import { NavLink } from 'react-router-dom'
import { IconButton } from '@astryxdesign/core/IconButton'
import { useIsDesktop } from '../useIsDesktop.js'

// Navigation shell from the design project's shared.jsx: a top bar on
// desktop, a bottom tab bar on mobile.
const NAV_ITEMS = [
  { key: 'recipes', label: 'Recipes', to: '/' },
  { key: 'shopping', label: 'Shopping list', mobileLabel: 'Shopping', to: '/shopping' },
  { key: 'meat-temps', label: 'Meat temps', mobileLabel: 'Temps', to: '/meat-temps' },
  { key: 'inbox', label: 'Import inbox', mobileLabel: 'Inbox', to: '/inbox' },
  { key: 'settings', label: 'Settings', to: '/settings' },
]

function Wordmark() {
  return (
    <span
      style={{
        fontSize: 'var(--text-large-size)',
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

function itemStyle({ active }) {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
    fontWeight: active ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
  }
}

// Shared shape for the mobile bottom-nav items and the logout button beside them.
const mobileItemStyle = {
  flex: 1,
  flexDirection: 'column',
  gap: 'var(--spacing-0-5)',
  padding: 'var(--spacing-2) 0',
  fontSize: 'var(--text-supporting-size)',
}

export default function AppNav({ onLogout }) {
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
            ...itemStyle({ active: isActive }),
            fontSize: 'var(--text-label-size)',
          })}>
            {item.label}
          </NavLink>
        ))}
        <IconButton
          label="Log out"
          icon={<span>⎋</span>}
          variant="ghost"
          size="sm"
          onClick={onLogout}
          style={{ marginLeft: 'auto' }}
        />
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
          ...itemStyle({ active: isActive }),
          ...mobileItemStyle,
        })}>
          {({ isActive }) => (
            <>
              <span
                style={{
                  width: 'var(--spacing-1-5)',
                  height: 'var(--spacing-1-5)',
                  borderRadius: 'var(--radius-full)',
                  background: isActive ? 'var(--color-accent)' : 'transparent',
                }}
              />
              {item.mobileLabel ?? item.label}
            </>
          )}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onLogout}
        style={{
          ...itemStyle({ active: false }),
          ...mobileItemStyle,
          background: 'none',
          border: 'none',
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <span style={{ width: 'var(--spacing-1-5)', height: 'var(--spacing-1-5)', borderRadius: 'var(--radius-full)', background: 'transparent' }} />
        Log out
      </button>
    </nav>
  )
}
