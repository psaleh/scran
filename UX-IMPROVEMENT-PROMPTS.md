# UX improvement prompt pack

Prompts for executing the July 2026 UX review findings, one section per
session (written for Sonnet 5 or similar). Run them **in order** —
Prompt 2 builds the toast/confirm infrastructure that Prompts 3, 5, and
6 rely on. Paste the preamble at the top of every session, then the
prompt. Each prompt should end in its own commit.

Backlog ideas deliberately NOT in this pack: duplicate-recipe button
(reuse export→import round-trip), shopping-list count badge on the nav
item, PWA service worker (already tracked in CLAUDE.md "Remaining").

## Preamble (paste before every prompt)

> Read CLAUDE.md and frontend/.claude/CLAUDE.md first and follow their
> conventions exactly: Astryx components first, layout via inline styles
> with tokens (`var(--spacing-*)`, `var(--color-*)`) — no raw hex, no
> CSS frameworks; theme is matcha, do not change it. Use
> `npx astryx component <Name>` to check props before using an
> unfamiliar component. NEVER touch `backend/data/` or port 8000. Verify
> per CLAUDE.md "Verifying changes": build the frontend, run an isolated
> backend on port 8010 with a /tmp DB, seed a couple of recipes via the
> API, and screenshot with puppeteer-core + /usr/bin/chromium at 390×844
> and 1280×900. Commit when done with a clear message.

## Prompt 1 — Mobile/desktop layout bug fixes

> A UX review found these concrete layout bugs. Fix them all in
> `frontend/src`:
>
> 1. `pages/RecipeDetailPage.jsx`: on mobile (390px) the title sits
>    beside the action buttons and, for a draft (Publish + Export + Edit),
>    the Edit button is clipped off the right edge. Stack the header
>    vertically on mobile (title block, then an action row that wraps)
>    and reduce the title font size on mobile — currently it renders so
>    large that "Chicken Tikka Masala" wraps one word per line. Use the
>    existing `useIsDesktop()` hook.
> 2. `pages/RecipeDetailPage.jsx`: when a recipe has no photo, the
>    header still reserves the full 260/220px photo block for a
>    "no photo yet" placeholder. Shrink it to a compact strip.
> 3. `pages/RecipeDetailPage.jsx` (~L439): the desktop sticky left
>    ingredient column (`gridTemplateColumns: '420px 1fr'`, sticky top 0)
>    has no max-height, so a long ingredient list's bottom is
>    unreachable while the steps column scrolls. Cap it with a
>    viewport-height `maxHeight` + `overflowY: auto`, like the review
>    column in `pages/RecipeEditorPage.jsx` (~L735) already does.
> 4. `pages/ShoppingListPage.jsx`: in the manual add bar, the qty/unit/
>    name inputs push the "+" add button off-screen at 390px. Make the
>    name input flex and keep the button visible; also ensure pressing
>    Enter in the name field adds the item.
> 5. `pages/SettingsPage.jsx`: with 5 admin tabs, the TabList clips on
>    mobile ("Users"/"Auth" cut off) with no scroll affordance. Wrap it
>    in an `overflow-x: auto` container so tabs scroll horizontally.
> 6. `pages/BrowsePage.jsx`: the tag filter chips render as a sparse
>    grid eating ~3 rows on mobile, and are capped at `slice(0, 8)` so
>    tags 9+ can never be filtered. Make them one horizontally
>    scrollable row showing ALL tags.
> 7. `pages/BrowsePage.jsx` (~L207): the desktop grid is hard-coded
>    `repeat(4, 1fr)`; use `repeat(auto-fill, minmax(240px, 1fr))` so it
>    adapts between 1024px and ultrawide.
> 8. `App.jsx` (~L52 loading gate) and `pages/LoginPage.jsx` (~L15) use
>    `minHeight: '100vh'`; the project decision (see CLAUDE.md) is
>    `100dvh`. Fix both.
>
> Verify each fix visually with screenshots (a DRAFT recipe's detail
> page at 390px is the key one for #1/#2 — drafts show three action
> buttons).

## Prompt 2 — Shared toast + confirm infrastructure, error handling

> The app swallows most mutation errors and has no consistent success
> feedback or destructive-action confirmation. Build shared infra and
> apply it:
>
> 1. Check `npx astryx search toast` and `npx astryx search snackbar` —
>    if Astryx has a toast/snackbar component, use it; otherwise create
>    `components/Toaster.jsx`: a React context + fixed-position stack
>    (bottom of screen, sitting above the mobile bottom nav), with a
>    `useToast()` hook returning `toast.success(msg)` / `toast.error(msg)`,
>    plus support for an optional action button (`{ label, onClick }`) —
>    a later session uses that for Undo. Auto-dismiss after ~4s, dismiss
>    on tap. Mount the provider in `App.jsx`.
> 2. Create `components/ConfirmDialog.jsx` by extracting the
>    delete-confirmation dialog pattern from `pages/RecipeEditorPage.jsx`
>    (title, message, confirm/cancel, danger variant).
> 3. Apply confirmations to: Shopping "Clear all" AND "Clear completed"
>    (`pages/ShoppingListPage.jsx` ~L410/L250), note delete
>    (`pages/RecipeDetailPage.jsx` NoteRow ~L119), and in
>    `pages/SettingsPage.jsx`: AI-profile delete (~L131), store delete
>    (~L253), category delete (~L336), user delete (~L406), and the
>    admin toggle (~L403).
> 4. Error handling: wrap every unguarded `await api(...)` mutation in
>    try/catch → `toast.error(err.message)`. Key spots: RecipeDetailPage
>    `addToList`/`addAllToList`/`publish`/note save/delete (~L218-L236,
>    L78-86, L129); ShoppingListPage `addItem`/`toggleItem`/`removeItem`/
>    `recategorise`/`clear` (~L208-L252) — these update state
>    optimistically, so restore the previous state on failure;
>    SettingsPage `activate`/`remove`/`removeStore`/`move` (~L70-74,
>    L213-225) — `move` is optimistic, roll it back on failure. Also
>    `pages/ShoppingListPage.jsx` ~L183: a failed list load currently
>    renders as "list is empty" (`.catch(() => setItems([]))`) — show an
>    error state instead.
> 5. Success toasts: "Added to list" / "Added N items" (replacing or
>    complementing the ✓ flash), "Published", "Saved", "List cleared".
> 6. `pages/RecipeEditorPage.jsx`: `save` (~L535) has no busy flag —
>    rapid double-click on Save/Publish POSTs twice and creates
>    duplicate recipes. Add a busy state disabling Save/Save draft/
>    Save as version while in flight (match the existing `tidyWithAi`
>    busy pattern).
> 7. `pages/RecipeEditorPage.jsx`: add an unsaved-changes guard — track
>    dirty state (any field change after load) and show the
>    ConfirmDialog on the editor's own Back button (~L640) before
>    `navigate(-1)`. Don't try to intercept the global nav/browser
>    back — keep it simple.
>
> Verify: kill the backend mid-session and confirm a toggle/remove on
> the shopping list shows an error toast and rolls back; confirm Clear
> all asks first; double-click Save creates exactly one recipe.

## Prompt 3 — Accessibility and dialog consistency

> Fix these accessibility and consistency gaps (a shared toast system
> and ConfirmDialog from a previous session exist in `components/` —
> reuse them where feedback is needed):
>
> 1. `pages/BrowsePage.jsx` (~L23): `RecipeCard` is a clickable `<div>` —
>    not keyboard-focusable. Make the card a real link (react-router
>    `Link` with the styles preserved) so Enter/tab work and
>    middle-click opens a new tab.
> 2. `pages/RecipeEditorPage.jsx` (~L865): tag remove is a bare
>    `<span onClick>×</span>` — make it a real button with an
>    aria-label ("Remove tag <name>"), keyboard-operable.
> 3. Ingredient-name autocomplete (editor ~L247 and shopping ~L331) has
>    no keyboard navigation, while the tag autocomplete (editor ~L888,
>    key handling ~L453) supports arrows/Enter/Esc. Extract ONE shared
>    suggestion-dropdown component (or hook) with the tag field's
>    keyboard behaviour and use it in all three places.
> 4. `pages/ShoppingListPage.jsx`: complete/remove is swipe-only — no
>    keyboard/assistive path (plain tap intentionally does nothing;
>    keep that). Add "Mark done/not done" and "Remove" actions to the
>    existing per-row recategorise dialog so every action is reachable
>    without swiping.
> 5. `components/ImportUrlDialog.jsx` and
>    `components/ImportVideoDialog.jsx` pass `onOpenChange` straight
>    through, so cancelling keeps stale url/error state on reopen.
>    Reset state on close like `ImportDataDialog.jsx` does.
> 6. `pages/InboxPage.jsx`: error shows as a raw red `<span>` (~L236) —
>    use the same `<Banner status="error">` as other pages. Also the 5s
>    `setInterval` poll (~L129) runs even in hidden tabs — pause it on
>    `document.visibilitychange` and refresh immediately when visible
>    again.
> 7. `pages/SettingsPage.jsx`: sections render blank cards while
>    loading and when empty (e.g. AiProfilesSection ~L102). Add a small
>    Spinner during load and an empty-state line ("No profiles yet")
>    per section — StoresSection (~L272) already has one to copy.
> 8. `components/ExportRecipeDialog.jsx` (~L30):
>    `navigator.clipboard.writeText` throws on plain-HTTP LAN
>    deployments (this app is self-hosted). Guard it: fall back to
>    selecting the textarea text + `document.execCommand('copy')`, and
>    show an error message if copying still fails. Also add a loading
>    state while the export JSON is being fetched.
> 9. Object-URL leaks: `components/ImportPhotosDialog.jsx` (~L93) calls
>    `URL.createObjectURL` inside render on every pass and never
>    revokes; the editor photo preview (~L478) never revokes either.
>    Create URLs once per file (memo/state) and revoke on removal/
>    unmount.

## Prompt 4 — Polish and consistency pass

> Quality-only cleanup of `frontend/src` (no behaviour changes):
>
> 1. Font-size tokens: two families are mixed arbitrarily
>    (`--font-size-{sm,base,lg,xl}` vs
>    `--text-{body,label,supporting}-size`). Check
>    `npx astryx docs typography` for the intended roles and
>    standardise: use the `--text-*` role tokens where a role fits,
>    reserving `--font-size-*` only where no role exists. Apply across
>    pages/, components/, styles.js.
> 2. Replace raw px with tokens where an equivalent exists (spacing,
>    radii, icon sizes) — e.g. styles.js step circle (28px), BrowsePage
>    card image height, editor input widths. True layout dimensions
>    (column widths, maxWidths) may stay px.
> 3. Promote `DialogFrame` (currently private in
>    `pages/SettingsPage.jsx` ~L28) to `components/DialogFrame.jsx` and
>    use it in the four import dialogs and the editor's version/delete
>    dialogs, which each re-implement the same h2+p header block.
> 4. Share `formatAmount` (currently duplicated:
>    `pages/RecipeDetailPage.jsx` ~L22 and inline rounding in
>    `pages/ShoppingListPage.jsx` ~L54) — move it to `styles.js` or a
>    new `utils.js`.
> 5. Dead code: remove the unused `disabled` nav-item branch in
>    `components/AppNav.jsx` (~L37-43, L68, L99) and delete unused
>    `assets/hero.png` + `assets/vite.svg` if nothing imports them.
>    Leave the Inbox "Enqueue test job" button alone (it's removed in a
>    separate planned stage).
> 6. `components/AppNav.jsx`: the mobile bottom-nav "Shopping list"
>    label wraps to two lines — shorten to "Shopping" on mobile. The
>    mobile logout button hand-rolls nav-item styling — align it with
>    the shared `itemStyle` used by the NavLinks.
> 7. `pages/LoginPage.jsx`: the page title is plain "Scran" text —
>    match the nav wordmark ("scran." with the orange dot, see AppNav
>    ~L27) and make it a proper h1.
>
> Verify with `npm run build` + before/after screenshots of every
> screen to confirm nothing regressed visually.

## Prompt 5 — Features: shopping undo + browse sort/filter

> Two small features. The app has a shared toast system with action
> buttons (`useToast` in `components/`) and a ConfirmDialog — reuse
> them.
>
> 1. **Undo for shopping list.** In `pages/ShoppingListPage.jsx`, after
>    a swipe-remove show `toast('Removed <name>', { action: Undo })`;
>    after Clear all / Clear completed show `toast('Cleared N items',
>    { action: Undo })`. Undo re-adds the removed item(s) via
>    `POST /api/shopping` — keep the full removed item objects (name,
>    amount, unit, category_id, recipe_id/title, completed) in a ref
>    until the toast dismisses. Check `backend/app/shopping.py`
>    `ManualItemIn` (~L23) — if it can't carry `recipe_id`/completed
>    state, extend it with optional fields so an undone item keeps its
>    recipe tag and checked state.
> 2. **Browse sort + draft filter.** Backend `backend/app/recipes.py`
>    `GET /api/recipes` (~L235): add `sort=newest|updated|title`
>    (default: current order) mapping to `created_at DESC` /
>    `updated_at DESC` / `title COLLATE NOCASE`, and a `status=draft`
>    filter param (cards already receive `status` — the Draft badge
>    uses it). Frontend `pages/BrowsePage.jsx`: a compact Select
>    ("Newest / Recently updated / A–Z") next to the search box, and a
>    "Drafts" chip rendered with the tag filter chips that toggles the
>    status filter. Keep the 250ms debounced fetch pattern.
>
> Verify end-to-end on the isolated instance: remove an item, Undo it,
> confirm it returns with its recipe tag; sort by A–Z and filter drafts
> in the browse screen.

## Prompt 6 — Features: "I cooked this" + kitchen wake-lock

> Two small additions to `pages/RecipeDetailPage.jsx`:
>
> 1. **"I cooked this."** A button in the notes section header that
>    POSTs to the existing `/api/recipes/{id}/notes`. Open a small
>    pre-filled dialog first ("Cooked this 🍳") so the user can
>    optionally add detail (e.g. "Cooked this — swapped cream for
>    yoghurt") before saving. Reuse the existing note-add flow/refresh;
>    success toast. The notes list then doubles as a cooking history.
> 2. **Cook mode (screen wake lock).** A toggle IconButton near the
>    servings stepper: on enable, call
>    `navigator.wakeLock.request('screen')`; re-acquire on
>    `visibilitychange` when the page becomes visible; release on
>    toggle-off and on unmount. Hide the button entirely when
>    `'wakeLock' in navigator` is false (also covers insecure-context
>    deployments, where the API is absent). Show state clearly (filled
>    vs outline icon + aria-pressed).
>
> Verify: cooked-this note appears newest-first with author+timestamp;
> wake-lock toggle visually flips state (a functional wake-lock check
> needs a real device — note that in the commit message).
