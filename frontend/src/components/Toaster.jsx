import { useToast as useAstryxToast } from '@astryxdesign/core/Toast'
import { Button } from '@astryxdesign/core/Button'

/**
 * Thin wrapper around Astryx's useToast hook giving the app a small,
 * consistent success/error API. Mount <LayerProvider> once at the app root
 * (see App.jsx) so toasts share one viewport instead of each caller
 * self-mounting a fallback.
 */
export function useToast() {
  const showToast = useAstryxToast()

  const success = (message, { action } = {}) =>
    showToast({
      body: message,
      type: 'info',
      autoHideDuration: 4000,
      endContent: action ? (
        <Button label={action.label} variant="secondary" size="sm" onClick={action.onClick} />
      ) : undefined,
    })

  const error = (message, { action } = {}) =>
    showToast({
      body: message,
      type: 'error',
      endContent: action ? (
        <Button label={action.label} variant="secondary" size="sm" onClick={action.onClick} />
      ) : undefined,
    })

  return { success, error }
}
