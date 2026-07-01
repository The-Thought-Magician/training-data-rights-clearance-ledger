'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Stat } from '@/components/ui/Stat'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface StatusCount {
  status: string
  count: number
}
interface TopRisk {
  source_id: string
  name?: string
  composite_risk?: number
  risk_score?: number
}
interface RiskDashboard {
  statusCounts?: StatusCount[]
  topRisks?: TopRisk[]
  blocked?: number | unknown[]
  expiring?: number | unknown[]
}
interface Throughput {
  throughput?: { period?: string; cleared?: number }[]
  backlog?: number
  avgDays?: number | null
}
interface Notification {
  id: string
  kind?: string
  title?: string
  body?: string
  link?: string
  is_read?: boolean
  created_at?: string
}
interface Workspace {
  workspace?: { id: string; name?: string; slug?: string }
  role?: string
}

const STATUS_TONE: Record<string, 'green' | 'red' | 'amber' | 'zinc' | 'blue'> = {
  cleared: 'green',
  blocked: 'red',
  review: 'amber',
  draft: 'zinc',
  retired: 'zinc',
}

function countOf(v: number | unknown[] | undefined): number {
  if (Array.isArray(v)) return v.length
  return typeof v === 'number' ? v : 0
}

function fmtDate(s?: string): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [risk, setRisk] = useState<RiskDashboard | null>(null)
  const [throughput, setThroughput] = useState<Throughput | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [r, t, n, w] = await Promise.all([
          api.getRiskDashboard().catch(() => null),
          api.getClearanceThroughput().catch(() => null),
          api.listNotifications().catch(() => []),
          api.getCurrentWorkspace().catch(() => null),
        ])
        if (!active) return
        setRisk(r)
        setThroughput(t)
        setNotifications(Array.isArray(n) ? n : [])
        setWorkspace(w)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load dashboard')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  if (loading) return <PageSpinner label="Loading dashboard..." />

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-zinc-100">Dashboard</h1>
        <EmptyState
          title="Could not load dashboard"
          description={error}
          icon="⚠️"
          action={
            <Button onClick={() => location.reload()} variant="secondary">
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  const statusCounts = Array.isArray(risk?.statusCounts)
    ? (risk!.statusCounts as StatusCount[])
    : Object.entries((risk?.statusCounts as unknown as Record<string, number>) ?? {}).map(
        ([status, count]) => ({ status, count }),
      )
  const totalSources = statusCounts.reduce((a, s) => a + (s.count || 0), 0)
  const clearedCount = statusCounts.find((s) => s.status === 'cleared')?.count ?? 0
  const blocked = countOf(risk?.blocked)
  const expiring = countOf(risk?.expiring)
  const topRisks = risk?.topRisks ?? []
  const backlog = throughput?.backlog ?? 0
  const avgDays = throughput?.avgDays
  const series = throughput?.throughput ?? []
  const maxCleared = Math.max(1, ...series.map((p) => p.cleared || 0))
  const unread = notifications.filter((n) => !n.is_read)

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-zinc-100">Overview</h1>
            {workspace?.role && <Badge tone="purple">{workspace.role}</Badge>}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {workspace?.workspace?.name
              ? `Rights clearance posture for ${workspace.workspace.name}`
              : 'Portfolio-wide rights clearance posture'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/sources/new">
            <Button>Register source</Button>
          </Link>
          <Link href="/dashboard/clearance">
            <Button variant="secondary">Clearance gate</Button>
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total sources" value={totalSources} hint={`${clearedCount} cleared`} />
        <Stat label="Blocked" value={blocked} tone={blocked > 0 ? 'red' : 'default'} hint="Failing clearance" />
        <Stat
          label="Expiring licenses"
          value={expiring}
          tone={expiring > 0 ? 'amber' : 'default'}
          hint="Within renewal window"
        />
        <Stat label="Clearance backlog" value={backlog} tone={backlog > 0 ? 'rose' : 'default'} hint="Pending decisions" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sources by status */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">Sources by status</h2>
            <Link href="/dashboard/sources" className="text-xs text-rose-400 hover:text-rose-300">
              View register →
            </Link>
          </CardHeader>
          <CardBody>
            {statusCounts.length === 0 ? (
              <EmptyState
                title="No sources yet"
                description="Register a data source to begin tracking clearance."
                icon="📦"
                action={
                  <Link href="/dashboard/sources/new">
                    <Button>Register source</Button>
                  </Link>
                }
              />
            ) : (
              <div className="space-y-3">
                {statusCounts.map((s) => {
                  const pct = totalSources > 0 ? Math.round((s.count / totalSources) * 100) : 0
                  const tone = STATUS_TONE[s.status] ?? 'zinc'
                  const barColor =
                    tone === 'green'
                      ? 'bg-emerald-500'
                      : tone === 'red'
                        ? 'bg-red-500'
                        : tone === 'amber'
                          ? 'bg-amber-500'
                          : tone === 'blue'
                            ? 'bg-sky-500'
                            : 'bg-zinc-500'
                  return (
                    <div key={s.status} className="flex items-center gap-3">
                      <div className="w-24 shrink-0">
                        <Badge tone={tone}>{s.status}</Badge>
                      </div>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="w-16 shrink-0 text-right text-sm tabular-nums text-zinc-300">
                        {s.count} <span className="text-zinc-600">({pct}%)</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Risk summary */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">Top risk sources</h2>
            <Link href="/dashboard/risk" className="text-xs text-rose-400 hover:text-rose-300">
              Risk →
            </Link>
          </CardHeader>
          <CardBody>
            {topRisks.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">No risk scores computed yet.</p>
            ) : (
              <ul className="space-y-3">
                {topRisks.slice(0, 6).map((rk) => {
                  const score = rk.composite_risk ?? rk.risk_score ?? 0
                  const pct = Math.min(100, Math.round(score * (score > 1 ? 1 : 100)))
                  const tone = pct >= 70 ? 'red' : pct >= 40 ? 'amber' : 'green'
                  const bar = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
                  return (
                    <li key={rk.source_id}>
                      <Link
                        href={`/dashboard/sources/${rk.source_id}`}
                        className="block rounded-lg p-2 hover:bg-zinc-800/50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-zinc-200">{rk.name || rk.source_id}</span>
                          <span className="shrink-0 text-xs tabular-nums text-zinc-400">{pct}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                          <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Clearance throughput chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">Clearance throughput</h2>
            <span className="text-xs text-zinc-500">
              {avgDays != null ? `Avg ${Number(avgDays).toFixed(1)}d to clear` : 'No clear-time data'}
            </span>
          </CardHeader>
          <CardBody>
            {series.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">No throughput data yet.</p>
            ) : (
              <div className="flex h-40 items-end gap-2">
                {series.map((p, i) => {
                  const h = Math.round(((p.cleared || 0) / maxCleared) * 100)
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                      <div className="flex h-full w-full items-end">
                        <div
                          className="w-full rounded-t bg-rose-600/80 transition-all hover:bg-rose-500"
                          style={{ height: `${Math.max(h, 2)}%` }}
                          title={`${p.cleared ?? 0} cleared`}
                        />
                      </div>
                      <span className="truncate text-[10px] text-zinc-600">{p.period ?? i + 1}</span>
                      <span className="text-xs tabular-nums text-zinc-400">{p.cleared ?? 0}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">
              Notifications {unread.length > 0 && <Badge tone="rose">{unread.length}</Badge>}
            </h2>
            <Link href="/dashboard/notifications" className="text-xs text-rose-400 hover:text-rose-300">
              All →
            </Link>
          </CardHeader>
          <CardBody>
            {notifications.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">You're all caught up.</p>
            ) : (
              <ul className="space-y-2">
                {notifications.slice(0, 6).map((n) => {
                  const item = (
                    <div
                      className={`rounded-lg border p-3 ${
                        n.is_read ? 'border-zinc-800 bg-zinc-900/40' : 'border-rose-900/50 bg-rose-950/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-zinc-200">{n.title || n.kind || 'Notification'}</span>
                        {!n.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-500" />}
                      </div>
                      {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{n.body}</p>}
                      {n.created_at && <p className="mt-1 text-[10px] text-zinc-600">{fmtDate(n.created_at)}</p>}
                    </div>
                  )
                  return (
                    <li key={n.id}>{n.link ? <Link href={n.link}>{item}</Link> : item}</li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
