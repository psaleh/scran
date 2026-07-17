import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Selector } from '@astryxdesign/core/Selector'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Token } from '@astryxdesign/core/Token'

import { api } from '../api.js'
import ImportDataDialog from '../components/ImportDataDialog.jsx'
import ImportPhotosDialog from '../components/ImportPhotosDialog.jsx'
import ImportUrlDialog from '../components/ImportUrlDialog.jsx'
import ImportVideoDialog from '../components/ImportVideoDialog.jsx'
import { SuggestionDropdown, useSuggestionKeyboard } from '../components/SuggestionDropdown.jsx'
import TagBadge from '../components/TagBadge.jsx'
import { useIsDesktop } from '../useIsDesktop.js'

// --- Power search ----------------------------------------------------------
// One search box carries both free text (FTS) and filter tokens. A token is
// typed as tag:dinner / tag:"Asian Food" / is:draft; once complete it turns
// into a removable chip inside the bar, so filters are always visible and
// one click (or Backspace on an empty input) clears them.

// A token still being typed at the end of the input (drives autocomplete).
const TRAILING_TOKEN_RE = /(^|\s)(tag|is):("?)([^"]*)$/i
// A finished token at the end of the input: value + closing quote or a
// trailing space ends it, at which point it becomes a chip. A bare (unquoted)
// value must not start with a quote — a space inside tag:"Comfort Food" is
// still mid-token, not the end of it.
const COMPLETE_TOKEN_RE = /(^|\s)(tag|is):(?:"([^"]+)"|([^"\s]\S*)\s)$/i

/** Is this a value the given filter key accepts? */
function isValidFilter(key, value) {
  if (key === 'is') return /^(draft|published)$/i.test(value)
  return value.length > 0
}

/** Quote a token value when it contains whitespace (tag:"Asian Food"). */
function tokenValue(value) {
  return /\s/.test(value) ? `"${value}"` : value
}

function RecipeCard({ recipe, onTagClick }) {
  const [hover, setHover] = useState(false)
  return (
    <Link
      to={`/recipes/${recipe.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      // minWidth: 0 stops a long title's intrinsic width from stretching this
      // grid item past its column — without it, text-overflow: ellipsis on
      // the title below has no narrower box to actually clip against.
      style={{ display: 'block', minWidth: 0, color: 'inherit', textDecoration: 'none' }}
    >
      <Card padding={0} style={{ overflow: 'hidden', boxShadow: hover ? 'var(--shadow-med)' : undefined, transition: 'box-shadow 125ms cubic-bezier(0.24,1,0.4,1)' }}>
        <div
          style={{
            height: 104,
            width: '100%',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-background-muted)',
          }}
        >
          {recipe.photo_path ? (
            <img
              src={`/api/uploads/${recipe.photo_path}`}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontFamily: 'var(--font-family-code)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              no photo
            </span>
          )}
          {recipe.status === 'draft' && (
            <div style={{ position: 'absolute', top: 'var(--spacing-2)', left: 'var(--spacing-2)' }}>
              <Badge label="Draft" variant="warning" />
            </div>
          )}
        </div>
        <div style={{ padding: 'var(--spacing-3)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
          <div
            style={{
              fontSize: 'var(--text-large-size)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {recipe.title}
          </div>
          <div style={{ display: 'flex', gap: 'var(--spacing-1)', flexWrap: 'wrap' }}>
            {recipe.tags.map((t) => (
              <TagBadge
                key={t}
                tag={t}
                // Stop the click from following the card's recipe link.
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTagClick(t) }}
              />
            ))}
          </div>
        </div>
      </Card>
    </Link>
  )
}

/** Recipe browse (home): power search bar, card grid (spec §6.2). */
export default function BrowsePage() {
  // Active filter chips ({ key: 'tag' | 'is', value }) + free text. One chip
  // per key: the API takes a single tag and a single status.
  const [filters, setFilters] = useState([])
  const [text, setText] = useState('')
  const [allTags, setAllTags] = useState([])
  const [recipes, setRecipes] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [photosOpen, setPhotosOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [dataImportOpen, setDataImportOpen] = useState(false)
  const [sort, setSort] = useState('updated')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const suggestBlurTimer = useRef(null)
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()

  useEffect(() => {
    api('/api/recipes/tags').then(setAllTags).catch(() => {})
  }, [])

  // One chip per filter key — adding a second tag replaces the first.
  const addFilter = (key, value) =>
    setFilters((current) => [...current.filter((f) => f.key !== key), { key, value }])
  const removeFilter = (filter) =>
    setFilters((current) => current.filter((f) => f !== filter))

  const activeTag = filters.find((f) => f.key === 'tag')?.value ?? ''
  const activeStatus = filters.find((f) => f.key === 'is')?.value ?? ''

  // What actually goes to FTS: the free text minus any half-typed token.
  const searchText = text.replace(TRAILING_TOKEN_RE, '$1').trim()

  // Debounced server-side search: FTS is fast, but don't fire per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams()
      if (searchText) params.set('q', searchText)
      if (activeTag) params.set('tag', activeTag)
      if (activeStatus) params.set('status', activeStatus.toLowerCase())
      params.set('sort', sort)
      api(`/api/recipes?${params}`)
        .then(setRecipes)
        .catch((err) => setError(err.message))
    }, 250)
    return () => clearTimeout(timer)
  }, [searchText, activeTag, activeStatus, sort])

  // Typing turns a finished token (closing quote, or a space after the
  // value) into a chip; everything else is just text.
  const onSearchChange = (value) => {
    const complete = COMPLETE_TOKEN_RE.exec(value)
    if (complete) {
      const key = complete[2].toLowerCase()
      const tokenText = (complete[3] ?? complete[4]).trim()
      if (isValidFilter(key, tokenText)) {
        addFilter(key, key === 'is' ? tokenText.toLowerCase() : tokenText)
        setText(value.slice(0, complete.index))
        suggestKeys.reset()
        return
      }
    }
    setText(value)
    setSuggestOpen(true)
    suggestKeys.reset()
  }

  // Autocomplete for the token being typed at the end of the input: tag
  // names after "tag:", draft/published after "is:", and the token keys
  // themselves on an empty box (discoverability).
  const trailing = TRAILING_TOKEN_RE.exec(text)
  let suggestions = []
  if (trailing) {
    const key = trailing[2].toLowerCase()
    const partial = trailing[4].toLowerCase()
    const options = key === 'tag' ? allTags : ['draft', 'published']
    suggestions = options
      .filter((o) => o.toLowerCase().includes(partial))
      .slice(0, 8)
      .map((o) => ({
        key: `${key}:${o}`,
        label: `${key}:${tokenValue(o)}`,
        // Chip the completed token, drop the partial from the text.
        apply: () => {
          addFilter(key, o)
          setText(text.slice(0, trailing.index) + trailing[1])
        },
      }))
  } else if (!text.trim() && filters.length === 0) {
    suggestions = [
      { key: 'hint-tag', label: 'tag: — filter by tag', apply: () => setText('tag:') },
      { key: 'hint-draft', label: 'is:draft — drafts only', apply: () => addFilter('is', 'draft') },
    ]
  }

  const pickSuggestion = (s) => s.apply()
  const suggestKeys = useSuggestionKeyboard({
    suggestions,
    isOpen: suggestOpen,
    onPick: pickSuggestion,
    onClose: () => setSuggestOpen(false),
  })

  // Backspace on an empty (or caret-at-start) input removes the last chip.
  const onSearchKeyDown = (e) => {
    suggestKeys.onKeyDown(e)
    if (e.defaultPrevented) return
    if (e.key === 'Backspace' && e.target.selectionStart === 0 && e.target.selectionEnd === 0 && filters.length > 0) {
      e.preventDefault()
      setFilters((current) => current.slice(0, -1))
    } else if (e.key === 'Enter') {
      // Enter finishes a fully-typed token without needing a trailing space.
      const t = TRAILING_TOKEN_RE.exec(text)
      if (t && isValidFilter(t[2].toLowerCase(), t[4].trim())) {
        const key = t[2].toLowerCase()
        addFilter(key, key === 'is' ? t[4].trim().toLowerCase() : t[4].trim())
        setText(text.slice(0, t.index) + t[1])
      }
    }
  }

  // "Add recipe" menu (spec §6.2): manual entry, website import, or AI
  // photo import.
  const addMenuItems = [
    { label: 'Manual entry', onClick: () => navigate('/recipes/new') },
    { label: 'Import from website…', onClick: () => setImportOpen(true) },
    { label: 'Import from photo…', onClick: () => setPhotosOpen(true) },
    { label: 'Import from YouTube…', onClick: () => setVideoOpen(true) },
    { label: 'Import recipe data…', onClick: () => setDataImportOpen(true) },
  ]

  const isFreshInstall =
    recipes !== null && recipes.length === 0 && !text.trim() && filters.length === 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header: title, search, tag chips, add button */}
      <div
        style={{
          padding: isDesktop ? 'var(--spacing-4) var(--spacing-6)' : 'var(--spacing-4)',
          background: 'var(--color-background-surface)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: isDesktop ? 'row' : 'column',
          alignItems: isDesktop ? 'center' : 'stretch',
          gap: 'var(--spacing-3)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', flex: isDesktop ? 1 : 'none' }}>
          {!isDesktop && (
            <div style={{ flexShrink: 0 }}>
              <DropdownMenu button={{ label: 'Add', variant: 'primary' }} items={addMenuItems} menuWidth={200} />
            </div>
          )}
          <div
            style={{ flex: 1, position: 'relative' }}
            onKeyDown={onSearchKeyDown}
            onFocus={() => { clearTimeout(suggestBlurTimer.current); setSuggestOpen(true) }}
            onBlur={() => { suggestBlurTimer.current = setTimeout(() => setSuggestOpen(false), 150) }}
          >
            {/* The search bar itself: filter chips + free-text input in one
                box. Styled to sit alongside Astryx inputs (the chips make a
                stock TextInput unusable here). */}
            <div
              className="search-bar"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 'var(--spacing-1)',
                boxSizing: 'border-box',
                minHeight: 40,
                padding: 'var(--spacing-1) var(--spacing-3)',
                background: 'var(--color-background-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {filters.map((f) => (
                <Token
                  key={f.key}
                  label={`${f.key}:${f.value}`}
                  size="sm"
                  color={f.key === 'tag' ? 'green' : 'orange'}
                  onRemove={() => removeFilter(f)}
                />
              ))}
              <input
                aria-label="Search recipes"
                value={text}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={filters.length ? 'Search…' : 'Search — try tag:dinner or is:draft'}
                style={{
                  flex: 1,
                  minWidth: 120,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  font: 'inherit',
                  fontSize: 'var(--text-body-size)',
                  color: 'var(--color-text-primary)',
                  padding: 0,
                }}
              />
            </div>
            {suggestOpen && suggestions.length > 0 && (
              <SuggestionDropdown
                items={suggestions}
                getKey={(s) => s.key}
                getLabel={(s) => s.label}
                highlight={suggestKeys.highlight}
                onHighlight={suggestKeys.setHighlight}
                onPick={pickSuggestion}
              />
            )}
          </div>
          {isDesktop && (
            <div style={{ width: 172, flexShrink: 0 }}>
              <Selector
                label="Sort"
                isLabelHidden
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'updated', label: 'Recently updated' },
                  { value: 'newest', label: 'Newest' },
                  { value: 'title', label: 'A–Z' },
                ]}
              />
            </div>
          )}
        </div>

        {!isDesktop && (
          <div style={{ width: 148 }}>
            <Selector
              label="Sort"
              isLabelHidden
              value={sort}
              onChange={setSort}
              options={[
                { value: 'updated', label: 'Recently updated' },
                { value: 'newest', label: 'Newest' },
                { value: 'title', label: 'A–Z' },
              ]}
            />
          </div>
        )}

        {isDesktop && (
          <DropdownMenu button={{ label: 'Add recipe', variant: 'primary' }} items={addMenuItems} menuWidth={200} />
        )}
      </div>

      <ImportUrlDialog isOpen={importOpen} onOpenChange={setImportOpen} />
      <ImportPhotosDialog isOpen={photosOpen} onOpenChange={setPhotosOpen} />
      <ImportVideoDialog isOpen={videoOpen} onOpenChange={setVideoOpen} />
      <ImportDataDialog isOpen={dataImportOpen} onOpenChange={setDataImportOpen} />

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isDesktop ? 'var(--spacing-6)' : 'var(--spacing-4)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          {error && <EmptyState title="Something went wrong" description={error} />}
          {!error && recipes === null && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-8)' }}>
              <Spinner label="Loading recipes" />
            </div>
          )}
          {!error && isFreshInstall && (
            <EmptyState
              title="No recipes yet"
              description="Add your first recipe to start building the household recipe box."
              actions={<Button label="Add recipe" variant="primary" onClick={() => navigate('/recipes/new')} />}
            />
          )}
          {!error && recipes !== null && recipes.length === 0 && !isFreshInstall && (
            <EmptyState title="No recipes found" description="Try a different search or remove the filters." />
          )}
          {!error && recipes !== null && recipes.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(240px, 1fr))' : '1fr', gap: 'var(--spacing-3)' }}>
              {recipes.map((r) => (
                <RecipeCard key={r.id} recipe={r} onTagClick={(t) => addFilter('tag', t)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
