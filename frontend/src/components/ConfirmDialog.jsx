import { AlertDialog } from '@astryxdesign/core/AlertDialog'

/**
 * Shared confirmation dialog for destructive actions (delete, clear, etc).
 * Wraps Astryx's AlertDialog with the app's naming (message/onConfirm)
 * so call sites read the same way everywhere.
 */
export default function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  isBusy = false,
  variant = 'destructive',
}) {
  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={title}
      description={message}
      actionLabel={confirmLabel}
      cancelLabel={cancelLabel}
      actionVariant={variant}
      isActionLoading={isBusy}
      onAction={onConfirm}
    />
  )
}
