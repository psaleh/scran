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
