import { useState } from 'react'
import { Card } from '@astryxdesign/core/Card'

/**
 * Shared keyboard behaviour for a suggestion-dropdown field: arrows move a
 * highlight, Enter picks the highlighted suggestion (falls through — caller
 * checks `e.defaultPrevented` — when nothing is highlighted, so a plain
 * Enter can still do its own thing, e.g. add free-text), Escape closes.
 * Caller owns the suggestions array and open state (fetched differently per
 * field); this just owns the highlight index and translates key events.
 */
export function useSuggestionKeyboard({ suggestions, isOpen, onPick, onClose }) {
  const [highlight, setHighlight] = useState(-1)

  const onKeyDown = (e) => {
    if (!isOpen || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && highlight >= 0 && highlight < suggestions.length) {
      e.preventDefault()
      onPick(suggestions[highlight])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return { highlight, setHighlight, onKeyDown, reset: () => setHighlight(-1) }
}

/**
 * Floating suggestion list shared by every autocomplete field (tags,
 * ingredient name in the editor and shopping list) — same look, same mouse
 * hover/click behaviour, paired with useSuggestionKeyboard for arrows/Enter.
 */
export function SuggestionDropdown({ items, getKey, getLabel, highlight, onHighlight, onPick }) {
  return (
    <Card style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, padding: 4, zIndex: 10, boxShadow: 'var(--shadow-high)' }}>
      {items.map((item, i) => (
        <div
          key={getKey(item)}
          onMouseDown={(e) => { e.preventDefault(); onPick(item) }}
          onMouseEnter={() => onHighlight(i)}
          style={{
            padding: 'var(--spacing-2) var(--spacing-3)',
            borderRadius: 'var(--radius-inner)',
            fontSize: 'var(--text-body-size)',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
            backgroundImage: i === highlight
              ? 'linear-gradient(var(--color-overlay-hover), var(--color-overlay-hover))'
              : 'none',
          }}
        >
          {getLabel(item)}
        </div>
      ))}
    </Card>
  )
}
