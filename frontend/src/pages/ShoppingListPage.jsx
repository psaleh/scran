import { useEffect, useRef, useState } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Divider } from '@astryxdesign/core/Divider'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Selector } from '@astryxdesign/core/Selector'
import { Spinner } from '@astryxdesign/core/Spinner'
import { TextInput } from '@astryxdesign/core/TextInput'

import { api } from '../api.js'
import TagBadge from '../components/TagBadge.jsx'
import { sectionLabelStyle } from '../styles.js'

const SWIPE_THRESHOLD = 140

/**
 * One list row. Interactions (from the design mockup):
 * - tap toggles checked (strike-through)
 * - swipe right = toggle checked, swipe left = remove
 */
function ItemRow({ item, onToggle, onRemove }) {
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
    dragRef.current.active = false
    if (dx > SWIPE_THRESHOLD) {
      onToggle(item)
    } else if (dx < -SWIPE_THRESHOLD) {
      onRemove(item)
      return
    } else if (!dragRef.current.moved) {
      onToggle(item) // plain tap
    }
    setDx(0)
  }

  const meta = [item.amount != null ? String(Math.round(item.amount * 100) / 100) : null, item.unit]
    .filter(Boolean)
    .join(' ')
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
        {meta && (
          <div style={{ fontSize: 'var(--font-size-xl)', color: 'var(--color-text-secondary)', flexShrink: 0, minWidth: 48 }}>
            {meta}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 'var(--font-size-xl)',
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
          {item.recipe_title && (
            <div style={{ marginTop: 2 }}>
              <TagBadge tag={item.recipe_title} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CategorySection({ label, items, onToggle, onRemove }) {
  return (
    <div>
      <div style={{ ...sectionLabelStyle, padding: 'var(--spacing-3) var(--spacing-4) var(--spacing-1)' }}>
        {label}
      </div>
      <Card padding={0} style={{ margin: '0 var(--spacing-4)', overflow: 'hidden' }}>
        {items.map((item, i) => (
          <div key={item.id}>
            {i > 0 && <Divider />}
            <ItemRow item={item} onToggle={onToggle} onRemove={onRemove} />
          </div>
        ))}
      </Card>
    </div>
  )
}

/** Shopping list (spec §3.4, §6.6): store-ordered category groups, recipe
 * tags, adjacent duplicate grouping, check-off, manual add w/ autocomplete. */
export default function ShoppingListPage() {
  const [items, setItems] = useState(null)
  const [categories, setCategories] = useState([])
  const [stores, setStores] = useState([])
  const [storeId, setStoreId] = useState(() => localStorage.getItem('scran.store') || '')

  // Add bar state
  const [draft, setDraft] = useState('')
  const [draftAmount, setDraftAmount] = useState('')
  const [draftUnit, setDraftUnit] = useState('')
  const [draftCategory, setDraftCategory] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const blurTimer = useRef(null)

  useEffect(() => {
    api('/api/shopping').then(setItems).catch(() => setItems([]))
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

  const addItem = async () => {
    const name = draft.trim()
    if (!name) return
    const created = await api('/api/shopping', {
      method: 'POST',
      body: {
        name,
        amount: draftAmount === '' ? null : Number(draftAmount) || null,
        unit: draftUnit.trim() || null,
        category_id: draftCategory,
      },
    })
    setItems((list) => [...list, created])
    setDraft('')
    setDraftAmount('')
    setDraftUnit('')
    setDraftCategory(null)
    setSuggestOpen(false)
  }

  const toggleItem = async (item) => {
    // Optimistic: flip locally, then persist.
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)))
    await api(`/api/shopping/${item.id}`, { method: 'PATCH', body: { checked: !item.checked } })
  }

  const removeItem = async (item) => {
    setItems((list) => list.filter((i) => i.id !== item.id))
    await api(`/api/shopping/${item.id}`, { method: 'DELETE' })
  }

  const clear = async (checkedOnly) => {
    await api(`/api/shopping/clear?checked_only=${checkedOnly}`, { method: 'POST' })
    setItems((list) => (checkedOnly ? list.filter((i) => !i.checked) : []))
  }

  if (items === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-8)' }}>
        <Spinner label="Loading list" />
      </div>
    )
  }

  // --- Grouping: category sections in the selected store's walking route ----
  const categoryName = Object.fromEntries(categories.map((c) => [c.id, c.name]))
  const store = stores.find((s) => String(s.id) === String(storeId))
  const routeOrder = store ? store.category_order : categories.map((c) => c.id)

  const active = items.filter((i) => !i.checked)
  const completed = items.filter((i) => i.checked)

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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%', maxWidth: 600, margin: '0 auto' }}>
        {/* Header: title, store selector, add bar */}
        <div style={{ background: 'var(--color-background-surface)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ padding: 'var(--spacing-4)', paddingBottom: 'var(--spacing-3)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
            <h1 style={{ margin: 0, fontSize: 'var(--text-heading-1-size)', fontWeight: 'var(--text-heading-1-weight)', color: 'var(--color-text-primary)' }}>
              Shopping list
            </h1>
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
              style={{ flex: 1, position: 'relative' }}
              onFocus={() => { clearTimeout(blurTimer.current); setSuggestOpen(true) }}
              onBlur={() => { blurTimer.current = setTimeout(() => setSuggestOpen(false), 150) }}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem() }}
            >
              <TextInput
                label="Add item"
                isLabelHidden
                value={draft}
                onChange={(v) => { setDraft(v); setDraftCategory(null); setSuggestOpen(true) }}
                placeholder="Add item…"
              />
              {suggestOpen && suggestions.length > 0 && (
                <Card style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, padding: 4, zIndex: 10, boxShadow: 'var(--shadow-high)' }}>
                  {suggestions.map((s) => (
                    <div
                      key={s.name}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setDraft(s.name)
                        setDraftCategory(s.category_id)
                        setSuggestOpen(false)
                      }}
                      style={{ padding: 'var(--spacing-2) var(--spacing-3)', borderRadius: 'var(--radius-inner)', fontSize: 'var(--text-body-size)', color: 'var(--color-text-primary)', cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundImage = 'linear-gradient(var(--color-overlay-hover), var(--color-overlay-hover))' }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundImage = 'none' }}
                    >
                      {s.name}
                    </div>
                  ))}
                </Card>
              )}
            </div>
            <IconButton label="Add item" icon={<span>+</span>} variant="primary" clickAction={addItem} isDisabled={!draft.trim()} />
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 'var(--spacing-6)' }}>
          {items.length === 0 ? (
            <div style={{ padding: 'var(--spacing-8) var(--spacing-4)' }}>
              <EmptyState
                title="List is empty"
                description="Add items above, or send ingredients over from a recipe."
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingTop: 'var(--spacing-1)' }}>
              {orderedSections.map((id) => (
                <CategorySection key={id} label={categoryName[id]} items={byCategory.get(id)} onToggle={toggleItem} onRemove={removeItem} />
              ))}
              {uncategorised.length > 0 && (
                <CategorySection label="Uncategorised" items={uncategorised} onToggle={toggleItem} onRemove={removeItem} />
              )}
              {completed.length > 0 && (
                <CategorySection label="Completed" items={[...completed].sort(byName)} onToggle={toggleItem} onRemove={removeItem} />
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        {items.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', padding: 'var(--spacing-3) var(--spacing-4)', background: 'var(--color-background-surface)', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
            <div style={{ flex: 1 }}>
              <Button label={`Clear completed${checkedCount ? ` (${checkedCount})` : ''}`} variant="secondary" clickAction={() => clear(true)} isDisabled={checkedCount === 0} />
            </div>
            <div style={{ flex: 1 }}>
              <Button label="Clear all" variant="destructive" clickAction={() => clear(false)} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
