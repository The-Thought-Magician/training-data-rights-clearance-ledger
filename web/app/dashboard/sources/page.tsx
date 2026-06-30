'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'

interface DataSource {
  id: string
  name: string
  description?: string
  source_type?: string
  modality?: string
  vendor?: string
  collection?: string
  record_count?: number
  status?: string
  risk_score?: number
  created_at?: string
  updated_at?: string
}

const STATUSES = ['draft', 'review', 'cleared', 'blocked', 'retired']

function riskTone(score?: number): { tone: 'green' | 'amber' | 'red' | 'zinc'; label: string } {
  if (score == null) return { tone: 'zinc', label: 'n/a' }
  const pct = score > 1 ? score : score * 100
  if (pct >= 70) return { tone: 'red', label: `${Math.round(pct)} high` }
  if (pct >= 40) return { tone: 'amber', label: `${Math.round(pct)} med` }
  return { tone: 'green', label: `${Math.round(pct)} low` }
}

function fmtCount(n?: number): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export default function SourcesPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sources, setSources] = useState<DataSource[]>([])

  const [status, setStatus] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [collection, setCollection] = useState('')
  const [q, setQ] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = {}
      if (status) params.status = status
      if (sourceType) params.source_type = sourceType
      if (collection) params.collection = collection
      if (q) params.q = q
      const data = await api.listSources(Object.keys(params).length ? params : undefined)
      setSources(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sources')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sourceType, collection])

  // Source-type and collection options derived from loaded rows (so filters reflect real data).
  const typeOptions = useMemo(
    () => Array.from(new Set(sources.map((s) => s.source_type).filter(Boolean))) as string[],
    [sources],
  )
  const collectionOptions = useMemo(
    () => Array.from(new Set(sources.map((s) => s.collection).filter(Boolean))) as string[],
    [sources],
  )

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    load()
  }

  function clearFilters() {
    setStatus('')
    setSourceType('')
    setCollection('')
    setQ('')
  }

  const hasFilters = status || sourceType || collection || q

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Source register</h1>
          <p className="mt-1 text-sm text-zinc-500">Every data source and its clearance posture.</p>
        </div>
        <Link href="/dashboard/sources/new">
          <Button>Register source</Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <form onSubmit={onSearch} className="flex flex-1 gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, vendor, description..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          <div className="flex flex-wrap gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
            >
              <option value="">All types</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <select
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
            >
              <option value="">All collections</option>
              {collectionOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {hasFilters && (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <PageSpinner label="Loading sources..." />
      ) : error ? (
        <EmptyState
          title="Could not load sources"
          description={error}
          icon="⚠️"
          action={
            <Button onClick={load} variant="secondary">
              Retry
            </Button>
          }
        />
      ) : sources.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'No matching sources' : 'No sources registered'}
          description={
            hasFilters
              ? 'Try adjusting or clearing your filters.'
              : 'Register your first data source to begin tracking rights clearance.'
          }
          icon="📦"
          action={
            hasFilters ? (
              <Button onClick={clearFilters} variant="secondary">
                Clear filters
              </Button>
            ) : (
              <Link href="/dashboard/sources/new">
                <Button>Register source</Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            {sources.length} source{sources.length === 1 ? '' : 's'}
          </p>
          <Table>
            <Thead>
              <Tr>
                <Th>Source</Th>
                <Th>Type</Th>
                <Th>Modality</Th>
                <Th>Vendor</Th>
                <Th className="text-right">Records</Th>
                <Th>Status</Th>
                <Th>Risk</Th>
              </Tr>
            </Thead>
            <Tbody>
              {sources.map((s) => {
                const r = riskTone(s.risk_score)
                return (
                  <Tr key={s.id} className="cursor-pointer">
                    <Td>
                      <Link href={`/dashboard/sources/${s.id}`} className="block">
                        <div className="font-medium text-zinc-100 hover:text-rose-400">{s.name}</div>
                        {s.collection && <div className="text-xs text-zinc-600">{s.collection}</div>}
                      </Link>
                    </Td>
                    <Td>{s.source_type || '—'}</Td>
                    <Td>{s.modality || '—'}</Td>
                    <Td>{s.vendor || '—'}</Td>
                    <Td className="text-right tabular-nums">{fmtCount(s.record_count)}</Td>
                    <Td>{s.status ? <Badge>{s.status}</Badge> : '—'}</Td>
                    <Td>
                      <Badge tone={r.tone}>{r.label}</Badge>
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        </div>
      )}
    </div>
  )
}
