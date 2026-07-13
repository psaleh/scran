import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import { IconButton } from '@astryxdesign/core/IconButton'

import { uploadMany } from '../api.js'

const MAX_PHOTOS = 8 // matches MAX_IMPORT_PHOTOS on the server

/**
 * "Import from photo" dialog (spec §3.3.3, §5.3): pick photos of one recipe
 * (a multi-page recipe is several photos of the same recipe), then queue one
 * AI photo-import job. The AI reads the photos and creates a draft recipe
 * that shows up in the import inbox for review — nothing is ever published
 * without a human looking at it first.
 */
export default function ImportPhotosDialog({ isOpen, onOpenChange }) {
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef(null)
  const navigate = useNavigate()

  const addFiles = (e) => {
    const picked = Array.from(e.target.files ?? [])
    setFiles((current) => [...current, ...picked].slice(0, MAX_PHOTOS))
    setError('')
    // Reset so picking the same file again after removing it still fires.
    e.target.value = ''
  }

  const removeFile = (index) => setFiles((current) => current.filter((_, i) => i !== index))

  const close = (open) => {
    if (busy) return
    if (!open) {
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
      await uploadMany('/api/import/photos', 'photos', files)
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', padding: 'var(--spacing-2)' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-heading-2-size)', fontWeight: 'var(--text-heading-2-weight)', color: 'var(--color-text-primary)' }}>
            Import from photo
          </h2>
          <p style={{ margin: 'var(--spacing-1) 0 0', fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)' }}>
            Photograph the cookbook or magazine pages for one recipe — add a
            photo per page if it runs over. The AI reads them and a draft
            appears in the import inbox for you to review.
          </p>
        </div>
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
            {files.map((file, i) => (
              <div key={`${file.name}-${i}`} style={{ position: 'relative' }}>
                <img
                  src={URL.createObjectURL(file)}
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
      </div>
    </Dialog>
  )
}
