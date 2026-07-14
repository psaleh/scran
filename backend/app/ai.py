"""Shared client for OpenAI-compatible chat-completions endpoints (spec §5.1).

Every AI call in the app — LM Studio on the owner's PC, OpenRouter, or any
other OpenAI-compatible server — goes through this module. Like the URL
importer, it is deliberately stdlib-only (urllib + json) to keep the
dependency count low.

Logging policy (spec: debuggable from container logs): we log request/response
*summaries* — endpoint host, model, message count, payload sizes, latency,
errors — never full payloads and never API keys.
"""

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("scran.ai")

# Long default: local models on modest hardware can be slow, especially with
# images. Callers with tighter needs (the reachability probe) pass their own.
CHAT_TIMEOUT_SECONDS = 300
PROBE_TIMEOUT_SECONDS = 5


class AiError(Exception):
    """Any failure talking to the AI endpoint; str() is safe to show users."""


def get_active_profile(db):
    """Return the active ai_profiles row, or None if none is configured."""
    return db.execute("SELECT * FROM ai_profiles WHERE is_default = 1").fetchone()


def get_video_profile(db):
    """The profile dedicated to YouTube video extraction (purpose = 'video'),
    or None — video import is unavailable until the household configures one
    (it needs a video-capable hosted model, e.g. Gemini via OpenRouter,
    which is usually not the same endpoint as the everyday profile)."""
    return db.execute(
        "SELECT * FROM ai_profiles WHERE purpose = 'video' ORDER BY id LIMIT 1"
    ).fetchone()


def _endpoint(profile, path):
    return profile["base_url"].rstrip("/") + path


def _host(profile):
    """Loggable identity of the endpoint (no path, no credentials)."""
    return urllib.parse.urlsplit(profile["base_url"]).netloc or profile["base_url"]


def probe(profile, timeout=PROBE_TIMEOUT_SECONDS):
    """Cheap reachability check: GET /models with a short timeout.

    Returns True/False; never raises. Used by the job worker before picking
    up work, so an unreachable endpoint (PC switched off) leaves jobs pending.
    """
    request = urllib.request.Request(_endpoint(profile, "/models"), headers=_headers(profile))
    try:
        with urllib.request.urlopen(request, timeout=timeout):
            return True
    except Exception as exc:  # any network/HTTP problem means "not reachable"
        log.info("AI probe failed for %s: %s", _host(profile), exc)
        return False


def _headers(profile):
    headers = {"Content-Type": "application/json"}
    if profile["api_key"]:
        headers["Authorization"] = f"Bearer {profile['api_key']}"
    return headers


def chat(profile, messages, max_tokens=None, timeout=CHAT_TIMEOUT_SECONDS, temperature=None,
         response_format=None):
    """Send a chat-completions request and return the assistant message text.

    `messages` is standard OpenAI format (role/content dicts; content may be
    the multimodal list form for vision/video requests). Raises AiError with
    a human-readable message on any failure. Pass temperature=0 for
    transcription/extraction tasks where inventiveness is a bug, and
    response_format={"type": "json_object"} to ask hosted endpoints for
    guaranteed-JSON replies (local servers may ignore it — callers must
    still parse defensively).
    """
    payload = {"model": profile["model"], "messages": messages}
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    if temperature is not None:
        payload["temperature"] = temperature
    if response_format is not None:
        payload["response_format"] = response_format
    body = json.dumps(payload).encode("utf-8")

    log.info(
        "AI request → %s model=%s messages=%d bytes=%d",
        _host(profile), profile["model"], len(messages), len(body),
    )
    started = time.monotonic()
    request = urllib.request.Request(
        _endpoint(profile, "/chat/completions"), data=body, headers=_headers(profile)
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        detail = _error_detail(exc)
        log.warning("AI request failed: %s HTTP %s: %s", _host(profile), exc.code, detail)
        raise AiError(f"Endpoint returned HTTP {exc.code}: {detail}")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        log.warning("AI request failed: %s unreachable: %s", _host(profile), reason)
        raise AiError(f"Could not reach endpoint: {reason}")

    elapsed = time.monotonic() - started
    try:
        data = json.loads(raw)
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        log.warning("AI response from %s was not valid chat-completions JSON", _host(profile))
        raise AiError("Endpoint returned an unexpected response format (not chat-completions JSON)")
    if not isinstance(content, str):
        raise AiError("Endpoint returned an empty or non-text response")

    log.info(
        "AI response ← %s model=%s chars=%d elapsed=%.1fs",
        _host(profile), profile["model"], len(content), elapsed,
    )
    return content


def _error_detail(exc):
    """Extract a short human-readable message from an HTTP error body."""
    try:
        body = exc.read(2048).decode("utf-8", "replace")
        data = json.loads(body)
        # OpenAI-style errors nest the message under "error".
        err = data.get("error", data)
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:300]
        return body[:300]
    except Exception:
        return exc.reason if getattr(exc, "reason", None) else "no detail"


def test_profile(profile):
    """Trivial round-trip used by the settings "Test connection" button.

    Returns (ok, message); never raises.
    """
    try:
        started = time.monotonic()
        reply = chat(
            profile,
            [{"role": "user", "content": "Reply with the single word: OK"}],
            max_tokens=100,
            timeout=60,
        )
        elapsed = time.monotonic() - started
        return True, f'Success in {elapsed:.1f}s — model replied: "{reply.strip()[:80]}"'
    except AiError as exc:
        return False, str(exc)
