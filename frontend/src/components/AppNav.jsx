import { NavLink } from 'react-router-dom'
import { useIsDesktop } from '../useIsDesktop.js'

// Navigation shell from the design project's shared.jsx: a top bar on
// desktop, a bottom tab bar on mobile. Sections that aren't built yet are
// listed but disabled so the layout matches the final app.
const NAV_ITEMS = [
  { key: 'recipes', label: 'Recipes', to: '/' },
  { key: 'shopping', label: 'Shopping list', to: '/shopping' },
  { key: 'inbox', label: 'Import inbox', to: '/inbox', disabled: true },
  { key: 'settings', label: 'Settings', to: '/settings' },
]

function Wordmark() {
  return (
    <span
      style={{
        fontSize: 'var(--font-size-lg)',
        fontWeight: 'var(--font-weight-bold)',
        color: 'var(--color-text-primary)',
        letterSpacing: '-0.02em',
        marginRight: 'var(--spacing-4)',
      }}
    >
      scran<span style={{ color: 'var(--color-text-orange)' }}>.</span>
    </span>
  )
}

function itemStyle({ active, disabled }) {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    color: disabled
      ? 'var(--color-text-disabled)'
      : active
        ? 'var(--color-accent)'
        : 'var(--color-text-secondary)',
    fontWeight: active ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
    pointerEvents: disabled ? 'none' : 'auto',
  }
}

export default function AppNav() {
  const isDesktop = useIsDesktop()

  if (isDesktop) {
    return (
      <nav
        aria-label="Main"
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-6)',
          padding: '0 var(--spacing-6)',
          height: 56,
          background: 'var(--color-background-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Wordmark />
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.key} to={item.to} end={item.to === '/'} style={({ isActive }) => ({
            ...itemStyle({ active: isActive, disabled: item.disabled }),
            fontSize: 'var(--text-label-size)',
          })}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    )
  }

  return (
    <nav
      aria-label="Main"
      style={{
        flexShrink: 0,
        display: 'flex',
        background: 'var(--color-background-surface)',
        borderTop: '1px solid var(--color-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.key} to={item.to} end={item.to === '/'} style={({ isActive }) => ({
          ...itemStyle({ active: isActive, disabled: item.disabled }),
          flex: 1,
          flexDirection: 'column',
          gap: 2,
          padding: 'var(--spacing-2) 0',
          fontSize: 'var(--text-supporting-size)',
        })}>
          {({ isActive }) => (
            <>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 'var(--radius-full)',
                  background: isActive ? 'var(--color-accent)' : 'transparent',
                }}
              />
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
