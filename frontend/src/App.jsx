import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Center } from '@astryxdesign/core/Center'
import { Spinner } from '@astryxdesign/core/Spinner'
import { LayerProvider } from '@astryxdesign/core/Layer'

import { api } from './api.js'
import AppNav from './components/AppNav.jsx'
import LoginPage from './pages/LoginPage.jsx'
import BrowsePage from './pages/BrowsePage.jsx'
import MeatTempsPage from './pages/MeatTempsPage.jsx'
import RecipeDetailPage from './pages/RecipeDetailPage.jsx'
import RecipeEditorPage from './pages/RecipeEditorPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import ShoppingListPage from './pages/ShoppingListPage.jsx'
import { useIsDesktop } from './useIsDesktop.js'

/** Signed-in app shell: desktop gets a top nav, mobile a bottom tab bar. */
function Shell({ user, onLogout }) {
  const isDesktop = useIsDesktop()
  return (
    // Mobile's bottom tab bar sits in normal flow at the bottom of the
    // screen, so the toast viewport needs a bottom inset to clear it
    // (desktop's nav is a top bar, so a small inset is enough there).
    <LayerProvider toast={{ position: 'bottomEnd', inset: { bottom: isDesktop ? 24 : 76 } }}>
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--color-background-body)' }}>
        {isDesktop && <AppNav />}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Routes>
            <Route path="/" element={<BrowsePage />} />
            <Route path="/recipes/new" element={<RecipeEditorPage currentUser={user} />} />
            <Route path="/recipes/:id" element={<RecipeDetailPage currentUser={user} />} />
            <Route path="/recipes/:id/edit" element={<RecipeEditorPage currentUser={user} />} />
            <Route path="/shopping" element={<ShoppingListPage />} />
            <Route path="/meat-temps" element={<MeatTempsPage />} />
            {/* The inbox moved into Settings; keep old links/bookmarks working. */}
            <Route path="/inbox" element={<Navigate to="/settings?tab=inbox" replace />} />
            <Route path="/settings" element={<SettingsPage currentUser={user} onLogout={onLogout} />} />
          </Routes>
        </div>
        {!isDesktop && <AppNav />}
      </div>
    </LayerProvider>
  )
}

/** App root: checks the session, then shows login or the app. */
export default function App() {
  // undefined = still checking, null = logged out, object = logged in
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    api('/api/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
  }, [])

  if (user === undefined) {
    return (
      <Center axis="both" style={{ minHeight: '100dvh' }}>
        <Spinner size="lg" label="Loading" />
      </Center>
    )
  }

  if (user === null) {
    return <LoginPage onLogin={setUser} />
  }

  const logout = () => {
    // Tell the service worker to drop its offline copies of API data (the
    // shopping list etc.) so they don't outlive this session on the device.
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-api-cache' })
    return api('/api/auth/logout', { method: 'POST' }).finally(() => setUser(null))
  }

  return (
    <BrowserRouter>
      <Shell user={user} onLogout={logout} />
    </BrowserRouter>
  )
}
