"""Website recipe import (spec §3.3.2).

The user pastes a URL; we fetch the page server-side and look for
schema.org/Recipe structured data — JSON-LD first (what nearly every
recipe site publishes today), then a microdata fallback for older sites.
The parsed result is returned to the browser and opens pre-filled in the
recipe editor for review; nothing is saved to the database here.

Deliberately stdlib-only (urllib + html.parser + json) to keep the
dependency count low, per the project conventions.
"""

import json
import re
import sqlite3
import urllib.error
import urllib.request
from html import unescape
from html.parser import HTMLParser

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import worker
from .auth.deps import get_current_user
from .db import get_db
from .jobs import _job

router = APIRouter(prefix="/api", tags=["import"])

FETCH_TIMEOUT_SECONDS = 15
MAX_PAGE_BYTES = 5 * 1024 * 1024  # recipe pages are text; 5 MB is generous
# Cap on stored page text (spec §5.5: truncate to a sane length for
# local-model context limits). ~30k chars ≈ 8k tokens.
MAX_PAGE_TEXT_CHARS = 30_000
# Some sites block default urllib UAs; present as an ordinary browser.
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) Scran/1.0 (self-hosted recipe manager)"


class ImportRequest(BaseModel):
    url: str = Field(min_length=1)


# --- Page fetching -------------------------------------------------------------

def _fetch_html(url: str) -> str:
    """Download the page and return decoded HTML, with friendly errors."""
    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Enter a full http:// or https:// URL")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_PAGE_BYTES)
            # Respect the declared charset when there is one; recipe sites are
            # overwhelmingly UTF-8, so that's the fallback.
            charset = response.headers.get_content_charset() or "utf-8"
    except urllib.error.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"The website returned an error (HTTP {exc.code})"
        )
    except (urllib.error.URLError, TimeoutError) as exc:
        raise HTTPException(
            status_code=502, detail="Couldn't reach that website — check the URL and try again"
        )
    return raw.decode(charset, errors="replace")


# --- Readable page text ----------------------------------------------------------

class _TextCollector(HTMLParser):
    """Strips a page down to its readable text: everything except
    script/style/template contents, with line breaks between block elements.
    Rough is fine — this text is prompt fodder for the AI redraft job."""

    _SKIP = {"script", "style", "template", "noscript", "svg", "head"}
    _BLOCK = {"p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
              "tr", "br", "section", "article", "header", "footer", "table"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip_depth:
            self._skip_depth -= 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip_depth:
            self.parts.append(data)


def _page_text(html: str) -> str:
    """Readable text of the page, whitespace-collapsed and length-capped."""
    collector = _TextCollector()
    collector.feed(html)
    lines = ("".join(collector.parts)).splitlines()
    cleaned = [" ".join(line.split()) for line in lines]
    text = "\n".join(line for line in cleaned if line)
    return text[:MAX_PAGE_TEXT_CHARS]


# --- JSON-LD extraction --------------------------------------------------------

class _JsonLdCollector(HTMLParser):
    """Collects the text of every <script type="application/ld+json"> block."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self._in_ld_script = False
        self._buffer: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("type", "").strip().lower() == "application/ld+json":
            self._in_ld_script = True
            self._buffer = []

    def handle_endtag(self, tag):
        if tag == "script" and self._in_ld_script:
            self._in_ld_script = False
            self.blocks.append("".join(self._buffer))

    def handle_data(self, data):
        if self._in_ld_script:
            self._buffer.append(data)


def _is_recipe_node(node) -> bool:
    """True if a JSON-LD node declares @type Recipe (possibly among others)."""
    if not isinstance(node, dict):
        return False
    node_type = node.get("@type", "")
    types = node_type if isinstance(node_type, list) else [node_type]
    return any(isinstance(t, str) and t.lower() == "recipe" for t in types)


def _find_recipe_node(data):
    """Walk arbitrarily nested JSON-LD (top-level lists, @graph wrappers,
    mainEntity, …) and return the first Recipe node found."""
    if _is_recipe_node(data):
        return data
    if isinstance(data, list):
        for item in data:
            found = _find_recipe_node(item)
            if found:
                return found
    elif isinstance(data, dict):
        for key in ("@graph", "mainEntity", "mainEntityOfPage"):
            if key in data:
                found = _find_recipe_node(data[key])
                if found:
                    return found
    return None


def _extract_json_ld_recipe(html: str) -> dict | None:
    collector = _JsonLdCollector()
    collector.feed(html)
    for block in collector.blocks:
        try:
            data = json.loads(block.strip())
        except json.JSONDecodeError:
            continue  # malformed block — try the next one
        node = _find_recipe_node(data)
        if node:
            return node
    return None


# --- Microdata fallback --------------------------------------------------------

class _MicrodataRecipeParser(HTMLParser):
    """Minimal microdata extractor: once inside an
    itemscope/itemtype=…schema.org/Recipe element, record the text (or
    content attribute) of each itemprop we care about. This intentionally
    doesn't implement the full microdata nesting model — it's a fallback
    for older sites, and recipe pages are flat enough in practice."""

    PROPS = {"name", "description", "recipeYield", "recipeIngredient",
             "ingredients", "recipeInstructions", "keywords"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found = False
        self._done = False  # set once the Recipe scope has closed
        self.props: dict[str, list[str]] = {}
        self._depth = 0            # tag depth inside the Recipe scope
        self._current_prop = None  # itemprop currently capturing text
        self._prop_depth = 0
        self._buffer: list[str] = []

    def handle_starttag(self, tag, attrs):
        if self._done:
            return
        a = dict(attrs)
        if not self.found:
            if "itemscope" in a and "schema.org/recipe" in a.get("itemtype", "").lower():
                self.found = True
                self._depth = 1
            return
        self._depth += 1
        prop = a.get("itemprop")
        if prop in self.PROPS and self._current_prop is None:
            # <meta itemprop=… content=…> carries its value in the attribute.
            if "content" in a:
                self.props.setdefault(prop, []).append(a["content"])
            else:
                self._current_prop = prop
                self._prop_depth = self._depth
                self._buffer = []

    def handle_endtag(self, tag):
        if not self.found or self._done:
            return
        if self._current_prop is not None and self._depth == self._prop_depth:
            text = " ".join("".join(self._buffer).split())
            if text:
                self.props.setdefault(self._current_prop, []).append(text)
            self._current_prop = None
        self._depth -= 1
        if self._depth <= 0:
            self._done = True  # scope closed; stop collecting

    def handle_data(self, data):
        if self._current_prop is not None:
            self._buffer.append(data)


def _extract_microdata_recipe(html: str) -> dict | None:
    parser = _MicrodataRecipeParser()
    parser.feed(html)
    if not parser.props:
        return None
    p = parser.props
    # Reshape into the same keys a JSON-LD Recipe node uses so the
    # normalisation below handles both sources identically.
    return {
        "name": (p.get("name") or [""])[0],
        "description": (p.get("description") or [""])[0],
        "recipeYield": (p.get("recipeYield") or [None])[0],
        "recipeIngredient": p.get("recipeIngredient") or p.get("ingredients") or [],
        "recipeInstructions": p.get("recipeInstructions") or [],
        "keywords": (p.get("keywords") or [""])[0],
    }


# --- Normalising schema.org values ---------------------------------------------

def _as_text(value) -> str:
    """schema.org values are wildly inconsistent: strings, lists, or nested
    objects with a "name"/"text" field. Reduce anything to a plain string."""
    if value is None:
        return ""
    if isinstance(value, str):
        return unescape(value).strip()
    if isinstance(value, list):
        return _as_text(value[0]) if value else ""
    if isinstance(value, dict):
        return _as_text(value.get("name") or value.get("text") or value.get("@value"))
    return str(value).strip()


def _parse_servings(value) -> int | None:
    """recipeYield might be 4, "4", "4 servings", "Serves 4-6", or a list."""
    text = _as_text(value)
    match = re.search(r"\d+", text)
    return int(match.group()) if match else None


def _parse_steps(value) -> list[str]:
    """recipeInstructions: a string, a list of strings, a list of HowToStep
    objects, or HowToSection objects containing itemListElement steps."""
    if value is None:
        return []
    if isinstance(value, str):
        # Single blob — split on newlines into individual steps.
        return [s.strip() for s in re.split(r"\n+", value) if s.strip()]
    if isinstance(value, dict):
        if "itemListElement" in value:  # HowToSection
            return _parse_steps(value["itemListElement"])
        text = _as_text(value)
        return [text] if text else []
    if isinstance(value, list):
        steps: list[str] = []
        for item in value:
            steps.extend(_parse_steps(item))
        return steps
    return []


def _parse_tags(node: dict) -> list[str]:
    """Build tags from keywords + recipeCategory + recipeCuisine, deduped."""
    raw: list[str] = []
    keywords = node.get("keywords")
    if isinstance(keywords, str):
        raw.extend(k.strip() for k in keywords.split(","))
    elif isinstance(keywords, list):
        raw.extend(_as_text(k) for k in keywords)
    for key in ("recipeCategory", "recipeCuisine"):
        value = node.get(key)
        if isinstance(value, list):
            raw.extend(_as_text(v) for v in value)
        else:
            raw.append(_as_text(value))
    seen, tags = set(), []
    for tag in raw:
        tag = tag.strip()
        if tag and len(tag) <= 40 and tag.lower() not in seen:
            seen.add(tag.lower())
            tags.append(tag)
    return tags[:8]  # sites often stuff dozens of SEO keywords in — cap it


# Units we recognise at the start of an ingredient string. Longest first so
# "tablespoons" wins over "tablespoon" etc. when matching.
_UNITS = sorted(
    [
        "tablespoons", "tablespoon", "tbsps", "tbsp", "teaspoons", "teaspoon",
        "tsps", "tsp", "cups", "cup", "grams", "gram", "kilograms", "kilogram",
        "kg", "g", "millilitres", "milliliters", "ml", "litres", "liters",
        "litre", "liter", "l", "ounces", "ounce", "oz", "pounds", "pound",
        "lbs", "lb", "pinches", "pinch", "cloves", "clove", "slices", "slice",
        "cans", "can", "tins", "tin", "packs", "pack", "handfuls", "handful",
        "sticks", "stick", "sprigs", "sprig", "bunches", "bunch", "pieces", "piece",
    ],
    key=len,
    reverse=True,
)

_UNICODE_FRACTIONS = {"½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75,
                      "⅕": 0.2, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875}


def _parse_amount(text: str) -> tuple[float | None, str]:
    """Pull a leading amount off an ingredient string.
    Handles "2", "1.5", "1/2", "1 1/2", "½", "1½", and ranges like "2-3"
    (take the first number). Returns (amount, remainder)."""
    text = text.strip()
    # Unicode fraction, optionally preceded by a whole number: "1½"
    m = re.match(r"^(\d+)?\s*([½⅓⅔¼¾⅕⅛⅜⅝⅞])\s*", text)
    if m:
        whole = int(m.group(1)) if m.group(1) else 0
        return whole + _UNICODE_FRACTIONS[m.group(2)], text[m.end():]
    # "1 1/2" or "1/2"
    m = re.match(r"^(?:(\d+)\s+)?(\d+)\s*/\s*(\d+)\s*", text)
    if m and int(m.group(3)) != 0:
        whole = int(m.group(1)) if m.group(1) else 0
        return whole + int(m.group(2)) / int(m.group(3)), text[m.end():]
    # Plain number, possibly a range "2-3" (keep the first number).
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(?:[-–—]\s*\d+(?:\.\d+)?)?\s*", text)
    if m:
        return float(m.group(1)), text[m.end():]
    return None, text


# Leading size/qualifier words that belong in the note, not the shoppable
# name (spec §3.2: "1 small onion" → name "onion", note "small").
_NOTE_PREFIX_WORDS = {"small", "medium", "large", "big", "extra-large", "ripe",
                      "fresh", "frozen", "optional"}


def _split_name_note(text: str) -> tuple[str, str | None]:
    """Split an ingredient line into (name, note) per spec §3.2/§3.3:
    parenthesised text and trailing text after the first comma go to the
    note, as do leading size words like "small". Imperfect splits are fine —
    the user reviews the result in the editor."""
    notes: list[str] = []

    # "(finely chopped)" anywhere in the line → note.
    def _capture(match):
        notes.append(match.group(1).strip())
        return " "
    text = re.sub(r"\(([^)]*)\)", _capture, text)

    # "onion, finely diced" → everything after the first comma is note.
    name, _, trailing = text.partition(",")
    if trailing.strip():
        notes.append(trailing.strip())

    # "small onion" → strip leading qualifier words into the note.
    words = name.split()
    prefix: list[str] = []
    while len(words) > 1 and words[0].lower() in _NOTE_PREFIX_WORDS:
        prefix.append(words.pop(0).lower())
    notes = prefix + notes
    name = " ".join(words).strip()

    notes = [n for n in notes if n]
    return name, ", ".join(notes) or None


def _parse_ingredient(text: str) -> dict:
    """Split "2 tbsp olive oil" into amount/unit/name/note. Best-effort —
    whatever doesn't parse cleanly just stays in the name for the user to
    tidy in the editor (this is a review flow, not a data pipeline)."""
    text = " ".join(unescape(text).split())
    amount, rest = _parse_amount(text)
    unit = None
    if amount is not None:
        for candidate in _UNITS:
            # Unit must be a whole word ("g " but not "garlic").
            m = re.match(rf"^{candidate}\b\.?\s+", rest, re.IGNORECASE)
            if m:
                unit = candidate
                rest = rest[m.end():]
                break
    if unit:
        # "2 cups of flour" → drop the connecting "of".
        rest = re.sub(r"^of\s+", "", rest, flags=re.IGNORECASE)
    name, note = _split_name_note(rest.strip())
    return {
        # Round away float-division noise ("⅓" → 0.33, not 0.3333333…).
        "amount": round(amount, 2) if amount is not None else None,
        "unit": unit,
        "name": name or text,  # never return an empty name
        "note": note,
        "category_id": None,
        "scalable": True,
    }


def _parse_ingredients(node: dict) -> list[dict]:
    raw = node.get("recipeIngredient") or node.get("ingredients") or []
    if isinstance(raw, str):
        raw = [raw]
    return [_parse_ingredient(_as_text(i)) for i in raw if _as_text(i)]


# --- Endpoint ------------------------------------------------------------------

@router.post("/import/url")
def import_from_url(body: ImportRequest, user=Depends(get_current_user)):
    """Fetch a recipe page and return editor-ready recipe data. Nothing is
    saved — the frontend opens the result in the editor for human review."""
    url = body.url.strip()
    html = _fetch_html(url)

    node = _extract_json_ld_recipe(html) or _extract_microdata_recipe(html)
    if node is None:
        # 422 signals "page fetched fine but no structured data" — the
        # frontend offers AI extraction as a fallback (spec §3.3.2).
        raise HTTPException(
            status_code=422,
            detail="No recipe data found on that page. The site may not "
                   "publish structured recipe data — you can still add the "
                   "recipe manually.",
        )

    title = _as_text(node.get("name"))
    if not title:
        raise HTTPException(
            status_code=422,
            detail="Found recipe data but it has no title — try adding the recipe manually.",
        )

    return {
        "title": title,
        "description": _as_text(node.get("description")),
        "servings": _parse_servings(node.get("recipeYield")),
        "tags": _parse_tags(node),
        "source_url": url,
        # Retained on the saved draft to power "Tidy up with AI" (spec §5.5).
        "source_page_text": _page_text(html),
        "ingredients": _parse_ingredients(node),
        "steps": _parse_steps(node.get("recipeInstructions")),
    }


@router.post("/import/url/ai", status_code=201)
def import_from_url_ai(
    body: ImportRequest,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    """AI-extraction fallback for pages without schema.org data (spec §3.3.2,
    §5.5): fetch the page, strip it to readable text, and queue a url_redraft
    job with no draft. The result lands in the import inbox for review."""
    url = body.url.strip()
    text = _page_text(_fetch_html(url))
    if not text.strip():
        raise HTTPException(status_code=422, detail="That page has no readable text to extract from")
    cur = db.execute(
        "INSERT INTO jobs (type, payload) VALUES ('url_redraft', ?)",
        (json.dumps({"url": url, "page_text": text}),),
    )
    db.commit()
    worker.wake()
    return _job(db.execute("SELECT * FROM jobs WHERE id = ?", (cur.lastrowid,)).fetchone())
