'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'

interface ModelVersion {
  id: string
  model_id: string
  version: string
  base_model?: string | null
  training_type?: string | null
  training_date?: string | null
  manifest_hash?: string | null
  release_status: string
  released_at?: string | null
  released_by?: string | null
  created_at?: string
}

interface LineageBinding {
  id: string
  model_version_id: string
  source_id: string
  proportion?: number | null
  preprocessing?: string | null
  created_at?: string
}

interface DataSource {
  id: string
  name: string
  status?: string
  risk_score?: number | null
  modality?: string | null
  source_type?: string | null
}

interface Readiness {
  ready: boolean
  blockers: Array<string | { message?: string; detail?: string; source_id?: string; reason?: string }>
}

interface LedgerEntry {
  id: string
  seq?: number
  action: string
  entity_type?: string
  entity_id?: string
  actor_id?: string | null
  entry_hash?: string
  prev_hash?: string | null
  created_at?: string
  payload?: any
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleString()
}

function blockerText(b: any): string {
  if (typeof b === 'string') return b
  return b?.message || b?.detail || b?.reason || JSON.stringify(b)
}

export default function ModelVersionPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id

  const [version, setVersion] = useState<ModelVersion | null>(null)
  const [bindings, setBindings] = useState<LineageBinding[]>([])
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [sources, setSources] = useState<DataSource[]>([])
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [bindOpen, setBindOpen] = useState(false)
  const [bindSourceId, setBindSourceId] = useState('')
  const [bindProportion, setBindProportion] = useState('')
  const [bindPreprocessing, setBindPreprocessing] = useState('')
  const [bindSaving, setBindSaving] = useState(false)
  const [bindError, setBindError] = useState<string | null>(null)

  const [unbinding, setUnbinding] = useState<string | null>(null)

  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releaseNote, setReleaseNote] = useState('')
  const [releaseForce, setReleaseForce] = useState(false)
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)

  const sourceById = useMemo(() => {
    const m: Record<string, DataSource> = {}
    for (const s of sources) m[s.id] = s
    return m
  }, [sources])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [v, r, lin, src] = await Promise.all([
        api.getModelVersion(id),
        api.getReadiness(id),
        api.listLineage({ model_version_id: id }),
        api.listSources(),
      ])
      const ver: ModelVersion = v?.version ?? v
      setVersion(ver)
      setReadiness({ ready: !!r?.ready, blockers: Array.isArray(r?.blockers) ? r.blockers : [] })
      // listLineage may already be scoped; fall back to bindings on the version payload.
      const lb: LineageBinding[] = Array.isArray(lin) ? lin : Array.isArray(v?.bindings) ? v.bindings : []
      setBindings(lb.filter((b) => !b.model_version_id || b.model_version_id === id))
      setSources(Array.isArray(src) ? src : [])
      try {
        const led = await api.getEntityLedger('model_version', id)
        setLedger(Array.isArray(led) ? led : [])
      } catch {
        setLedger([])
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load model version')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const boundSourceIds = useMemo(() => new Set(bindings.map((b) => b.source_id)), [bindings])
  const availableSources = useMemo(() => sources.filter((s) => !boundSourceIds.has(s.id)), [sources, boundSourceIds])

  const proportionTotal = useMemo(
    () => bindings.reduce((acc, b) => acc + (Number(b.proportion) || 0), 0),
    [bindings]
  )

  const blockedSources = useMemo(
    () => bindings.filter((b) => sourceById[b.source_id]?.status === 'blocked').length,
    [bindings, sourceById]
  )

  async function submitBind(e: React.FormEvent) {
    e.preventDefault()
    if (!bindSourceId) { setBindError('Select a source'); return }
    setBindSaving(true)
    setBindError(null)
    const prop = bindProportion.trim() === '' ? null : Number(bindProportion)
    try {
      await api.createLineageBinding({
        model_version_id: id,
        source_id: bindSourceId,
        proportion: prop != null && !isNaN(prop) ? prop : null,
        preprocessing: bindPreprocessing.trim() || null,
      })
      setBindOpen(false)
      setBindSourceId('')
      setBindProportion('')
      setBindPreprocessing('')
      await load()
    } catch (e: any) {
      setBindError(e?.message || 'Bind failed')
    } finally {
      setBindSaving(false)
    }
  }

  async function unbind(bindingId: string) {
    setUnbinding(bindingId)
    try {
      await api.deleteLineageBinding(bindingId)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Unbind failed')
    } finally {
      setUnbinding(null)
    }
  }

  async function submitRelease(e: React.FormEvent) {
    e.preventDefault()
    setReleaseBusy(true)
    setReleaseError(null)
    try {
      await api.releaseModelVersion(id, {
        note: releaseNote.trim() || null,
        force: releaseForce,
      })
      setReleaseOpen(false)
      setReleaseNote('')
      setReleaseForce(false)
      await load()
    } catch (e: any) {
      setReleaseError(e?.message || 'Release failed')
    } finally {
      setReleaseBusy(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-rose-500 focus:outline-none'

  if (loading) return <PageSpinner label="Loading model version..." />

  if (error || !version) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/models" className="text-sm text-rose-400 hover:underline">← Back to models</Link>
        <Card><CardBody>
          <div className="text-sm text-red-400">{error || 'Model version not found.'}</div>
          <Button variant="secondary" className="mt-3" onClick={load}>Retry</Button>
        </CardBody></Card>
      </div>
    )
  }

  const released = version.release_status === 'released'

  return (
    <div className="space-y-6">
      <div>
        <button onClick={() => router.push('/dashboard/models')} className="text-sm text-rose-400 hover:underline">← Back to models</button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-zinc-100">Version {version.version}</h1>
            <Badge>{version.release_status}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-500">
            <span>Base: <span className="text-zinc-300">{version.base_model || '—'}</span></span>
            <span>Training: <span className="text-zinc-300">{version.training_type || '—'}</span></span>
            <span>Trained: <span className="text-zinc-300">{fmtDate(version.training_date)}</span></span>
          </div>
          {version.manifest_hash && (
            <div className="mt-1 font-mono text-xs text-zinc-600">manifest: {version.manifest_hash}</div>
          )}
        </div>
        <Button onClick={() => { setReleaseError(null); setReleaseNote(''); setReleaseForce(false); setReleaseOpen(true) }} disabled={released}>
          {released ? 'Released' : 'Release version'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Bound sources" value={bindings.length} tone="rose" />
        <Stat label="Proportion total" value={`${(proportionTotal * (proportionTotal <= 1 ? 100 : 1)).toFixed(proportionTotal <= 1 ? 0 : 1)}%`} hint={proportionTotal <= 1 ? 'fractions sum' : 'raw sum'} />
        <Stat label="Blocked sources" value={blockedSources} tone={blockedSources > 0 ? 'red' : 'green'} />
        <Stat label="Readiness" value={readiness?.ready ? 'Ready' : 'Blocked'} tone={readiness?.ready ? 'green' : 'amber'} />
      </div>

      {/* Release readiness */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Release readiness</h2>
          <Badge tone={readiness?.ready ? 'green' : 'amber'}>{readiness?.ready ? 'Ready to release' : `${readiness?.blockers.length || 0} blocker(s)`}</Badge>
        </CardHeader>
        <CardBody>
          {readiness?.ready ? (
            <p className="text-sm text-emerald-400">All bound sources are cleared. This version is ready for sign-off.</p>
          ) : (readiness?.blockers.length || 0) === 0 ? (
            <p className="text-sm text-zinc-500">No readiness data available.</p>
          ) : (
            <ul className="space-y-2">
              {readiness!.blockers.map((b, i) => {
                const obj = typeof b === 'object' ? b : null
                const linkedSource = obj?.source_id ? sourceById[obj.source_id] : null
                return (
                  <li key={i} className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm">
                    <span className="mt-0.5 text-amber-400">⚠</span>
                    <div>
                      <span className="text-amber-200">{blockerText(b)}</span>
                      {linkedSource && (
                        <Link href={`/dashboard/sources/${linkedSource.id}`} className="ml-2 text-rose-400 hover:underline">
                          {linkedSource.name}
                        </Link>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Lineage editor */}
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Data lineage</h2>
            <p className="text-xs text-zinc-500">Sources bound to this version. Each binding is part of the manifest.</p>
          </div>
          <Button variant="secondary" className="px-3 py-1.5" onClick={() => { setBindError(null); setBindSourceId(''); setBindProportion(''); setBindPreprocessing(''); setBindOpen(true) }} disabled={availableSources.length === 0}>
            + Bind source
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {bindings.length === 0 ? (
            <EmptyState
              className="m-5"
              icon="🔗"
              title="No sources bound"
              description="Bind training data sources to build this version's lineage and unlock release readiness."
              action={<Button onClick={() => setBindOpen(true)} disabled={availableSources.length === 0}>+ Bind source</Button>}
            />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Source</Th>
                  <Th>Status</Th>
                  <Th>Risk</Th>
                  <Th>Proportion</Th>
                  <Th>Preprocessing</Th>
                  <Th className="text-right">Action</Th>
                </Tr>
              </Thead>
              <Tbody>
                {bindings.map((b) => {
                  const s = sourceById[b.source_id]
                  return (
                    <Tr key={b.id}>
                      <Td className="font-medium text-zinc-100">
                        {s ? (
                          <Link href={`/dashboard/sources/${s.id}`} className="hover:text-rose-400">{s.name}</Link>
                        ) : (
                          <span className="font-mono text-xs text-zinc-500">{b.source_id}</span>
                        )}
                      </Td>
                      <Td>{s?.status ? <Badge>{s.status}</Badge> : '—'}</Td>
                      <Td>{s?.risk_score != null ? Number(s.risk_score).toFixed(1) : '—'}</Td>
                      <Td>{b.proportion != null ? `${(Number(b.proportion) * (Number(b.proportion) <= 1 ? 100 : 1)).toFixed(Number(b.proportion) <= 1 ? 0 : 1)}%` : '—'}</Td>
                      <Td className="max-w-[14rem] truncate text-zinc-400">{b.preprocessing || '—'}</Td>
                      <Td className="text-right">
                        <Button variant="ghost" className="px-2 py-1 text-red-400" onClick={() => unbind(b.id)} disabled={unbinding === b.id || released}>
                          {unbinding === b.id ? <Spinner /> : 'Unbind'}
                        </Button>
                      </Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Ledger */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-200">Ledger trail</h2>
          <p className="text-xs text-zinc-500">Tamper-evident entries recorded for this model version.</p>
        </CardHeader>
        <CardBody className="p-0">
          {ledger.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-zinc-500">No ledger entries yet for this version.</div>
          ) : (
            <ol className="divide-y divide-zinc-800">
              {ledger
                .slice()
                .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
                .map((e) => (
                  <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[10px] tabular-nums text-zinc-500">
                      {e.seq ?? '•'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge tone="purple">{e.action}</Badge>
                        <span className="text-xs text-zinc-500">{fmtDate(e.created_at)}</span>
                      </div>
                      {e.entry_hash && <div className="mt-1 truncate font-mono text-[11px] text-zinc-600">{e.entry_hash}</div>}
                    </div>
                  </li>
                ))}
            </ol>
          )}
        </CardBody>
      </Card>

      {/* Bind modal */}
      <Modal
        open={bindOpen}
        onClose={() => !bindSaving && setBindOpen(false)}
        title="Bind data source"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBindOpen(false)} disabled={bindSaving}>Cancel</Button>
            <Button onClick={submitBind} disabled={bindSaving}>{bindSaving ? <Spinner /> : 'Bind'}</Button>
          </>
        }
      >
        <form onSubmit={submitBind} className="space-y-4">
          {bindError && <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{bindError}</div>}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Source *</label>
            <select className={inputCls} value={bindSourceId} onChange={(e) => setBindSourceId(e.target.value)}>
              <option value="">Select a source…</option>
              {availableSources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.status ? ` (${s.status})` : ''}</option>
              ))}
            </select>
            {availableSources.length === 0 && <p className="mt-1 text-xs text-zinc-500">All sources are already bound.</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Proportion (0–1 fraction, optional)</label>
            <input className={inputCls} type="number" step="0.01" min="0" value={bindProportion} onChange={(e) => setBindProportion(e.target.value)} placeholder="0.25" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Preprocessing notes</label>
            <textarea className={inputCls} rows={2} value={bindPreprocessing} onChange={(e) => setBindPreprocessing(e.target.value)} placeholder="dedup, NSFW filter, tokenized" />
          </div>
        </form>
      </Modal>

      {/* Release modal */}
      <Modal
        open={releaseOpen}
        onClose={() => !releaseBusy && setReleaseOpen(false)}
        title="Release version"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReleaseOpen(false)} disabled={releaseBusy}>Cancel</Button>
            <Button onClick={submitRelease} disabled={releaseBusy}>{releaseBusy ? <Spinner /> : 'Sign off release'}</Button>
          </>
        }
      >
        <form onSubmit={submitRelease} className="space-y-4">
          {releaseError && <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{releaseError}</div>}
          {!readiness?.ready && (
            <div className="rounded-md border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
              This version has {readiness?.blockers.length || 0} unresolved blocker(s). Releasing now requires an override.
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Release note</label>
            <textarea className={inputCls} rows={3} value={releaseNote} onChange={(e) => setReleaseNote(e.target.value)} placeholder="Sign-off rationale, scope of release..." />
          </div>
          {!readiness?.ready && (
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={releaseForce} onChange={(e) => setReleaseForce(e.target.checked)} className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-rose-600 focus:ring-rose-500" />
              Override blockers and release anyway
            </label>
          )}
        </form>
      </Modal>
    </div>
  )
}
