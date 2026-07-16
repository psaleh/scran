import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import { IconButton } from '@astryxdesign/core/IconButton'

import { uploadMany } from '../api.js'
import DialogFrame from './DialogFrame.jsx'

const MAX_PHOTOS = 8 // matches MAX_IMPORT_PHOTOS on the server

/**
 * "Import from photo" dialog (spec §3.3.3, §5.3): pick photos of one recipe
 * (a multi-page recipe is several photos of the same recipe), then queue one
 * AI photo-import job. The AI reads the photos and creates a draft recipe
 * that shows up in the import inbox for review — nothing is ever published
 * without a human looking at it first.
 */
export default function ImportPhotosDialog({ isOpen, onOpenChange }) {
  // {file, url}[] — the object URL is created once per file (not on every
  // render, which leaked one URL per render per photo) and revoked whenever
  // that entry leaves the list.
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef(null)
  const navigate = useNavigate()
  const filesRef = useRef(files)
  filesRef.current = files

  // Revoke any still-outstanding URLs if the dialog unmounts without going
  // through close() (e.g. navigating away mid-pick).
  useEffect(() => () => { filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)) }, [])

  const addFiles = (e) => {
    const picked = Array.from(e.target.files ?? [])
    setFiles((current) => {
      const combined = [...current, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]
      const kept = combined.slice(0, MAX_PHOTOS)
      // Revoke URLs for anything bumped off the end by the MAX_PHOTOS cap.
      combined.slice(MAX_PHOTOS).forEach((f) => URL.revokeObjectURL(f.url))
      return kept
    })
    setError('')
    // Reset so picking the same file again after removing it still fires.
    e.target.value = ''
  }

  const removeFile = (index) => setFiles((current) => {
    URL.revokeObjectURL(current[index].url)
    return current.filter((_, i) => i !== index)
  })

  const close = (open) => {
    if (busy) return
    if (!open) {
      files.forEach((f) => URL.revokeObjectURL(f.url))
      setFiles([])
      setError('')
    }
    onOpenChange(open)
  }

  const doImport = async () => {
    if (files.length === 0 || busy) return
    setBusy(true)
    setError('')
    try {
      // Photos upload at original resolution on purpose: downscaling (tried
      // at 1600px) made small-print ingredient columns illegible to the
      // vision model, which then silently dropped them from the recipe.
      await uploadMany('/api/import/photos', 'photos', files.map((f) => f.file))
      files.forEach((f) => URL.revokeObjectURL(f.url))
      setFiles([])
      onOpenChange(false)
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
        title="Import from photo"
        description="Photograph the cookbook or magazine pages for one recipe — add a photo per page if it runs over. The AI reads them and a draft appears in the import inbox for you to review."
      >
        {error && <Banner status="error" title={error} />}

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={addFiles}
          style={{ display: 'none' }}
        />

        {files.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
            {files.map(({ file, url }, i) => (
              <div key={`${file.name}-${i}`} style={{ position: 'relative' }}>
                <img
                  src={url}
                  alt={`Page ${i + 1}`}
                  style={{
                    width: 88,
                    height: 88,
                    objectFit: 'cover',
                    borderRadius: 'var(--radius-inner)',
                    outline: '1px solid var(--color-border)',
                    outlineOffset: -1,
                    display: 'block',
                  }}
                />
                <div style={{ position: 'absolute', top: 0, right: 0 }}>
                  <IconButton label={`Remove page ${i + 1}`} icon={<span>×</span>} variant="ghost" size="sm" onClick={() => removeFile(i)} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <Button
            label={files.length === 0 ? 'Choose photos…' : 'Add another page…'}
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            isDisabled={busy || files.length >= MAX_PHOTOS}
          />
        </div>

        <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
          <Button label="Cancel" variant="ghost" onClick={() => close(false)} isDisabled={busy} />
          <Button
            label={busy ? 'Uploading…' : files.length === 0 ? 'Import' : `Import ${files.length} photo${files.length === 1 ? '' : 's'}`}
            variant="primary"
            clickAction={doImport}
            isDisabled={busy || files.length === 0}
          />
        </div>
      </DialogFrame>
    </Dialog>
  )
}
