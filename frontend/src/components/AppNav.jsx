import { NavLink } from 'react-router-dom'
import { Icon } from '@astryxdesign/core/Icon'
import { CookingPot, Settings, ShoppingCart, Thermometer } from 'lucide-react'
import { useIsDesktop } from '../useIsDesktop.js'

// Navigation shell from the design project's shared.jsx: a top bar on
// desktop, a bottom tab bar on mobile.
const NAV_ITEMS = [
  { key: 'recipes', label: 'Recipes', to: '/', icon: CookingPot },
  { key: 'shopping', label: 'Shopping list', mobileLabel: 'Shopping', to: '/shopping', icon: ShoppingCart },
  { key: 'meat-temps', label: 'Meat temps', mobileLabel: 'Temps', to: '/meat-temps', icon: Thermometer },
  { key: 'settings', label: 'Settings', to: '/settings', icon: Settings },
]

function Wordmark() {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-2)',
        fontSize: 'var(--text-large-size)',
        fontWeight: 'var(--font-weight-bold)',
        color: 'var(--color-text-primary)',
        letterSpacing: '-0.02em',
        marginRight: 'var(--spacing-4)',
      }}
    >
      {/* The app icon (same art as the favicon/PWA icon). The PNG, not
          favicon.svg: the SVG recolours itself for the *system* dark mode,
          which can disagree with the in-app Appearance setting. Decorative,
          since the wordmark beside it already names the app. */}
      <img
        src="/icons/icon-192.png"
        alt=""
        width={32}
        height={32}
      />
      <span>
        scran<span style={{ color: 'var(--color-text-orange)' }}>.</span>
      </span>
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

export default function AppNav() {
  const isDesktop = useIsDesktop()

  if (isDesktop) {
    return (
      <nav
        aria-label="Main"
        style={{
          position: 'relative',
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
        <span
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-6)',
          }}
        >
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.key} to={item.to} end={item.to === '/'} style={({ isActive }) => ({
              ...itemStyle({ active: isActive }),
              gap: 'var(--spacing-1-5)',
              fontSize: 'var(--text-label-size)',
              whiteSpace: 'nowrap',
            })}>
              <Icon icon={item.icon} size="sm" />
              {item.label}
            </NavLink>
          ))}
        </span>
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
          flex: 1,
          flexDirection: 'column',
          gap: 'var(--spacing-0-5)',
          padding: 'var(--spacing-2) 0',
          fontSize: 'var(--text-supporting-size)',
        })}>
          <Icon icon={item.icon} size="sm" />
          {item.mobileLabel ?? item.label}
        </NavLink>
      ))}
    </nav>
  )
}
