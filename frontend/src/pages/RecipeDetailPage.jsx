import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '@astryxdesign/core/Avatar'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Dialog } from '@astryxdesign/core/Dialog'
import { Divider } from '@astryxdesign/core/Divider'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { IconButton } from '@astryxdesign/core/IconButton'
import { NumberInput } from '@astryxdesign/core/NumberInput'
import { Spinner } from '@astryxdesign/core/Spinner'
import { TextArea } from '@astryxdesign/core/TextArea'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'

import { api } from '../api.js'
import DialogFrame from '../components/DialogFrame.jsx'
import ExportRecipeDialog from '../components/ExportRecipeDialog.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import TagBadge from '../components/TagBadge.jsx'
import { useToast } from '../components/Toaster.jsx'
import { formatAmount, sectionLabelStyle, stepNumberStyle } from '../styles.js'
import { useIsDesktop } from '../useIsDesktop.js'

function IngredientRow({ ingredient, scale, onAdd, added }) {
  const amount =
    ingredient.scalable && ingredient.amount != null
      ? ingredient.amount * scale
      : ingredient.amount
  const meta = [formatAmount(amount), ingredient.unit].filter(Boolean).join(' ')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', padding: 'var(--spacing-3) var(--spacing-4)' }}>
      <div style={{ fontSize: 'var(--font-size-xl)', color: 'var(--color-text-secondary)', minWidth: 64, flexShrink: 0 }}>
        {meta || '—'}
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--font-size-xl)', color: 'var(--color-text-primary)' }}>
        {ingredient.name}
        {/* Full line is rendered from the parts (spec §3.2): "onion — small, finely diced" */}
        {ingredient.note && (
          <span style={{ color: 'var(--color-text-secondary)' }}> — {ingredient.note}</span>
        )}
      </div>
      <IconButton
        label={added ? 'Added to list' : 'Add to shopping list'}
        icon={<span>{added ? '✓' : '+'}</span>}
        variant={added ? 'secondary' : 'ghost'}
        onClick={() => onAdd(ingredient.id)}
      />
    </div>
  )
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g

// Auto-added notes (import/AI review) often carry a source link — render it
// clickable instead of as inert text.
function renderNoteText(text) {
  // split() with one capturing group alternates [text, url, text, url, ...]
  // — odd indices are always the matched URLs.
  return text.split(URL_PATTERN).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

function NoteRow({ note, currentUser, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.text)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const canModify = note.user_id === currentUser.id || currentUser.is_admin
  const toast = useToast()

  const save = async () => {
    try {
      await api(`/api/notes/${note.id}`, { method: 'PUT', body: { text: draft } })
      setEditing(false)
      onChanged()
    } catch (err) {
      toast.error(err.message)
    }
  }
  const remove = async () => {
    setDeleteBusy(true)
    try {
      await api(`/api/notes/${note.id}`, { method: 'DELETE' })
      onChanged()
    } catch (err) {
      setDeleteBusy(false)
      toast.error(err.message)
    }
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)', padding: 'var(--spacing-3) 0' }}>
        <TextArea label="Edit note" isLabelHidden value={draft} onChange={setDraft} rows={2} />
        <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
          <Button label="Save" variant="primary" size="sm" clickAction={save} />
          <Button label="Cancel" variant="ghost" size="sm" onClick={() => { setDraft(note.text); setEditing(false) }} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-3)', padding: 'var(--spacing-3) 0' }}>
      <Avatar name={note.author} size="small" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--spacing-2)' }}>
          <span style={{ fontSize: 'var(--text-label-size)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>
            {note.author}
          </span>
          <span style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>
            {new Date(note.created_at + 'Z').toLocaleString()}
          </span>
        </div>
        <div style={{ fontSize: 'var(--text-large-size)', lineHeight: 1.5, color: 'var(--color-text-primary)', marginTop: 'var(--spacing-0-5)', whiteSpace: 'pre-wrap' }}>
          {renderNoteText(note.text)}
        </div>
      </div>
      {canModify && (
        <div style={{ display: 'flex', gap: 'var(--spacing-0-5)', flexShrink: 0 }}>
          <IconButton label="Edit note" icon={<span>✎</span>} variant="ghost" size="sm" onClick={() => setEditing(true)} />
          <IconButton label="Delete note" icon={<span>×</span>} variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} />
        </div>
      )}
      <ConfirmDialog
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this note?"
        message="This removes the note. This can't be undone."
        confirmLabel="Delete note"
        isBusy={deleteBusy}
        onConfirm={async () => {
          await remove()
          setDeleteOpen(false)
        }}
      />
    </div>
  )
}

// Pre-filled dialog for the "I cooked this" shortcut — posts to the same
// notes endpoint as the inline add box, just with a default message the
// user can extend before saving.
function CookedThisDialog({ recipeId, isOpen, onOpenChange, onSaved }) {
  const [detail, setDetail] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (isOpen) setDetail('')
  }, [isOpen])

  const save = async () => {
    setSaving(true)
    try {
      const text = detail.trim() ? `Cooked this — ${detail.trim()}` : 'Cooked this'
      await api(`/api/recipes/${recipeId}/notes`, { method: 'POST', body: { text } })
      onOpenChange(false)
      onSaved()
      toast.success('Note added')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form">
      <DialogFrame title="Cooked this 🍳" description="Add any detail worth remembering next time — or just save as-is.">
        <TextArea
          label="Detail (optional)"
          isLabelHidden
          value={detail}
          onChange={setDetail}
          rows={2}
          placeholder="e.g. swapped cream for yoghurt"
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
          <Button label="Cancel" variant="ghost" onClick={() => onOpenChange(false)} isDisabled={saving} />
          <Button label="Save" variant="primary" clickAction={save} isLoading={saving} />
        </div>
      </DialogFrame>
    </Dialog>
  )
}

function NotesSection({ recipe, currentUser, onChanged }) {
  const [draft, setDraft] = useState('')
  const [cookedOpen, setCookedOpen] = useState(false)
  const toast = useToast()

  const save = async () => {
    if (!draft.trim()) return
    try {
      await api(`/api/recipes/${recipe.id}/notes`, { method: 'POST', body: { text: draft.trim() } })
      setDraft('')
      onChanged()
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={sectionLabelStyle}>Notes</span>
        <Button label="I cooked this" icon={<span>🍳</span>} variant="secondary" size="sm" onClick={() => setCookedOpen(true)} />
      </div>
      <CookedThisDialog recipeId={recipe.id} isOpen={cookedOpen} onOpenChange={setCookedOpen} onSaved={onChanged} />

      {/* Inline add box — no navigation, no edit mode (spec §3.1.1). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)', marginTop: 'var(--spacing-3)', marginBottom: 'var(--spacing-2)' }}>
        <TextArea label="Add a note" isLabelHidden value={draft} onChange={setDraft} rows={2} placeholder="Add a note about this recipe…" />
        <div>
          <Button label="Save note" variant="secondary" size="sm" clickAction={save} isDisabled={!draft.trim()} />
        </div>
      </div>

      <Card padding={0} style={{ padding: '0 var(--spacing-3)' }}>
        {recipe.notes.length === 0 && (
          <div style={{ padding: 'var(--spacing-3) 0', fontSize: 'var(--text-body-size)', color: 'var(--color-text-secondary)' }}>
            No notes yet.
          </div>
        )}
        {recipe.notes.map((n, i) => (
          <div key={n.id}>
            {i > 0 && <Divider />}
            <NoteRow note={n} currentUser={currentUser} onChanged={onChanged} />
          </div>
        ))}
      </Card>
    </div>
  )
}

/** Recipe detail: photo, tags, servings stepper with live scaling, steps,
 * cooking notes (spec §6.3). */
export default function RecipeDetailPage({ currentUser }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const [recipe, setRecipe] = useState(null)
  const [error, setError] = useState('')
  const [servings, setServings] = useState(null)
  // Ingredient ids briefly shown with a ✓ after being sent to the list.
  const [addedIds, setAddedIds] = useState({})
  const [exportOpen, setExportOpen] = useState(false)
  const [cookMode, setCookMode] = useState(false)
  const wakeLockRef = useRef(null)
  const toast = useToast()
  const wakeLockSupported = 'wakeLock' in navigator

  const load = () => {
    api(`/api/recipes/${id}`)
      .then((r) => {
        setRecipe(r)
        setServings((s) => s ?? r.servings ?? 1)
      })
      .catch((err) => setError(err.message))
  }
  useEffect(() => {
    // Reset the stepper when switching recipe (or version), then load.
    setServings(null)
    setRecipe(null)
    load()
  }, [id])

  // Cook mode: keep the screen awake while the recipe is on-screen. The
  // lock is released automatically by the browser when the tab goes
  // background, so it must be re-acquired on visibilitychange or it stays
  // off for the rest of the cook after a quick screen-off/on.
  useEffect(() => {
    if (!wakeLockSupported || !cookMode) return
    let cancelled = false
    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          lock.release()
          return
        }
        wakeLockRef.current = lock
      } catch {
        // Can fail if the tab isn't visible or the OS refuses — the toggle
        // stays on and re-acquire is retried on the next visibilitychange.
      }
    }
    acquire()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) acquire()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      wakeLockRef.current?.release()
      wakeLockRef.current = null
    }
  }, [cookMode, wakeLockSupported])

  if (error) return <EmptyState title="Recipe not found" description={error} actions={<Button label="Back to recipes" onClick={() => navigate('/')} />} />
  if (recipe === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-8)' }}>
        <Spinner label="Loading recipe" />
      </div>
    )
  }

  const baseServings = recipe.servings || 1
  const scale = (servings || baseServings) / baseServings

  // Send ingredients to the shopping list. Items are copies of the STORED
  // amounts (scaling is display-only, spec §3.4 / §3.1).
  const flashAdded = (ids) => {
    setAddedIds((m) => ({ ...m, ...Object.fromEntries(ids.map((i) => [i, true])) }))
    setTimeout(() => {
      setAddedIds((m) => {
        const next = { ...m }
        ids.forEach((i) => delete next[i])
        return next
      })
    }, 1400)
  }

  const addToList = async (ingredientId) => {
    try {
      await api('/api/shopping/from-recipe', {
        method: 'POST',
        body: { recipe_id: recipe.id, ingredient_ids: [ingredientId] },
      })
      flashAdded([ingredientId])
      toast.success('Added to list')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const addAllToList = async () => {
    try {
      await api('/api/shopping/from-recipe', {
        method: 'POST',
        body: { recipe_id: recipe.id },
      })
      flashAdded(recipe.ingredients.map((i) => i.id))
      toast.success(`Added ${recipe.ingredients.length} items`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  // PUT /api/recipes/{id} replaces the whole recipe, so this must resend the
  // current fields (not just status) or ingredients/steps would be wiped.
  const publish = async () => {
    try {
      await api(`/api/recipes/${recipe.id}`, {
        method: 'PUT',
        body: {
          title: recipe.title,
          description: recipe.description,
          servings: recipe.servings,
          tags: recipe.tags,
          source_url: recipe.source_url,
          status: 'published',
          ingredients: recipe.ingredients.map((i) => ({
            name: i.name,
            amount: i.amount,
            unit: i.unit,
            note: i.note,
            scalable: i.scalable,
            category_id: i.category_id,
            section: i.section,
          })),
          steps: recipe.steps,
        },
      })
      load()
      toast.success('Published')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const leftColumn = (
    <>
      {/* Photo header with back/edit floating buttons */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div
          style={{
            height: recipe.photo_path ? (isDesktop ? 260 : 220) : (isDesktop ? 72 : 56),
            width: '100%',
            borderRadius: isDesktop ? 'var(--radius-container)' : 0,
            overflow: 'hidden',
            background: 'var(--color-background-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {recipe.photo_path ? (
            <img src={`/api/uploads/${recipe.photo_path}`} alt={recipe.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontFamily: 'var(--font-family-code)', fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>
              no photo yet
            </span>
          )}
        </div>
        {!isDesktop && (
          <div style={{ position: 'absolute', top: 'var(--spacing-3)', left: 'var(--spacing-3)' }}>
            <IconButton label="Back" icon={<span>‹</span>} variant="secondary" onClick={() => navigate('/')} />
          </div>
        )}
      </div>

      <div style={{ padding: isDesktop ? 'var(--spacing-4) 0' : 'var(--spacing-4)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
        <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column', alignItems: isDesktop ? 'flex-start' : 'stretch', justifyContent: 'space-between', gap: 'var(--spacing-3)' }}>
          <h1
            style={{
              margin: 0,
              fontSize: isDesktop ? 'var(--text-heading-1-size)' : 'var(--text-heading-2-size)',
              fontWeight: 'var(--text-heading-1-weight)',
              color: 'var(--color-text-primary)',
            }}
          >
            {recipe.title}
          </h1>
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', flexShrink: 0 }}>
            {recipe.status === 'draft' && (
              <Button label="Publish" variant="primary" size="sm" clickAction={publish} />
            )}
            <Button label="Export" variant="secondary" size="sm" onClick={() => setExportOpen(true)} />
            <Button label="Edit" icon={<span>✎</span>} variant="secondary" size="sm" onClick={() => navigate(`/recipes/${recipe.id}/edit`)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          {recipe.status === 'draft' && <Badge label="Draft" variant="warning" />}
          {recipe.tags.map((t) => <TagBadge key={t} tag={t} />)}
        </div>

        {/* Version switcher (only when this recipe has more than one version) */}
        {recipe.versions.length > 1 && (
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>
              Versions:
            </span>
            {recipe.versions.map((v, i) => (
              <ToggleButton
                key={v.id}
                label={v.version_label || (i === 0 ? 'Original' : `Version ${i + 1}`)}
                size="sm"
                isPressed={v.id === recipe.id}
                onPressedChange={() => {
                  if (v.id !== recipe.id) navigate(`/recipes/${v.id}`)
                }}
              />
            ))}
          </div>
        )}

        {recipe.description && (
          <p style={{ margin: 0, fontSize: 'var(--text-large-size)', lineHeight: 1.5, color: 'var(--color-text-primary)' }}>
            {recipe.description}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-primary)' }}>
            Servings
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            {wakeLockSupported && (
              <ToggleButton
                label={cookMode ? 'Cook mode on — screen stays awake' : 'Cook mode — keep screen awake'}
                icon={<span>◌</span>}
                pressedIcon={<span>☀</span>}
                isIconOnly
                isPressed={cookMode}
                onPressedChange={setCookMode}
              />
            )}
            <NumberInput label="Servings" isLabelHidden value={servings} onChange={setServings} min={1} max={24} />
          </div>
        </div>
      </div>

      <div style={{ padding: isDesktop ? '0 0 var(--spacing-2)' : '0 var(--spacing-4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-2)' }}>
        <span style={sectionLabelStyle}>Ingredients</span>
        {recipe.ingredients.length > 0 && (
          <Button label="Add all to list" variant="primary" size="sm" clickAction={addAllToList} />
        )}
      </div>

      <Card padding={0} style={{ margin: isDesktop ? 0 : '0 var(--spacing-4)' }}>
        {(() => {
          // Group ingredients by section regardless of where they fall in
          // the stored order, so the same heading (e.g. two "Golf" rows
          // separated by a "Graft" row) always renders as one contiguous
          // block instead of repeating. Un-sectioned ingredients form their
          // own (heading-less) group and always come first. Within each
          // group, and across groups, original array order is preserved —
          // groups appear in the order their section first shows up.
          const noSection = []
          const bySection = new Map()
          const sectionOrder = []
          for (const ing of recipe.ingredients) {
            if (!ing.section) {
              noSection.push(ing)
              continue
            }
            if (!bySection.has(ing.section)) {
              bySection.set(ing.section, [])
              sectionOrder.push(ing.section)
            }
            bySection.get(ing.section).push(ing)
          }
          const ordered = [...noSection, ...sectionOrder.flatMap((s) => bySection.get(s))]
          let currentSection = null
          return ordered.map((ing, i) => {
            const startsNewSection = ing.section && ing.section !== currentSection
            currentSection = ing.section || currentSection
            return (
              <div key={ing.id}>
                {i > 0 && <Divider />}
                {startsNewSection && (
                  <div
                    style={{
                      padding: 'var(--spacing-3) var(--spacing-4) 0',
                      fontSize: 'var(--text-supporting-size)',
                      fontWeight: 'var(--font-weight-semibold)',
                      color: 'var(--color-text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {ing.section}
                  </div>
                )}
                <IngredientRow ingredient={ing} scale={scale} onAdd={addToList} added={!!addedIds[ing.id]} />
              </div>
            )
          })
        })()}
        {recipe.ingredients.length === 0 && (
          <div style={{ padding: 'var(--spacing-3) var(--spacing-4)', color: 'var(--color-text-secondary)' }}>
            No ingredients listed.
          </div>
        )}
      </Card>
    </>
  )

  const rightColumn = (
    <div style={{ padding: isDesktop ? 0 : 'var(--spacing-4)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
      <span style={{ ...sectionLabelStyle, marginBottom: 'var(--spacing-2)' }}>Steps</span>
      {recipe.steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: 'var(--spacing-3)', padding: 'var(--spacing-3) 0' }}>
          <div style={stepNumberStyle}>{i + 1}</div>
          <div style={{ fontSize: 'var(--text-large-size)', lineHeight: 1.5, color: 'var(--color-text-primary)', paddingTop: 3 }}>
            {step}
          </div>
        </div>
      ))}
      {recipe.steps.length === 0 && (
        <span style={{ color: 'var(--color-text-secondary)' }}>No steps yet.</span>
      )}

      <div style={{ marginTop: 'var(--spacing-6)' }}>
        <NotesSection recipe={recipe} currentUser={currentUser} onChanged={load} />
      </div>
    </div>
  )

  const exportDialog = (
    <ExportRecipeDialog recipeId={recipe.id} title={recipe.title} isOpen={exportOpen} onOpenChange={setExportOpen} />
  )

  if (isDesktop) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--spacing-6)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: '420px 1fr', gap: 'var(--spacing-8)', alignItems: 'start' }}>
          <div style={{ position: 'sticky', top: 0, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100dvh - 140px)', overflowY: 'auto' }}>{leftColumn}</div>
          <div style={{ maxWidth: 640 }}>{rightColumn}</div>
        </div>
        {exportDialog}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
      {leftColumn}
      {rightColumn}
      {exportDialog}
    </div>
  )
}
