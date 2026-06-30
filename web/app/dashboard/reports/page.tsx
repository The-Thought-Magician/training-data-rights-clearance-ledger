'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table'

type ThroughputPoint = { period?: string; date?: string; label?: string; count?: number; cleared?: number }
type Throughput = {
  throughput?: ThroughputPoint[] | Record<string, number>
  backlog?: number
  avgDays?: number | null
}

type ByModel = { model_id?: string; model?: string; name?: string; total?: number; cleared?: number; coverage?: number }
type Coverage = {
  overall?: number
  byModel?: ByModel[]
}

type Bucket = { key?: string; type?: string; status?: string; count?: number }
type ClaimsSummary = {
  byType?: Bucket[] | Record<string, number>
  byStatus?: Bucket[] | Record<string, number>
  avgResolutionDays?: number | null
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pct(v: unknown): number {
  const n = num(v)
  // tolerate both 0..1 and 0..100 encodings
  return n <= 1 && n > 0 ? n * 100 : n
}

// Normalize a "bucket" payload that may be an array of {key,count} or a plain object.
function toBuckets(raw: Bucket[] | Record<string, number> | undefined, keyFields: string[]): { key: string; count: number }[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((b) => {
      let key = ''
      for (const f of keyFields) {
        const v = (b as Record<string, unknown>)[f]
        if (typeof v === 'string' && v) { key = v; break }
      }
      return { key: key || 'unknown', count: num(b.count) }
    })
  }
  return Object.entries(raw).map(([key, count]) => ({ key, count: num(count) }))
}

function toThroughputPoints(raw: Throughput['throughput']): { label: string; count: number }[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((p) => ({
      label: p.label ?? p.period ?? p.date ?? '',
      count: num(p.count ?? p.cleared),
    }))
  }
  return Object.entries(raw).map(([label, count]) => ({ label, count: num(count) }))
}

const STATUS_TONE: Record<string, string> = {
  received: 'bg-sky-500', investigating: 'bg-amber-500', valid: 'bg-emerald-500',
  invalid: 'bg-zinc-600', remediating: 'bg-rose-500', resolved: 'bg-emerald-600',
  escalated: 'bg-red-600',
}
const TYPE_TONE: Record<string, string> = {
  copyright: 'bg-rose-500', privacy: 'bg-purple-500', contract: 'bg-sky-500', takedown: 'bg-amber-500',
}

export default function ReportsPage() {
  const [throughput, setThroughput] = useState<Throughput | null>(null)
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [claims, setClaims] = useState<ClaimsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [tp, cov, cs] = await Promise.all([
        api.getClearanceThroughput(),
        api.getCoverage(),
        api.getClaimsSummary(),
      ])
      setThroughput(tp ?? {})
      setCoverage(cov ?? {})
      setClaims(cs ?? {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const points = useMemo(() => toThroughputPoints(throughput?.throughput), [throughput])
  const maxCount = useMemo(() => points.reduce((m, p) => Math.max(m, p.count), 0), [points])
  const totalCleared = useMemo(() => points.reduce((s, p) => s + p.count, 0), [points])

  const byModel = useMemo(() => (coverage?.byModel ?? []).map((m) => ({
    name: m.name ?? m.model ?? m.model_id ?? 'Untitled model',
    total: num(m.total),
    cleared: num(m.cleared),
    coverage: m.coverage != null ? pct(m.coverage) : (num(m.total) > 0 ? (num(m.cleared) / num(m.total)) * 100 : 0),
  })), [coverage])

  const claimsByType = useMemo(() => toBuckets(claims?.byType, ['type', 'key', 'claim_type']), [claims])
  const claimsByStatus = useMemo(() => toBuckets(claims?.byStatus, ['status', 'key']), [claims])
  const claimsTotal = useMemo(() => claimsByType.reduce((s, b) => s + b.count, 0), [claimsByType])

  if (loading) return <PageSpinner label="Loading reports..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Reports &amp; Analytics</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Clearance throughput, model coverage, and claims activity across your data estate.
          </p>
        </div>
        <Button variant="secondary" onClick={load}>Refresh</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
          <button onClick={load} className="ml-3 underline hover:text-red-200">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Cleared (window)" value={totalCleared} tone="green" />
        <Stat label="Backlog" value={num(throughput?.backlog)} tone={num(throughput?.backlog) > 0 ? 'amber' : 'default'} />
        <Stat
          label="Avg Time-to-Clear"
          value={throughput?.avgDays != null ? `${num(throughput.avgDays).toFixed(1)}d` : '—'}
        />
        <Stat label="Overall Coverage" value={`${pct(coverage?.overall).toFixed(0)}%`} tone="rose" />
        <Stat
          label="Avg Resolution"
          value={claims?.avgResolutionDays != null ? `${num(claims.avgResolutionDays).toFixed(1)}d` : '—'}
        />
      </div>

      {/* Clearance throughput */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Clearance Throughput</h2>
            <p className="text-xs text-zinc-500">Sources cleared per period</p>
          </div>
          <Badge tone="zinc">{points.length} periods</Badge>
        </CardHeader>
        <CardBody>
          {points.length === 0 ? (
            <EmptyState
              icon="📈"
              title="No throughput data yet"
              description="Clear some sources through the clearance gate to populate this chart."
            />
          ) : (
            <div className="flex items-end gap-2" style={{ height: 200 }}>
              {points.map((p, i) => {
                const h = maxCount > 0 ? Math.max(4, (p.count / maxCount) * 170) : 4
                return (
                  <div key={`${p.label}-${i}`} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${p.label}: ${p.count}`}>
                    <span className="text-xs tabular-nums text-zinc-400">{p.count}</span>
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-rose-700 to-rose-500"
                      style={{ height: h }}
                    />
                    <span className="w-full truncate text-center text-[10px] text-zinc-600">{p.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Coverage by model */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-100">Coverage by Model</h2>
            <p className="text-xs text-zinc-500">% of bound sources fully cleared</p>
          </CardHeader>
          <CardBody>
            {byModel.length === 0 ? (
              <EmptyState
                icon="🧩"
                title="No model coverage yet"
                description="Bind sources to model versions to track clearance coverage per model."
              />
            ) : (
              <div className="space-y-4">
                {byModel.map((m, i) => (
                  <div key={`${m.name}-${i}`}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="truncate font-medium text-zinc-200">{m.name}</span>
                      <span className="tabular-nums text-zinc-400">
                        {m.cleared}/{m.total}{' '}
                        <span className={coverageColor(m.coverage)}>({m.coverage.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full rounded-full ${coverageBar(m.coverage)}`}
                        style={{ width: `${Math.min(100, m.coverage)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Claims by status */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-100">Claims by Status</h2>
            <p className="text-xs text-zinc-500">{claimsTotal} total claims</p>
          </CardHeader>
          <CardBody>
            {claimsByStatus.length === 0 ? (
              <EmptyState
                icon="⚖️"
                title="No claims recorded"
                description="Claim volume and resolution stats appear here as disputes are logged."
              />
            ) : (
              <DistList buckets={claimsByStatus} toneMap={STATUS_TONE} />
            )}
          </CardBody>
        </Card>
      </div>

      {/* Claims by type */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-100">Claims by Type</h2>
          <p className="text-xs text-zinc-500">Volume by category of dispute</p>
        </CardHeader>
        <CardBody>
          {claimsByType.length === 0 ? (
            <EmptyState icon="🏷️" title="No claims by type" description="No disputes have been categorized yet." />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Type</Th>
                  <Th className="text-right">Count</Th>
                  <Th>Share</Th>
                </Tr>
              </Thead>
              <Tbody>
                {claimsByType
                  .slice()
                  .sort((a, b) => b.count - a.count)
                  .map((b) => {
                    const share = claimsTotal > 0 ? (b.count / claimsTotal) * 100 : 0
                    return (
                      <Tr key={b.key}>
                        <Td className="font-medium capitalize text-zinc-100">{b.key}</Td>
                        <Td className="text-right tabular-nums">{b.count}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-40 max-w-full overflow-hidden rounded-full bg-zinc-800">
                              <div
                                className={`h-full rounded-full ${TYPE_TONE[b.key] ?? 'bg-rose-500'}`}
                                style={{ width: `${share}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-zinc-500">{share.toFixed(0)}%</span>
                          </div>
                        </Td>
                      </Tr>
                    )
                  })}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function DistList({ buckets, toneMap }: { buckets: { key: string; count: number }[]; toneMap: Record<string, string> }) {
  const total = buckets.reduce((s, b) => s + b.count, 0)
  return (
    <div className="space-y-3">
      {buckets
        .slice()
        .sort((a, b) => b.count - a.count)
        .map((b) => {
          const share = total > 0 ? (b.count / total) * 100 : 0
          return (
            <div key={b.key}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2 capitalize text-zinc-200">
                  <span className={`h-2.5 w-2.5 rounded-full ${toneMap[b.key] ?? 'bg-zinc-500'}`} />
                  {b.key}
                </span>
                <span className="tabular-nums text-zinc-400">{b.count}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div className={`h-full rounded-full ${toneMap[b.key] ?? 'bg-zinc-500'}`} style={{ width: `${share}%` }} />
              </div>
            </div>
          )
        })}
    </div>
  )
}

function coverageColor(p: number) {
  if (p >= 90) return 'text-emerald-400'
  if (p >= 60) return 'text-amber-400'
  return 'text-rose-400'
}
function coverageBar(p: number) {
  if (p >= 90) return 'bg-emerald-500'
  if (p >= 60) return 'bg-amber-500'
  return 'bg-rose-500'
}
