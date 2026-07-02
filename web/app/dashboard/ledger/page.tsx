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

interface LedgerEntry {
  id: string
  seq: number
  entity_type?: string
  entity_id?: string
  action?: string
  payload?: Record<string, unknown> | null
  actor_id?: string | null
  prev_hash?: string | null
  entry_hash?: string | null
  created_at?: string
}

interface VerifyResult {
  valid: boolean
  brokenAt?: number | null
  count: number
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function shortHash(h?: string | null): string {
  if (!h) return '—'
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h
}

export default function LedgerPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const [search, setSearch] = useState('')
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('all')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [detail, setDetail] = useState<LedgerEntry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [le, vr] = await Promise.all([api.listLedger(), api.verifyLedger()])
      setEntries(Array.isArray(le) ? le : [])
      setVerify(vr && typeof vr.valid === 'boolean' ? vr : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ledger')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const runVerify = async () => {
    setVerifying(true)
    setError(null)
    try {
      const vr = await api.verifyLedger()
      setVerify(vr && typeof vr.valid === 'boolean' ? vr : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  const entityTypes = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.entity_type) set.add(e.entity_type)
    return Array.from(set).sort()
  }, [entries])

  const actions = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.action) set.add(e.action)
    return Array.from(set).sort()
  }, [entries])

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.seq - a.seq),
    [entries],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sorted
      .filter((e) => (entityTypeFilter === 'all' ? true : e.entity_type === entityTypeFilter))
      .filter((e) => (actionFilter === 'all' ? true : e.action === actionFilter))
      .filter((e) =>
        q
          ? (e.entity_type ?? '').toLowerCase().includes(q) ||
            (e.action ?? '').toLowerCase().includes(q) ||
            (e.entity_id ?? '').toLowerCase().includes(q) ||
            (e.actor_id ?? '').toLowerCase().includes(q) ||
            String(e.seq).includes(q) ||
            (e.entry_hash ?? '').toLowerCase().includes(q)
          : true,
      )
  }, [sorted, entityTypeFilter, actionFilter, search])

  const stats = useMemo(() => {
    const actors = new Set<string>()
    for (const e of entries) if (e.actor_id) actors.add(e.actor_id)
    const last = sorted[0]
    return {
      total: entries.length,
      entities: entityTypes.length,
      actors: actors.size,
      lastAt: last?.created_at,
    }
  }, [entries, sorted, entityTypes])

  if (loading) return <PageSpinner label="Loading evidence ledger..." />

  const verified = verify?.valid === true
  const brokenAt = verify?.brokenAt

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Evidence Ledger</h1>
          <p className="mt-1 text-sm text-slate-500">
            Append-only, hash-chained record of every consequential action. Each entry links to the
            previous via its hash, making tampering detectable.
          </p>
        </div>
        <Button variant="secondary" onClick={runVerify} disabled={verifying}>
          {verifying ? <Spinner label="Verifying..." /> : 'Re-verify chain'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Chain-verify banner */}
      {verify && (
        <div
          className={`flex flex-col gap-2 rounded-xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
            verified
              ? 'border-emerald-800/60 bg-emerald-950/30'
              : 'border-red-800 bg-red-950/40'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className={`text-2xl ${verified ? 'text-emerald-400' : 'text-red-400'}`}>
              {verified ? '🔒' : '⚠️'}
            </span>
            <div>
              <div className={`text-sm font-semibold ${verified ? 'text-emerald-300' : 'text-red-300'}`}>
                {verified ? 'Hash chain intact' : 'Hash chain broken'}
              </div>
              <div className="text-xs text-slate-400">
                {verified
                  ? `All ${verify.count} entries verify against their predecessor hashes.`
                  : brokenAt != null
                    ? `Tampering detected: chain breaks at sequence #${brokenAt} of ${verify.count} entries.`
                    : `Chain verification failed across ${verify.count} entries.`}
              </div>
            </div>
          </div>
          <Badge tone={verified ? 'green' : 'red'}>{verified ? 'verified' : 'compromised'}</Badge>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Ledger entries" value={stats.total} />
        <Stat label="Entity types" value={stats.entities} />
        <Stat label="Distinct actors" value={stats.actors} />
        <Stat label="Last entry" value={stats.lastAt ? fmtDate(stats.lastAt).split(',')[0] : '—'} tone="rose" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <select
            value={entityTypeFilter}
            onChange={(e) => setEntityTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
          >
            <option value="all">All entity types</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
          >
            <option value="all">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search seq, hash, entity, actor..."
          className="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none lg:w-72"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={entries.length === 0 ? 'Ledger is empty' : 'No entries match'}
          description={
            entries.length === 0
              ? 'Consequential actions across the platform append hash-chained entries here.'
              : 'Try a different filter or clear the search.'
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Chain entries</h2>
            <span className="text-xs text-slate-500">
              showing {filtered.length} of {entries.length}
            </span>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <Thead>
                <Tr>
                  <Th>Seq</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Actor</Th>
                  <Th>Prev → Entry hash</Th>
                  <Th>Recorded</Th>
                  <Th className="text-right">Payload</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filtered.map((e) => {
                  const isBreak = brokenAt != null && e.seq === brokenAt
                  return (
                    <Tr key={e.id} className={isBreak ? 'bg-red-950/30' : ''}>
                      <Td className="font-mono text-xs tabular-nums text-slate-400">#{e.seq}</Td>
                      <Td>{e.action ? <Badge tone="blue">{e.action}</Badge> : '—'}</Td>
                      <Td>
                        <div className="text-slate-200">{e.entity_type ?? '—'}</div>
                        {e.entity_id && (
                          <div className="font-mono text-[11px] text-slate-600">
                            {String(e.entity_id).slice(0, 12)}
                          </div>
                        )}
                      </Td>
                      <Td className="text-xs text-slate-500">{e.actor_id ?? '—'}</Td>
                      <Td>
                        <div className="flex items-center gap-1 font-mono text-[11px]">
                          <span className="text-slate-600">{shortHash(e.prev_hash)}</span>
                          <span className="text-slate-700">→</span>
                          <span className="text-fuchsia-400">{shortHash(e.entry_hash)}</span>
                        </div>
                      </Td>
                      <Td className="text-xs text-slate-500">{fmtDate(e.created_at)}</Td>
                      <Td className="text-right">
                        <Button
                          variant="ghost"
                          className="px-2.5 py-1.5 text-xs"
                          onClick={() => setDetail(e)}
                        >
                          View
                        </Button>
                      </Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* Entry detail modal */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `Ledger entry #${detail.seq}` : 'Ledger entry'}
        className="max-w-2xl"
        footer={<Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Action</div>
                <div className="text-slate-200">{detail.action ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Recorded at</div>
                <div className="text-slate-200">{fmtDate(detail.created_at)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Entity type</div>
                <div className="text-slate-200">{detail.entity_type ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Actor</div>
                <div className="text-slate-200">{detail.actor_id ?? '—'}</div>
              </div>
            </div>
            {detail.entity_id && (
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Entity id</div>
                <div className="break-all font-mono text-xs text-slate-300">{detail.entity_id}</div>
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Previous hash</div>
              <div className="break-all font-mono text-xs text-slate-500">{detail.prev_hash ?? '— (genesis)'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Entry hash</div>
              <div className="break-all font-mono text-xs text-fuchsia-400">{detail.entry_hash ?? '—'}</div>
            </div>
            {detail.payload && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Payload</div>
                <pre className="max-h-64 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
                  {JSON.stringify(detail.payload, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
