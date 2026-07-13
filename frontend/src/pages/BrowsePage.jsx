import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Spinner } from '@astryxdesign/core/Spinner'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'

import { api } from '../api.js'
import ImportUrlDialog from '../components/ImportUrlDialog.jsx'
import TagBadge from '../components/TagBadge.jsx'
import { useIsDesktop } from '../useIsDesktop.js'

function RecipeCard({ recipe, onOpen }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpen(recipe.id)}
      style={{ cursor: 'pointer' }}
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
              fontSize: 'var(--font-size-lg)',
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
              <TagBadge key={t} tag={t} />
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

/** Recipe browse (home): search, tag filter chips, card grid (spec §6.2). */
export default function BrowsePage() {
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState('')
  const [allTags, setAllTags] = useState([])
  const [recipes, setRecipes] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()

  useEffect(() => {
    api('/api/recipes/tags').then(setAllTags).catch(() => {})
  }, [])

  // Debounced server-side search: FTS is fast, but don't fire per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (activeTag) params.set('tag', activeTag)
      api(`/api/recipes?${params}`)
        .then(setRecipes)
        .catch((err) => setError(err.message))
    }, 250)
    return () => clearTimeout(timer)
  }, [query, activeTag])

  // "Add recipe" menu (spec §6.2): manual entry or website import. Photo
  // import joins this menu once the AI import inbox is built.
  const addMenuItems = [
    { label: 'Manual entry', onClick: () => navigate('/recipes/new') },
    { label: 'Import from website…', onClick: () => setImportOpen(true) },
  ]

  const isFreshInstall =
    recipes !== null && recipes.length === 0 && !query.trim() && !activeTag

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--text-heading-1-size)', fontWeight: 'var(--text-heading-1-weight)', color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
            Recipes
          </h1>
          {!isDesktop && (
            <DropdownMenu button={{ label: 'Add recipe', variant: 'primary', size: 'sm' }} items={addMenuItems} menuWidth={200} />
          )}
        </div>

        <div style={{ flex: isDesktop ? 1 : 'none' }}>
          <TextInput
            label="Search recipes"
            isLabelHidden
            value={query}
            onChange={setQuery}
            placeholder="Search recipes…"
          />
        </div>

        {allTags.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
            {allTags.slice(0, 8).map((tag) => (
              <ToggleButton
                key={tag}
                label={tag}
                size="sm"
                isPressed={activeTag === tag}
                onPressedChange={(pressed) => setActiveTag(pressed ? tag : '')}
              />
            ))}
          </div>
        )}

        {isDesktop && (
          <DropdownMenu button={{ label: 'Add recipe', variant: 'primary' }} items={addMenuItems} menuWidth={200} />
        )}
      </div>

      <ImportUrlDialog isOpen={importOpen} onOpenChange={setImportOpen} />

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
            <EmptyState title="No recipes found" description="Try a different search or clear the tag filter." />
          )}
          {!error && recipes !== null && recipes.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(4, 1fr)' : '1fr 1fr', gap: 'var(--spacing-3)' }}>
              {recipes.map((r) => (
                <RecipeCard key={r.id} recipe={r} onOpen={(id) => navigate(`/recipes/${id}`)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
