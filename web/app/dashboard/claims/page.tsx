'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface DataSource {
  id: string
  name: string
}

interface Claim {
  id: string
  claimant: string
  rights_holder_id?: string | null
  claim_type: string
  description?: string | null
  severity: string
  status: string
  source_id?: string | null
  response_deadline?: string | null
  legal_hold?: boolean
  resolution?: string | null
  resolved_at?: string | null
  created_at?: string
  updated_at?: string
}

const CLAIM_TYPES = ['copyright', 'privacy', 'contract', 'takedown'] as const
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const STATUSES = [
  'received',
  'investigating',
  'valid',
  'invalid',
  'remediating',
  'resolved',
  'escalated',
] as const

// Kanban columns group the lifecycle into actionable lanes.
const COLUMNS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'intake', label: 'Intake', statuses: ['received'] },
  { key: 'review', label: 'Investigating', statuses: ['investigating'] },
  { key: 'triaged', label: 'Triaged', statuses: ['valid', 'invalid'] },
  { key: 'remediating', label: 'Remediating', statuses: ['remediating', 'escalated'] },
  { key: 'closed', label: 'Resolved', statuses: ['resolved'] },
]

const severityTone: Record<string, 'zinc' | 'blue' | 'amber' | 'red'> = {
  low: 'zinc',
  medium: 'blue',
  high: 'amber',
  critical: 'red',
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function deadlineState(s?: string | null): { label: string; tone: 'zinc' | 'amber' | 'red' } {
  if (!s) return { label: 'No deadline', tone: 'zinc' }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return { label: 'No deadline', tone: 'zinc' }
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000)
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'red' }
  if (days <= 7) return { label: `${days}d left`, tone: 'amber' }
  return { label: `${days}d left`, tone: 'zinc' }
}

export default function ClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([])
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [typeFilter, setTypeFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [severityFilter, setSeverityFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'board' | 'table'>('board')

  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    claimant: '',
    claim_type: 'copyright',
    severity: 'medium',
    description: '',
    source_id: '',
    response_deadline: '',
    legal_hold: false,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = {}
      if (typeFilter) params.claim_type = typeFilter
      if (statusFilter) params.status = statusFilter
      const [cl, src] = await Promise.all([
        api.listClaims(Object.keys(params).length ? params : undefined),
        api.listSources(),
      ])
      setClaims(Array.isArray(cl) ? cl : [])
      setSources(Array.isArray(src) ? src : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load claims')
    } finally {
      setLoading(false)
    }
  }, [typeFilter, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  const sourceById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sources) m.set(s.id, s.name)
    return m
  }, [sources])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return claims
      .filter((c) => (severityFilter ? c.severity === severityFilter : true))
      .filter((c) =>
        q
          ? c.claimant.toLowerCase().includes(q) ||
            (c.description ?? '').toLowerCase().includes(q)
          : true,
      )
  }, [claims, severityFilter, search])

  const stats = useMemo(() => {
    const open = filtered.filter((c) => !['resolved', 'invalid'].includes(c.status)).length
    const critical = filtered.filter((c) => c.severity === 'critical').length
    const holds = filtered.filter((c) => c.legal_hold).length
    const overdue = filtered.filter((c) => {
      if (!c.response_deadline || ['resolved', 'invalid'].includes(c.status)) return false
      return new Date(c.response_deadline).getTime() < Date.now()
    }).length
    return { total: filtered.length, open, critical, holds, overdue }
  }, [filtered])

  const byColumn = useMemo(() => {
    const m = new Map<string, Claim[]>()
    for (const col of COLUMNS) m.set(col.key, [])
    for (const c of filtered) {
      const col = COLUMNS.find((co) => co.statuses.includes(c.status))
      if (col) m.get(col.key)!.push(c)
    }
    return m
  }, [filtered])

  const submitCreate = async () => {
    if (!form.claimant.trim()) {
      setError('Claimant is required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await api.createClaim({
        claimant: form.claimant.trim(),
        claim_type: form.claim_type,
        severity: form.severity,
        description: form.description || undefined,
        source_id: form.source_id || undefined,
        response_deadline: form.response_deadline || undefined,
        legal_hold: form.legal_hold,
      })
      setCreateOpen(false)
      setForm({
        claimant: '',
        claim_type: 'copyright',
        severity: 'medium',
        description: '',
        source_id: '',
        response_deadline: '',
        legal_hold: false,
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create claim')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <PageSpinner label="Loading claims board..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Claims &amp; Disputes</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Intake takedown notices and rights disputes, triage severity, and track them to
            resolution. New claims auto-derive model-version impacts from source lineage.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New claim</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Total" value={stats.total} />
        <Stat label="Open" value={stats.open} tone="amber" />
        <Stat label="Critical" value={stats.critical} tone="red" />
        <Stat label="Legal holds" value={stats.holds} tone="rose" />
        <Stat label="Overdue" value={stats.overdue} tone="red" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
          >
            <option value="">All types</option>
            {CLAIM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
          >
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search claimant / description..."
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none sm:w-72"
          />
        </div>
        <div className="flex gap-1.5">
          {(['board', 'table'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                view === v
                  ? 'bg-rose-600 text-white'
                  : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No claims"
          description={
            claims.length === 0
              ? 'No claims have been filed yet. Use “New claim” to record a takedown notice or dispute.'
              : 'No claims match the current filters.'
          }
          action={<Button onClick={() => setCreateOpen(true)}>New claim</Button>}
        />
      ) : view === 'board' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const items = byColumn.get(col.key) ?? []
            return (
              <div key={col.key} className="flex flex-col">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold text-zinc-300">{col.label}</span>
                  <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                    {items.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-600">
                      Empty
                    </div>
                  ) : (
                    items.map((c) => {
                      const dl = deadlineState(c.response_deadline)
                      return (
                        <Link
                          key={c.id}
                          href={`/dashboard/claims/${c.id}`}
                          className="block rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 transition-colors hover:border-rose-700/60 hover:bg-zinc-900"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-zinc-100">{c.claimant}</span>
                            <Badge tone={severityTone[c.severity] ?? 'zinc'}>{c.severity}</Badge>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <Badge>{c.claim_type}</Badge>
                            <Badge>{c.status}</Badge>
                            {c.legal_hold && <Badge tone="rose">legal hold</Badge>}
                          </div>
                          {c.source_id && (
                            <div className="mt-1.5 truncate text-xs text-zinc-500">
                              src: {sourceById.get(c.source_id) ?? c.source_id}
                            </div>
                          )}
                          <div className="mt-1.5 flex items-center justify-between text-xs">
                            <span className="text-zinc-600">{fmtDate(c.created_at)}</span>
                            {c.response_deadline && <Badge tone={dl.tone}>{dl.label}</Badge>}
                          </div>
                        </Link>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Claimant</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Severity</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Deadline</th>
                    <th className="px-4 py-3 font-medium">Hold</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filtered.map((c) => {
                    const dl = deadlineState(c.response_deadline)
                    return (
                      <tr key={c.id} className="hover:bg-zinc-900/40">
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboard/claims/${c.id}`}
                            className="font-medium text-rose-400 hover:underline"
                          >
                            {c.claimant}
                          </Link>
                          {c.description && (
                            <div className="mt-0.5 max-w-md truncate text-xs text-zinc-500">
                              {c.description}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge>{c.claim_type}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={severityTone[c.severity] ?? 'zinc'}>{c.severity}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge>{c.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">
                          {c.source_id ? sourceById.get(c.source_id) ?? c.source_id : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {c.response_deadline ? <Badge tone={dl.tone}>{dl.label}</Badge> : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {c.legal_hold ? <Badge tone="rose">hold</Badge> : '—'}
                        </td>
                        <td className="px-4 py-3 text-zinc-500">{fmtDate(c.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Create claim modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Intake new claim"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={submitting}>
              {submitting ? <Spinner label="Filing..." /> : 'File claim'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Claimant <span className="text-rose-400">*</span>
            </label>
            <input
              value={form.claimant}
              onChange={(e) => setForm((f) => ({ ...f, claimant: e.target.value }))}
              placeholder="Name of the party filing the claim"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Type
              </label>
              <select
                value={form.claim_type}
                onChange={(e) => setForm((f) => ({ ...f, claim_type: e.target.value }))}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
              >
                {CLAIM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Severity
              </label>
              <select
                value={form.severity}
                onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Affected source (optional)
            </label>
            <select
              value={form.source_id}
              onChange={(e) => setForm((f) => ({ ...f, source_id: e.target.value }))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
            >
              <option value="">None</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-600">
              Selecting a source auto-derives impacts on every model version trained on it.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Response deadline (optional)
            </label>
            <input
              type="date"
              value={form.response_deadline}
              onChange={(e) => setForm((f) => ({ ...f, response_deadline: e.target.value }))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="Details of the claim or notice…"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.legal_hold}
              onChange={(e) => setForm((f) => ({ ...f, legal_hold: e.target.checked }))}
              className="h-4 w-4 accent-rose-600"
            />
            Place affected entities under legal hold
          </label>
        </div>
      </Modal>
    </div>
  )
}
