import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Astryx pre-built stylesheet path (no StyleX build plugin — spec §4.2).
// Order matters: reset, then component styles, then the theme's tokens.
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-matcha/theme.css'

import { Theme } from '@astryxdesign/core/theme'
import { matchaTheme } from '@astryxdesign/theme-matcha/built'

import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Theme theme={matchaTheme}>
      <App />
    </Theme>
  </StrictMode>,
)
