import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import { TextInput } from '@astryxdesign/core/TextInput'

import { api } from '../api.js'
import DialogFrame from './DialogFrame.jsx'

/**
 * "Import from YouTube" dialog: paste a video link, the server queues an AI
 * job that watches the video and creates a draft recipe. The draft shows up
 * in the import inbox for review — nothing is published without a human.
 * Requires a video AI profile (Settings → AI profiles); the server rejects
 * the request with a readable message if none is configured.
 */
export default function ImportVideoDialog({ isOpen, onOpenChange }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const close = (open) => {
    if (busy) return
    if (!open) {
      setUrl('')
      setError('')
    }
    onOpenChange(open)
  }

  const doImport = async () => {
    if (!url.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await api('/api/import/video', { method: 'POST', body: { url: url.trim() } })
      onOpenChange(false)
      setUrl('')
      navigate('/settings?tab=inbox')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={close} purpose="form">
      <DialogFrame
        title="Import from YouTube"
        description="Paste a link to a cooking video. The AI watches it and drafts the recipe — the draft appears in the import inbox for review."
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doImport() } }}
      >
        {error && <Banner status="error" title={error} />}
        <TextInput
          label="YouTube video URL"
          value={url}
          onChange={setUrl}
          placeholder="https://www.youtube.com/watch?v=…"
          type="url"
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
          <Button label="Cancel" variant="ghost" onClick={() => close(false)} isDisabled={busy} />
          <Button label={busy ? 'Queueing…' : 'Import'} variant="primary" clickAction={doImport} isDisabled={busy || !url.trim()} />
        </div>
      </DialogFrame>
    </Dialog>
  )
}
