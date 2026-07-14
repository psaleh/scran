import { useEffect, useState } from 'react'
import { Avatar } from '@astryxdesign/core/Avatar'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Dialog } from '@astryxdesign/core/Dialog'
import { Divider } from '@astryxdesign/core/Divider'
import { IconButton } from '@astryxdesign/core/IconButton'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { TextInput } from '@astryxdesign/core/TextInput'

import { api } from '../api.js'
import { useIsDesktop } from '../useIsDesktop.js'

// Shared bits ---------------------------------------------------------------

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-3)',
  padding: 'var(--spacing-3) var(--spacing-4)',
}
const rowTextStyle = { flex: 1, fontSize: 'var(--font-size-lg)', color: 'var(--color-text-primary)' }
const hintStyle = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }

function DialogFrame({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', padding: 'var(--spacing-2)' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--text-heading-2-size)', fontWeight: 'var(--text-heading-2-weight)', color: 'var(--color-text-primary)' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

// --- AI profiles ------------------------------------------------------------

function AiProfilesSection() {
  const [profiles, setProfiles] = useState([])
  const [editing, setEditing] = useState(null) // null | {} (new) | profile
  const [error, setError] = useState('')
  const [testingId, setTestingId] = useState(null)
  const [testResults, setTestResults] = useState({}) // profile id → {ok, message}

  const load = () => api('/api/ai-profiles').then(setProfiles).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const save = async () => {
    setError('')
    try {
      const body = {
        name: editing.name || '',
        base_url: editing.base_url || '',
        model: editing.model || '',
        api_key: editing.api_key || null,
        purpose: editing.purpose || 'general',
      }
      if (editing.id) await api(`/api/ai-profiles/${editing.id}`, { method: 'PUT', body })
      else await api('/api/ai-profiles', { method: 'POST', body })
      setEditing(null)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const activate = async (id) => {
    await api(`/api/ai-profiles/${id}/activate`, { method: 'POST' })
    load()
  }
  const remove = async (id) => {
    await api(`/api/ai-profiles/${id}`, { method: 'DELETE' })
    load()
  }

  const test = async (id) => {
    setTestingId(id)
    setTestResults((r) => ({ ...r, [id]: null }))
    try {
      const result = await api(`/api/ai-profiles/${id}/test`, { method: 'POST' })
      setTestResults((r) => ({ ...r, [id]: result }))
    } catch (e) {
      setTestResults((r) => ({ ...r, [id]: { ok: false, message: e.message } }))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
      {error && <Banner status="error" title={error} />}
      <span style={hintStyle}>
        OpenAI-compatible endpoints used for photo import and ingredient
        categorisation. The active profile is used by the background worker.
        A profile marked for YouTube imports is used only to extract recipes
        from videos — it needs a video-capable hosted model (e.g.
        google/gemini-2.5-flash via OpenRouter).
      </span>
      {profiles.length > 0 && (
        <Card padding={0}>
          {profiles.map((p, i) => (
            <div key={p.id}>
              {i > 0 && <Divider />}
              <div style={rowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                    <span style={{ fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-primary)' }}>{p.name}</span>
                    {p.is_default && <Badge label="Active" variant="success" />}
                    {p.purpose === 'video' && <Badge label="YouTube" variant="info" />}
                    {!p.has_key && <Badge label="No key" variant="neutral" />}
                  </div>
                  <span style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>
                    {p.base_url} — {p.model}
                  </span>
                </div>
                {/* A video-only profile can't be the everyday active one. */}
                {!p.is_default && p.purpose !== 'video' && (
                  <Button label="Use" size="sm" variant="secondary" clickAction={() => activate(p.id)} />
                )}
                <Button
                  label={testingId === p.id ? 'Testing…' : 'Test'}
                  size="sm"
                  variant="secondary"
                  isDisabled={testingId !== null}
                  clickAction={() => test(p.id)}
                />
                <IconButton label="Edit profile" icon={<span>✎</span>} variant="ghost" size="sm" onClick={() => setEditing({ ...p, api_key: '' })} />
                <IconButton label="Delete profile" icon={<span>×</span>} variant="ghost" size="sm" clickAction={() => remove(p.id)} />
              </div>
              {testResults[p.id] && (
                <div style={{ padding: '0 var(--spacing-4) var(--spacing-3)' }}>
                  <Banner
                    status={testResults[p.id].ok ? 'success' : 'error'}
                    title={testResults[p.id].ok ? 'Connection OK' : 'Connection failed'}
                    description={testResults[p.id].message}
                  />
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      <div>
        <Button label="Add profile" variant="secondary" onClick={() => setEditing({})} />
      </div>

      <Dialog isOpen={editing !== null} onOpenChange={(open) => !open && setEditing(null)} purpose="form">
        {editing !== null && (
          <DialogFrame title={editing.id ? 'Edit AI profile' : 'Add AI profile'}>
            <TextInput label="Name" value={editing.name || ''} onChange={(v) => setEditing({ ...editing, name: v })} placeholder='e.g. "Local PC"' />
            <TextInput label="Base URL" value={editing.base_url || ''} onChange={(v) => setEditing({ ...editing, base_url: v })} placeholder="http://kitchen-pc:1234/v1" />
            <TextInput label="Model" value={editing.model || ''} onChange={(v) => setEditing({ ...editing, model: v })} placeholder="gemma-3-27b-it" />
            <TextInput
              label="API key"
              type="password"
              value={editing.api_key || ''}
              onChange={(v) => setEditing({ ...editing, api_key: v })}
              isOptional
              description={editing.id ? 'Leave blank to keep the stored key.' : 'Leave blank for keyless endpoints like LM Studio.'}
            />
            <CheckboxInput
              label="Use only for YouTube video imports"
              value={editing.purpose === 'video'}
              onChange={(v) => setEditing({ ...editing, purpose: v ? 'video' : 'general' })}
            />
            <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
              <Button label="Cancel" variant="ghost" onClick={() => setEditing(null)} />
              <Button label="Save" variant="primary" clickAction={save} />
            </div>
          </DialogFrame>
        )}
      </Dialog>
    </div>
  )
}

// --- Stores & walking routes --------------------------------------------------

function StoresSection() {
  const [stores, setStores] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [newStore, setNewStore] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    const [s, c] = await Promise.all([api('/api/stores'), api('/api/categories')])
    setStores(s)
    setCategories(c)
    setSelectedId((id) => id ?? s[0]?.id ?? null)
  }
  useEffect(() => { load().catch((e) => setError(e.message)) }, [])

  const categoryName = Object.fromEntries(categories.map((c) => [c.id, c.name]))
  const selected = stores.find((s) => s.id === selectedId)

  const addStore = async () => {
    if (!newStore.trim()) return
    setError('')
    try {
      const created = await api('/api/stores', { method: 'POST', body: { name: newStore.trim() } })
      setNewStore('')
      setSelectedId(created.id)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const removeStore = async (id) => {
    await api(`/api/stores/${id}`, { method: 'DELETE' })
    setSelectedId(null)
    load()
  }

  const move = async (index, dir) => {
    const order = [...selected.category_order]
    const j = index + dir
    if (j < 0 || j >= order.length) return
    ;[order[index], order[j]] = [order[j], order[index]]
    // Optimistic local update, then persist.
    setStores((list) => list.map((s) => (s.id === selected.id ? { ...s, category_order: order } : s)))
    await api(`/api/stores/${selected.id}`, {
      method: 'PUT',
      body: { name: selected.name, category_order: order },
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
      {error && <Banner status="error" title={error} />}
      <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        {stores.map((s) => (
          <Button key={s.id} label={s.name} size="sm" variant={selectedId === s.id ? 'primary' : 'secondary'} onClick={() => setSelectedId(s.id)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--spacing-2)', maxWidth: 420 }} onKeyDown={(e) => { if (e.key === 'Enter') addStore() }}>
        <div style={{ flex: 1 }}>
          <TextInput label="New store" isLabelHidden value={newStore} onChange={setNewStore} placeholder='Add a store, e.g. "Tesco Spennymoor"' />
        </div>
        <Button label="Add store" variant="secondary" clickAction={addStore} isDisabled={!newStore.trim()} />
      </div>

      {selected && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-2)' }}>
            <span style={hintStyle}>
              Walking route — reorder to match {selected.name}'s layout
            </span>
            <Button label="Delete store" variant="destructive" size="sm" clickAction={() => removeStore(selected.id)} />
          </div>
          <Card padding={0}>
            {selected.category_order.map((catId, i) => (
              <div key={catId}>
                {i > 0 && <Divider />}
                <div style={rowStyle}>
                  <span style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)', width: 20 }}>{i + 1}</span>
                  <span style={rowTextStyle}>{categoryName[catId] || '?'}</span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <IconButton label="Move up" icon={<span>↑</span>} variant="ghost" size="sm" isDisabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton label="Move down" icon={<span>↓</span>} variant="ghost" size="sm" isDisabled={i === selected.category_order.length - 1} onClick={() => move(i, 1)} />
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
      {stores.length === 0 && (
        <span style={hintStyle}>No stores yet. Add one to give the shopping list a walking-route order.</span>
      )}
    </div>
  )
}

// --- Categories -----------------------------------------------------------------

function CategoriesSection() {
  const [categories, setCategories] = useState([])
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renameText, setRenameText] = useState('')
  const [error, setError] = useState('')

  const load = () => api('/api/categories').then(setCategories).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const run = async (fn) => {
    setError('')
    try {
      await fn()
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const add = () => run(async () => {
    if (!newName.trim()) return
    await api('/api/categories', { method: 'POST', body: { name: newName.trim() } })
    setNewName('')
  })
  const rename = () => run(async () => {
    await api(`/api/categories/${renamingId}`, { method: 'PUT', body: { name: renameText.trim() } })
    setRenamingId(null)
  })
  const remove = (id) => run(() => api(`/api/categories/${id}`, { method: 'DELETE' }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
      {error && <Banner status="error" title={error} />}
      <span style={hintStyle}>
        Grocery categories used to sort the shopping list. Deleting one moves
        its items to "Uncategorised"; new ones join the end of every store route.
      </span>
      <Card padding={0}>
        {categories.map((c, i) => (
          <div key={c.id}>
            {i > 0 && <Divider />}
            <div style={rowStyle}>
              {renamingId === c.id ? (
                <>
                  <div style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === 'Enter') rename() }}>
                    <TextInput label="Rename category" isLabelHidden value={renameText} onChange={setRenameText} hasAutoFocus />
                  </div>
                  <Button label="Save" size="sm" variant="primary" clickAction={rename} />
                  <Button label="Cancel" size="sm" variant="ghost" onClick={() => setRenamingId(null)} />
                </>
              ) : (
                <>
                  <span style={rowTextStyle}>{c.name}</span>
                  <IconButton label="Rename category" icon={<span>✎</span>} variant="ghost" size="sm" onClick={() => { setRenamingId(c.id); setRenameText(c.name) }} />
                  <IconButton label="Delete category" icon={<span>×</span>} variant="ghost" size="sm" clickAction={() => remove(c.id)} />
                </>
              )}
            </div>
          </div>
        ))}
      </Card>
      <div style={{ display: 'flex', gap: 'var(--spacing-2)', maxWidth: 420 }} onKeyDown={(e) => { if (e.key === 'Enter') add() }}>
        <div style={{ flex: 1 }}>
          <TextInput label="New category" isLabelHidden value={newName} onChange={setNewName} placeholder="Add a category…" />
        </div>
        <Button label="Add" variant="secondary" clickAction={add} isDisabled={!newName.trim()} />
      </div>
    </div>
  )
}

// --- Users (admin only) ------------------------------------------------------------

function UsersSection({ currentUser }) {
  const [users, setUsers] = useState([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', is_admin: false })
  const [resetting, setResetting] = useState(null) // user being password-reset
  const [resetPassword, setResetPassword] = useState('')
  const [error, setError] = useState('')

  const load = () => api('/api/users').then(setUsers).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const run = async (fn) => {
    setError('')
    try {
      await fn()
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const addUser = () => run(async () => {
    await api('/api/users', { method: 'POST', body: form })
    setAdding(false)
    setForm({ username: '', password: '', is_admin: false })
  })
  const doReset = () => run(async () => {
    await api(`/api/users/${resetting.id}`, { method: 'PATCH', body: { password: resetPassword } })
    setResetting(null)
    setResetPassword('')
  })
  const toggleAdmin = (u) => run(() => api(`/api/users/${u.id}`, { method: 'PATCH', body: { is_admin: !u.is_admin } }))
  const remove = (u) => run(() => api(`/api/users/${u.id}`, { method: 'DELETE' }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
      {error && <Banner status="error" title={error} />}
      <Card padding={0}>
        {users.map((u, i) => (
          <div key={u.id}>
            {i > 0 && <Divider />}
            <div style={rowStyle}>
              <Avatar name={u.username} size="small" />
              <span style={rowTextStyle}>
                {u.username}
                {u.id === currentUser.id && <span style={{ color: 'var(--color-text-secondary)' }}> (you)</span>}
              </span>
              {u.is_admin ? <Badge label="Admin" variant="purple" /> : null}
              <IconButton label={u.is_admin ? 'Remove admin role' : 'Make admin'} icon={<span>{u.is_admin ? '☆' : '★'}</span>} variant="ghost" size="sm" clickAction={() => toggleAdmin(u)} />
              <IconButton label="Reset password" icon={<span>⚿</span>} variant="ghost" size="sm" onClick={() => { setResetting(u); setResetPassword('') }} />
              {u.id !== currentUser.id && (
                <IconButton label="Delete user" icon={<span>×</span>} variant="ghost" size="sm" clickAction={() => remove(u)} />
              )}
            </div>
          </div>
        ))}
      </Card>
      <div>
        <Button label="Add user" variant="secondary" onClick={() => setAdding(true)} />
      </div>

      <Dialog isOpen={adding} onOpenChange={setAdding} purpose="form">
        <DialogFrame title="Add user">
          <TextInput label="Username" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
          <TextInput label="Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} description="At least 8 characters." />
          <CheckboxInput label="Admin" value={form.is_admin} onChange={(v) => setForm({ ...form, is_admin: v })} />
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
            <Button label="Cancel" variant="ghost" onClick={() => setAdding(false)} />
            <Button label="Create user" variant="primary" clickAction={addUser} />
          </div>
        </DialogFrame>
      </Dialog>

      <Dialog isOpen={resetting !== null} onOpenChange={(open) => !open && setResetting(null)} purpose="form">
        {resetting && (
          <DialogFrame title={`Reset password — ${resetting.username}`}>
            <TextInput label="New password" type="password" value={resetPassword} onChange={setResetPassword} description="At least 8 characters. They will be signed out everywhere." />
            <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
              <Button label="Cancel" variant="ghost" onClick={() => setResetting(null)} />
              <Button label="Reset password" variant="primary" clickAction={doReset} />
            </div>
          </DialogFrame>
        )}
      </Dialog>
    </div>
  )
}

// --- Auth (read-only, configured via environment) ------------------------------------

function AuthSection() {
  const [info, setInfo] = useState(null)
  useEffect(() => { api('/api/settings/auth').then(setInfo).catch(() => {}) }, [])
  if (!info) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
      <Banner
        status="info"
        title="Configured via environment variables"
        description="These values come from the container's environment (SCRAN_AUTH_*) and are shown here for reference. See docker-compose.yml."
      />
      <Card padding={4}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)', fontSize: 'var(--font-size-base)', color: 'var(--color-text-primary)' }}>
          <div>Trust reverse-proxy identity header (SSO): <strong>{info.trust_header ? 'on' : 'off'}</strong></div>
          <div>Header name: <strong>{info.header_name}</strong></div>
          <div>Trusted proxy IPs: <strong>{info.trusted_proxy_ips.length ? info.trusted_proxy_ips.join(', ') : '—'}</strong></div>
        </div>
      </Card>
    </div>
  )
}

// --- Page ------------------------------------------------------------------------

/** Settings (spec §6.7): AI profiles, stores, categories, users, auth. */
export default function SettingsPage({ currentUser }) {
  const isDesktop = useIsDesktop()
  const [tab, setTab] = useState('ai')

  const sections = [
    { value: 'ai', label: 'AI profiles', render: () => <AiProfilesSection /> },
    { value: 'stores', label: 'Stores', render: () => <StoresSection /> },
    { value: 'categories', label: 'Categories', render: () => <CategoriesSection /> },
    ...(currentUser.is_admin
      ? [
          { value: 'users', label: 'Users', render: () => <UsersSection currentUser={currentUser} /> },
          { value: 'auth', label: 'Auth', render: () => <AuthSection /> },
        ]
      : []),
  ]
  const section = sections.find((s) => s.value === tab) ?? sections[0]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          padding: isDesktop ? 'var(--spacing-4) var(--spacing-6) 0' : 'var(--spacing-4) var(--spacing-4) 0',
          flexShrink: 0,
          background: 'var(--color-background-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h1 style={{ margin: '0 0 var(--spacing-3)', fontSize: 'var(--text-heading-1-size)', fontWeight: 'var(--text-heading-1-weight)', color: 'var(--color-text-primary)' }}>
            Settings
          </h1>
          <TabList value={section.value} onChange={setTab}>
            {sections.map((s) => (
              <Tab key={s.value} value={s.value} label={s.label} />
            ))}
          </TabList>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: isDesktop ? 'var(--spacing-6)' : 'var(--spacing-4)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>{section.render()}</div>
      </div>
    </div>
  )
}
