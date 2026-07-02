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

interface DataSource {
  id: string
  name: string
  source_type?: string
  modality?: string
  status?: string
  risk_score?: number
  collection?: string
}

interface Clearance {
  id: string
  source_id: string
  status: string
  unmet_requirements?: string[] | null
  approver_id?: string | null
  approver_role?: string | null
  decision_rationale?: string | null
  is_override?: boolean
  override_justification?: string | null
  decided_at?: string | null
  created_at?: string
}

interface ClearanceRequirement {
  id?: string
  key: string
  label: string
  description?: string
  is_required: boolean
}

interface Certificate {
  id: string
  source_id: string
  clearance_id?: string
  certificate_hash: string
  issued_to?: string | null
  issued_by?: string | null
  created_at?: string
  payload?: Record<string, unknown> | null
}

const STATUS_TABS = ['all', 'pending', 'cleared', 'blocked', 'overridden'] as const
type StatusTab = (typeof STATUS_TABS)[number]

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function shortHash(h?: string): string {
  if (!h) return '—'
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h
}

export default function ClearancePage() {
  const [clearances, setClearances] = useState<Clearance[]>([])
  const [sources, setSources] = useState<DataSource[]>([])
  const [requirements, setRequirements] = useState<ClearanceRequirement[]>([])
  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const [tab, setTab] = useState<StatusTab>('all')
  const [search, setSearch] = useState('')

  // requirements editor
  const [reqOpen, setReqOpen] = useState(false)
  const [reqDraft, setReqDraft] = useState<ClearanceRequirement[]>([])
  const [reqSaving, setReqSaving] = useState(false)

  // approve / override modals
  const [approveTarget, setApproveTarget] = useState<DataSource | null>(null)
  const [approveRole, setApproveRole] = useState('legal')
  const [approveRationale, setApproveRationale] = useState('')
  const [approveIssuedTo, setApproveIssuedTo] = useState('')
  const [overrideTarget, setOverrideTarget] = useState<DataSource | null>(null)
  const [overrideJustification, setOverrideJustification] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // certificate viewer
  const [certView, setCertView] = useState<Certificate | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cl, src, reqs, certs] = await Promise.all([
        api.listClearances(),
        api.listSources(),
        api.getClearanceRequirements(),
        api.listCertificates(),
      ])
      setClearances(Array.isArray(cl) ? cl : [])
      setSources(Array.isArray(src) ? src : [])
      setRequirements(Array.isArray(reqs) ? reqs : [])
      setCertificates(Array.isArray(certs) ? certs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load clearance data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const sourceById = useMemo(() => {
    const m = new Map<string, DataSource>()
    for (const s of sources) m.set(s.id, s)
    return m
  }, [sources])

  const clearanceBySource = useMemo(() => {
    const m = new Map<string, Clearance>()
    for (const c of clearances) m.set(c.source_id, c)
    return m
  }, [clearances])

  const certsBySource = useMemo(() => {
    const m = new Map<string, Certificate[]>()
    for (const c of certificates) {
      const arr = m.get(c.source_id) ?? []
      arr.push(c)
      m.set(c.source_id, arr)
    }
    return m
  }, [certificates])

  // Build a per-source gate row: every source plus its clearance state.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sources
      .map((s) => {
        const cl = clearanceBySource.get(s.id)
        const status = cl?.status ?? 'pending'
        return { source: s, clearance: cl, status }
      })
      .filter((r) => (tab === 'all' ? true : r.status === tab))
      .filter((r) =>
        q
          ? r.source.name.toLowerCase().includes(q) ||
            (r.source.collection ?? '').toLowerCase().includes(q) ||
            (r.source.source_type ?? '').toLowerCase().includes(q)
          : true,
      )
  }, [sources, clearanceBySource, tab, search])

  const counts = useMemo(() => {
    const c = { total: sources.length, pending: 0, cleared: 0, blocked: 0, overridden: 0 }
    for (const s of sources) {
      const st = clearanceBySource.get(s.id)?.status ?? 'pending'
      if (st === 'cleared') c.cleared++
      else if (st === 'blocked') c.blocked++
      else if (st === 'overridden') c.overridden++
      else c.pending++
    }
    return c
  }, [sources, clearanceBySource])

  const flash = (msg: string) => {
    setActionMsg(msg)
    window.setTimeout(() => setActionMsg(null), 3500)
  }

  const handleEvaluate = async (sourceId: string) => {
    setBusyId(sourceId)
    setError(null)
    try {
      await api.evaluateClearance(sourceId)
      flash('Gate re-evaluated')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluate failed')
    } finally {
      setBusyId(null)
    }
  }

  const handleEvaluateAll = async () => {
    setBusyId('__all__')
    setError(null)
    try {
      await Promise.all(rows.map((r) => api.evaluateClearance(r.source.id)))
      flash(`Re-evaluated ${rows.length} source${rows.length === 1 ? '' : 's'}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk evaluate failed')
    } finally {
      setBusyId(null)
    }
  }

  const submitApprove = async () => {
    if (!approveTarget) return
    setSubmitting(true)
    setError(null)
    try {
      await api.approveClearance(approveTarget.id, {
        approver_role: approveRole,
        decision_rationale: approveRationale || undefined,
        issued_to: approveIssuedTo || undefined,
      })
      flash(`Cleared ${approveTarget.name} and issued certificate`)
      setApproveTarget(null)
      setApproveRationale('')
      setApproveIssuedTo('')
      setApproveRole('legal')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setSubmitting(false)
    }
  }

  const submitOverride = async () => {
    if (!overrideTarget) return
    if (!overrideJustification.trim()) {
      setError('Override justification is required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await api.overrideClearance(overrideTarget.id, {
        override_justification: overrideJustification.trim(),
      })
      flash(`Override recorded for ${overrideTarget.name}`)
      setOverrideTarget(null)
      setOverrideJustification('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Override failed')
    } finally {
      setSubmitting(false)
    }
  }

  const openRequirements = () => {
    setReqDraft(requirements.map((r) => ({ ...r })))
    setReqOpen(true)
  }

  const toggleReqRequired = (key: string) => {
    setReqDraft((d) => d.map((r) => (r.key === key ? { ...r, is_required: !r.is_required } : r)))
  }

  const saveRequirements = async () => {
    setReqSaving(true)
    setError(null)
    try {
      const next = await api.setClearanceRequirements({
        requirements: reqDraft.map((r) => ({
          key: r.key,
          label: r.label,
          description: r.description,
          is_required: r.is_required,
        })),
      })
      setRequirements(Array.isArray(next) ? next : reqDraft)
      flash('Clearance requirements updated')
      setReqOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save requirements')
    } finally {
      setReqSaving(false)
    }
  }

  if (loading) return <PageSpinner label="Loading clearance console..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Clearance Gate Console</h1>
          <p className="mt-1 text-sm text-slate-500">
            Evaluate sources against required checks, approve sign-offs that issue tamper-evident
            certificates, and record overrides.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={openRequirements}>
            Configure requirements
          </Button>
          <Button
            variant="secondary"
            onClick={handleEvaluateAll}
            disabled={busyId !== null || rows.length === 0}
          >
            {busyId === '__all__' ? <Spinner label="Evaluating..." /> : `Re-evaluate ${rows.length} shown`}
          </Button>
        </div>
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
        <Stat label="Total sources" value={counts.total} />
        <Stat label="Pending" value={counts.pending} tone="amber" />
        <Stat label="Cleared" value={counts.cleared} tone="green" />
        <Stat label="Blocked" value={counts.blocked} tone="red" />
        <Stat label="Overridden" value={counts.overridden} tone="rose" />
      </div>

      {/* Required-checks summary strip */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Active gate requirements</h2>
          <span className="text-xs text-slate-500">
            {requirements.filter((r) => r.is_required).length} of {requirements.length} required
          </span>
        </CardHeader>
        <CardBody>
          {requirements.length === 0 ? (
            <p className="text-sm text-slate-500">No requirements configured yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {requirements.map((r) => (
                <Badge key={r.key} tone={r.is_required ? 'rose' : 'zinc'} title={r.description}>
                  {r.label}
                  {r.is_required ? ' • required' : ' • optional'}
                </Badge>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? 'bg-fuchsia-600 text-white'
                  : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sources..."
          className="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none sm:w-64"
        />
      </div>

      {/* Gate table */}
      {rows.length === 0 ? (
        <EmptyState
          title="No sources match this view"
          description={
            sources.length === 0
              ? 'Register data sources first, then run them through the clearance gate.'
              : 'Try a different status tab or clear the search.'
          }
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Source</Th>
              <Th>Gate status</Th>
              <Th>Unmet requirements</Th>
              <Th>Decision</Th>
              <Th>Certificate</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map(({ source, clearance, status }) => {
              const unmet = clearance?.unmet_requirements ?? []
              const certs = certsBySource.get(source.id) ?? []
              const isBusy = busyId === source.id
              return (
                <Tr key={source.id}>
                  <Td>
                    <div className="font-medium text-slate-100">{source.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-slate-500">
                      {source.source_type && <span>{source.source_type}</span>}
                      {source.collection && <span>· {source.collection}</span>}
                      {typeof source.risk_score === 'number' && (
                        <span>· risk {source.risk_score.toFixed(2)}</span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <Badge>{status}</Badge>
                    {clearance?.is_override && (
                      <Badge tone="purple" className="ml-1">
                        override
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    {Array.isArray(unmet) && unmet.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {unmet.map((u) => (
                          <Badge key={u} tone="amber">
                            {u}
                          </Badge>
                        ))}
                      </div>
                    ) : status === 'pending' && !clearance ? (
                      <span className="text-xs text-slate-600">not evaluated</span>
                    ) : (
                      <span className="text-xs text-emerald-400">all met</span>
                    )}
                  </Td>
                  <Td>
                    {clearance?.decided_at ? (
                      <div className="text-xs text-slate-400">
                        <div>{fmtDate(clearance.decided_at)}</div>
                        {clearance.approver_role && (
                          <div className="text-slate-500">by {clearance.approver_role}</div>
                        )}
                        {clearance.decision_rationale && (
                          <div className="mt-0.5 max-w-[16rem] truncate text-slate-500" title={clearance.decision_rationale}>
                            “{clearance.decision_rationale}”
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </Td>
                  <Td>
                    {certs.length > 0 ? (
                      <button
                        onClick={() => setCertView(certs[0])}
                        className="font-mono text-xs text-fuchsia-400 hover:underline"
                        title="View certificate"
                      >
                        {shortHash(certs[0].certificate_hash)}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-600">none</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        className="px-2.5 py-1.5 text-xs"
                        onClick={() => handleEvaluate(source.id)}
                        disabled={isBusy}
                      >
                        {isBusy ? '…' : 'Evaluate'}
                      </Button>
                      <Button
                        variant="secondary"
                        className="px-2.5 py-1.5 text-xs"
                        onClick={() => {
                          setApproveTarget(source)
                          setApproveRole('legal')
                          setApproveRationale('')
                          setApproveIssuedTo('')
                        }}
                        disabled={status === 'cleared'}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="danger"
                        className="px-2.5 py-1.5 text-xs"
                        onClick={() => {
                          setOverrideTarget(source)
                          setOverrideJustification('')
                        }}
                      >
                        Override
                      </Button>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      )}

      {/* Certificates ledger */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Issued certificates</h2>
          <span className="text-xs text-slate-500">{certificates.length} total</span>
        </CardHeader>
        <CardBody className="p-0">
          {certificates.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No certificates issued"
                description="Approving a source through the gate issues a hashed clearance certificate."
              />
            </div>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Source</Th>
                  <Th>Hash</Th>
                  <Th>Issued to</Th>
                  <Th>Issued by</Th>
                  <Th>Issued at</Th>
                  <Th className="text-right">View</Th>
                </Tr>
              </Thead>
              <Tbody>
                {certificates.map((c) => (
                  <Tr key={c.id}>
                    <Td>{sourceById.get(c.source_id)?.name ?? c.source_id}</Td>
                    <Td className="font-mono text-xs text-fuchsia-400">{shortHash(c.certificate_hash)}</Td>
                    <Td>{c.issued_to ?? '—'}</Td>
                    <Td>{c.issued_by ?? '—'}</Td>
                    <Td className="text-slate-500">{fmtDate(c.created_at)}</Td>
                    <Td className="text-right">
                      <Button
                        variant="ghost"
                        className="px-2.5 py-1.5 text-xs"
                        onClick={() => setCertView(c)}
                      >
                        Details
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Requirements editor modal */}
      <Modal
        open={reqOpen}
        onClose={() => setReqOpen(false)}
        title="Clearance requirements"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReqOpen(false)} disabled={reqSaving}>
              Cancel
            </Button>
            <Button onClick={saveRequirements} disabled={reqSaving}>
              {reqSaving ? <Spinner label="Saving..." /> : 'Save requirements'}
            </Button>
          </>
        }
      >
        {reqDraft.length === 0 ? (
          <p className="text-sm text-slate-500">No requirement definitions available.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">
              Toggle which checks a source must satisfy before the gate can clear it.
            </p>
            {reqDraft.map((r) => (
              <label
                key={r.key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5 hover:border-slate-700"
              >
                <input
                  type="checkbox"
                  checked={r.is_required}
                  onChange={() => toggleReqRequired(r.key)}
                  className="mt-0.5 h-4 w-4 accent-fuchsia-600"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-200">{r.label}</span>
                  {r.description && (
                    <span className="mt-0.5 block text-xs text-slate-500">{r.description}</span>
                  )}
                  <span className="mt-0.5 block font-mono text-[11px] text-slate-600">{r.key}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </Modal>

      {/* Approve modal */}
      <Modal
        open={approveTarget !== null}
        onClose={() => setApproveTarget(null)}
        title={approveTarget ? `Approve clearance — ${approveTarget.name}` : 'Approve clearance'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setApproveTarget(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitApprove} disabled={submitting}>
              {submitting ? <Spinner label="Approving..." /> : 'Approve & issue certificate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Sign-off marks the source <span className="text-emerald-400">cleared</span> and issues a
            hashed certificate recorded in the ledger.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Approver role
            </label>
            <select
              value={approveRole}
              onChange={(e) => setApproveRole(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
            >
              <option value="legal">legal</option>
              <option value="admin">admin</option>
              <option value="ml-lead">ml-lead</option>
              <option value="dataops">dataops</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Issued to (optional)
            </label>
            <input
              value={approveIssuedTo}
              onChange={(e) => setApproveIssuedTo(e.target.value)}
              placeholder="e.g. ML Platform Team"
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Decision rationale (optional)
            </label>
            <textarea
              value={approveRationale}
              onChange={(e) => setApproveRationale(e.target.value)}
              rows={3}
              placeholder="Why this source is cleared for training use…"
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Override modal */}
      <Modal
        open={overrideTarget !== null}
        onClose={() => setOverrideTarget(null)}
        title={overrideTarget ? `Override gate — ${overrideTarget.name}` : 'Override gate'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOverrideTarget(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={submitOverride} disabled={submitting}>
              {submitting ? <Spinner label="Recording..." /> : 'Record override'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            An admin override forces a decision against the gate result. The justification is logged
            to the immutable ledger.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Override justification <span className="text-fuchsia-400">*</span>
            </label>
            <textarea
              value={overrideJustification}
              onChange={(e) => setOverrideJustification(e.target.value)}
              rows={4}
              placeholder="Document the business/legal reason for overriding the gate…"
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Certificate detail modal */}
      <Modal
        open={certView !== null}
        onClose={() => setCertView(null)}
        title="Clearance certificate"
        footer={<Button variant="secondary" onClick={() => setCertView(null)}>Close</Button>}
      >
        {certView && (
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Source</div>
              <div className="text-slate-200">
                {sourceById.get(certView.source_id)?.name ?? certView.source_id}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Certificate hash</div>
              <div className="break-all font-mono text-xs text-fuchsia-400">
                {certView.certificate_hash}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Issued to</div>
                <div className="text-slate-200">{certView.issued_to ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Issued by</div>
                <div className="text-slate-200">{certView.issued_by ?? '—'}</div>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Issued at</div>
              <div className="text-slate-200">{fmtDate(certView.created_at)}</div>
            </div>
            {certView.payload && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Payload</div>
                <pre className="max-h-64 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
                  {JSON.stringify(certView.payload, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
