'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'

interface RiskScore {
  id: string
  source_id: string
  license_risk: number | null
  copyright_risk: number | null
  pii_risk: number | null
  optout_risk: number | null
  composite_risk: number | null
  computed_at: string | null
  created_at: string
}

interface TopRisk {
  source_id: string
  name?: string
  composite_risk?: number | null
  risk_score?: number | null
  status?: string
}

interface BlockedRow {
  id: string
  name?: string
  status?: string
  risk_score?: number | null
}

interface ExpiringRow {
  id: string
  license_name?: string
  source_id?: string | null
  expiry_date?: string | null
}

interface Dashboard {
  statusCounts?: Record<string, number> | { status: string; count: number }[]
  topRisks?: TopRisk[]
  blocked?: BlockedRow[]
  expiring?: ExpiringRow[]
}

function pct(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v)) return 0
  // risk values are 0..1 reals; clamp and scale to 0..100
  const n = v <= 1 ? v * 100 : v
  return Math.max(0, Math.min(100, Math.round(n)))
}

function riskTone(p: number): 'green' | 'amber' | 'red' {
  if (p >= 66) return 'red'
  if (p >= 33) return 'amber'
  return 'green'
}

const toneBar: Record<'green' | 'amber' | 'red', string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-fuchsia-500',
}

function RiskBar({ value, label }: { value: number | null | undefined; label?: string }) {
  const p = pct(value)
  const tone = riskTone(p)
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full max-w-[140px] overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${toneBar[tone]}`} style={{ width: `${p}%` }} />
      </div>
      <span className={`w-9 text-right text-xs tabular-nums ${tone === 'red' ? 'text-fuchsia-400' : tone === 'amber' ? 'text-amber-400' : 'text-emerald-400'}`}>
        {p}
        {label ?? ''}
      </span>
    </div>
  )
}

function normalizeStatusCounts(sc: Dashboard['statusCounts']): { status: string; count: number }[] {
  if (!sc) return []
  if (Array.isArray(sc)) return sc.map((r) => ({ status: r.status, count: Number(r.count) || 0 }))
  return Object.entries(sc).map(([status, count]) => ({ status, count: Number(count) || 0 }))
}

export default function RiskDashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [scores, setScores] = useState<RiskScore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sort, setSort] = useState<'composite' | 'license' | 'copyright' | 'pii' | 'optout'>('composite')
  const [recomputingId, setRecomputingId] = useState<string | null>(null)
  const [recomputingAll, setRecomputingAll] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [d, s] = await Promise.all([api.getRiskDashboard(), api.listRiskScores()])
      setDashboard(d && typeof d === 'object' ? d : {})
      setScores(Array.isArray(s) ? s : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load risk data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function recompute(sourceId: string) {
    setRecomputingId(sourceId)
    setActionError(null)
    try {
      await api.recomputeRisk(sourceId)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Recompute failed')
    } finally {
      setRecomputingId(null)
    }
  }

  async function recomputeAll() {
    if (scores.length === 0) return
    if (!confirm(`Recompute composite risk for all ${scores.length} scored sources?`)) return
    setRecomputingAll(true)
    setActionError(null)
    try {
      for (const s of scores) {
        await api.recomputeRisk(s.source_id)
      }
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Bulk recompute failed')
    } finally {
      setRecomputingAll(false)
    }
  }

  const statusCounts = useMemo(() => normalizeStatusCounts(dashboard?.statusCounts), [dashboard])
  const totalSources = useMemo(() => statusCounts.reduce((a, r) => a + r.count, 0), [statusCounts])

  const sortedScores = useMemo(() => {
    const key =
      sort === 'composite'
        ? 'composite_risk'
        : sort === 'license'
        ? 'license_risk'
        : sort === 'copyright'
        ? 'copyright_risk'
        : sort === 'pii'
        ? 'pii_risk'
        : 'optout_risk'
    return [...scores].sort((a, b) => pct(b[key as keyof RiskScore] as number) - pct(a[key as keyof RiskScore] as number))
  }, [scores, sort])

  const avgComposite = useMemo(() => {
    if (scores.length === 0) return 0
    const sum = scores.reduce((a, s) => a + pct(s.composite_risk), 0)
    return Math.round(sum / scores.length)
  }, [scores])

  const highRiskCount = useMemo(() => scores.filter((s) => pct(s.composite_risk) >= 66).length, [scores])

  const dimensionAverages = useMemo(() => {
    if (scores.length === 0) return { license: 0, copyright: 0, pii: 0, optout: 0 }
    const acc = { license: 0, copyright: 0, pii: 0, optout: 0 }
    for (const s of scores) {
      acc.license += pct(s.license_risk)
      acc.copyright += pct(s.copyright_risk)
      acc.pii += pct(s.pii_risk)
      acc.optout += pct(s.optout_risk)
    }
    return {
      license: Math.round(acc.license / scores.length),
      copyright: Math.round(acc.copyright / scores.length),
      pii: Math.round(acc.pii / scores.length),
      optout: Math.round(acc.optout / scores.length),
    }
  }, [scores])

  if (loading) return <PageSpinner label="Loading portfolio risk..." />

  if (error) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-red-300">{error}</p>
            <Button variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </CardBody>
      </Card>
    )
  }

  const topRisks = dashboard?.topRisks ?? []
  const blocked = dashboard?.blocked ?? []
  const expiring = dashboard?.expiring ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Portfolio Risk</h1>
          <p className="mt-1 text-sm text-slate-500">
            Composite rights-clearance risk across every training data source, rolled up by license, copyright, PII, and opt-out exposure.
          </p>
        </div>
        <Button onClick={() => void recomputeAll()} disabled={recomputingAll || scores.length === 0}>
          {recomputingAll ? 'Recomputing...' : 'Recompute All'}
        </Button>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Scored Sources" value={scores.length} hint={`${totalSources} total in portfolio`} />
        <Stat
          label="Avg Composite Risk"
          value={`${avgComposite}`}
          tone={riskTone(avgComposite) === 'red' ? 'red' : riskTone(avgComposite) === 'amber' ? 'amber' : 'green'}
        />
        <Stat label="High Risk (≥66)" value={highRiskCount} tone={highRiskCount ? 'red' : 'default'} />
        <Stat label="Blocked Sources" value={blocked.length} tone={blocked.length ? 'red' : 'default'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Status distribution */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Sources by Status</h2>
          </CardHeader>
          <CardBody>
            {statusCounts.length === 0 ? (
              <p className="text-sm text-slate-500">No source status data.</p>
            ) : (
              <div className="space-y-3">
                {statusCounts.map((r) => {
                  const p = totalSources ? Math.round((r.count / totalSources) * 100) : 0
                  return (
                    <div key={r.status} className="flex items-center gap-3">
                      <div className="w-24 shrink-0">
                        <Badge>{r.status}</Badge>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full ${
                            r.status === 'blocked'
                              ? 'bg-fuchsia-500'
                              : r.status === 'cleared'
                              ? 'bg-emerald-500'
                              : r.status === 'review'
                              ? 'bg-amber-500'
                              : 'bg-slate-500'
                          }`}
                          style={{ width: `${p}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-sm tabular-nums text-slate-300">
                        {r.count} <span className="text-slate-600">({p}%)</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Dimension averages */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Avg Risk by Dimension</h2>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              {([
                ['License', dimensionAverages.license],
                ['Copyright', dimensionAverages.copyright],
                ['PII', dimensionAverages.pii],
                ['Opt-out', dimensionAverages.optout],
              ] as [string, number][]).map(([label, v]) => (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-xs text-slate-400">
                    <span>{label}</span>
                    <span className="tabular-nums">{v}</span>
                  </div>
                  <RiskBar value={v} />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Blocked */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Blocked Sources</h2>
          </CardHeader>
          <CardBody>
            {blocked.length === 0 ? (
              <p className="text-sm text-slate-500">No blocked sources.</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {blocked.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-2">
                    <Link href={`/dashboard/sources/${b.id}`} className="text-sm text-slate-200 hover:text-fuchsia-300">
                      {b.name ?? b.id}
                    </Link>
                    <div className="flex items-center gap-2">
                      {b.status && <Badge>{b.status}</Badge>}
                      {b.risk_score != null && (
                        <span className="text-xs tabular-nums text-fuchsia-400">{pct(b.risk_score)}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Expiring licenses */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Expiring / Expired Licenses</h2>
          </CardHeader>
          <CardBody>
            {expiring.length === 0 ? (
              <p className="text-sm text-slate-500">No expiring licenses.</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {expiring.map((e) => {
                  const days =
                    e.expiry_date != null
                      ? Math.ceil((new Date(e.expiry_date).getTime() - Date.now()) / 86400000)
                      : null
                  return (
                    <li key={e.id} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-slate-200">{e.license_name ?? e.id}</div>
                        {e.source_id && (
                          <Link href={`/dashboard/sources/${e.source_id}`} className="text-xs text-fuchsia-400 hover:underline">
                            view source
                          </Link>
                        )}
                      </div>
                      <span className={`text-xs tabular-nums ${days != null && days < 0 ? 'text-red-400' : 'text-amber-400'}`}>
                        {e.expiry_date ? e.expiry_date.slice(0, 10) : '—'}
                        {days != null && <span className="ml-1">({days < 0 ? `${-days}d ago` : `${days}d`})</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Top risks from dashboard rollup */}
      {topRisks.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Top Risk Sources</h2>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              {topRisks.map((t) => (
                <div key={t.source_id} className="flex items-center gap-3">
                  <Link
                    href={`/dashboard/sources/${t.source_id}`}
                    className="w-48 shrink-0 truncate text-sm text-slate-200 hover:text-fuchsia-300"
                  >
                    {t.name ?? t.source_id}
                  </Link>
                  <div className="flex-1">
                    <RiskBar value={t.composite_risk ?? t.risk_score} />
                  </div>
                  {t.status && <Badge>{t.status}</Badge>}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Full risk score table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-200">Risk Score Register</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Sort by</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
              >
                <option value="composite">Composite</option>
                <option value="license">License</option>
                <option value="copyright">Copyright</option>
                <option value="pii">PII</option>
                <option value="optout">Opt-out</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {sortedScores.length === 0 ? (
            <EmptyState
              title="No risk scores yet"
              description="Recompute risk on a source from its detail page, or run Recompute All once sources are scored."
            />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Source</Th>
                  <Th>License</Th>
                  <Th>Copyright</Th>
                  <Th>PII</Th>
                  <Th>Opt-out</Th>
                  <Th>Composite</Th>
                  <Th>Computed</Th>
                  <Th className="text-right">Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {sortedScores.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <Link
                        href={`/dashboard/sources/${s.source_id}`}
                        className="font-mono text-xs text-fuchsia-400 hover:underline"
                      >
                        {s.source_id.slice(0, 8)}
                      </Link>
                    </Td>
                    <Td><RiskBar value={s.license_risk} /></Td>
                    <Td><RiskBar value={s.copyright_risk} /></Td>
                    <Td><RiskBar value={s.pii_risk} /></Td>
                    <Td><RiskBar value={s.optout_risk} /></Td>
                    <Td>
                      <Badge tone={riskTone(pct(s.composite_risk))}>{pct(s.composite_risk)}</Badge>
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {s.computed_at ? s.computed_at.slice(0, 10) : '—'}
                    </Td>
                    <Td className="text-right">
                      <Button
                        variant="ghost"
                        className="px-2 py-1"
                        onClick={() => void recompute(s.source_id)}
                        disabled={recomputingId === s.source_id}
                      >
                        {recomputingId === s.source_id ? <Spinner /> : 'Recompute'}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
