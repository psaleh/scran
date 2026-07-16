import { useEffect, useRef, useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import { Spinner } from '@astryxdesign/core/Spinner'
import { TextArea } from '@astryxdesign/core/TextArea'

import { api } from '../api.js'

/**
 * "Export recipe" dialog: fetches the portable JSON shape for this recipe
 * (see RecipeExport on the backend) and offers two ways to move it to
 * another Scran instance — copy the text and paste it into that instance's
 * "Import recipe data" dialog, or download/upload a file.
 */
export default function ExportRecipeDialog({ recipeId, title, isOpen, onOpenChange }) {
  const [json, setJson] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const textAreaRef = useRef(null) // forwarded straight to the <textarea>

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setJson('')
    setCopied(false)
    setLoading(true)
    api(`/api/recipes/${recipeId}/export`)
      .then((data) => setJson(JSON.stringify(data, null, 2)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [isOpen, recipeId])

  const copy = async () => {
    setError('')
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
      return
    } catch {
      // navigator.clipboard throws on plain-HTTP LAN deployments (this app
      // is self-hosted, often without TLS) — fall back to the older
      // select-and-copy approach.
    }
    try {
      const el = textAreaRef.current
      if (!el) throw new Error('no textarea')
      el.focus()
      el.select()
      const ok = document.execCommand('copy')
      if (!ok) throw new Error('execCommand failed')
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      setError("Couldn't copy automatically — select the text above and copy it manually.")
    }
  }

  const download = () => {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title || 'recipe'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', padding: 'var(--spacing-2)' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-heading-2-size)', fontWeight: 'var(--text-heading-2-weight)', color: 'var(--color-text-primary)' }}>
            Export recipe
          </h2>
          <p style={{ margin: 'var(--spacing-1) 0 0', fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)' }}>
            Copy this and paste it into "Import recipe data" on another Scran
            instance, or download it as a file.
          </p>
        </div>
        {error && <Banner status="error" title={error} />}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-6)' }}>
            <Spinner label="Preparing export" />
          </div>
        ) : (
          <TextArea
            ref={textAreaRef}
            label="Recipe data"
            isLabelHidden
            value={json}
            onChange={setJson}
            rows={12}
          />
        )}
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
          <Button label="Close" variant="ghost" onClick={() => onOpenChange(false)} />
          <Button label="Download file" variant="secondary" onClick={download} isDisabled={!json} />
          <Button label={copied ? 'Copied!' : 'Copy to clipboard'} variant="primary" clickAction={copy} isDisabled={!json} />
        </div>
      </div>
    </Dialog>
  )
}
