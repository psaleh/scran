import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import { TextInput } from '@astryxdesign/core/TextInput'

import { api } from '../api.js'
import DialogFrame from './DialogFrame.jsx'

/**
 * "Import from website" dialog (spec §3.3.2): paste a URL, the server parses
 * the page's schema.org/Recipe data, and the result opens pre-filled in the
 * recipe editor for review. Nothing is saved until the user saves the draft.
 */
export default function ImportUrlDialog({ isOpen, onOpenChange }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 422 = page fetched but no schema.org recipe data; AI extraction is the
  // fallback (spec §3.3.2). Other errors (bad URL, site down) get no offer.
  const [offerAi, setOfferAi] = useState(false)
  const navigate = useNavigate()

  const close = (open) => {
    if (busy) return
    if (!open) {
      setUrl('')
      setError('')
      setOfferAi(false)
    }
    onOpenChange(open)
  }

  const doImport = async () => {
    if (!url.trim() || busy) return
    setBusy(true)
    setError('')
    setOfferAi(false)
    try {
      const prefill = await api('/api/import/url', { method: 'POST', body: { url: url.trim() } })
      onOpenChange(false)
      setUrl('')
      // The editor picks this up from router state and pre-fills the form.
      navigate('/recipes/new', { state: { prefill } })
    } catch (err) {
      setError(err.message)
      if (err.status === 422) setOfferAi(true)
    } finally {
      setBusy(false)
    }
  }

  // Queue an AI-extraction job for the same URL; the draft shows up in the
  // import inbox for review when the job finishes.
  const doAiImport = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api('/api/import/url/ai', { method: 'POST', body: { url: url.trim() } })
      onOpenChange(false)
      setUrl('')
      setOfferAi(false)
      navigate('/inbox')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={close} purpose="form">
      <DialogFrame
        title="Import from website"
        description="Paste a link to a recipe page. You'll get a chance to review and edit everything before saving."
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doImport() } }}
      >
        {error && <Banner status="error" title={error} />}
        {offerAi && (
          <Banner
            status="info"
            title="Try AI extraction instead?"
            description="The AI can read the page like a human would. The result is queued and appears in the import inbox as a draft for review."
          />
        )}
        <TextInput
          label="Recipe page URL"
          value={url}
          onChange={setUrl}
          placeholder="https://…"
          type="url"
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
          <Button label="Cancel" variant="ghost" onClick={() => close(false)} isDisabled={busy} />
          {offerAi && (
            <Button label={busy ? 'Queueing…' : 'Try AI extraction'} variant="secondary" clickAction={doAiImport} isDisabled={busy} />
          )}
          <Button label={busy ? 'Fetching…' : 'Import'} variant="primary" clickAction={doImport} isDisabled={busy || !url.trim()} />
        </div>
      </DialogFrame>
    </Dialog>
  )
}
