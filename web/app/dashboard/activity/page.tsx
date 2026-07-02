'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface ActivityLog {
  id: string
  workspace_id: string
  actor_id: string | null
  entity_type: string | null
  entity_id: string | null
  action: string | null
  detail: string | null
  created_at: string
}

const PAGE_SIZE = 50

// Route a small set of known entity types back to their detail/list pages.
function entityHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null
  switch (entityType) {
    case 'source':
    case 'data_source':
      return `/dashboard/sources/${entityId}`
    case 'claim':
      return `/dashboard/claims/${entityId}`
    case 'model_version':
    case 'model':
      return `/dashboard/models/${entityId}`
    default:
      return null
  }
}

function actionTone(action: string | null): 'green' | 'red' | 'amber' | 'blue' | 'zinc' | 'purple' {
  const a = (action ?? '').toLowerCase()
  if (/(creat|add|issue|generat|release|bind)/.test(a)) return 'green'
  if (/(delet|remov|block|reject|fail|quarantine)/.test(a)) return 'red'
  if (/(updat|edit|chang|recompute|evaluate)/.test(a)) return 'amber'
  if (/(override)/.test(a)) return 'purple'
  if (/(approv|clear|apply|resolv)/.test(a)) return 'blue'
  return 'zinc'
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function ActivityFeedPage() {
  const [entries, setEntries] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)

  // Filters
  const [q, setQ] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [entityTypeFilter, setEntityTypeFilter] = useState('')

  async function load(reset = true) {
    if (reset) {
      setLoading(true)
      setError(null)
    } else {
      setLoadingMore(true)
    }
    const nextOffset = reset ? 0 : offset
    try {
      const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: nextOffset }
      if (actorFilter.trim()) params.actor_id = actorFilter.trim()
      if (entityTypeFilter.trim()) params.entity_type = entityTypeFilter.trim()
      const data = await api.listActivity(params)
      const list: ActivityLog[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
      setHasMore(list.length === PAGE_SIZE)
      setOffset(nextOffset + list.length)
      setEntries((prev) => (reset ? list : [...prev, ...list]))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // Reload from the server whenever a server-side filter changes.
  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorFilter, entityTypeFilter])

  // Client-side free-text search over already-loaded rows.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((e) => {
      const hay = `${e.action ?? ''} ${e.detail ?? ''} ${e.entity_type ?? ''} ${e.entity_id ?? ''} ${e.actor_id ?? ''}`.toLowerCase()
      return hay.includes(needle)
    })
  }, [entries, q])

  const entityTypes = useMemo(
    () => Array.from(new Set(entries.map((e) => e.entity_type).filter(Boolean))) as string[],
    [entries],
  )

  // Group filtered rows by day for the timeline.
  const groups = useMemo(() => {
    const map = new Map<string, ActivityLog[]>()
    for (const e of filtered) {
      const key = dayLabel(e.created_at)
      const arr = map.get(key)
      if (arr) arr.push(e)
      else map.set(key, [e])
    }
    return Array.from(map.entries())
  }, [filtered])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Audit Trail</h1>
          <p className="mt-1 text-sm text-slate-500">
            Chronological record of every consequential action across the rights-clearance ledger.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load(true)} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search action, detail, entity..."
          className="w-72 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
        />
        <select
          value={entityTypeFilter}
          onChange={(e) => setEntityTypeFilter(e.target.value)}
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
        >
          <option value="">All entity types</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          placeholder="Filter by actor id"
          className="w-56 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none"
        />
        {(q || actorFilter || entityTypeFilter) && (
          <Button
            variant="ghost"
            onClick={() => {
              setQ('')
              setActorFilter('')
              setEntityTypeFilter('')
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {loading ? (
        <PageSpinner label="Loading activity..." />
      ) : error ? (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-red-300">{error}</p>
              <Button variant="secondary" onClick={() => void load(true)}>
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No activity"
          description={
            q || actorFilter || entityTypeFilter
              ? 'No events match the current filters.'
              : 'Actions across sources, licenses, clearances, and claims will appear here.'
          }
        />
      ) : (
        <div className="space-y-8">
          {groups.map(([label, rows]) => (
            <div key={label}>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
              <ol className="relative space-y-0 border-l border-slate-800 pl-6">
                {rows.map((e) => {
                  const href = entityHref(e.entity_type, e.entity_id)
                  return (
                    <li key={e.id} className="relative pb-5 last:pb-0">
                      <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-fuchsia-500" />
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={actionTone(e.action)}>{e.action ?? 'event'}</Badge>
                        {e.entity_type && (
                          <span className="text-xs text-slate-500">
                            on <span className="text-slate-300">{e.entity_type}</span>
                          </span>
                        )}
                        {href ? (
                          <Link href={href} className="font-mono text-xs text-fuchsia-400 hover:underline">
                            {e.entity_id?.slice(0, 8)}
                          </Link>
                        ) : (
                          e.entity_id && <span className="font-mono text-xs text-slate-500">{e.entity_id.slice(0, 8)}</span>
                        )}
                        <span className="ml-auto text-xs text-slate-600" title={new Date(e.created_at).toLocaleString()}>
                          {relativeTime(e.created_at)}
                        </span>
                      </div>
                      {e.detail && <p className="mt-1 text-sm text-slate-300">{e.detail}</p>}
                      {e.actor_id && (
                        <p className="mt-1 text-xs text-slate-600">
                          actor <span className="font-mono">{e.actor_id.slice(0, 12)}</span>
                        </p>
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}

          {!q && hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="secondary" onClick={() => void load(false)} disabled={loadingMore}>
                {loadingMore ? <Spinner label="Loading..." /> : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
