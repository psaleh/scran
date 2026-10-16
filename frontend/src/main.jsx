import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'

// Astryx pre-built stylesheet path (no StyleX build plugin — spec §4.2).
// Order matters: reset, then component styles, then the theme's tokens.
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-matcha/theme.css'
import './app.css'

import { Theme } from '@astryxdesign/core/theme'
import { matchaTheme } from '@astryxdesign/theme-matcha/built'

import App from './App.jsx'
import { THEME_MODE_KEY, ThemeModeContext } from './themeMode.js'

/** Wraps the Theme provider so the colour mode (Settings → Appearance) can
 *  be switched at runtime and survives reloads via localStorage. */
function Root() {
  const [mode, setModeState] = useState(() => localStorage.getItem(THEME_MODE_KEY) ?? 'system')
  const setMode = (m) => {
    setModeState(m)
    localStorage.setItem(THEME_MODE_KEY, m)
  }
  return (
    <ThemeModeContext.Provider value={{ mode, setMode }}>
      <Theme theme={matchaTheme} mode={mode}>
        <App />
      </Theme>
    </ThemeModeContext.Provider>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

// Register the service worker (public/sw.js) so the app is installable and
// the shopping list stays readable offline. Production builds only — in Vite
// dev a caching worker would just serve stale modules and confuse things.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Was this page already controlled by a worker when it loaded? If so, a
  // later controller change means a new deploy's worker has taken over.
  const hadController = Boolean(navigator.serviceWorker.controller)

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // An installed app can sit in the background for days without ever
        // navigating, so the browser never re-checks sw.js on its own. Check
        // each time the app comes back to the foreground.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => {})
        })
      })
      .catch((err) => {
        console.warn('Service worker registration failed', err)
      })
  })

  // A new worker (i.e. a new deploy) took over: reload once so the page runs
  // the new build instead of the JS it started with. Skipped on the very
  // first install, where there's no old build to replace.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.location.reload()
  })
}
