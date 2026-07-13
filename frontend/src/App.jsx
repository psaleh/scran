import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Center } from '@astryxdesign/core/Center'
import { Spinner } from '@astryxdesign/core/Spinner'

import { api } from './api.js'
import AppNav from './components/AppNav.jsx'
import LoginPage from './pages/LoginPage.jsx'
import BrowsePage from './pages/BrowsePage.jsx'
import InboxPage from './pages/InboxPage.jsx'
import RecipeDetailPage from './pages/RecipeDetailPage.jsx'
import RecipeEditorPage from './pages/RecipeEditorPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import ShoppingListPage from './pages/ShoppingListPage.jsx'
import { useIsDesktop } from './useIsDesktop.js'

/** Signed-in app shell: desktop gets a top nav, mobile a bottom tab bar. */
function Shell({ user }) {
  const isDesktop = useIsDesktop()
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--color-background-body)' }}>
      {isDesktop && <AppNav />}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/recipes/new" element={<RecipeEditorPage />} />
          <Route path="/recipes/:id" element={<RecipeDetailPage currentUser={user} />} />
          <Route path="/recipes/:id/edit" element={<RecipeEditorPage />} />
          <Route path="/shopping" element={<ShoppingListPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/settings" element={<SettingsPage currentUser={user} />} />
        </Routes>
      </div>
      {!isDesktop && <AppNav />}
    </div>
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
      <Center axis="both" style={{ minHeight: '100vh' }}>
        <Spinner size="lg" label="Loading" />
      </Center>
    )
  }

  if (user === null) {
    return <LoginPage onLogin={setUser} />
  }

  return (
    <BrowserRouter>
      <Shell user={user} />
    </BrowserRouter>
  )
}
