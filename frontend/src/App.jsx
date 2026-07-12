import { useEffect, useState } from 'react'
import { Center } from '@astryxdesign/core/Center'
import { Spinner } from '@astryxdesign/core/Spinner'
import { VStack } from '@astryxdesign/core/Layout'
import { Heading, Text } from '@astryxdesign/core/Text'
import { Button } from '@astryxdesign/core/Button'

import { api } from './api.js'
import LoginPage from './pages/LoginPage.jsx'

/**
 * App root: figures out whether someone is logged in, then shows either the
 * login page or the app. Real routing arrives with the recipe screens; for
 * now the "app" is a placeholder proving the session works.
 */
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

  const handleLogout = async () => {
    await api('/api/auth/logout', { method: 'POST' })
    setUser(null)
  }

  return (
    <Center axis="both" style={{ minHeight: '100vh' }}>
      <VStack gap={4} hAlign="center">
        <Heading level={1}>Scran</Heading>
        <Text color="secondary">
          Logged in as {user.username}
          {user.is_admin ? ' (admin)' : ''} — recipes coming soon.
        </Text>
        <Button label="Log out" clickAction={handleLogout} />
      </VStack>
    </Center>
  )
}
