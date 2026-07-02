'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'

/* ---------------- types ---------------- */

interface DataSource {
  id: string
  name: string
  description: string | null
  source_type: string | null
  modality: string | null
  origin_url: string | null
  vendor: string | null
  acquisition_method: string | null
  acquisition_date: string | null
  acquirer: string | null
  justification: string | null
  record_count: number | null
  size_bytes: number | null
  format: string | null
  tags: string[] | null
  collection: string | null
  status: string | null
  risk_score: number | null
  created_at: string
  updated_at: string | null
}

interface ProvenanceEvent {
  id: string
  event_type: string
  description: string | null
  related_source_id: string | null
  occurred_at: string | null
  recorded_by: string | null
  created_at: string
}

interface CustodyHandoff {
  id: string
  from_party: string | null
  to_party: string | null
  reason: string | null
  occurred_at: string | null
  recorded_by: string | null
  created_at: string
}

interface License {
  id: string
  license_name: string
  license_type: string | null
  permits_ai_training: boolean
  permits_commercial: boolean
  permits_derivatives: boolean
  requires_attribution: boolean
  share_alike: boolean
  expiry_date: string | null
  status: string | null
  conflict_flags: string[] | null
}

interface Screening {
  id: string
  status: string | null
  method: string | null
  reviewer: string | null
  notes: string | null
  risk_score?: number | null
  screened_at: string | null
}

interface Optout {
  id: string
  subject_identity: string | null
  optout_type: string | null
  scope: string | null
  channel: string | null
  honor_status: string | null
  received_at: string | null
}

interface PreferenceSignal {
  id: string
  signal_type: string
  directive: string | null
  captured_url: string | null
  snapshot_sha256: string | null
  captured_at: string | null
  recheck_due: string | null
}

interface LineageBinding {
  id: string
  model_version_id: string
  proportion: number | null
  preprocessing: string | null
  version?: string | null
  model_name?: string | null
}

interface RiskScore {
  license_risk: number | null
  copyright_risk: number | null
  pii_risk: number | null
  optout_risk: number | null
  composite_risk: number | null
  computed_at: string | null
}

interface Clearance {
  id?: string
  status: string | null
  unmet_requirements?: string[] | null
  decision_rationale?: string | null
  decided_at?: string | null
}

interface FullSource {
  source: DataSource
  license: License | null
  copyright: Screening | null
  pii: Screening | null
  optouts: Optout[]
  signals: PreferenceSignal[]
  clearance: Clearance | null
  lineage: LineageBinding[]
  risk: RiskScore | null
}

interface LedgerEntry {
  id: string
  seq: number
  entity_type: string
  entity_id: string
  action: string
  payload: unknown
  actor_id: string | null
  entry_hash: string
  created_at: string
}

type Tab =
  | 'overview'
  | 'provenance'
  | 'license'
  | 'screenings'
  | 'optouts'
  | 'lineage'
  | 'clearance'
  | 'ledger'

/* ---------------- helpers ---------------- */

const inputCls =
  'w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleString()
}

function fmtBytes(n: number | null | undefined) {
  if (n == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function riskTone(v: number | null | undefined): 'green' | 'amber' | 'red' | 'zinc' {
  if (v == null) return 'zinc'
  if (v >= 0.66) return 'red'
  if (v >= 0.33) return 'amber'
  return 'green'
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label}
        {required && <span className="text-fuchsia-500"> *</span>}
      </span>
      {children}
    </label>
  )
}

function RiskBar({ label, value }: { label: string; value: number | null | undefined }) {
  const v = value ?? 0
  const pct = Math.round(Math.min(1, Math.max(0, v)) * 100)
  const tone = riskTone(value)
  const color = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="tabular-nums text-slate-300">{value == null ? '—' : pct}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/* ---------------- page ---------------- */

export default function SourceDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [data, setData] = useState<FullSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')

  const [provenance, setProvenance] = useState<ProvenanceEvent[]>([])
  const [custody, setCustody] = useState<CustodyHandoff[]>([])
  const [signals, setSignals] = useState<PreferenceSignal[]>([])
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [subLoading, setSubLoading] = useState(false)

  const [action, setAction] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  // modals
  const [modal, setModal] = useState<
    null | 'edit' | 'provenance' | 'custody' | 'license' | 'copyright' | 'pii' | 'signal'
  >(null)

  const loadFull = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await api.getSourceFull(id)
      setData(d)
      setSignals(Array.isArray(d?.signals) ? d.signals : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load source')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadFull()
  }, [loadFull])

  // lazy-load tab-specific data
  useEffect(() => {
    if (!data) return
    if (tab === 'provenance') {
      setSubLoading(true)
      Promise.all([api.getProvenance(id), api.getCustody(id)])
        .then(([p, c]) => {
          setProvenance(Array.isArray(p) ? p : [])
          setCustody(Array.isArray(c) ? c : [])
        })
        .catch(() => {})
        .finally(() => setSubLoading(false))
    } else if (tab === 'optouts') {
      setSubLoading(true)
      api
        .listPreferenceSignals({ source_id: id })
        .then((s) => setSignals(Array.isArray(s) ? s : []))
        .catch(() => {})
        .finally(() => setSubLoading(false))
    } else if (tab === 'ledger') {
      setSubLoading(true)
      api
        .getEntityLedger('source', id)
        .then((l) => setLedger(Array.isArray(l) ? l : []))
        .catch(() => {})
        .finally(() => setSubLoading(false))
    }
  }, [tab, id, data])

  async function runAction(name: string, fn: () => Promise<void>) {
    setAction(name)
    setActionMsg(null)
    try {
      await fn()
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setAction(null)
    }
  }

  if (loading) return <PageSpinner label="Loading source..." />

  if (error || !data) {
    return (
      <Card>
        <CardBody>
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-red-300">{error ?? 'Source not found'}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void loadFull()}>
                Retry
              </Button>
              <Link href="/dashboard/sources">
                <Button variant="ghost">Back to Sources</Button>
              </Link>
            </div>
          </div>
        </CardBody>
      </Card>
    )
  }

  const s = data.source
  const tabs: [Tab, string][] = [
    ['overview', 'Overview'],
    ['provenance', 'Provenance & Custody'],
    ['license', 'License'],
    ['screenings', 'Screenings'],
    ['optouts', 'Opt-Outs & Signals'],
    ['lineage', 'Lineage'],
    ['clearance', 'Clearance'],
    ['ledger', 'Ledger'],
  ]

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/sources" className="text-xs text-fuchsia-400 hover:underline">
            ← Sources
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-100">{s.name}</h1>
            {s.status && <Badge>{s.status}</Badge>}
            {s.risk_score != null && (
              <Badge tone={riskTone(s.risk_score)}>risk {Math.round(s.risk_score * 100)}</Badge>
            )}
          </div>
          {s.description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{s.description}</p>}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => void runAction('recompute', async () => {
              await api.recomputeRisk(id)
              await loadFull()
              setActionMsg('Risk recomputed')
            })}
            disabled={action === 'recompute'}
          >
            {action === 'recompute' ? 'Recomputing...' : 'Recompute Risk'}
          </Button>
          <Button onClick={() => setModal('edit')}>Edit Source</Button>
        </div>
      </div>

      {actionMsg && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
          {actionMsg}
        </div>
      )}

      {/* tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-800">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-fuchsia-500 text-fuchsia-300'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Records" value={s.record_count?.toLocaleString() ?? '—'} />
            <Stat label="Size" value={fmtBytes(s.size_bytes)} />
            <Stat
              label="Composite Risk"
              value={data.risk?.composite_risk != null ? Math.round(data.risk.composite_risk * 100) : '—'}
              tone={(() => { const t = riskTone(data.risk?.composite_risk); return t === 'zinc' ? 'default' : t })()}
            />
            <Stat
              label="Clearance"
              value={data.clearance?.status ?? 'none'}
              tone={data.clearance?.status === 'cleared' ? 'green' : data.clearance?.status === 'blocked' ? 'red' : 'default'}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-200">Source Details</h3>
              </CardHeader>
              <CardBody>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <KV k="Type" v={s.source_type} />
                  <KV k="Modality" v={s.modality} />
                  <KV k="Format" v={s.format} />
                  <KV k="Collection" v={s.collection} />
                  <KV k="Vendor" v={s.vendor} />
                  <KV k="Acquisition" v={s.acquisition_method} />
                  <KV k="Acquired" v={s.acquisition_date ? s.acquisition_date.slice(0, 10) : null} />
                  <KV k="Acquirer" v={s.acquirer} />
                  <KV
                    k="Origin"
                    v={
                      s.origin_url ? (
                        <a href={s.origin_url} target="_blank" rel="noreferrer" className="text-fuchsia-400 hover:underline">
                          link
                        </a>
                      ) : null
                    }
                  />
                  <KV k="Created" v={s.created_at ? s.created_at.slice(0, 10) : null} />
                </dl>
                {s.justification && (
                  <div className="mt-4 border-t border-slate-800 pt-3">
                    <div className="text-xs font-medium uppercase text-slate-500">Justification</div>
                    <p className="mt-1 text-sm text-slate-400">{s.justification}</p>
                  </div>
                )}
                {s.tags && s.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {s.tags.map((t, i) => (
                      <Badge key={i}>{t}</Badge>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-200">Risk Breakdown</h3>
              </CardHeader>
              <CardBody className="space-y-4">
                {data.risk ? (
                  <>
                    <RiskBar label="License risk" value={data.risk.license_risk} />
                    <RiskBar label="Copyright risk" value={data.risk.copyright_risk} />
                    <RiskBar label="PII risk" value={data.risk.pii_risk} />
                    <RiskBar label="Opt-out risk" value={data.risk.optout_risk} />
                    <div className="border-t border-slate-800 pt-3">
                      <RiskBar label="Composite" value={data.risk.composite_risk} />
                    </div>
                    <p className="text-xs text-slate-600">Computed {fmtDate(data.risk.computed_at)}</p>
                  </>
                ) : (
                  <EmptyState
                    title="No risk score"
                    description="Recompute risk to generate a breakdown from license, copyright, PII and opt-out signals."
                    action={
                      <Button
                        variant="secondary"
                        onClick={() => void runAction('recompute', async () => {
                          await api.recomputeRisk(id)
                          await loadFull()
                        })}
                      >
                        Recompute Risk
                      </Button>
                    }
                  />
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* PROVENANCE & CUSTODY */}
      {tab === 'provenance' && (
        <div className="space-y-6">
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal('custody')}>
              + Custody Handoff
            </Button>
            <Button onClick={() => setModal('provenance')}>+ Provenance Event</Button>
          </div>
          {subLoading ? (
            <Spinner label="Loading timeline..." />
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-200">Provenance Events</h3>
                </CardHeader>
                <CardBody>
                  {provenance.length === 0 ? (
                    <EmptyState title="No provenance events" description="Record where this data came from." />
                  ) : (
                    <ol className="space-y-3">
                      {provenance.map((p) => (
                        <li key={p.id} className="border-l-2 border-fuchsia-800/60 pl-3">
                          <div className="flex items-center gap-2">
                            <Badge tone="purple">{p.event_type}</Badge>
                            <span className="text-xs text-slate-500">{fmtDate(p.occurred_at ?? p.created_at)}</span>
                          </div>
                          {p.description && <p className="mt-1 text-sm text-slate-400">{p.description}</p>}
                          {p.recorded_by && <p className="text-xs text-slate-600">by {p.recorded_by}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-200">Custody Chain</h3>
                </CardHeader>
                <CardBody>
                  {custody.length === 0 ? (
                    <EmptyState title="No custody handoffs" description="Track who held this data and when." />
                  ) : (
                    <ol className="space-y-3">
                      {custody.map((c) => (
                        <li key={c.id} className="border-l-2 border-slate-700 pl-3">
                          <div className="text-sm text-slate-200">
                            {c.from_party ?? '—'} <span className="text-slate-600">→</span> {c.to_party ?? '—'}
                          </div>
                          {c.reason && <p className="text-sm text-slate-500">{c.reason}</p>}
                          <p className="text-xs text-slate-600">{fmtDate(c.occurred_at ?? c.created_at)}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* LICENSE */}
      {tab === 'license' && (
        <div className="space-y-4">
          {data.license ? (
            <Card>
              <CardHeader className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">{data.license.license_name}</h3>
                {data.license.status && <Badge>{data.license.status}</Badge>}
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ['permits_ai_training', 'AI training'],
                    ['permits_commercial', 'Commercial'],
                    ['permits_derivatives', 'Derivatives'],
                    ['requires_attribution', 'Attribution req.'],
                    ['share_alike', 'Share-alike'],
                  ] as [keyof License, string][]).map(([key, label]) => (
                    <Badge key={key} tone={data.license![key] ? 'green' : 'zinc'}>
                      {data.license![key] ? '✓' : '✕'} {label}
                    </Badge>
                  ))}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <KV k="Type" v={data.license.license_type} />
                  <KV k="Expiry" v={data.license.expiry_date ? data.license.expiry_date.slice(0, 10) : null} />
                </dl>
                {data.license.conflict_flags && data.license.conflict_flags.length > 0 && (
                  <div className="rounded-lg border border-red-800 bg-red-950/30 p-3">
                    <div className="text-xs font-medium uppercase text-red-300">Conflicts</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {data.license.conflict_flags.map((c, i) => (
                        <Badge key={i} tone="red">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <Link href="/dashboard/licenses" className="text-sm text-fuchsia-400 hover:underline">
                  Manage in License Tracker →
                </Link>
              </CardBody>
            </Card>
          ) : (
            <EmptyState
              title="No license attached"
              description="Attach a license to define AI-training rights for this source."
              action={<Button onClick={() => setModal('license')}>+ Attach License</Button>}
            />
          )}
        </div>
      )}

      {/* SCREENINGS */}
      {tab === 'screenings' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Copyright Screening</h3>
              <Button variant="ghost" className="px-2 py-1" onClick={() => setModal('copyright')}>
                + New
              </Button>
            </CardHeader>
            <CardBody>
              {data.copyright ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <KV k="Status" v={data.copyright.status ? <Badge>{data.copyright.status}</Badge> : null} />
                  <KV k="Method" v={data.copyright.method} />
                  <KV k="Reviewer" v={data.copyright.reviewer} />
                  <KV k="Screened" v={data.copyright.screened_at ? data.copyright.screened_at.slice(0, 10) : null} />
                  {data.copyright.notes && (
                    <div className="col-span-2">
                      <div className="text-xs uppercase text-slate-500">Notes</div>
                      <p className="mt-1 text-slate-400">{data.copyright.notes}</p>
                    </div>
                  )}
                </dl>
              ) : (
                <EmptyState title="Not screened" description="No copyright screening on record." />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">PII Screening</h3>
              <Button variant="ghost" className="px-2 py-1" onClick={() => setModal('pii')}>
                + New
              </Button>
            </CardHeader>
            <CardBody>
              {data.pii ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <KV k="Status" v={data.pii.status ? <Badge>{data.pii.status}</Badge> : null} />
                  <KV k="Method" v={data.pii.method} />
                  <KV k="Reviewer" v={data.pii.reviewer} />
                  <KV k="Screened" v={data.pii.screened_at ? data.pii.screened_at.slice(0, 10) : null} />
                  {data.pii.notes && (
                    <div className="col-span-2">
                      <div className="text-xs uppercase text-slate-500">Notes</div>
                      <p className="mt-1 text-slate-400">{data.pii.notes}</p>
                    </div>
                  )}
                </dl>
              ) : (
                <EmptyState title="Not screened" description="No PII screening on record." />
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* OPT-OUTS & SIGNALS */}
      {tab === 'optouts' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-200">Opt-Outs</h3>
            </CardHeader>
            <CardBody>
              {data.optouts.length === 0 ? (
                <EmptyState title="No opt-outs" description="No opt-out requests recorded for this source." />
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Subject</Th>
                      <Th>Type</Th>
                      <Th>Channel</Th>
                      <Th>Status</Th>
                      <Th>Received</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {data.optouts.map((o) => (
                      <Tr key={o.id}>
                        <Td>{o.subject_identity ?? '—'}</Td>
                        <Td>{o.optout_type ?? '—'}</Td>
                        <Td>{o.channel ?? '—'}</Td>
                        <Td>{o.honor_status ? <Badge>{o.honor_status}</Badge> : '—'}</Td>
                        <Td>{o.received_at ? o.received_at.slice(0, 10) : '—'}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Preference Signals</h3>
              <Button variant="ghost" className="px-2 py-1" onClick={() => setModal('signal')}>
                + Capture Signal
              </Button>
            </CardHeader>
            <CardBody>
              {subLoading ? (
                <Spinner label="Loading signals..." />
              ) : signals.length === 0 ? (
                <EmptyState
                  title="No preference signals"
                  description="Capture robots.txt, ai.txt, TDM reservation or noai directives."
                />
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Signal</Th>
                      <Th>Directive</Th>
                      <Th>URL</Th>
                      <Th>Captured</Th>
                      <Th>Recheck</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {signals.map((sig) => (
                      <Tr key={sig.id}>
                        <Td>
                          <Badge tone="blue">{sig.signal_type}</Badge>
                        </Td>
                        <Td>
                          <Badge tone={sig.directive === 'disallow' ? 'red' : 'green'}>{sig.directive ?? '—'}</Badge>
                        </Td>
                        <Td className="max-w-xs truncate">
                          {sig.captured_url ? (
                            <a href={sig.captured_url} target="_blank" rel="noreferrer" className="text-fuchsia-400 hover:underline">
                              {sig.captured_url}
                            </a>
                          ) : (
                            '—'
                          )}
                        </Td>
                        <Td>{sig.captured_at ? sig.captured_at.slice(0, 10) : '—'}</Td>
                        <Td>{sig.recheck_due ? sig.recheck_due.slice(0, 10) : '—'}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* LINEAGE */}
      {tab === 'lineage' && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-200">Model Lineage</h3>
          </CardHeader>
          <CardBody>
            {data.lineage.length === 0 ? (
              <EmptyState
                title="Not used in any model"
                description="This source has not been bound to a model version yet."
              />
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Model Version</Th>
                    <Th>Proportion</Th>
                    <Th>Preprocessing</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {data.lineage.map((l) => (
                    <Tr key={l.id}>
                      <Td>
                        <Link href={`/dashboard/models/${l.model_version_id}`} className="text-fuchsia-400 hover:underline">
                          {l.model_name ? `${l.model_name} ` : ''}
                          {l.version ?? l.model_version_id}
                        </Link>
                      </Td>
                      <Td>{l.proportion != null ? `${Math.round(l.proportion * 100)}%` : '—'}</Td>
                      <Td>{l.preprocessing ?? '—'}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {/* CLEARANCE */}
      {tab === 'clearance' && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Clearance Gate</h3>
              <Button
                onClick={() => void runAction('evaluate', async () => {
                  await api.evaluateClearance(id)
                  await loadFull()
                  setActionMsg('Clearance evaluated')
                })}
                disabled={action === 'evaluate'}
              >
                {action === 'evaluate' ? 'Evaluating...' : 'Evaluate Clearance'}
              </Button>
            </CardHeader>
            <CardBody className="space-y-4">
              {data.clearance ? (
                <>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-400">Status</span>
                    <Badge
                      tone={
                        data.clearance.status === 'cleared'
                          ? 'green'
                          : data.clearance.status === 'blocked'
                          ? 'red'
                          : data.clearance.status === 'overridden'
                          ? 'purple'
                          : 'amber'
                      }
                    >
                      {data.clearance.status ?? 'pending'}
                    </Badge>
                  </div>
                  {data.clearance.unmet_requirements && data.clearance.unmet_requirements.length > 0 ? (
                    <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-3">
                      <div className="text-xs font-medium uppercase text-amber-300">Unmet Requirements</div>
                      <ul className="mt-1 list-inside list-disc text-sm text-amber-200/90">
                        {data.clearance.unmet_requirements.map((u, i) => (
                          <li key={i}>{u}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    data.clearance.status === 'cleared' && (
                      <p className="text-sm text-emerald-400">All clearance requirements satisfied.</p>
                    )
                  )}
                  {data.clearance.decision_rationale && (
                    <p className="text-sm text-slate-400">{data.clearance.decision_rationale}</p>
                  )}
                  {data.clearance.decided_at && (
                    <p className="text-xs text-slate-600">Decided {fmtDate(data.clearance.decided_at)}</p>
                  )}
                  <Link href="/dashboard/clearance" className="block text-sm text-fuchsia-400 hover:underline">
                    Open Clearance Console →
                  </Link>
                </>
              ) : (
                <EmptyState
                  title="Not evaluated"
                  description="Run an evaluation to check this source against workspace clearance requirements."
                />
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* LEDGER */}
      {tab === 'ledger' && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-200">Immutable Ledger</h3>
          </CardHeader>
          <CardBody>
            {subLoading ? (
              <Spinner label="Loading ledger..." />
            ) : ledger.length === 0 ? (
              <EmptyState title="No ledger entries" description="No tamper-evident events recorded for this source yet." />
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Seq</Th>
                    <Th>Action</Th>
                    <Th>Actor</Th>
                    <Th>Hash</Th>
                    <Th>When</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {ledger.map((e) => (
                    <Tr key={e.id}>
                      <Td className="tabular-nums">{e.seq}</Td>
                      <Td>
                        <Badge tone="purple">{e.action}</Badge>
                      </Td>
                      <Td>{e.actor_id ?? '—'}</Td>
                      <Td className="font-mono text-xs text-slate-500">{e.entry_hash?.slice(0, 12)}…</Td>
                      <Td>{fmtDate(e.created_at)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {/* ---------------- modals ---------------- */}
      <EditSourceModal open={modal === 'edit'} onClose={() => setModal(null)} source={s} onSaved={loadFull} />
      <ProvenanceModal
        open={modal === 'provenance'}
        onClose={() => setModal(null)}
        sourceId={id}
        onSaved={() => {
          setModal(null)
          setTab('provenance')
          api.getProvenance(id).then((p) => setProvenance(Array.isArray(p) ? p : [])).catch(() => {})
        }}
      />
      <CustodyModal
        open={modal === 'custody'}
        onClose={() => setModal(null)}
        sourceId={id}
        onSaved={() => {
          setModal(null)
          api.getCustody(id).then((c) => setCustody(Array.isArray(c) ? c : [])).catch(() => {})
        }}
      />
      <LicenseModal open={modal === 'license'} onClose={() => setModal(null)} sourceId={id} onSaved={loadFull} />
      <CopyrightModal open={modal === 'copyright'} onClose={() => setModal(null)} sourceId={id} onSaved={loadFull} />
      <PiiModal open={modal === 'pii'} onClose={() => setModal(null)} sourceId={id} onSaved={loadFull} />
      <SignalModal
        open={modal === 'signal'}
        onClose={() => setModal(null)}
        sourceId={id}
        onSaved={() => {
          setModal(null)
          api.listPreferenceSignals({ source_id: id }).then((sg) => setSignals(Array.isArray(sg) ? sg : [])).catch(() => {})
        }}
      />
    </div>
  )
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-500">{k}</dt>
      <dd className="mt-0.5 text-slate-300">{v == null || v === '' ? '—' : v}</dd>
    </div>
  )
}

/* ---------------- modal components ---------------- */

function useSaver(onSaved: () => void | Promise<void>, onClose: () => void) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setSaving(true)
    setErr(null)
    try {
      await fn()
      await onSaved()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }
  return { saving, err, setErr, run }
}

function ModalErr({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{msg}</div>
  )
}

function EditSourceModal({
  open,
  onClose,
  source,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  source: DataSource
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState({
    name: source.name ?? '',
    description: source.description ?? '',
    status: source.status ?? 'draft',
    collection: source.collection ?? '',
    vendor: source.vendor ?? '',
    justification: source.justification ?? '',
  })
  useEffect(() => {
    if (open)
      setForm({
        name: source.name ?? '',
        description: source.description ?? '',
        status: source.status ?? 'draft',
        collection: source.collection ?? '',
        vendor: source.vendor ?? '',
        justification: source.justification ?? '',
      })
  }, [open, source])
  const { saving, err, run } = useSaver(onSaved, onClose)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Source"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() =>
              run(async () => {
                await api.updateSource(source.id, {
                  ...form,
                  description: form.description.trim() || null,
                  collection: form.collection.trim() || null,
                  vendor: form.vendor.trim() || null,
                  justification: form.justification.trim() || null,
                })
              })
            }
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalErr msg={err} />
        <Field label="Name" required>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className={`${inputCls} h-20 resize-none`}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
              {['draft', 'review', 'cleared', 'blocked', 'retired'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Collection">
            <input
              value={form.collection}
              onChange={(e) => setForm({ ...form, collection: e.target.value })}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Vendor">
          <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Justification">
          <textarea
            value={form.justification}
            onChange={(e) => setForm({ ...form, justification: e.target.value })}
            className={`${inputCls} h-16 resize-none`}
          />
        </Field>
      </div>
    </Modal>
  )
}

function ProvenanceModal({
  open,
  onClose,
  sourceId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  sourceId: string
  onSaved: () => void
}) {
  const [form, setForm] = useState({ event_type: 'acquired', description: '', occurred_at: '', recorded_by: '' })
  useEffect(() => {
    if (open) setForm({ event_type: 'acquired', description: '', occurred_at: '', recorded_by: '' })
  }, [open])
  const { saving, err, run } = useSaver(async () => onSaved(), onClose)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Provenance Event"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() =>
              run(async () => {
                await api.addProvenance(sourceId, {
                  event_type: form.event_type,
                  description: form.description.trim() || null,
                  occurred_at: form.occurred_at || null,
                  recorded_by: form.recorded_by.trim() || null,
                })
              })
            }
          >
            {saving ? 'Saving...' : 'Add Event'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalErr msg={err} />
        <Field label="Event type">
          <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} className={inputCls}>
            {['acquired', 'derived', 'transformed', 'merged', 'transferred', 'deleted', 'other'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className={`${inputCls} h-20 resize-none`}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Occurred at">
            <input
              type="datetime-local"
              value={form.occurred_at}
              onChange={(e) => setForm({ ...form, occurred_at: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Recorded by">
            <input value={form.recorded_by} onChange={(e) => setForm({ ...form, recorded_by: e.target.value })} className={inputCls} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function CustodyModal({
  open,
  onClose,
  sourceId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  sourceId: string
  onSaved: () => void
}) {
  const [form, setForm] = useState({ from_party: '', to_party: '', reason: '', occurred_at: '', recorded_by: '' })
  useEffect(() => {
    if (open) setForm({ from_party: '', to_party: '', reason: '', occurred_at: '', recorded_by: '' })
  }, [open])
  const { saving, err, run } = useSaver(async () => onSaved(), onClose)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Custody Handoff"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() =>
              run(async () => {
                await api.addCustody(sourceId, {
                  from_party: form.from_party.trim() || null,
                  to_party: form.to_party.trim() || null,
                  reason: form.reason.trim() || null,
                  occurred_at: form.occurred_at || null,
                  recorded_by: form.recorded_by.trim() || null,
                })
              })
            }
          >
            {saving ? 'Saving...' : 'Add Handoff'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalErr msg={err} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="From party">
            <input value={form.from_party} onChange={(e) => setForm({ ...form, from_party: e.target.value })} className={inputCls} />
          </Field>
          <Field label="To party">
            <input value={form.to_party} onChange={(e) => setForm({ ...form, to_party: e.target.value })} className={inputCls} />
          </Field>
        </div>
        <Field label="Reason">
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Occurred at">
            <input
              type="datetime-local"
              value={form.occurred_at}
              onChange={(e) => setForm({ ...form, occurred_at: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Recorded by">
            <input value={form.recorded_by} onChange={(e) => setForm({ ...form, recorded_by: e.target.value })} className={inputCls} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function LicenseModal({
  open,
  onClose,
  sourceId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  sourceId: string
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState({
    license_name: '',
    license_type: 'commercial',
    permits_ai_training: true,
    permits_commercial: true,
    permits_derivatives: false,
    requires_attribution: false,
    share_alike: false,
    expiry_date: '',
    status: 'active',
  })
  useEffect(() => {
    if (open)
      setForm({
        license_name: '',
        license_type: 'commercial',
        permits_ai_training: true,
        permits_commercial: true,
        permits_derivatives: false,
        requires_attribution: false,
        share_alike: false,
        expiry_date: '',
        status: 'active',
      })
  }, [open])
  const { saving, err, run } = useSaver(onSaved, onClose)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Attach License"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() =>
              run(async () => {
                await api.createLicense({ ...form, source_id: sourceId, expiry_date: form.expiry_date || null })
              })
            }
          >
            {saving ? 'Saving...' : 'Attach License'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalErr msg={err} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="License name" required>
            <input value={form.license_name} onChange={(e) => setForm({ ...form, license_name: e.target.value })} className={inputCls} />
          </Field>
          <Field label="License type">
            <select value={form.license_type} onChange={(e) => setForm({ ...form, license_type: e.target.value })} className={inputCls}>
              {['commercial', 'open-source', 'creative-commons', 'public-domain', 'proprietary', 'custom'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          {([
            ['permits_ai_training', 'AI training'],
            ['permits_commercial', 'Commercial'],
            ['permits_derivatives', 'Derivatives'],
            ['requires_attribution', 'Attribution'],
            ['share_alike', 'Share-alike'],
          ] as [keyof typeof form, string][]).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form[key] as boolean}
                onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                className="h-4 w-4 accent-fuchsia-600"
              />
              Permits {label.toLowerCase()}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expiry date">
            <input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
              {['active', 'expired', 'revoked', 'pending'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function CopyrightModal({
  open,
  onClose,
  sourceId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  sourceId: string
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState({ status: 'in-progress', method: '', reviewer: '', notes: '' })
  useEffect(() => {
    if (open) setForm({ status: 'in-progress', method: '', reviewer: '', notes: '' })
  }, [open])
  const { saving, err, run } = useSaver(onSaved, onClose)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Copyright Screening"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() =>
              run(async () => {
                await api.createCopyrightScreening({
                  source_id: sourceId,
                  status: form.status,
                  method: form.method.trim() || null,
                  reviewer: form.reviewer.trim() || null,
                  notes: form.notes.trim() || null,
                })
              })
            }
          >
            {saving ? 'Saving...' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalErr msg={err} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
              {['not-started', 'in-progress', 'passed', 'flagged', 'failed'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Method">
            <input value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={inputCls} placeholder="e.g. fingerprint match" />
          </Field>
        </div>
        <Field label="Reviewer">
          <input value={form.reviewer} onChange={(e) => setForm({ ...form, reviewer: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${inputCls} h-20 resize-none`} />
        </Field>
      </div>
    </Modal>
  )
}

function PiiModal({
  open,
  onClose,
  sourceId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  sourceId: string
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState({ status: 'in-progress', method: '', reviewer: '', lawful_basis: '', notes: '' })
  useEffect(() => {
    if (open) setForm({ status: 'in-progress', method: '', reviewer: '', lawful_basis: '', notes: '' })
  }, [open])
  const { saving, err, run } = useSaver(onSaved, onClose)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New PII Screening"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() =>
              run(async () => {
                await api.createPiiScreening({
                  source_id: sourceId,
                  status: form.status,
                  method: form.method.trim() || null,
                  reviewer: form.reviewer.trim() || null,
                  lawful_basis: form.lawful_basis.trim() || null,
                  notes: form.notes.trim() || null,
                })
              })
            }
          >
            {saving ? 'Saving...' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalErr msg={err} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
              {['not-started', 'in-progress', 'passed', 'flagged', 'failed'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Method">
            <input value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={inputCls} placeholder="e.g. NER scan" />
          </Field>
        </div>
        <Field label="Lawful basis">
          <input value={form.lawful_basis} onChange={(e) => setForm({ ...form, lawful_basis: e.target.value })} className={inputCls} placeholder="e.g. consent, legitimate interest" />
        </Field>
        <Field label="Reviewer">
          <input value={form.reviewer} onChange={(e) => setForm({ ...form, reviewer: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${inputCls} h-20 resize-none`} />
        </Field>
      </div>
    </Modal>
  )
}

function SignalModal({
  open,
  onClose,
  sourceId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  sourceId: string
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    signal_type: 'robots.txt',
    directive: 'disallow',
    captured_url: '',
    snapshot_sha256: '',
    recheck_due: '',
  })
  useEffect(() => {
    if (open)
      setForm({ signal_type: 'robots.txt', directive: 'disallow', captured_url: '', snapshot_sha256: '', recheck_due: '' })
  }, [open])
  const { saving, err, run } = useSaver(async () => onSaved(), onClose)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Capture Preference Signal"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() =>
              run(async () => {
                await api.createPreferenceSignal({
                  source_id: sourceId,
                  signal_type: form.signal_type,
                  directive: form.directive,
                  captured_url: form.captured_url.trim() || null,
                  snapshot_sha256: form.snapshot_sha256.trim() || null,
                  recheck_due: form.recheck_due || null,
                })
              })
            }
          >
            {saving ? 'Saving...' : 'Capture'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalErr msg={err} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Signal type">
            <select value={form.signal_type} onChange={(e) => setForm({ ...form, signal_type: e.target.value })} className={inputCls}>
              {['robots.txt', 'ai.txt', 'tdm-reservation', 'noai', 'noimageai'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Directive">
            <select value={form.directive} onChange={(e) => setForm({ ...form, directive: e.target.value })} className={inputCls}>
              {['allow', 'disallow'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Captured URL">
          <input value={form.captured_url} onChange={(e) => setForm({ ...form, captured_url: e.target.value })} className={inputCls} placeholder="https://example.com/robots.txt" />
        </Field>
        <Field label="Snapshot SHA-256">
          <input value={form.snapshot_sha256} onChange={(e) => setForm({ ...form, snapshot_sha256: e.target.value })} className={`${inputCls} font-mono`} />
        </Field>
        <Field label="Recheck due">
          <input type="date" value={form.recheck_due} onChange={(e) => setForm({ ...form, recheck_due: e.target.value })} className={inputCls} />
        </Field>
      </div>
    </Modal>
  )
}
