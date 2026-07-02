'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table'

type Screening = {
  id: string
  source_id: string
  status: string
  method?: string | null
  reviewer?: string | null
  flagged_works?: unknown
  risk_score?: number | null
  remediation_action?: string | null
  remediation_owner?: string | null
  remediation_due?: string | null
  remediation_status?: string | null
  notes?: string | null
  screened_at?: string | null
  created_at?: string
}

type Source = { id: string; name: string; source_type?: string | null; modality?: string | null }

const STATUSES = ['not-started', 'in-progress', 'passed', 'flagged', 'failed'] as const
const METHODS = ['manual-review', 'automated-match', 'fingerprint-scan', 'hash-dedup', 'vendor-attestation']

function fmtDate(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function flaggedCount(works: unknown): number {
  if (Array.isArray(works)) return works.length
  if (typeof works === 'string') {
    const t = works.trim()
    if (!t) return 0
    return t.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).length
  }
  return 0
}

function parseFlagged(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function CopyrightScreeningPage() {
  const [screenings, setScreenings] = useState<Screening[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Screening | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [scr, src] = await Promise.all([
        api.listCopyrightScreenings(),
        api.listSources(),
      ])
      setScreenings(Array.isArray(scr) ? scr : [])
      setSources(Array.isArray(src) ? src : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load copyright screenings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const sourceName = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sources) map.set(s.id, s.name)
    return (id: string) => map.get(id) ?? id.slice(0, 8)
  }, [sources])

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: screenings.length }
    for (const st of STATUSES) c[st] = 0
    let flagged = 0
    for (const s of screenings) {
      if (s.status in c) c[s.status] += 1
      flagged += flaggedCount(s.flagged_works)
    }
    c.flaggedWorks = flagged
    return c
  }, [screenings])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return screenings.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (!q) return true
      const name = sourceName(s.source_id).toLowerCase()
      return (
        name.includes(q) ||
        (s.reviewer ?? '').toLowerCase().includes(q) ||
        (s.method ?? '').toLowerCase().includes(q) ||
        (s.notes ?? '').toLowerCase().includes(q)
      )
    })
  }, [screenings, statusFilter, search, sourceName])

  async function quickStatus(s: Screening, status: string) {
    setScreenings((prev) => prev.map((x) => (x.id === s.id ? { ...x, status } : x)))
    try {
      const updated = await api.updateCopyrightScreening(s.id, { status, screened_at: new Date().toISOString() })
      setScreenings((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...updated } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
      load()
    }
  }

  if (loading) return <PageSpinner label="Loading copyright screenings..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Copyright Screening</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review training sources for infringing or unlicensed copyrighted works.
          </p>
        </div>
        <Button onClick={() => { setFormError(null); setCreateOpen(true) }}>+ New Screening</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
          <button onClick={load} className="ml-3 underline hover:text-red-200">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total" value={counts.total} />
        <Stat label="In Progress" value={counts['in-progress']} tone="amber" />
        <Stat label="Passed" value={counts.passed} tone="green" />
        <Stat label="Flagged" value={counts.flagged} tone="amber" />
        <Stat label="Failed" value={counts.failed} tone="red" />
        <Stat label="Flagged Works" value={counts.flaggedWorks} tone="rose" />
      </div>

      <StatusBar counts={counts} total={counts.total} />

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
              All ({counts.total})
            </FilterChip>
            {STATUSES.map((st) => (
              <FilterChip key={st} active={statusFilter === st} onClick={() => setStatusFilter(st)}>
                {st} ({counts[st]})
              </FilterChip>
            ))}
          </div>
          <div className="ml-auto">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search source, reviewer, method..."
              className="w-64 max-w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-600 focus:outline-none"
            />
          </div>
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon="©"
          title={screenings.length === 0 ? 'No copyright screenings yet' : 'No screenings match your filters'}
          description={
            screenings.length === 0
              ? 'Open a screening on a data source to start tracking copyright clearance.'
              : 'Try clearing the search or selecting a different status.'
          }
          action={
            screenings.length === 0 ? (
              <Button onClick={() => { setFormError(null); setCreateOpen(true) }}>+ New Screening</Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th>Method</Th>
              <Th>Reviewer</Th>
              <Th className="text-right">Flagged</Th>
              <Th className="text-right">Risk</Th>
              <Th>Remediation</Th>
              <Th>Screened</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map((s) => (
              <Tr key={s.id}>
                <Td className="font-medium text-slate-100">{sourceName(s.source_id)}</Td>
                <Td><Badge>{s.status}</Badge></Td>
                <Td className="text-slate-400">{s.method || '—'}</Td>
                <Td className="text-slate-400">{s.reviewer || '—'}</Td>
                <Td className="text-right tabular-nums">
                  {flaggedCount(s.flagged_works) > 0 ? (
                    <Badge tone="rose">{flaggedCount(s.flagged_works)}</Badge>
                  ) : (
                    <span className="text-slate-600">0</span>
                  )}
                </Td>
                <Td className="text-right tabular-nums">
                  {s.risk_score != null ? (
                    <span className={riskColor(s.risk_score)}>{Number(s.risk_score).toFixed(0)}</span>
                  ) : '—'}
                </Td>
                <Td>
                  {s.remediation_action ? (
                    <span className="text-slate-300">
                      {s.remediation_action}
                      {s.remediation_status && (
                        <Badge className="ml-2">{s.remediation_status}</Badge>
                      )}
                    </span>
                  ) : <span className="text-slate-600">—</span>}
                </Td>
                <Td className="text-slate-400">{fmtDate(s.screened_at)}</Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <select
                      value={s.status}
                      onChange={(e) => quickStatus(s, e.target.value)}
                      className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-fuchsia-600 focus:outline-none"
                      aria-label="Set status"
                    >
                      {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setFormError(null); setEditing(s) }}>
                      Edit
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {createOpen && (
        <ScreeningForm
          mode="create"
          sources={sources}
          busy={busy}
          error={formError}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (body) => {
            setBusy(true)
            setFormError(null)
            try {
              const created = await api.createCopyrightScreening(body)
              setScreenings((prev) => [created, ...prev])
              setCreateOpen(false)
            } catch (e) {
              setFormError(e instanceof Error ? e.message : 'Failed to create screening')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}

      {editing && (
        <ScreeningForm
          mode="edit"
          sources={sources}
          initial={editing}
          busy={busy}
          error={formError}
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            setBusy(true)
            setFormError(null)
            try {
              const updated = await api.updateCopyrightScreening(editing.id, body)
              setScreenings((prev) => prev.map((x) => (x.id === editing.id ? { ...x, ...updated } : x)))
              setEditing(null)
            } catch (e) {
              setFormError(e instanceof Error ? e.message : 'Failed to update screening')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}

function riskColor(score: number) {
  if (score >= 70) return 'text-red-400 font-semibold'
  if (score >= 40) return 'text-amber-400 font-semibold'
  return 'text-emerald-400'
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
        active
          ? 'border-fuchsia-600 bg-fuchsia-950/40 text-fuchsia-300'
          : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function StatusBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (total === 0) return null
  const segments: { key: string; tone: string }[] = [
    { key: 'passed', tone: 'bg-emerald-500' },
    { key: 'in-progress', tone: 'bg-amber-500' },
    { key: 'flagged', tone: 'bg-fuchsia-500' },
    { key: 'failed', tone: 'bg-red-600' },
    { key: 'not-started', tone: 'bg-slate-600' },
  ]
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full border border-slate-800 bg-slate-900">
        {segments.map((seg) =>
          counts[seg.key] > 0 ? (
            <div
              key={seg.key}
              className={seg.tone}
              style={{ width: `${(counts[seg.key] / total) * 100}%` }}
              title={`${seg.key}: ${counts[seg.key]}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {segments.map((seg) => (
          <span key={seg.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${seg.tone}`} /> {seg.key} {counts[seg.key]}
          </span>
        ))}
      </div>
    </div>
  )
}

function ScreeningForm({
  mode,
  sources,
  initial,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  sources: Source[]
  initial?: Screening
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [sourceId, setSourceId] = useState(initial?.source_id ?? (sources[0]?.id ?? ''))
  const [status, setStatus] = useState(initial?.status ?? 'not-started')
  const [method, setMethod] = useState(initial?.method ?? '')
  const [reviewer, setReviewer] = useState(initial?.reviewer ?? '')
  const [flagged, setFlagged] = useState(
    Array.isArray(initial?.flagged_works)
      ? (initial!.flagged_works as string[]).join('\n')
      : typeof initial?.flagged_works === 'string'
        ? (initial!.flagged_works as string)
        : '',
  )
  const [riskScore, setRiskScore] = useState(initial?.risk_score != null ? String(initial.risk_score) : '')
  const [remAction, setRemAction] = useState(initial?.remediation_action ?? '')
  const [remOwner, setRemOwner] = useState(initial?.remediation_owner ?? '')
  const [remDue, setRemDue] = useState(initial?.remediation_due ? initial.remediation_due.slice(0, 10) : '')
  const [remStatus, setRemStatus] = useState(initial?.remediation_status ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  function submit() {
    const body: Record<string, unknown> = {
      source_id: sourceId,
      status,
      method: method || null,
      reviewer: reviewer || null,
      flagged_works: parseFlagged(flagged),
      risk_score: riskScore ? Number(riskScore) : null,
      remediation_action: remAction || null,
      remediation_owner: remOwner || null,
      remediation_due: remDue || null,
      remediation_status: remStatus || null,
      notes: notes || null,
    }
    if (status === 'passed' || status === 'flagged' || status === 'failed') {
      body.screened_at = initial?.screened_at ?? new Date().toISOString()
    }
    onSubmit(body)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'New Copyright Screening' : 'Edit Copyright Screening'}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !sourceId}>
            {busy ? <Spinner label={mode === 'create' ? 'Creating...' : 'Saving...'} /> : mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Data Source" required>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={inputCls} disabled={mode === 'edit'}>
              {sources.length === 0 && <option value="">No sources available</option>}
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          </Field>
          <Field label="Method">
            <input list="copyright-methods" value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls} placeholder="e.g. fingerprint-scan" />
            <datalist id="copyright-methods">
              {METHODS.map((m) => <option key={m} value={m} />)}
            </datalist>
          </Field>
          <Field label="Reviewer">
            <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} className={inputCls} placeholder="Reviewer name" />
          </Field>
          <Field label="Risk Score (0-100)">
            <input type="number" min={0} max={100} value={riskScore} onChange={(e) => setRiskScore(e.target.value)} className={inputCls} placeholder="0" />
          </Field>
        </div>

        <Field label="Flagged Works" hint="One per line, or comma-separated">
          <textarea value={flagged} onChange={(e) => setFlagged(e.target.value)} rows={3} className={inputCls} placeholder="Title / URL / identifier of suspected works" />
        </Field>

        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Remediation</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Action">
              <input value={remAction} onChange={(e) => setRemAction(e.target.value)} className={inputCls} placeholder="e.g. remove flagged records" />
            </Field>
            <Field label="Owner">
              <input value={remOwner} onChange={(e) => setRemOwner(e.target.value)} className={inputCls} placeholder="Responsible person" />
            </Field>
            <Field label="Due Date">
              <input type="date" value={remDue} onChange={(e) => setRemDue(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Remediation Status">
              <select value={remStatus} onChange={(e) => setRemStatus(e.target.value)} className={inputCls}>
                <option value="">—</option>
                <option value="open">open</option>
                <option value="in-progress">in-progress</option>
                <option value="done">done</option>
              </select>
            </Field>
          </div>
        </div>

        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} placeholder="Context, findings, decisions..." />
        </Field>
      </div>
    </Modal>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-600 focus:outline-none'

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-400">
        {label} {required && <span className="text-fuchsia-500">*</span>}
        {hint && <span className="font-normal text-slate-600">— {hint}</span>}
      </span>
      {children}
    </label>
  )
}
