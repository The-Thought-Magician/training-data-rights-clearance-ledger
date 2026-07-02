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
  status?: string
}

interface Policy {
  id: string
  name: string
  description?: string | null
  conditions?: Record<string, unknown> | PolicyCondition[] | null
  action: string
  severity?: string | null
  is_active: boolean
  version?: number
  created_by?: string
  created_at?: string
}

interface PolicyCondition {
  field: string
  op: string
  value: string
}

interface PolicyViolation {
  id: string
  policy_id: string
  source_id: string
  detail?: string | null
  resolved: boolean
  detected_at?: string | null
  created_at?: string
}

const ACTIONS = ['block', 'flag', 'require-review'] as const
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const FIELDS = [
  'status',
  'source_type',
  'modality',
  'risk_score',
  'vendor',
  'acquisition_method',
  'collection',
] as const
const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'] as const

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function actionTone(action: string): 'red' | 'amber' | 'blue' | 'zinc' {
  if (action === 'block') return 'red'
  if (action === 'flag') return 'amber'
  if (action === 'require-review') return 'blue'
  return 'zinc'
}

function severityTone(sev?: string | null): 'red' | 'amber' | 'blue' | 'zinc' {
  if (sev === 'critical' || sev === 'high') return 'red'
  if (sev === 'medium') return 'amber'
  if (sev === 'low') return 'blue'
  return 'zinc'
}

// Conditions may come back as an array of {field,op,value} or an object map.
function normalizeConditions(c: Policy['conditions']): PolicyCondition[] {
  if (!c) return []
  if (Array.isArray(c)) return c as PolicyCondition[]
  if (typeof c === 'object') {
    return Object.entries(c as Record<string, unknown>).map(([field, value]) => ({
      field,
      op: 'eq',
      value: String(value),
    }))
  }
  return []
}

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [violations, setViolations] = useState<PolicyViolation[]>([])
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const [view, setView] = useState<'policies' | 'violations'>('policies')
  const [violationFilter, setViolationFilter] = useState<'all' | 'open' | 'resolved'>('all')
  const [search, setSearch] = useState('')

  // editor
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Policy | null>(null)
  const [eName, setEName] = useState('')
  const [eDescription, setEDescription] = useState('')
  const [eAction, setEAction] = useState<string>('flag')
  const [eSeverity, setESeverity] = useState<string>('medium')
  const [eActive, setEActive] = useState(true)
  const [eConditions, setEConditions] = useState<PolicyCondition[]>([
    { field: 'status', op: 'eq', value: '' },
  ])
  const [saving, setSaving] = useState(false)

  // evaluate
  const [evalOpen, setEvalOpen] = useState(false)
  const [evalSourceId, setEvalSourceId] = useState('')
  const [evaluating, setEvaluating] = useState(false)
  const [busyDelete, setBusyDelete] = useState<string | null>(null)
  const [busyToggle, setBusyToggle] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pol, vio, src] = await Promise.all([
        api.listPolicies(),
        api.listPolicyViolations(),
        api.listSources(),
      ])
      setPolicies(Array.isArray(pol) ? pol : [])
      setViolations(Array.isArray(vio) ? vio : [])
      setSources(Array.isArray(src) ? src : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load policies')
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

  const sourceById = useMemo(() => {
    const m = new Map<string, DataSource>()
    for (const s of sources) m.set(s.id, s)
    return m
  }, [sources])

  const policyById = useMemo(() => {
    const m = new Map<string, Policy>()
    for (const p of policies) m.set(p.id, p)
    return m
  }, [policies])

  const counts = useMemo(() => {
    return {
      total: policies.length,
      active: policies.filter((p) => p.is_active).length,
      open: violations.filter((v) => !v.resolved).length,
      resolved: violations.filter((v) => v.resolved).length,
    }
  }, [policies, violations])

  const filteredPolicies = useMemo(() => {
    const q = search.trim().toLowerCase()
    return policies.filter((p) =>
      q ? p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q) : true,
    )
  }, [policies, search])

  const filteredViolations = useMemo(() => {
    return violations
      .filter((v) =>
        violationFilter === 'all'
          ? true
          : violationFilter === 'open'
            ? !v.resolved
            : v.resolved,
      )
      .sort((a, b) => (b.detected_at ?? '').localeCompare(a.detected_at ?? ''))
  }, [violations, violationFilter])

  const openCreate = () => {
    setEditing(null)
    setEName('')
    setEDescription('')
    setEAction('flag')
    setESeverity('medium')
    setEActive(true)
    setEConditions([{ field: 'status', op: 'eq', value: '' }])
    setEditorOpen(true)
  }

  const openEdit = (p: Policy) => {
    setEditing(p)
    setEName(p.name)
    setEDescription(p.description ?? '')
    setEAction(p.action)
    setESeverity(p.severity ?? 'medium')
    setEActive(p.is_active)
    const conds = normalizeConditions(p.conditions)
    setEConditions(conds.length > 0 ? conds : [{ field: 'status', op: 'eq', value: '' }])
    setEditorOpen(true)
  }

  const addCond = () => setEConditions((c) => [...c, { field: 'status', op: 'eq', value: '' }])
  const removeCond = (i: number) => setEConditions((c) => c.filter((_, idx) => idx !== i))
  const updateCond = (i: number, patch: Partial<PolicyCondition>) =>
    setEConditions((c) => c.map((cd, idx) => (idx === i ? { ...cd, ...patch } : cd)))

  const submitEditor = async () => {
    if (!eName.trim()) {
      setError('Policy name is required')
      return
    }
    setSaving(true)
    setError(null)
    const body = {
      name: eName.trim(),
      description: eDescription || undefined,
      action: eAction,
      severity: eSeverity,
      is_active: eActive,
      conditions: eConditions.filter((c) => c.field && c.value !== ''),
    }
    try {
      if (editing) {
        await api.updatePolicy(editing.id, body)
        flash('Policy updated')
      } else {
        await api.createPolicy(body)
        flash('Policy created')
      }
      setEditorOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save policy')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (p: Policy) => {
    setBusyToggle(p.id)
    setError(null)
    try {
      await api.updatePolicy(p.id, { is_active: !p.is_active })
      flash(p.is_active ? 'Policy deactivated' : 'Policy activated')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle policy')
    } finally {
      setBusyToggle(null)
    }
  }

  const deletePolicy = async (p: Policy) => {
    if (!window.confirm(`Delete policy "${p.name}"? This cannot be undone.`)) return
    setBusyDelete(p.id)
    setError(null)
    try {
      await api.deletePolicy(p.id)
      flash('Policy deleted')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete policy')
    } finally {
      setBusyDelete(null)
    }
  }

  const submitEvaluate = async () => {
    if (!evalSourceId) {
      setError('Select a source to evaluate')
      return
    }
    setEvaluating(true)
    setError(null)
    try {
      const res = await api.evaluatePolicies(evalSourceId)
      const v = res && Array.isArray(res.violations) ? res.violations.length : 0
      flash(v > 0 ? `Evaluation found ${v} violation${v === 1 ? '' : 's'}` : 'Evaluation passed — no violations')
      setEvalOpen(false)
      setView('violations')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluation failed')
    } finally {
      setEvaluating(false)
    }
  }

  if (loading) return <PageSpinner label="Loading policy engine..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Policy Engine</h1>
          <p className="mt-1 text-sm text-slate-500">
            Author rules that evaluate data sources against governance conditions. Active policies
            flag, require review, or block sources and record violations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { setEvalSourceId(''); setEvalOpen(true) }}>
            Evaluate a source
          </Button>
          <Button onClick={openCreate}>New policy</Button>
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Policies" value={counts.total} />
        <Stat label="Active" value={counts.active} tone="green" />
        <Stat label="Open violations" value={counts.open} tone="red" />
        <Stat label="Resolved violations" value={counts.resolved} tone="rose" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5">
          <button
            onClick={() => setView('policies')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              view === 'policies' ? 'bg-fuchsia-600 text-white' : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            Policies ({counts.total})
          </button>
          <button
            onClick={() => setView('violations')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              view === 'violations' ? 'bg-fuchsia-600 text-white' : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            Violations ({counts.open})
          </button>
        </div>
        {view === 'policies' && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search policies..."
            className="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none sm:w-64"
          />
        )}
        {view === 'violations' && (
          <div className="flex gap-1.5">
            {(['all', 'open', 'resolved'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setViolationFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  violationFilter === f ? 'bg-slate-700 text-white' : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === 'policies' ? (
        filteredPolicies.length === 0 ? (
          <EmptyState
            title="No policies yet"
            description="Define governance rules that automatically flag or block non-compliant data sources."
            action={<Button onClick={openCreate}>New policy</Button>}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filteredPolicies.map((p) => {
              const conds = normalizeConditions(p.conditions)
              const openVios = violations.filter((v) => v.policy_id === p.id && !v.resolved).length
              return (
                <Card key={p.id}>
                  <CardHeader className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-100">{p.name}</h3>
                        <Badge tone={actionTone(p.action)}>{p.action}</Badge>
                        {p.severity && <Badge tone={severityTone(p.severity)}>{p.severity}</Badge>}
                        <Badge tone={p.is_active ? 'green' : 'zinc'}>
                          {p.is_active ? 'active' : 'inactive'}
                        </Badge>
                      </div>
                      {p.description && <p className="mt-1 text-xs text-slate-500">{p.description}</p>}
                    </div>
                  </CardHeader>
                  <CardBody className="space-y-3">
                    <div>
                      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                        Conditions
                      </div>
                      {conds.length === 0 ? (
                        <span className="text-xs text-slate-600">No conditions</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {conds.map((c, i) => (
                            <span
                              key={i}
                              className="rounded-md border border-slate-800 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-slate-400"
                            >
                              {c.field} {c.op} {String(c.value)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">
                        {openVios > 0 ? (
                          <span className="text-red-400">{openVios} open violation{openVios === 1 ? '' : 's'}</span>
                        ) : (
                          'no open violations'
                        )}
                        {typeof p.version === 'number' && <span> · v{p.version}</span>}
                      </span>
                      <div className="flex gap-1.5">
                        <Button
                          variant="ghost"
                          className="px-2.5 py-1.5 text-xs"
                          onClick={() => toggleActive(p)}
                          disabled={busyToggle === p.id}
                        >
                          {busyToggle === p.id ? '…' : p.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => openEdit(p)}>
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          className="px-2.5 py-1.5 text-xs"
                          onClick={() => deletePolicy(p)}
                          disabled={busyDelete === p.id}
                        >
                          {busyDelete === p.id ? '…' : 'Delete'}
                        </Button>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              )
            })}
          </div>
        )
      ) : filteredViolations.length === 0 ? (
        <EmptyState
          title="No violations"
          description="Evaluate sources against active policies to surface violations here."
          action={<Button onClick={() => { setEvalSourceId(''); setEvalOpen(true) }}>Evaluate a source</Button>}
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Policy</Th>
              <Th>Source</Th>
              <Th>Detail</Th>
              <Th>Status</Th>
              <Th>Detected</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filteredViolations.map((v) => {
              const pol = policyById.get(v.policy_id)
              return (
                <Tr key={v.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-100">{pol?.name ?? v.policy_id.slice(0, 8)}</span>
                      {pol && <Badge tone={actionTone(pol.action)}>{pol.action}</Badge>}
                    </div>
                  </Td>
                  <Td className="text-slate-300">{sourceById.get(v.source_id)?.name ?? v.source_id.slice(0, 8)}</Td>
                  <Td className="max-w-[24rem] text-xs text-slate-400">{v.detail ?? '—'}</Td>
                  <Td>
                    <Badge tone={v.resolved ? 'green' : 'red'}>{v.resolved ? 'resolved' : 'open'}</Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">{fmtDate(v.detected_at ?? v.created_at)}</Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      )}

      {/* Policy editor modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? `Edit policy — ${editing.name}` : 'New policy'}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitEditor} disabled={saving}>
              {saving ? <Spinner label="Saving..." /> : editing ? 'Save changes' : 'Create policy'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Name <span className="text-fuchsia-400">*</span>
            </label>
            <input
              value={eName}
              onChange={(e) => setEName(e.target.value)}
              placeholder="e.g. Block uncleared scraped sources"
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Description (optional)
            </label>
            <textarea
              value={eDescription}
              onChange={(e) => setEDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Action
              </label>
              <select
                value={eAction}
                onChange={(e) => setEAction(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Severity
              </label>
              <select
                value={eSeverity}
                onChange={(e) => setESeverity(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={eActive}
              onChange={(e) => setEActive(e.target.checked)}
              className="h-4 w-4 accent-fuchsia-600"
            />
            Active (evaluated against sources)
          </label>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Conditions (all must match)
              </label>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={addCond}>
                + Add condition
              </Button>
            </div>
            <div className="space-y-2">
              {eConditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={c.field}
                    onChange={(e) => updateCond(i, { field: e.target.value })}
                    className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
                  >
                    {FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <select
                    value={c.op}
                    onChange={(e) => updateCond(i, { op: e.target.value })}
                    className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
                  >
                    {OPS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <input
                    value={c.value}
                    onChange={(e) => updateCond(i, { value: e.target.value })}
                    placeholder="value"
                    className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
                  />
                  {eConditions.length > 1 && (
                    <button
                      onClick={() => removeCond(i)}
                      className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-800 hover:text-red-300"
                      aria-label="Remove condition"
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

      {/* Evaluate modal */}
      <Modal
        open={evalOpen}
        onClose={() => setEvalOpen(false)}
        title="Evaluate source against policies"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEvalOpen(false)} disabled={evaluating}>
              Cancel
            </Button>
            <Button onClick={submitEvaluate} disabled={evaluating}>
              {evaluating ? <Spinner label="Evaluating..." /> : 'Run evaluation'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Runs all active policies against the selected source and records any violations.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Source
            </label>
            {sources.length === 0 ? (
              <p className="text-sm text-slate-500">No sources available. Register a source first.</p>
            ) : (
              <select
                value={evalSourceId}
                onChange={(e) => setEvalSourceId(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
              >
                <option value="">Select a source…</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.status ? ` (${s.status})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
