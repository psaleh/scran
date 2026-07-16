// Shared header+layout wrapper for Dialog content: title, optional
// description, then whatever body/footer the caller passes as children.
export default function DialogFrame({ title, description, children, ...rest }) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', padding: 'var(--spacing-2)' }}
      {...rest}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--text-heading-2-size)', fontWeight: 'var(--text-heading-2-weight)', color: 'var(--color-text-primary)' }}>
          {title}
        </h2>
        {description && (
          <p style={{ margin: 'var(--spacing-1) 0 0', fontSize: 'var(--text-body-size)', color: 'var(--color-text-secondary)' }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}
