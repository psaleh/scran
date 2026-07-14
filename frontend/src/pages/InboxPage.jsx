import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  video_import: 'YouTube import',
  categorise: 'Categorise ingredients',
  url_redraft: 'AI recipe tidy-up',
  name_note_cleanup: 'Ingredient name cleanup',
  test: 'Test job',
}

// DB statuses → display. 'done' is refined per job type below (a finished
// photo import or redraft needs review; a finished categorise job is done).
const STATUS_META = {
  pending: { label: 'Queued', variant: 'neutral' },
  running: { label: 'Processing', variant: 'info' },
  done: { label: 'Done', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
}

// Job types whose output is a draft a human must review before it becomes a
// recipe (settled decision: AI drafts always require review).
const REVIEW_TYPES = new Set(['photo_import', 'video_import', 'url_redraft'])

// Review jobs whose worker already created the draft recipe — reviewing
// just opens that recipe (job.recipe_id), never a prefilled new one.
const DRAFT_CREATED_TYPES = new Set(['photo_import', 'video_import'])

function JobCard({ job, onRetry, onReview }) {
  // Once the linked recipe is published, the review is done — stop
  // offering "Review draft" and show Done like any other finished job.
  const needsReview = job.status === 'done' && REVIEW_TYPES.has(job.type) && job.recipe_status !== 'published'
  const meta = needsReview ? { label: 'Needs review', variant: 'info' } : STATUS_META[job.status]
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
        {job.status === 'done' && DRAFT_CREATED_TYPES.has(job.type) && job.result?.title && (
          <div style={{ fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }}>
            Draft: “{job.result.title}” — {job.result.ingredients} ingredient(s), {job.result.steps} step(s)
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
        {needsReview && (DRAFT_CREATED_TYPES.has(job.type) ? job.recipe_id != null : job.result?.recipe) && (
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', marginTop: 'var(--spacing-1)' }}>
            <Button label="Review draft" variant="primary" size="sm" clickAction={() => onReview(job)} />
          </div>
        )}
      </div>
    </Card>
  )
}

/** Import inbox (spec §5.2): job list, AI endpoint status, manual retry. */
export default function InboxPage() {
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
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

  // Open a finished url_redraft result in the editor for review. Redrafts of
  // an existing recipe open that recipe with the AI's draft pre-filled (the
  // user still has to save); fallback extractions open a brand-new draft.
  const review = (job) => {
    // Photo imports already saved their draft recipe (the worker created
    // it); reviewing just opens that recipe in the editor with the original
    // photos alongside for checking (spec §5.3).
    if (job.type === 'photo_import') {
      navigate(`/recipes/${job.recipe_id}/edit`, {
        state: {
          reviewPhotos: job.result?.photos ?? [],
          // What the AI actually read off the pages — shown collapsed in the
          // review column so a bad draft can be traced to a misread photo
          // vs. a mangled restructuring.
          reviewTranscription: job.result?.transcription ?? '',
        },
      })
      return
    }
    // Video imports also saved their draft; there are no originals to show
    // alongside (the source video is linked from the recipe itself).
    if (job.type === 'video_import') {
      navigate(`/recipes/${job.recipe_id}/edit`)
      return
    }
    const { recipe, url, page_text: pageText, image_urls: imageUrls } = job.result
    // job.recipe_id is the durable link (set at enqueue time for a redraft
    // of an existing recipe, or once a fallback extraction gets saved for
    // the first time) — prefer it over job.result.recipe_id so re-opening
    // "Review draft" after an earlier draft save reopens that recipe
    // instead of creating a duplicate.
    const recipeId = job.recipe_id ?? job.result.recipe_id
    const prefill = {
      ...recipe,
      source_url: url,
      source_page_text: pageText,
      ai_reviewed: true,
      image_urls: imageUrls,
      // Only needed for a fallback extraction not yet linked to a recipe.
      review_job_id: recipeId ? null : job.id,
    }
    navigate(recipeId ? `/recipes/${recipeId}/edit` : '/recipes/new', { state: { prefill } })
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
            jobs.map((job) => <JobCard key={job.id} job={job} onRetry={retry} onReview={review} />)
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
