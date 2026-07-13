import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import { TextInput } from '@astryxdesign/core/TextInput'

import { api } from '../api.js'

/**
 * "Import from website" dialog (spec §3.3.2): paste a URL, the server parses
 * the page's schema.org/Recipe data, and the result opens pre-filled in the
 * recipe editor for review. Nothing is saved until the user saves the draft.
 */
export default function ImportUrlDialog({ isOpen, onOpenChange }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const doImport = async () => {
    if (!url.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const prefill = await api('/api/import/url', { method: 'POST', body: { url: url.trim() } })
      onOpenChange(false)
      setUrl('')
      // The editor picks this up from router state and pre-fills the form.
      navigate('/recipes/new', { state: { prefill } })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form">
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', padding: 'var(--spacing-2)' }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doImport() } }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-heading-2-size)', fontWeight: 'var(--text-heading-2-weight)', color: 'var(--color-text-primary)' }}>
            Import from website
          </h2>
          <p style={{ margin: 'var(--spacing-1) 0 0', fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)' }}>
            Paste a link to a recipe page. You'll get a chance to review and
            edit everything before saving.
          </p>
        </div>
        {error && <Banner status="error" title={error} />}
        <TextInput
          label="Recipe page URL"
          value={url}
          onChange={setUrl}
          placeholder="https://…"
          type="url"
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
          <Button label="Cancel" variant="ghost" onClick={() => onOpenChange(false)} isDisabled={busy} />
          <Button label={busy ? 'Fetching…' : 'Import'} variant="primary" clickAction={doImport} isDisabled={busy || !url.trim()} />
        </div>
      </div>
    </Dialog>
  )
}
