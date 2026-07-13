import { useEffect, useRef, useState } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Spinner } from '@astryxdesign/core/Spinner'
import { StatusDot } from '@astryxdesign/core/StatusDot'

import { api } from '../api.js'
import { useIsDesktop } from '../useIsDesktop.js'

// Layout follows the design mockup ui_kits/recipe-app/import-inbox.html.

const POLL_MS = 5000

const TYPE_LABELS = {
  photo_import: 'Photo import',
  categorise: 'Categorise ingredients',
  url_redraft: 'AI recipe tidy-up',
  name_note_cleanup: 'Ingredient name cleanup',
  test: 'Test job',
}

// DB statuses → display. 'done' is refined per job type below (a finished
// photo import needs review; a finished categorise job is just done).
const STATUS_META = {
  pending: { label: 'Queued', variant: 'neutral' },
  running: { label: 'Processing', variant: 'info' },
  done: { label: 'Done', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
}

function JobCard({ job, onRetry }) {
  const meta = STATUS_META[job.status]
  return (
    <Card elevation="low" style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
        <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {TYPE_LABELS[job.type] || job.type}
        </div>
        {job.summary && (
          <div style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>
            {job.summary}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
          {job.status === 'running' && <Spinner size="sm" />}
          <Badge label={meta.label} variant={meta.variant} />
          {job.attempts > 1 && (
            <span style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>
              attempt {job.attempts}
            </span>
          )}
        </div>

        {job.status === 'failed' && job.error && (
          <div style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-error)' }}>
            {job.error}
          </div>
        )}
        {job.status === 'done' && job.type === 'categorise' && job.result?.categories && (
          <div style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>
            {Object.entries(job.result.categories).map(([name, cat]) => `${name} → ${cat}`).join(', ')}
          </div>
        )}
        {job.status === 'done' && job.type === 'test' && job.result?.reply && (
          <div style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>
            Model replied: “{job.result.reply}”
          </div>
        )}

        {job.status === 'failed' && (
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', marginTop: 'var(--spacing-1)' }}>
            <Button label="Retry" variant="secondary" size="sm" clickAction={() => onRetry(job.id)} />
          </div>
        )}
      </div>
    </Card>
  )
}

/** Import inbox (spec §5.2): job list, AI endpoint status, manual retry. */
export default function InboxPage() {
  const isDesktop = useIsDesktop()
  const [jobs, setJobs] = useState(null) // null = loading
  const [aiStatus, setAiStatus] = useState(null)
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  const load = async () => {
    try {
      const [jobList, status] = await Promise.all([api('/api/jobs'), api('/api/ai-status')])
      setJobs(jobList)
      setAiStatus(status)
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  // Poll while the screen is open so statuses move on their own.
  useEffect(() => {
    load()
    timerRef.current = setInterval(load, POLL_MS)
    return () => clearInterval(timerRef.current)
  }, [])

  const retry = async (id) => {
    try {
      await api(`/api/jobs/${id}/retry`, { method: 'POST' })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  // TEMPORARY (stage 2): enqueue a trivial AI job to verify the queue loop.
  const enqueueTest = async () => {
    try {
      await api('/api/jobs/test', { method: 'POST' })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const reachable = aiStatus?.reachable

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{
        padding: isDesktop ? 'var(--spacing-4) var(--spacing-6)' : 'var(--spacing-4)',
        flexShrink: 0,
        background: 'var(--color-background-surface)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <div style={{ maxWidth: isDesktop ? 720 : 'none', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--text-heading-1-size)', fontWeight: 'var(--text-heading-1-weight)', color: 'var(--color-text-primary)' }}>
            Import inbox
          </h1>

          <Card elevation="none" style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', background: 'var(--color-background-muted)' }}>
            <StatusDot
              variant={reachable ? 'success' : 'error'}
              label={reachable ? 'Endpoint reachable' : 'Endpoint unreachable'}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 'var(--text-label-size)', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-primary)' }}>
                {aiStatus?.profile_name || 'No AI profile configured'}
              </span>
              <span style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>
                {aiStatus?.profile_name == null
                  ? 'Add one in Settings → AI profiles'
                  : reachable
                    ? 'Reachable — jobs will process'
                    : 'Unreachable — jobs queued until it appears'}
              </span>
            </div>
          </Card>
        </div>
      </div>

      {/* Job list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isDesktop ? 'var(--spacing-6)' : 'var(--spacing-4)' }}>
        <div style={{ maxWidth: isDesktop ? 720 : 'none', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
          {error && (
            <span style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-error)' }}>{error}</span>
          )}
          {jobs === null ? (
            <Spinner size="lg" label="Loading" />
          ) : jobs.length === 0 ? (
            <EmptyState title="Inbox is empty" description="Photo imports and categorisation jobs will show up here." />
          ) : (
            jobs.map((job) => <JobCard key={job.id} job={job} onRetry={retry} />)
          )}
          <div>
            {/* TEMPORARY dev button (stage 2), removed in stage 5. */}
            <Button label="Enqueue test job" variant="ghost" size="sm" clickAction={enqueueTest} />
          </div>
        </div>
      </div>
    </div>
  )
}
