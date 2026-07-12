// Small shared inline-style fragments used across pages (Astryx tokens only).

// Uppercase section label, e.g. "INGREDIENTS", "STEPS", "NOTES".
export const sectionLabelStyle = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-semibold)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-secondary)',
}

// Numbered circle used for recipe steps.
export const stepNumberStyle = {
  flexShrink: 0,
  width: 28,
  height: 28,
  borderRadius: 'var(--radius-full)',
  background: 'var(--color-accent)',
  color: 'var(--color-on-accent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'var(--text-label-size)',
  fontWeight: 'var(--font-weight-semibold)',
}
