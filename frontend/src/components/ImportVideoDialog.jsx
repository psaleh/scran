import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import { TextInput } from '@astryxdesign/core/TextInput'

import { api } from '../api.js'

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

  const doImport = async () => {
    if (!url.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await api('/api/import/video', { method: 'POST', body: { url: url.trim() } })
      onOpenChange(false)
      setUrl('')
      navigate('/inbox')
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
            Import from YouTube
          </h2>
          <p style={{ margin: 'var(--spacing-1) 0 0', fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)' }}>
            Paste a link to a cooking video. The AI watches it and drafts the
            recipe — the draft appears in the import inbox for review.
          </p>
        </div>
        {error && <Banner status="error" title={error} />}
        <TextInput
          label="YouTube video URL"
          value={url}
          onChange={setUrl}
          placeholder="https://www.youtube.com/watch?v=…"
          type="url"
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
          <Button label="Cancel" variant="ghost" onClick={() => onOpenChange(false)} isDisabled={busy} />
          <Button label={busy ? 'Queueing…' : 'Import'} variant="primary" clickAction={doImport} isDisabled={busy || !url.trim()} />
        </div>
      </div>
    </Dialog>
  )
}
