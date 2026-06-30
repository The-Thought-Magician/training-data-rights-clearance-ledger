'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

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

interface ClaimImpact {
  id: string
  claim_id: string
  model_version_id: string
  impact: string
  resolved?: boolean
  notes?: string | null
  created_at?: string
}

interface AffectedVersion {
  id: string
  model_id?: string
  version?: string
  base_model?: string | null
  release_status?: string
  proportion?: number | null
}

interface ClaimDetail {
  claim: Claim
  impacts: ClaimImpact[]
  affectedVersions: AffectedVersion[]
}

const STATUSES = [
  'received',
  'investigating',
  'valid',
  'invalid',
  'remediating',
  'resolved',
  'escalated',
] as const
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const IMPACTS = ['none', 'review', 'retrain', 'quarantine', 're-release'] as const

const severityTone: Record<string, 'zinc' | 'blue' | 'amber' | 'red'> = {
  low: 'zinc',
  medium: 'blue',
  high: 'amber',
  critical: 'red',
}

const impactTone: Record<string, 'zinc' | 'amber' | 'red' | 'rose' | 'green'> = {
  none: 'zinc',
  review: 'amber',
  retrain: 'rose',
  quarantine: 'red',
  're-release': 'green',
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function ClaimDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [detail, setDetail] = useState<ClaimDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [savingMeta, setSavingMeta] = useState(false)

  // editable claim metadata
  const [status, setStatus] = useState('received')
  const [severity, setSeverity] = useState('medium')
  const [legalHold, setLegalHold] = useState(false)
  const [resolution, setResolution] = useState('')

  // add-impact modal
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ model_version_id: '', impact: 'review', notes: '' })
  const [addSubmitting, setAddSubmitting] = useState(false)

  // edit-impact modal
  const [editImpact, setEditImpact] = useState<ClaimImpact | null>(null)
  const [editForm, setEditForm] = useState({ impact: 'review', resolved: false, notes: '' })
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const d: ClaimDetail = await api.getClaim(id)
      setDetail(d)
      setStatus(d.claim.status)
      setSeverity(d.claim.severity)
      setLegalHold(Boolean(d.claim.legal_hold))
      setResolution(d.claim.resolution ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load claim')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const flash = (m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg(null), 3500)
  }

  const impacts = detail?.impacts ?? []
  const versions = detail?.affectedVersions ?? []

  const versionLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const v of versions) m.set(v.id, v.version ? `v${v.version}` : v.id)
    return m
  }, [versions])

  // Model versions affected by lineage but without an explicit impact row yet.
  const unassessed = useMemo(() => {
    const have = new Set(impacts.map((i) => i.model_version_id))
    return versions.filter((v) => !have.has(v.id))
  }, [impacts, versions])

  const impactCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const i of impacts) c[i.impact] = (c[i.impact] ?? 0) + 1
    return c
  }, [impacts])

  const resolvedCount = impacts.filter((i) => i.resolved).length

  const saveMeta = async () => {
    if (!id) return
    setSavingMeta(true)
    setError(null)
    try {
      const updated: Claim = await api.updateClaim(id, {
        status,
        severity,
        legal_hold: legalHold,
        resolution: resolution || undefined,
      })
      setDetail((d) => (d ? { ...d, claim: { ...d.claim, ...updated } } : d))
      flash('Claim updated')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update claim')
    } finally {
      setSavingMeta(false)
    }
  }

  const submitAddImpact = async () => {
    if (!id || !addForm.model_version_id) {
      setError('Select a model version')
      return
    }
    setAddSubmitting(true)
    setError(null)
    try {
      await api.addClaimImpact(id, {
        model_version_id: addForm.model_version_id,
        impact: addForm.impact,
        notes: addForm.notes || undefined,
      })
      setAddOpen(false)
      setAddForm({ model_version_id: '', impact: 'review', notes: '' })
      flash('Impact recorded')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add impact')
    } finally {
      setAddSubmitting(false)
    }
  }

  const openEdit = (i: ClaimImpact) => {
    setEditImpact(i)
    setEditForm({ impact: i.impact, resolved: Boolean(i.resolved), notes: i.notes ?? '' })
  }

  const submitEditImpact = async () => {
    if (!id || !editImpact) return
    setEditSubmitting(true)
    setError(null)
    try {
      await api.updateClaimImpact(id, editImpact.id, {
        impact: editForm.impact,
        resolved: editForm.resolved,
        notes: editForm.notes || undefined,
      })
      setEditImpact(null)
      flash('Impact updated')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update impact')
    } finally {
      setEditSubmitting(false)
    }
  }

  const toggleResolved = async (i: ClaimImpact) => {
    if (!id) return
    setRowBusy(i.id)
    setError(null)
    try {
      await api.updateClaimImpact(id, i.id, {
        impact: i.impact,
        resolved: !i.resolved,
        notes: i.notes ?? undefined,
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle impact')
    } finally {
      setRowBusy(null)
    }
  }

  if (loading) return <PageSpinner label="Loading claim..." />

  if (error && !detail) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/claims" className="text-sm text-rose-400 hover:underline">
          ← Back to claims
        </Link>
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/claims" className="text-sm text-rose-400 hover:underline">
          ← Back to claims
        </Link>
        <EmptyState title="Claim not found" />
      </div>
    )
  }

  const { claim } = detail

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => router.push('/dashboard/claims')}
          className="text-sm text-rose-400 hover:underline"
        >
          ← Back to claims
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-zinc-100">{claim.claimant}</h1>
            <Badge tone={severityTone[claim.severity] ?? 'zinc'}>{claim.severity}</Badge>
            <Badge>{claim.claim_type}</Badge>
            <Badge>{claim.status}</Badge>
            {claim.legal_hold && <Badge tone="rose">legal hold</Badge>}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Filed {fmtDate(claim.created_at)}
            {claim.response_deadline && <> · deadline {fmtDate(claim.response_deadline)}</>}
          </p>
        </div>
      </div>

      {msg && (
        <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300">
          {msg}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* impact summary stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Affected versions" value={versions.length} />
        <Stat label="Impact rows" value={impacts.length} />
        <Stat
          label="Resolved"
          value={`${resolvedCount}/${impacts.length}`}
          tone={impacts.length > 0 && resolvedCount === impacts.length ? 'green' : 'amber'}
        />
        <Stat label="Unassessed" value={unassessed.length} tone={unassessed.length ? 'rose' : 'default'} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: claim details + editable triage */}
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-zinc-200">Claim details</h2>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Description</div>
                <div className="mt-0.5 whitespace-pre-wrap text-zinc-300">
                  {claim.description || '—'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Source</div>
                  <div className="text-zinc-300">
                    {claim.source_id ? (
                      <Link
                        href={`/dashboard/sources/${claim.source_id}`}
                        className="text-rose-400 hover:underline"
                      >
                        view source
                      </Link>
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Resolved at</div>
                  <div className="text-zinc-300">{fmtDate(claim.resolved_at)}</div>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-zinc-200">Triage</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Severity
                </label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={legalHold}
                  onChange={(e) => setLegalHold(e.target.checked)}
                  className="h-4 w-4 accent-rose-600"
                />
                Legal hold
              </label>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Resolution
                </label>
                <textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  rows={3}
                  placeholder="How this claim was resolved…"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none"
                />
              </div>
              <Button onClick={saveMeta} disabled={savingMeta} className="w-full">
                {savingMeta ? <Spinner label="Saving..." /> : 'Save changes'}
              </Button>
            </CardBody>
          </Card>
        </div>

        {/* Right: impact assessment */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-200">Impact assessment</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Remediation action per affected model version.
                </p>
              </div>
              <Button onClick={() => setAddOpen(true)}>Add impact</Button>
            </CardHeader>
            <CardBody className="space-y-3">
              {/* impact distribution bar */}
              {impacts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {IMPACTS.map((k) =>
                    impactCounts[k] ? (
                      <Badge key={k} tone={impactTone[k]}>
                        {k}: {impactCounts[k]}
                      </Badge>
                    ) : null,
                  )}
                </div>
              )}

              {impacts.length === 0 ? (
                <EmptyState
                  title="No impact rows"
                  description="Add an impact to assess how this claim affects a model version, or add one for an unassessed version below."
                />
              ) : (
                <div className="w-full overflow-x-auto rounded-xl border border-zinc-800">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Model version</th>
                        <th className="px-4 py-3 font-medium">Impact</th>
                        <th className="px-4 py-3 font-medium">Notes</th>
                        <th className="px-4 py-3 font-medium">Resolved</th>
                        <th className="px-4 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {impacts.map((i) => (
                        <tr key={i.id} className="hover:bg-zinc-900/40">
                          <td className="px-4 py-3">
                            <span className="font-medium text-zinc-100">
                              {versionLabel.get(i.model_version_id) ?? i.model_version_id}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={impactTone[i.impact] ?? 'zinc'}>{i.impact}</Badge>
                          </td>
                          <td className="px-4 py-3 text-zinc-400">
                            <span className="block max-w-xs truncate" title={i.notes ?? ''}>
                              {i.notes || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {i.resolved ? (
                              <Badge tone="green">resolved</Badge>
                            ) : (
                              <Badge tone="amber">open</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                variant="ghost"
                                className="px-2.5 py-1.5 text-xs"
                                onClick={() => toggleResolved(i)}
                                disabled={rowBusy === i.id}
                              >
                                {rowBusy === i.id
                                  ? '…'
                                  : i.resolved
                                    ? 'Reopen'
                                    : 'Mark resolved'}
                              </Button>
                              <Button
                                variant="secondary"
                                className="px-2.5 py-1.5 text-xs"
                                onClick={() => openEdit(i)}
                              >
                                Edit
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Affected model versions via lineage */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-zinc-200">Affected model versions</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Versions trained on the claimed source (via lineage).
              </p>
            </CardHeader>
            <CardBody>
              {versions.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No model versions are linked to this claim&apos;s source.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {versions.map((v) => {
                    const hasImpact = impacts.some((i) => i.model_version_id === v.id)
                    return (
                      <div
                        key={v.id}
                        className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                      >
                        <div>
                          <Link
                            href={`/dashboard/models/${v.id}`}
                            className="text-sm font-medium text-rose-400 hover:underline"
                          >
                            {v.version ? `v${v.version}` : v.id}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
                            {v.release_status && <Badge>{v.release_status}</Badge>}
                            {typeof v.proportion === 'number' && (
                              <span>{(v.proportion * 100).toFixed(0)}% of mix</span>
                            )}
                          </div>
                        </div>
                        {hasImpact ? (
                          <Badge tone="green">assessed</Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            className="px-2.5 py-1.5 text-xs"
                            onClick={() => {
                              setAddForm({ model_version_id: v.id, impact: 'review', notes: '' })
                              setAddOpen(true)
                            }}
                          >
                            Assess
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Add impact modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add impact assessment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addSubmitting}>
              Cancel
            </Button>
            <Button onClick={submitAddImpact} disabled={addSubmitting}>
              {addSubmitting ? <Spinner label="Saving..." /> : 'Add impact'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Model version <span className="text-rose-400">*</span>
            </label>
            <select
              value={addForm.model_version_id}
              onChange={(e) => setAddForm((f) => ({ ...f, model_version_id: e.target.value }))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
            >
              <option value="">Select a version…</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.version ? `v${v.version}` : v.id}
                  {impacts.some((i) => i.model_version_id === v.id) ? ' (already assessed)' : ''}
                </option>
              ))}
            </select>
            {versions.length === 0 && (
              <p className="mt-1 text-xs text-amber-400">
                No affected versions found; impacts can still be added once lineage is recorded.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Remediation impact
            </label>
            <select
              value={addForm.impact}
              onChange={(e) => setAddForm((f) => ({ ...f, impact: e.target.value }))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
            >
              {IMPACTS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Notes
            </label>
            <textarea
              value={addForm.notes}
              onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              placeholder="Remediation plan / rationale…"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Edit impact modal */}
      <Modal
        open={editImpact !== null}
        onClose={() => setEditImpact(null)}
        title={
          editImpact
            ? `Edit impact — ${versionLabel.get(editImpact.model_version_id) ?? editImpact.model_version_id}`
            : 'Edit impact'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditImpact(null)} disabled={editSubmitting}>
              Cancel
            </Button>
            <Button onClick={submitEditImpact} disabled={editSubmitting}>
              {editSubmitting ? <Spinner label="Saving..." /> : 'Save impact'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Remediation impact
            </label>
            <select
              value={editForm.impact}
              onChange={(e) => setEditForm((f) => ({ ...f, impact: e.target.value }))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
            >
              {IMPACTS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={editForm.resolved}
              onChange={(e) => setEditForm((f) => ({ ...f, resolved: e.target.checked }))}
              className="h-4 w-4 accent-rose-600"
            />
            Mark this impact resolved
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Notes
            </label>
            <textarea
              value={editForm.notes}
              onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
