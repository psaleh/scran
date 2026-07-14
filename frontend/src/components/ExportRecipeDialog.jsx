import { useEffect, useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
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
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setJson('')
    api(`/api/recipes/${recipeId}/export`)
      .then((data) => setJson(JSON.stringify(data, null, 2)))
      .catch((err) => setError(err.message))
  }, [isOpen, recipeId])

  const copy = async () => {
    await navigator.clipboard.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
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
        <TextArea
          label="Recipe data"
          isLabelHidden
          value={json}
          onChange={setJson}
          rows={12}
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
          <Button label="Close" variant="ghost" onClick={() => onOpenChange(false)} />
          <Button label="Download file" variant="secondary" onClick={download} isDisabled={!json} />
          <Button label={copied ? 'Copied!' : 'Copy to clipboard'} variant="primary" clickAction={copy} isDisabled={!json} />
        </div>
      </div>
    </Dialog>
  )
}
