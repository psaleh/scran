import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import { TextArea } from '@astryxdesign/core/TextArea'

import { api } from '../api.js'

/**
 * "Import recipe data" dialog: the paste-and-import counterpart to Export
 * (ExportRecipeDialog.jsx) — paste JSON copied from another Scran instance,
 * or load it from a downloaded file, and it's saved as a new draft recipe.
 * Unlike the AI import flows, this is a direct copy — no review queue.
 */
export default function ImportDataDialog({ isOpen, onOpenChange }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef(null)
  const navigate = useNavigate()

  const loadFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  const close = (open) => {
    if (busy) return
    if (!open) {
      setText('')
      setError('')
    }
    onOpenChange(open)
  }

  const doImport = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    setError('')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      setError("That doesn't look like valid recipe data.")
      setBusy(false)
      return
    }
    try {
      const created = await api('/api/recipes/import', { method: 'POST', body: parsed })
      setText('')
      onOpenChange(false)
      navigate(`/recipes/${created.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={close} purpose="form">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', padding: 'var(--spacing-2)' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-heading-2-size)', fontWeight: 'var(--text-heading-2-weight)', color: 'var(--color-text-primary)' }}>
            Import recipe data
          </h2>
          <p style={{ margin: 'var(--spacing-1) 0 0', fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)' }}>
            Paste recipe data exported from another Scran instance, or choose
            a downloaded file. It's saved as a draft you can review here.
          </p>
        </div>
        {error && <Banner status="error" title={error} />}

        <input ref={fileInput} type="file" accept="application/json" onChange={loadFile} style={{ display: 'none' }} />

        <TextArea
          label="Recipe data"
          isLabelHidden
          value={text}
          onChange={setText}
          rows={12}
          placeholder="Paste recipe data here…"
        />

        <div>
          <Button label="…or choose a file" variant="secondary" onClick={() => fileInput.current?.click()} isDisabled={busy} />
        </div>

        <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
          <Button label="Cancel" variant="ghost" onClick={() => close(false)} isDisabled={busy} />
          <Button label={busy ? 'Importing…' : 'Import'} variant="primary" clickAction={doImport} isDisabled={busy || !text.trim()} />
        </div>
      </div>
    </Dialog>
  )
}
