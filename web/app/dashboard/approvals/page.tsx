'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'

interface ApprovalRequest {
  id: string
  request_type: string
  entity_type?: string
  entity_id?: string
  title: string
  description?: string | null
  mode: string
  status: string
  requested_by?: string
  created_at?: string
  updated_at?: string
}

interface ApprovalStep {
  id: string
  request_id: string
  step_order: number
  required_role?: string | null
  assigned_to?: string | null
  decision: string
  comment?: string | null
  decided_by?: string | null
  decided_at?: string | null
  created_at?: string
}

const STATUS_TABS = ['all', 'pending', 'approved', 'rejected', 'changes-requested'] as const
type StatusTab = (typeof STATUS_TABS)[number]

const REQUEST_TYPES = ['clearance', 'release', 'override', 'license'] as const
const ROLES = ['admin', 'legal', 'ml-lead', 'dataops', 'viewer'] as const

interface StepDraft {
  required_role: string
  assigned_to: string
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function decisionTone(decision: string): 'green' | 'red' | 'amber' | 'zinc' {
  if (decision === 'approve') return 'green'
  if (decision === 'reject') return 'red'
  if (decision === 'request-changes') return 'amber'
  return 'zinc'
}

export default function ApprovalsPage() {
  const [requests, setRequests] = useState<ApprovalRequest[]>([])
  const [mine, setMine] = useState<ApprovalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const [tab, setTab] = useState<StatusTab>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'queue' | 'mine'>('queue')

  // detail drawer
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ request: ApprovalRequest; steps: ApprovalStep[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // decide
  const [decideStep, setDecideStep] = useState<ApprovalStep | null>(null)
  const [decideValue, setDecideValue] = useState<'approve' | 'reject' | 'request-changes'>('approve')
  const [decideComment, setDecideComment] = useState('')
  const [deciding, setDeciding] = useState(false)

  // create
  const [createOpen, setCreateOpen] = useState(false)
  const [cTitle, setCTitle] = useState('')
  const [cType, setCType] = useState<string>('clearance')
  const [cEntityType, setCEntityType] = useState('')
  const [cEntityId, setCEntityId] = useState('')
  const [cDescription, setCDescription] = useState('')
  const [cMode, setCMode] = useState<'sequential' | 'parallel'>('sequential')
  const [cSteps, setCSteps] = useState<StepDraft[]>([{ required_role: 'legal', assigned_to: '' }])
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [all, my] = await Promise.all([api.listApprovals(), api.getMyApprovals()])
      setRequests(Array.isArray(all) ? all : [])
      setMine(Array.isArray(my) ? my : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load approvals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const flash = (msg: string) => {
    setActionMsg(msg)
    window.setTimeout(() => setActionMsg(null), 3500)
  }

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const d = await api.getApproval(id)
      setDetail(d && d.request ? d : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load request detail')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const counts = useMemo(() => {
    const c = { total: requests.length, pending: 0, approved: 0, rejected: 0, changes: 0, mine: mine.length }
    for (const r of requests) {
      if (r.status === 'approved') c.approved++
      else if (r.status === 'rejected') c.rejected++
      else if (r.status === 'changes-requested') c.changes++
      else c.pending++
    }
    return c
  }, [requests, mine])

  const rows = useMemo(() => {
    const list = view === 'mine' ? mine : requests
    const q = search.trim().toLowerCase()
    return list
      .filter((r) => (view === 'mine' ? true : tab === 'all' ? true : r.status === tab))
      .filter((r) =>
        q
          ? r.title.toLowerCase().includes(q) ||
            r.request_type.toLowerCase().includes(q) ||
            (r.entity_type ?? '').toLowerCase().includes(q)
          : true,
      )
  }, [view, mine, requests, tab, search])

  const submitDecision = async () => {
    if (!decideStep || !detailId) return
    setDeciding(true)
    setError(null)
    try {
      const d = await api.decideApproval(detailId, {
        step_id: decideStep.id,
        decision: decideValue,
        comment: decideComment || undefined,
      })
      if (d && d.request) setDetail(d)
      flash('Decision recorded')
      setDecideStep(null)
      setDecideComment('')
      setDecideValue('approve')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record decision')
    } finally {
      setDeciding(false)
    }
  }

  const addStepRow = () => setCSteps((s) => [...s, { required_role: 'legal', assigned_to: '' }])
  const removeStepRow = (i: number) => setCSteps((s) => s.filter((_, idx) => idx !== i))
  const updateStepRow = (i: number, patch: Partial<StepDraft>) =>
    setCSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)))

  const submitCreate = async () => {
    if (!cTitle.trim()) {
      setError('Title is required')
      return
    }
    if (cSteps.length === 0) {
      setError('At least one approval step is required')
      return
    }
    setCreating(true)
    setError(null)
    try {
      await api.createApproval({
        title: cTitle.trim(),
        request_type: cType,
        entity_type: cEntityType || undefined,
        entity_id: cEntityId || undefined,
        description: cDescription || undefined,
        mode: cMode,
        steps: cSteps.map((s, idx) => ({
          step_order: idx + 1,
          required_role: s.required_role,
          assigned_to: s.assigned_to || undefined,
        })),
      })
      flash('Approval request created')
      setCreateOpen(false)
      setCTitle('')
      setCType('clearance')
      setCEntityType('')
      setCEntityId('')
      setCDescription('')
      setCMode('sequential')
      setCSteps([{ required_role: 'legal', assigned_to: '' }])
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create request')
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <PageSpinner label="Loading approvals..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Approvals</h1>
          <p className="mt-1 text-sm text-slate-500">
            Multi-step sign-off workflows for clearances, releases, overrides, and licenses. Route
            decisions sequentially or in parallel across required roles.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New approval request</Button>
      </div>

      {actionMsg && (
        <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300">
          {actionMsg}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Total requests" value={counts.total} />
        <Stat label="Pending" value={counts.pending} tone="amber" />
        <Stat label="Approved" value={counts.approved} tone="green" />
        <Stat label="Rejected" value={counts.rejected} tone="red" />
        <Stat label="My pending" value={counts.mine} tone="rose" />
      </div>

      {/* View toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5">
          <button
            onClick={() => setView('queue')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              view === 'queue' ? 'bg-fuchsia-600 text-white' : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            Approval queue
          </button>
          <button
            onClick={() => setView('mine')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              view === 'mine' ? 'bg-fuchsia-600 text-white' : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            My pending ({counts.mine})
          </button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search requests..."
          className="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none sm:w-64"
        />
      </div>

      {view === 'queue' && (
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                tab === t ? 'bg-slate-700 text-white' : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {t.replace('-', ' ')}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={view === 'mine' ? 'Nothing awaiting your decision' : 'No approval requests'}
          description={
            view === 'mine'
              ? 'You have no pending steps assigned to you right now.'
              : 'Create an approval request to route a clearance, release, override, or license for sign-off.'
          }
          action={view === 'queue' ? <Button onClick={() => setCreateOpen(true)}>New approval request</Button> : undefined}
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Title</Th>
              <Th>Type</Th>
              <Th>Mode</Th>
              <Th>Status</Th>
              <Th>Entity</Th>
              <Th>Updated</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <button
                    onClick={() => openDetail(r.id)}
                    className="text-left font-medium text-slate-100 hover:text-fuchsia-400"
                  >
                    {r.title}
                  </button>
                  {r.description && (
                    <div className="mt-0.5 max-w-[20rem] truncate text-xs text-slate-500" title={r.description}>
                      {r.description}
                    </div>
                  )}
                </Td>
                <Td>
                  <Badge tone="blue">{r.request_type}</Badge>
                </Td>
                <Td className="text-slate-400">{r.mode}</Td>
                <Td>
                  <Badge>{r.status}</Badge>
                </Td>
                <Td className="text-xs text-slate-500">
                  {r.entity_type ? (
                    <span>
                      {r.entity_type}
                      {r.entity_id ? ` · ${String(r.entity_id).slice(0, 8)}` : ''}
                    </span>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td className="text-xs text-slate-500">{fmtDate(r.updated_at ?? r.created_at)}</Td>
                <Td className="text-right">
                  <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => openDetail(r.id)}>
                    Review
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {/* Detail modal */}
      <Modal
        open={detailId !== null}
        onClose={() => {
          setDetailId(null)
          setDetail(null)
        }}
        title={detail?.request ? detail.request.title : 'Approval request'}
        className="max-w-2xl"
        footer={
          <Button
            variant="secondary"
            onClick={() => {
              setDetailId(null)
              setDetail(null)
            }}
          >
            Close
          </Button>
        }
      >
        {detailLoading ? (
          <div className="py-6">
            <Spinner label="Loading request..." />
          </div>
        ) : detail?.request ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{detail.request.request_type}</Badge>
              <Badge>{detail.request.status}</Badge>
              <span className="text-xs text-slate-500">{detail.request.mode} mode</span>
            </div>
            {detail.request.description && (
              <p className="text-sm text-slate-400">{detail.request.description}</p>
            )}
            {detail.request.entity_type && (
              <div className="text-xs text-slate-500">
                Entity: <span className="text-slate-300">{detail.request.entity_type}</span>
                {detail.request.entity_id ? ` · ${detail.request.entity_id}` : ''}
              </div>
            )}

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Approval steps
              </div>
              <ol className="space-y-2">
                {[...detail.steps]
                  .sort((a, b) => a.step_order - b.step_order)
                  .map((s) => (
                    <li
                      key={s.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs text-slate-300">
                            {s.step_order}
                          </span>
                          <span className="text-sm text-slate-200">
                            {s.required_role ?? 'any role'}
                          </span>
                          {s.assigned_to && (
                            <span className="text-xs text-slate-500">→ {s.assigned_to}</span>
                          )}
                        </div>
                        <Badge tone={decisionTone(s.decision)}>{s.decision}</Badge>
                      </div>
                      {s.comment && (
                        <div className="mt-1.5 text-xs text-slate-400">“{s.comment}”</div>
                      )}
                      {s.decided_at && (
                        <div className="mt-1 text-[11px] text-slate-600">
                          {s.decided_by ? `${s.decided_by} · ` : ''}
                          {fmtDate(s.decided_at)}
                        </div>
                      )}
                      {s.decision === 'pending' && detail.request.status === 'pending' && (
                        <div className="mt-2">
                          <Button
                            variant="secondary"
                            className="px-2.5 py-1 text-xs"
                            onClick={() => {
                              setDecideStep(s)
                              setDecideValue('approve')
                              setDecideComment('')
                            }}
                          >
                            Record decision
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                {detail.steps.length === 0 && (
                  <li className="text-sm text-slate-500">No steps defined.</li>
                )}
              </ol>
            </div>
            <div className="text-[11px] text-slate-600">
              Requested by {detail.request.requested_by ?? '—'} · created {fmtDate(detail.request.created_at)}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Request not found.</p>
        )}
      </Modal>

      {/* Decision modal */}
      <Modal
        open={decideStep !== null}
        onClose={() => setDecideStep(null)}
        title="Record decision"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecideStep(null)} disabled={deciding}>
              Cancel
            </Button>
            <Button onClick={submitDecision} disabled={deciding}>
              {deciding ? <Spinner label="Saving..." /> : 'Submit decision'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {decideStep && (
            <p className="text-sm text-slate-500">
              Step {decideStep.step_order} ·{' '}
              <span className="text-slate-300">{decideStep.required_role ?? 'any role'}</span>
            </p>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Decision
            </label>
            <div className="flex flex-wrap gap-2">
              {(['approve', 'reject', 'request-changes'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDecideValue(d)}
                  className={`rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors ${
                    decideValue === d
                      ? d === 'approve'
                        ? 'border-emerald-700 bg-emerald-950/50 text-emerald-300'
                        : d === 'reject'
                          ? 'border-red-800 bg-red-950/50 text-red-300'
                          : 'border-amber-800 bg-amber-950/50 text-amber-300'
                      : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {d.replace('-', ' ')}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Comment (optional)
            </label>
            <textarea
              value={decideComment}
              onChange={(e) => setDecideComment(e.target.value)}
              rows={3}
              placeholder="Notes on this decision…"
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New approval request"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={creating}>
              {creating ? <Spinner label="Creating..." /> : 'Create request'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Title <span className="text-fuchsia-400">*</span>
            </label>
            <input
              value={cTitle}
              onChange={(e) => setCTitle(e.target.value)}
              placeholder="e.g. Release sign-off for model v1.2"
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Request type
              </label>
              <select
                value={cType}
                onChange={(e) => setCType(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
              >
                {REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Mode
              </label>
              <select
                value={cMode}
                onChange={(e) => setCMode(e.target.value as 'sequential' | 'parallel')}
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
              >
                <option value="sequential">sequential</option>
                <option value="parallel">parallel</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Entity type (optional)
              </label>
              <input
                value={cEntityType}
                onChange={(e) => setCEntityType(e.target.value)}
                placeholder="e.g. model_version"
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Entity id (optional)
              </label>
              <input
                value={cEntityId}
                onChange={(e) => setCEntityId(e.target.value)}
                placeholder="uuid"
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Description (optional)
            </label>
            <textarea
              value={cDescription}
              onChange={(e) => setCDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Approval steps
              </label>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={addStepRow}>
                + Add step
              </Button>
            </div>
            <div className="space-y-2">
              {cSteps.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs text-slate-300">
                    {i + 1}
                  </span>
                  <select
                    value={s.required_role}
                    onChange={(e) => updateStepRow(i, { required_role: e.target.value })}
                    className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <input
                    value={s.assigned_to}
                    onChange={(e) => updateStepRow(i, { assigned_to: e.target.value })}
                    placeholder="assigned to (optional user id)"
                    className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
                  />
                  {cSteps.length > 1 && (
                    <button
                      onClick={() => removeStepRow(i)}
                      className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-800 hover:text-red-300"
                      aria-label="Remove step"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
