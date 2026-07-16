// Small shared inline-style fragments used across pages (Astryx tokens only).

// Round a decimal ingredient/list amount to 2dp and drop trailing zeros
// (e.g. 0.3333333 -> "0.33"). Returns null for a missing amount.
export function formatAmount(n) {
  if (n == null) return null
  return String(Math.round(n * 100) / 100)
}

// Uppercase section label, e.g. "INGREDIENTS", "STEPS", "NOTES".
export const sectionLabelStyle = {
  fontSize: 'var(--text-supporting-size)',
  fontWeight: 'var(--font-weight-semibold)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-secondary)',
}

// Numbered circle used for recipe steps.
export const stepNumberStyle = {
  flexShrink: 0,
  width: 'var(--spacing-7)',
  height: 'var(--spacing-7)',
  borderRadius: 'var(--radius-full)',
  background: 'var(--color-accent)',
  color: 'var(--color-on-accent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'var(--text-label-size)',
  fontWeight: 'var(--font-weight-semibold)',
}
