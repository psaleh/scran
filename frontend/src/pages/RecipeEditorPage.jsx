import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Divider } from '@astryxdesign/core/Divider'
import { IconButton } from '@astryxdesign/core/IconButton'
import { NumberInput } from '@astryxdesign/core/NumberInput'
import { Selector } from '@astryxdesign/core/Selector'
import { Spinner } from '@astryxdesign/core/Spinner'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Banner } from '@astryxdesign/core/Banner'
import { Dialog } from '@astryxdesign/core/Dialog'

import { api, upload } from '../api.js'
import { sectionLabelStyle, stepNumberStyle } from '../styles.js'
import { useIsDesktop } from '../useIsDesktop.js'

let nextRowId = 1
const newIngredient = () => ({ rowId: nextRowId++, amount: '', unit: '', name: '', note: '', category_id: null, scalable: true })

/**
 * Ingredient row with autocomplete against the lookup table (spec §3.2).
 * Free text is always allowed; picking a suggestion silently attaches the
 * known category.
 */
function IngredientRow({ ing, categories, onChange, onRemove }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const blurTimer = useRef(null)

  useEffect(() => {
    if (ing.name.trim().length < 2 || !open) {
      setSuggestions([])
      return
    }
    const timer = setTimeout(() => {
      api(`/api/ingredients/suggest?q=${encodeURIComponent(ing.name.trim())}`)
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
    }, 150)
    return () => clearTimeout(timer)
  }, [ing.name, open])

  const pick = (s) => {
    onChange({ ...ing, name: s.name, category_id: s.category_id })
    setOpen(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)', padding: 'var(--spacing-3) var(--spacing-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
        <div style={{ width: 64, flexShrink: 0 }}>
          <TextInput label="Amount" isLabelHidden value={ing.amount} onChange={(v) => onChange({ ...ing, amount: v })} placeholder="qty" />
        </div>
        <div style={{ width: 64, flexShrink: 0 }}>
          <TextInput label="Unit" isLabelHidden value={ing.unit} onChange={(v) => onChange({ ...ing, unit: v })} placeholder="unit" />
        </div>
        <div
          style={{ flex: 1, minWidth: 0, position: 'relative' }}
          onFocus={() => { clearTimeout(blurTimer.current); setOpen(true) }}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150) }}
        >
          <TextInput
            label="Ingredient name"
            isLabelHidden
            value={ing.name}
            onChange={(v) => { onChange({ ...ing, name: v, category_id: null }); setOpen(true) }}
            placeholder="Ingredient name"
          />
          {open && suggestions.length > 0 && (
            <Card style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, padding: 4, zIndex: 10, boxShadow: 'var(--shadow-high)' }}>
              {suggestions.map((s) => (
                <div
                  key={s.name}
                  onMouseDown={(e) => { e.preventDefault(); pick(s) }}
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
        <IconButton label="Remove ingredient" icon={<span>×</span>} variant="ghost" onClick={onRemove} />
      </div>
      {/* Prep/size/qualifiers live here, keeping the name shoppable (spec §3.2). */}
      <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <TextInput
            label="Note"
            isLabelHidden
            value={ing.note}
            onChange={(v) => onChange({ ...ing, note: v })}
            placeholder="Note, e.g. finely diced (optional)"
          />
        </div>
        {/* Manual category override (spec §3.6.4). Empty = let the lookup
            table / AI categorisation decide on save. */}
        <div style={{ flex: '1 1 140px', minWidth: 0 }}>
          <Selector
            label="Category"
            isLabelHidden
            placeholder="Category (auto)"
            hasClear
            options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
            value={ing.category_id == null ? undefined : String(ing.category_id)}
            onChange={(v) => onChange({ ...ing, category_id: v == null ? null : Number(v) })}
          />
        </div>
      </div>
      <CheckboxInput label="Scales with servings" size="sm" value={ing.scalable} onChange={(v) => onChange({ ...ing, scalable: v })} />
    </div>
  )
}

function StepRow({ index, text, total, onChange, onRemove, onMove }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-3)', padding: 'var(--spacing-3) var(--spacing-4)' }}>
      <div style={{ ...stepNumberStyle, marginTop: 2 }}>{index + 1}</div>
      <div style={{ flex: 1 }}>
        <TextArea label={`Step ${index + 1}`} isLabelHidden value={text} onChange={onChange} rows={2} placeholder={`Step ${index + 1}…`} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        <IconButton label="Move up" icon={<span>↑</span>} variant="ghost" size="sm" isDisabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton label="Move down" icon={<span>↓</span>} variant="ghost" size="sm" isDisabled={index === total - 1} onClick={() => onMove(1)} />
        <IconButton label="Remove step" icon={<span>×</span>} variant="ghost" size="sm" onClick={onRemove} />
      </div>
    </div>
  )
}

/** Recipe editor: manual entry and editing (later also import review, spec §6.4). */
export default function RecipeEditorPage() {
  const { id } = useParams() // undefined on /recipes/new
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  // Website import (spec §3.3.2) lands here with the parsed recipe in router
  // state; the form starts pre-filled and the user reviews before saving.
  const prefill = useLocation().state?.prefill

  const [loaded, setLoaded] = useState(id === undefined)
  const [error, setError] = useState('')
  const [title, setTitle] = useState(prefill?.title ?? '')
  const [description, setDescription] = useState(prefill?.description ?? '')
  const [servings, setServings] = useState(prefill?.servings ?? 4)
  const [tags, setTags] = useState(prefill?.tags ?? [])
  const [tagDraft, setTagDraft] = useState('')
  const [sourceUrl, setSourceUrl] = useState(prefill?.source_url ?? null)
  const [status, setStatus] = useState('draft')
  const [ingredients, setIngredients] = useState(() =>
    prefill?.ingredients?.length
      ? prefill.ingredients.map((i) => ({ ...newIngredient(), ...i, amount: i.amount == null ? '' : String(i.amount), unit: i.unit ?? '', note: i.note ?? '' }))
      : [newIngredient()],
  )
  const [steps, setSteps] = useState(prefill?.steps?.length ? prefill.steps : [''])
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [existingPhoto, setExistingPhoto] = useState(null)
  const [versionDialogOpen, setVersionDialogOpen] = useState(false)
  const [versionLabel, setVersionLabel] = useState('')
  const [categories, setCategories] = useState([])
  const fileInput = useRef(null)

  useEffect(() => {
    api('/api/categories').then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    if (id === undefined) return
    api(`/api/recipes/${id}`)
      .then((r) => {
        setTitle(r.title)
        setDescription(r.description)
        setServings(r.servings ?? 4)
        setTags(r.tags)
        setSourceUrl(r.source_url)
        setStatus(r.status)
        setIngredients(
          r.ingredients.length
            ? r.ingredients.map((i) => ({ ...newIngredient(), ...i, amount: i.amount == null ? '' : String(i.amount), unit: i.unit ?? '', note: i.note ?? '' }))
            : [newIngredient()],
        )
        setSteps(r.steps.length ? r.steps : [''])
        setExistingPhoto(r.photo_path)
        setLoaded(true)
      })
      .catch((err) => setError(err.message))
  }, [id])

  const updateIngredient = (rowId, next) => setIngredients((list) => list.map((i) => (i.rowId === rowId ? next : i)))
  const removeIngredient = (rowId) => setIngredients((list) => list.filter((i) => i.rowId !== rowId))
  const moveStep = (i, dir) =>
    setSteps((list) => {
      const j = i + dir
      if (j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const addTag = () => {
    const t = tagDraft.trim()
    if (t && !tags.includes(t)) setTags([...tags, t])
    setTagDraft('')
  }

  const choosePhoto = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const buildBody = (saveStatus) => {
    // Commit any tag text still sitting in the input, so typing a tag and
    // hitting Save directly (without pressing Enter) doesn't lose it.
    const pending = tagDraft.trim()
    const finalTags = pending && !tags.includes(pending) ? [...tags, pending] : tags
    return {
      title,
      description,
      servings,
      tags: finalTags,
      source_url: sourceUrl,
      status: saveStatus,
      ingredients: ingredients
        .filter((i) => i.name.trim())
        .map((i) => ({
          amount: i.amount === '' ? null : Number(i.amount) || null,
          unit: i.unit || null,
          name: i.name,
          note: i.note.trim() || null,
          category_id: i.category_id,
          scalable: i.scalable,
        })),
      steps: steps.filter((s) => s.trim()),
    }
  }

  const validate = () => {
    setError('')
    if (!title.trim()) {
      setError('Give the recipe a title.')
      return false
    }
    return true
  }

  const finishSave = async (saved) => {
    if (photoFile) {
      await upload(`/api/recipes/${saved.id}/photo`, 'photo', photoFile)
    }
    navigate(`/recipes/${saved.id}`)
  }

  const save = async (saveStatus) => {
    if (!validate()) return
    try {
      const body = buildBody(saveStatus)
      const saved = id === undefined
        ? await api('/api/recipes', { method: 'POST', body })
        : await api(`/api/recipes/${id}`, { method: 'PUT', body })
      await finishSave(saved)
    } catch (err) {
      setError(err.message)
    }
  }

  // "Save as new version": the original recipe stays untouched; the edits in
  // the form become a new linked recipe in the same version group.
  const saveAsVersion = async () => {
    if (!validate()) return
    try {
      const body = { ...buildBody(status), version_label: versionLabel }
      const saved = await api(`/api/recipes/${id}/versions`, { method: 'POST', body })
      setVersionDialogOpen(false)
      await finishSave(saved)
    } catch (err) {
      setVersionDialogOpen(false)
      setError(err.message)
    }
  }

  if (!loaded && !error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-8)' }}>
        <Spinner label="Loading recipe" />
      </div>
    )
  }

  const photoSrc = photoPreview || (existingPhoto ? `/api/uploads/${existingPhoto}` : null)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header: back + save actions */}
      <div
        style={{
          padding: 'var(--spacing-3) var(--spacing-4)',
          flexShrink: 0,
          background: 'var(--color-background-surface)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--spacing-2)',
        }}
      >
        <IconButton label="Back" icon={<span>‹</span>} variant="ghost" onClick={() => navigate(-1)} />
        <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
          {id !== undefined && (
            <Button label="Save as version…" variant="ghost" size="sm" onClick={() => setVersionDialogOpen(true)} />
          )}
          <Button label="Save draft" variant="secondary" size="sm" clickAction={() => save('draft')} />
          <Button label={status === 'published' ? 'Save' : 'Publish'} variant="primary" size="sm" clickAction={() => save('published')} />
        </div>
      </div>

      {/* "Save as new version" label prompt */}
      <Dialog isOpen={versionDialogOpen} onOpenChange={setVersionDialogOpen} purpose="form">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', padding: 'var(--spacing-2)' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 'var(--text-heading-2-size)', fontWeight: 'var(--text-heading-2-weight)', color: 'var(--color-text-primary)' }}>
              Save as new version
            </h2>
            <p style={{ margin: 'var(--spacing-1) 0 0', fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)' }}>
              The original recipe is kept; your edits become a new version alongside it.
            </p>
          </div>
          <TextInput
            label="Version name"
            value={versionLabel}
            onChange={setVersionLabel}
            placeholder={'e.g. "Less spicy", "Slow-cooker"'}
            isOptional
          />
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
            <Button label="Cancel" variant="ghost" onClick={() => setVersionDialogOpen(false)} />
            <Button label="Save version" variant="primary" clickAction={saveAsVersion} />
          </div>
        </div>
      </Dialog>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: isDesktop ? 1200 : 'none', margin: '0 auto', padding: isDesktop ? 'var(--spacing-6)' : 0 }}>
          <div style={{ padding: isDesktop ? '0 0 var(--spacing-4)' : 'var(--spacing-4)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
            {error && <Banner status="error" title={error} />}
            {sourceUrl && <Badge label={`Imported from ${sourceUrl}`} variant="info" />}

            {/* Photo upload: tap the placeholder/photo to pick a file */}
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} style={{ display: 'none' }} />
            <div
              onClick={() => fileInput.current?.click()}
              style={{
                height: 140,
                borderRadius: 'var(--radius-container)',
                maxWidth: isDesktop ? 360 : 'none',
                overflow: 'hidden',
                cursor: 'pointer',
                background: 'var(--color-background-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {photoSrc ? (
                <img src={photoSrc} alt="Recipe" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontFamily: 'var(--font-family-code)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                  tap to upload photo
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? '2fr 1fr' : '1fr', gap: 'var(--spacing-4)' }}>
              <TextInput label="Title" value={title} onChange={setTitle} placeholder="Recipe title" isRequired />
              <NumberInput label="Servings" value={servings} onChange={setServings} min={1} max={24} />
            </div>

            <TextArea label="Description" value={description} onChange={setDescription} rows={2} isOptional placeholder="What is this dish?" />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
              {tags.length > 0 && (
                <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
                  {tags.map((t) => (
                    <Badge
                      key={t}
                      variant="neutral"
                      label={
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {t}
                          <span onClick={() => setTags(tags.filter((x) => x !== t))} style={{ cursor: 'pointer' }}>×</span>
                        </span>
                      }
                    />
                  ))}
                </div>
              )}
              <div style={{ maxWidth: isDesktop ? 360 : 'none' }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}>
                <TextInput label="Tags" value={tagDraft} onChange={setTagDraft} placeholder="Add a tag, press Enter" isOptional />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr', gap: isDesktop ? 'var(--spacing-6)' : 0, alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ padding: isDesktop ? '0 0 var(--spacing-2)' : '0 var(--spacing-4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-2)' }}>
                <span style={sectionLabelStyle}>Ingredients</span>
                <Button label="Add ingredient" variant="secondary" size="sm" onClick={() => setIngredients([...ingredients, newIngredient()])} />
              </div>
              <Card padding={0} style={{ margin: isDesktop ? 0 : '0 var(--spacing-4)' }}>
                {ingredients.map((ing, i) => (
                  <div key={ing.rowId}>
                    {i > 0 && <Divider />}
                    <IngredientRow ing={ing} categories={categories} onChange={(next) => updateIngredient(ing.rowId, next)} onRemove={() => removeIngredient(ing.rowId)} />
                  </div>
                ))}
              </Card>
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ padding: isDesktop ? '0 0 var(--spacing-2)' : 'var(--spacing-5) var(--spacing-4) 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-2)' }}>
                <span style={sectionLabelStyle}>Steps</span>
                <Button label="Add step" variant="secondary" size="sm" onClick={() => setSteps([...steps, ''])} />
              </div>
              <Card padding={0} style={{ margin: isDesktop ? 0 : '0 var(--spacing-4) var(--spacing-6)' }}>
                {steps.map((step, i) => (
                  <div key={i}>
                    {i > 0 && <Divider />}
                    <StepRow
                      index={i}
                      text={step}
                      total={steps.length}
                      onChange={(v) => setSteps(steps.map((s, idx) => (idx === i ? v : s)))}
                      onRemove={() => setSteps(steps.filter((_, idx) => idx !== i))}
                      onMove={(dir) => moveStep(i, dir)}
                    />
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
