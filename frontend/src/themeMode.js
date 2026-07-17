import { createContext, useContext } from 'react'

// Colour mode ('system' | 'light' | 'dark') for the Astryx Theme provider.
// State lives in main.jsx (it wraps the Theme provider); Settings reads and
// sets it through this context. Persisted in localStorage.

export const THEME_MODE_KEY = 'scran.themeMode'

export const ThemeModeContext = createContext({ mode: 'system', setMode: () => {} })

export function useThemeMode() {
  return useContext(ThemeModeContext)
}
