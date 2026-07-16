import { useState } from 'react'
import { VStack } from '@astryxdesign/core/Layout'
import { Center } from '@astryxdesign/core/Center'
import { Text, Heading } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Banner } from '@astryxdesign/core/Banner'

import { api } from '../api.js'

// Adapted from the Astryx "login" page template (npx astryx template login).
// Standalone auth page paints its own body background (no host shell).
const pageStyle = {
  minHeight: '100dvh',
  backgroundColor: 'var(--color-background-body)',
  padding: 'var(--spacing-6)',
}
// Cap the column at 400px but let it shrink to fit narrow screens.
const contentStyle = {
  width: '100%',
  maxWidth: 400,
}

/**
 * Username + password login (spec §2 — accounts are created by an admin,
 * so there is no sign-up link). Calls onLogin(user) on success.
 */
export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSignIn = async () => {
    setError('')
    if (!username || !password) {
      setError('Please enter both username and password.')
      return
    }
    setIsLoading(true)
    try {
      const user = await api('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      })
      onLogin(user)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Center axis="both" style={pageStyle}>
      <VStack gap={4} hAlign="center" style={contentStyle}>
        <Text type="body" weight="bold" size="lg">
          Scran
        </Text>

        <Card padding={8} width="100%">
          {/* Wrapping in a real <form> makes Enter submit and lets password
              managers recognise the fields. */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSignIn()
            }}
          >
            <VStack gap={4} hAlign="stretch">
              <VStack gap={1} hAlign="center">
                <Heading level={2}>Sign in</Heading>
                <Text type="body" color="secondary" size="sm">
                  Household recipes &amp; shopping list
                </Text>
              </VStack>

              {error && <Banner status="error" title={error} container="card" />}

              <TextInput
                label="Username"
                value={username}
                onChange={setUsername}
                size="lg"
              />

              <TextInput
                label="Password"
                value={password}
                onChange={setPassword}
                type="password"
                size="lg"
              />

              <Button
                label="Sign in"
                variant="primary"
                size="lg"
                type="submit"
                isLoading={isLoading}
              />
            </VStack>
          </form>
        </Card>
      </VStack>
    </Center>
  )
}
