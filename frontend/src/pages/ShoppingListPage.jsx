import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Dialog } from '@astryxdesign/core/Dialog'
import { Divider } from '@astryxdesign/core/Divider'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Selector } from '@astryxdesign/core/Selector'
import { Spinner } from '@astryxdesign/core/Spinner'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { TextInput } from '@astryxdesign/core/TextInput'

import { api } from '../api.js'
import TagBadge from '../components/TagBadge.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { useToast } from '../components/Toaster.jsx'
import { SuggestionDropdown, useSuggestionKeyboard } from '../components/SuggestionDropdown.jsx'
import { formatAmount, sectionLabelStyle } from '../styles.js'

const SWIPE_THRESHOLD = 140

/**
 * One list row. Interactions (from the design mockup):
 * - swipe right = toggle checked, swipe left = remove
 * - plain tap expands a detail row underneath showing quantity + recipe tag
 *   (tap again, or tap a different row, to collapse it — only one row is
 *   expanded at a time, tracked by the parent)
 */
function ItemRow({ item, onToggle, onRemove, onRecategorise, isExpanded, onToggleExpand }) {
  const [dx, setDx] = useState(0)
  const dragRef = useRef(null)

  const onPointerDown = (e) => {
    dragRef.current = { startX: e.clientX, active: true, moved: false }
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Synthetic events (tests) have no active pointer — dragging still works.
    }
  }
  const onPointerMove = (e) => {
    if (!dragRef.current?.active) return
    const delta = e.clientX - dragRef.current.startX
    if (Math.abs(delta) > 5) dragRef.current.moved = true
    setDx(delta)
  }
  const endDrag = () => {
    if (!dragRef.current) return
    const wasTap = !dragRef.current.moved
    dragRef.current.active = false
    if (dx > SWIPE_THRESHOLD) {
      onToggle(item)
    } else if (dx < -SWIPE_THRESHOLD) {
      onRemove(item)
      return
    } else if (wasTap) {
      onToggleExpand(item.id)
    }
    setDx(0)
  }

  const meta = [formatAmount(item.amount), item.unit].filter(Boolean).join(' ')
  const revealRight = dx > 0
  const revealAmount = Math.min(Math.abs(dx), SWIPE_THRESHOLD)

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Swipe reveal background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: revealRight ? 'flex-start' : 'flex-end',
          padding: '0 var(--spacing-4)',
          background: revealRight ? 'var(--color-success)' : 'var(--color-error)',
          color: revealRight ? 'var(--color-on-success)' : 'var(--color-on-error)',
          fontSize: 'var(--text-label-size)',
          fontWeight: 'var(--font-weight-medium)',
          opacity: revealAmount / SWIPE_THRESHOLD,
        }}
      >
        {revealRight ? (item.checked ? 'Uncheck' : 'Done') : 'Remove'}
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-3)',
          padding: 'var(--spacing-4)',
          background: 'var(--color-background-surface)',
          touchAction: 'pan-y',
          cursor: 'pointer',
          userSelect: 'none',
          transform: `translateX(${dx}px)`,
          transition: dragRef.current?.active ? 'none' : 'transform 200ms cubic-bezier(0.24,1,0.4,1)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 'var(--font-size-md)',
              fontWeight: 'var(--font-weight-medium)',
              color: item.checked ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
              textDecoration: item.checked ? 'line-through' : 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.name}
          </div>
          {/* Quantity + recipe tag are hidden until the row is tapped, so the
              name gets full width and the list reads cleaner while shopping.
              Grid-rows trick animates a variable-height reveal without
              measuring content. */}
          {(meta || item.recipe_title) && (
            <div
              style={{
                maxHeight: isExpanded ? 40 : 0,
                overflow: 'hidden',
                transition: 'max-height 180ms ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', paddingTop: 2 }}>
                {meta && (
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
                    {meta}
                  </span>
                )}
                {item.recipe_title && <TagBadge tag={item.recipe_title} />}
              </div>
            </div>
          )}
        </div>
        {/* Item actions (recategorise, spec §3.6.4, plus mark done/remove and
            move-to-list — the only non-swipe/non-drag path for those). Stop
            pointer events so the tap doesn't also toggle the item or start a
            swipe. */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={{ flexShrink: 0 }}
        >
          <IconButton
            label={`${item.name} actions`}
            icon={<span>⊞</span>}
            variant="ghost"
            size="sm"
            onClick={() => onRecategorise(item)}
          />
        </div>
      </div>
    </div>
  )
}

function CategorySection({ label, items, onToggle, onRemove, onRecategorise, expandedItemId, onToggleExpand }) {
  return (
    <div>
      <div style={{ ...sectionLabelStyle, padding: 'var(--spacing-3) var(--spacing-4) var(--spacing-1)' }}>
        {label}
      </div>
      <Card padding={0} style={{ margin: '0 var(--spacing-4)', overflow: 'hidden' }}>
        {items.map((item, i) => (
          <div key={item.id}>
            {i > 0 && <Divider />}
            <ItemRow
              item={item}
              onToggle={onToggle}
              onRemove={onRemove}
              onRecategorise={onRecategorise}
              isExpanded={expandedItemId === item.id}
              onToggleExpand={onToggleExpand}
            />
          </div>
        ))}
      </Card>
    </div>
  )
}

/** Shopping list (spec §3.4, §6.6): store-ordered category groups, recipe
 * tags, adjacent duplicate grouping, check-off, manual add w/ autocomplete.
 * Multiple named lists appear as tabs; items move between them via drag or
 * the ⊞ dialog. All items are fetched once and filtered client-side so tab
 * switching, per-tab counts and cross-list undo need no extra requests. */
export default function ShoppingListPage() {
  const [items, setItems] = useState(null)
  const [listError, setListError] = useState(null)
  const [categories, setCategories] = useState([])
  const [stores, setStores] = useState([])
  const [storeId, setStoreId] = useState(() => localStorage.getItem('scran.store') || '')
  const [lists, setLists] = useState([])
  const [activeListId, setActiveListId] = useState(null)
  const toast = useToast()

  // Id of the one row currently showing its quantity/recipe-tag detail
  // (null = none expanded). Tapping a row toggles this; tapping a different
  // row swaps which one is expanded rather than allowing several at once.
  const [expandedItemId, setExpandedItemId] = useState(null)
  const toggleExpanded = (id) => setExpandedItemId((prev) => (prev === id ? null : id))

  const headerObserverRef = useRef(null)
  const footerObserverRef = useRef(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  const [footerHeight, setFooterHeight] = useState(0)

  // Callback refs (not a plain ref + effect) so we measure correctly even
  // though the footer node conditionally mounts/unmounts as the list goes
  // from empty to non-empty — React calls this the moment the real DOM node
  // appears or disappears, with no dependency array needed.
  const headerRef = useCallback((node) => {
    headerObserverRef.current?.disconnect()
    if (node && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => setHeaderHeight(entry.contentRect.height))
      observer.observe(node)
      headerObserverRef.current = observer
    }
  }, [])
  const footerRef = useCallback((node) => {
    footerObserverRef.current?.disconnect()
    if (node && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => setFooterHeight(entry.contentRect.height))
      observer.observe(node)
      footerObserverRef.current = observer
    }
  }, [])

  const [chromeHidden, setChromeHidden] = useState(false)
  const handleListScroll = (e) => {
    const y = e.currentTarget.scrollTop
    if (y > 20 && !chromeHidden) setChromeHidden(true)
    else if (y <= 4 && chromeHidden) setChromeHidden(false)
  }

  // Clear-all/Clear-completed confirmation: null = closed, else which kind.
  const [clearConfirm, setClearConfirm] = useState(null)
  const [clearBusy, setClearBusy] = useState(false)

  // Add bar state
  const [draft, setDraft] = useState('')
  const [draftAmount, setDraftAmount] = useState('')
  const [draftUnit, setDraftUnit] = useState('')
  const [draftCategory, setDraftCategory] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const blurTimer = useRef(null)

  // Item being recategorised via the per-row dialog (null = closed).
  const [recatItem, setRecatItem] = useState(null)

  useEffect(() => {
    api('/api/shopping')
      .then(setItems)
      .catch((err) => {
        setListError(err.message || 'Failed to load the shopping list.')
        setItems([])
      })
    api('/api/shopping-lists')
      .then((loaded) => {
        setLists(loaded)
        // Restore the last-viewed tab; fall back to the default list when the
        // stored id is stale (list deleted since).
        const stored = Number(localStorage.getItem('scran.shoppingList'))
        const valid = loaded.find((l) => l.id === stored)
        setActiveListId(valid ? valid.id : loaded.find((l) => l.is_default)?.id ?? null)
      })
      .catch(() => {})
    api('/api/categories').then(setCategories).catch(() => {})
    api('/api/stores').then(setStores).catch(() => {})
  }, [])

  // Autocomplete against the shared ingredient lookup (spec §3.2).
  useEffect(() => {
    if (draft.trim().length < 2 || !suggestOpen) {
      setSuggestions([])
      return
    }
    const timer = setTimeout(() => {
      api(`/api/ingredients/suggest?q=${encodeURIComponent(draft.trim())}`)
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
    }, 150)
    return () => clearTimeout(timer)
  }, [draft, suggestOpen])

  const selectStore = (value) => {
    setStoreId(value ?? '')
    if (value) localStorage.setItem('scran.store', value)
    else localStorage.removeItem('scran.store')
  }

  const selectList = (listId) => {
    setActiveListId(listId)
    localStorage.setItem('scran.shoppingList', String(listId))
  }

  const addItem = async () => {
    const name = draft.trim()
    if (!name) return
    try {
      const created = await api('/api/shopping', {
        method: 'POST',
        body: {
          name,
          amount: draftAmount === '' ? null : Number(draftAmount) || null,
          unit: draftUnit.trim() || null,
          category_id: draftCategory,
          list_id: activeListId,
        },
      })
      setItems((list) => [...list, created])
      setDraft('')
      setDraftAmount('')
      setDraftUnit('')
      setDraftCategory(null)
      setSuggestOpen(false)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const pickSuggestion = (s) => {
    setDraft(s.name)
    setDraftCategory(s.category_id)
    setSuggestOpen(false)
  }

  const suggestKeys = useSuggestionKeyboard({
    suggestions,
    isOpen: suggestOpen,
    onPick: pickSuggestion,
    onClose: () => setSuggestOpen(false),
  })

  const toggleItem = async (item) => {
    setExpandedItemId((id) => (id === item.id ? null : id))
    // Optimistic: flip locally, then persist; roll back on failure.
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)))
    try {
      await api(`/api/shopping/${item.id}`, { method: 'PATCH', body: { checked: !item.checked } })
    } catch (err) {
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, checked: item.checked } : i)))
      toast.error(err.message)
    }
  }

  // Undo re-adds a removed item via POST /api/shopping, carrying enough of
  // its old shape (recipe tag, checked state) to look like it never left.
  const restoreItems = async (removed) => {
    try {
      const created = await Promise.all(
        removed.map((item) =>
          api('/api/shopping', {
            method: 'POST',
            body: {
              name: item.name,
              amount: item.amount,
              unit: item.unit,
              note: item.note,
              category_id: item.category_id,
              recipe_id: item.recipe_id,
              checked: item.checked,
              // Restore to the item's original list (the server falls back to
              // the default list if that list has since been deleted).
              list_id: item.list_id,
            },
          }),
        ),
      )
      setItems((list) => [...list, ...created])
    } catch (err) {
      toast.error(err.message)
    }
  }

  const removeItem = async (item) => {
    setExpandedItemId((id) => (id === item.id ? null : id))
    const previous = items
    setItems((list) => list.filter((i) => i.id !== item.id))
    try {
      await api(`/api/shopping/${item.id}`, { method: 'DELETE' })
      toast.success(`Removed ${item.name}`, { action: { label: 'Undo', onClick: () => restoreItems([item]) } })
    } catch (err) {
      setItems(previous)
      toast.error(err.message)
    }
  }

  // Move (never copy) an item to another list — from a drag onto a tab or
  // the ⊞ dialog picker. Optimistic, rolled back on failure.
  const moveItem = async (item, listId) => {
    if (item.list_id === listId) return
    const previous = items
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, list_id: listId } : i)))
    try {
      await api(`/api/shopping/${item.id}`, { method: 'PATCH', body: { list_id: listId } })
      const target = lists.find((l) => l.id === listId)
      toast.success(`Moved ${item.name} to ${target ? target.name : 'list'}`)
    } catch (err) {
      setItems(previous)
      toast.error(err.message)
    }
  }

  const recategorise = async (item, categoryId) => {
    setRecatItem(null)
    try {
      // The server also writes the choice back to ingredient_lookup so it
      // sticks for future saves (spec §3.6.4).
      const updated = await api(`/api/shopping/${item.id}`, {
        method: 'PATCH',
        body: { set_category: true, category_id: categoryId },
      })
      setItems((list) => list.map((i) => (i.id === item.id ? updated : i)))
    } catch (err) {
      toast.error(err.message)
    }
  }

  const clear = async (checkedOnly) => {
    // Scoped to the active list only — other tabs keep their items.
    const previous = items
    const inList = previous.filter((i) => i.list_id === activeListId)
    const removed = checkedOnly ? inList.filter((i) => i.checked) : inList
    setClearBusy(true)
    try {
      await api(`/api/shopping/clear?checked_only=${checkedOnly}&list_id=${activeListId}`, { method: 'POST' })
      setItems((list) => list.filter((i) => i.list_id !== activeListId || (checkedOnly && !i.checked)))
      toast.success(`Cleared ${removed.length} item${removed.length === 1 ? '' : 's'}`, {
        action: { label: 'Undo', onClick: () => restoreItems(removed) },
      })
    } catch (err) {
      setItems(previous)
      toast.error(err.message)
    } finally {
      setClearBusy(false)
      setClearConfirm(null)
    }
  }

  if (items === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-8)' }}>
        <Spinner label="Loading list" />
      </div>
    )
  }

  // Only the active tab's items are shown; everything below groups `visible`.
  const visible = activeListId === null ? items : items.filter((i) => i.list_id === activeListId)
  const uncheckedCountFor = (listId) => items.filter((i) => i.list_id === listId && !i.checked).length
  const showTabs = lists.length > 1

  // --- Grouping: category sections in the selected store's walking route ----
  const categoryName = Object.fromEntries(categories.map((c) => [c.id, c.name]))
  const store = stores.find((s) => String(s.id) === String(storeId))
  const routeOrder = store ? store.category_order : categories.map((c) => c.id)

  const active = visible.filter((i) => !i.checked)
  const completed = visible.filter((i) => i.checked)

  // Same-name items sort adjacently inside their category (spec: never
  // auto-merge, group visually instead).
  const byName = (a, b) => a.name.localeCompare(b.name) || a.id - b.id
  const byCategory = new Map()
  const uncategorised = []
  for (const item of [...active].sort(byName)) {
    if (item.category_id == null || !categoryName[item.category_id]) {
      uncategorised.push(item)
    } else {
      if (!byCategory.has(item.category_id)) byCategory.set(item.category_id, [])
      byCategory.get(item.category_id).push(item)
    }
  }
  const orderedSections = routeOrder.filter((id) => byCategory.has(id))

  const checkedCount = completed.length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%', maxWidth: 600, margin: '0 auto', position: 'relative', overflow: 'hidden' }}>
        {/* Header: title, store selector, add bar. Overlaid on top of the
            list and slid off-screen via transform when scrolled down, rather
            than collapsing its own layout height — collapsing height would
            resize the scrollable list itself, which on a short list can
            eliminate all overflow and snap scrollTop to 0. That looks
            identical to "user scrolled back to the top" and immediately
            brings the header back — hiding the add-item bar behind an
            unbreakable bounce loop. Overlaying keeps the list's scrollable
            height constant regardless of chromeHidden, so that can't happen,
            and scrolling to the top always successfully brings it back. */}
        <div
          ref={headerRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 2,
            background: 'var(--color-background-surface)',
            borderBottom: '1px solid var(--color-border)',
            transform: chromeHidden ? 'translateY(-100%)' : 'translateY(0)',
            transition: 'transform 200ms ease',
          }}
        >
          <div style={{ padding: 'var(--spacing-4)', paddingBottom: 'var(--spacing-3)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
            {/* List tabs (hidden with a single list). Items move between
                lists via the ⊞ dialog's "Move to list" section. */}
            {showTabs && (
              <div className="hide-scrollbar" style={{ overflowX: 'auto' }}>
                <TabList value={String(activeListId)} onChange={(v) => selectList(Number(v))}>
                  {lists.map((l) => (
                    <Tab
                      key={l.id}
                      value={String(l.id)}
                      label={uncheckedCountFor(l.id) > 0 ? `${l.name} (${uncheckedCountFor(l.id)})` : l.name}
                    />
                  ))}
                </TabList>
              </div>
            )}
            {stores.length > 0 && (
              <Selector
                label="Store"
                isLabelHidden
                placeholder="Sort for store…"
                hasClear
                options={stores.map((s) => ({ value: String(s.id), label: s.name }))}
                value={storeId || undefined}
                onChange={selectStore}
              />
            )}
          </div>

          {/* Add bar */}
          <div style={{ padding: '0 var(--spacing-4) var(--spacing-3)', display: 'flex', gap: 'var(--spacing-2)' }}>
            <div style={{ width: 56, flexShrink: 0 }}>
              <TextInput label="Amount" isLabelHidden value={draftAmount} onChange={setDraftAmount} placeholder="qty" />
            </div>
            <div style={{ width: 56, flexShrink: 0 }}>
              <TextInput label="Unit" isLabelHidden value={draftUnit} onChange={setDraftUnit} placeholder="unit" />
            </div>
            <div
              style={{ flex: 1, minWidth: 0, position: 'relative' }}
              onFocus={() => { clearTimeout(blurTimer.current); setSuggestOpen(true) }}
              onBlur={() => { blurTimer.current = setTimeout(() => setSuggestOpen(false), 150) }}
              onKeyDown={(e) => {
                suggestKeys.onKeyDown(e)
                if (e.key === 'Enter' && !e.defaultPrevented) addItem()
              }}
            >
              <TextInput
                label="Add item"
                isLabelHidden
                value={draft}
                onChange={(v) => { setDraft(v); setDraftCategory(null); setSuggestOpen(true); suggestKeys.reset() }}
                placeholder="Add item…"
              />
              {suggestOpen && suggestions.length > 0 && (
                <SuggestionDropdown
                  items={suggestions}
                  getKey={(s) => s.name}
                  getLabel={(s) => s.name}
                  highlight={suggestKeys.highlight}
                  onHighlight={suggestKeys.setHighlight}
                  onPick={pickSuggestion}
                />
              )}
            </div>
            <IconButton label="Add item" icon={<span>+</span>} variant="primary" clickAction={addItem} isDisabled={!draft.trim()} />
          </div>
        </div>

        {/* List. Padding-top/bottom reserve exactly the header/footer's
            measured height so content isn't hidden underneath them when
            they're shown — padding that never changes, which is what keeps
            this scroll area's height constant regardless of chromeHidden. */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            paddingTop: headerHeight,
            paddingBottom: `calc(${footerHeight}px + var(--spacing-6))`,
          }}
          onScroll={handleListScroll}
        >
          {listError ? (
            <div style={{ padding: 'var(--spacing-4)' }}>
              <Banner status="error" title="Couldn't load your shopping list" description={listError} />
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding: 'var(--spacing-8) var(--spacing-4)' }}>
              <EmptyState
                title={showTabs ? 'This list is empty' : 'List is empty'}
                description="Add items above, or send ingredients over from a recipe."
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingTop: 'var(--spacing-1)' }}>
              {orderedSections.map((id) => (
                <CategorySection key={id} label={categoryName[id]} items={byCategory.get(id)} onToggle={toggleItem} onRemove={removeItem} onRecategorise={setRecatItem} expandedItemId={expandedItemId} onToggleExpand={toggleExpanded} />
              ))}
              {uncategorised.length > 0 && (
                <CategorySection label="Uncategorised" items={uncategorised} onToggle={toggleItem} onRemove={removeItem} onRecategorise={setRecatItem} expandedItemId={expandedItemId} onToggleExpand={toggleExpanded} />
              )}
              {completed.length > 0 && (
                <CategorySection label="Completed" items={[...completed].sort(byName)} onToggle={toggleItem} onRemove={removeItem} onRecategorise={setRecatItem} expandedItemId={expandedItemId} onToggleExpand={toggleExpanded} />
              )}
            </div>
          )}
        </div>

        {/* Per-row actions dialog: the same "change category" tap target also
            gives Mark done/Remove a keyboard/assistive path, since the list
            row itself is swipe-only (spec: plain tap does nothing there). */}
        <Dialog isOpen={recatItem !== null} onOpenChange={(open) => { if (!open) setRecatItem(null) }} purpose="form">
          {recatItem && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)', padding: 'var(--spacing-2)' }}>
              <h2 style={{ margin: 0, fontSize: 'var(--text-heading-2-size)', fontWeight: 'var(--text-heading-2-weight)', color: 'var(--color-text-primary)' }}>
                “{recatItem.name}”
              </h2>
              <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                <div style={{ flex: 1 }}>
                  <Button
                    label={recatItem.checked ? 'Mark not done' : 'Mark done'}
                    variant="secondary"
                    clickAction={() => { toggleItem(recatItem); setRecatItem(null) }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Button
                    label="Remove"
                    variant="destructive"
                    clickAction={() => { removeItem(recatItem); setRecatItem(null) }}
                  />
                </div>
              </div>
              {/* Touch/assistive path for moving between lists (drag-to-tab
                  needs a mouse). Only shown when there is somewhere to move to. */}
              {showTabs && (
                <>
                  <Divider />
                  <span style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>Move to list</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
                    {lists.filter((l) => l.id !== recatItem.list_id).map((l) => (
                      <Button
                        key={l.id}
                        label={l.name}
                        variant="ghost"
                        clickAction={() => { moveItem(recatItem, l.id); setRecatItem(null) }}
                      />
                    ))}
                  </div>
                </>
              )}
              <Divider />
              <span style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>Category</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)', maxHeight: '50vh', overflowY: 'auto' }}>
                {categories.map((c) => (
                  <Button
                    key={c.id}
                    label={c.name}
                    variant={recatItem.category_id === c.id ? 'secondary' : 'ghost'}
                    clickAction={() => recategorise(recatItem, c.id)}
                  />
                ))}
              </div>
              <Button label="Cancel" variant="ghost" onClick={() => setRecatItem(null)} />
            </div>
          )}
        </Dialog>

        {/* Footer actions (scoped to the active list). Overlaid and slid
            off-screen with the header, for the same reason (see above). */}
        {visible.length > 0 && (
          <div
            ref={footerRef}
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 2,
              display: 'flex',
              gap: 'var(--spacing-2)',
              padding: 'var(--spacing-3) var(--spacing-4)',
              background: 'var(--color-background-surface)',
              borderTop: '1px solid var(--color-border)',
              transform: chromeHidden ? 'translateY(100%)' : 'translateY(0)',
              transition: 'transform 200ms ease',
            }}
          >
            <div style={{ flex: 1 }}>
              <Button
                label={`Clear completed${checkedCount ? ` (${checkedCount})` : ''}`}
                variant="secondary"
                clickAction={() => setClearConfirm('checked')}
                isDisabled={checkedCount === 0}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Button label="Clear all" variant="destructive" clickAction={() => setClearConfirm('all')} />
            </div>
          </div>
        )}

        <ConfirmDialog
          isOpen={clearConfirm !== null}
          onOpenChange={(open) => { if (!open) setClearConfirm(null) }}
          title={clearConfirm === 'all' ? 'Clear entire list?' : 'Clear completed items?'}
          message={
            clearConfirm === 'all'
              ? 'This removes every item on this list.'
              : 'This removes all checked-off items from this list.'
          }
          confirmLabel={clearConfirm === 'all' ? 'Clear all' : 'Clear completed'}
          isBusy={clearBusy}
          onConfirm={() => clear(clearConfirm === 'checked')}
        />
      </div>
    </div>
  )
}
