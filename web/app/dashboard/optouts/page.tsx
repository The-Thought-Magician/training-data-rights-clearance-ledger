'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table'

type Optout = {
  id: string
  source_id?: string | null
  rights_holder_id?: string | null
  subject_identity?: string | null
  optout_type: string
  scope?: string | null
  channel?: string | null
  received_at?: string | null
  honor_status: string
  rejection_reason?: string | null
  applied_at?: string | null
  notes?: string | null
  created_at?: string
}

type PreferenceSignal = {
  id: string
  source_id?: string | null
  signal_type: string
  directive: string
  captured_url?: string | null
  snapshot_ref?: string | null
  snapshot_sha256?: string | null
  captured_at?: string | null
  recheck_due?: string | null
  created_at?: string
}

type Source = { id: string; name: string }

const OPTOUT_TYPES = ['individual', 'rights-holder'] as const
const HONOR_STATUSES = ['pending', 'applied', 'rejected'] as const
const CHANNELS = ['email', 'web-form', 'api', 'postal', 'agent', 'legal-notice']
const SIGNAL_TYPES = ['robots.txt', 'ai.txt', 'tdm-reservation', 'noai', 'noimageai']
const DIRECTIVES = ['allow', 'disallow'] as const

function fmtDate(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function isPast(v?: string | null) {
  if (!v) return false
  const d = new Date(v)
  return !isNaN(d.getTime()) && d.getTime() < Date.now()
}

export default function OptoutsPage() {
  const [tab, setTab] = useState<'optouts' | 'signals'>('optouts')

  const [optouts, setOptouts] = useState<Optout[]>([])
  const [signals, setSignals] = useState<PreferenceSignal[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [createOptoutOpen, setCreateOptoutOpen] = useState(false)
  const [createSignalOpen, setCreateSignalOpen] = useState(false)
  const [rejecting, setRejecting] = useState<Optout | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [oo, sig, src] = await Promise.all([
        api.listOptouts(),
        api.listPreferenceSignals(),
        api.listSources(),
      ])
      setOptouts(Array.isArray(oo) ? oo : [])
      setSignals(Array.isArray(sig) ? sig : [])
      setSources(Array.isArray(src) ? src : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load opt-outs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const sourceName = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sources) map.set(s.id, s.name)
    return (id?: string | null) => (id ? map.get(id) ?? id.slice(0, 8) : 'Workspace-wide')
  }, [sources])

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: optouts.length, pending: 0, applied: 0, rejected: 0, individual: 0 }
    for (const o of optouts) {
      if (o.honor_status in c) c[o.honor_status] += 1
      if (o.optout_type === 'individual') c.individual += 1
    }
    return c
  }, [optouts])

  const signalCounts = useMemo(() => {
    let disallow = 0
    let recheckDue = 0
    for (const s of signals) {
      if (s.directive === 'disallow') disallow += 1
      if (isPast(s.recheck_due)) recheckDue += 1
    }
    return { total: signals.length, disallow, recheckDue }
  }, [signals])

  const filteredOptouts = useMemo(() => {
    const q = search.toLowerCase().trim()
    return optouts.filter((o) => {
      if (statusFilter !== 'all' && o.honor_status !== statusFilter) return false
      if (!q) return true
      return (
        (o.subject_identity ?? '').toLowerCase().includes(q) ||
        sourceName(o.source_id).toLowerCase().includes(q) ||
        (o.scope ?? '').toLowerCase().includes(q) ||
        (o.channel ?? '').toLowerCase().includes(q)
      )
    })
  }, [optouts, statusFilter, search, sourceName])

  const filteredSignals = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return signals
    return signals.filter(
      (s) =>
        s.signal_type.toLowerCase().includes(q) ||
        (s.captured_url ?? '').toLowerCase().includes(q) ||
        sourceName(s.source_id).toLowerCase().includes(q),
    )
  }, [signals, search, sourceName])

  async function apply(o: Optout) {
    setRowBusy(o.id)
    try {
      const updated = await api.applyOptout(o.id)
      setOptouts((prev) => prev.map((x) => (x.id === o.id ? { ...x, ...updated } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply opt-out')
    } finally {
      setRowBusy(null)
    }
  }

  async function doReject() {
    if (!rejecting) return
    setBusy(true)
    setFormError(null)
    try {
      const updated = await api.rejectOptout(rejecting.id, { rejection_reason: rejectReason })
      setOptouts((prev) => prev.map((x) => (x.id === rejecting.id ? { ...x, ...updated } : x)))
      setRejecting(null)
      setRejectReason('')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to reject opt-out')
    } finally {
      setBusy(false)
    }
  }

  async function deleteSignal(s: PreferenceSignal) {
    setRowBusy(s.id)
    try {
      await api.deletePreferenceSignal(s.id)
      setSignals((prev) => prev.filter((x) => x.id !== s.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete signal')
    } finally {
      setRowBusy(null)
    }
  }

  if (loading) return <PageSpinner label="Loading opt-out register..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Opt-Outs &amp; Preference Signals</h1>
          <p className="mt-1 text-sm text-slate-500">
            Honor opt-out requests and machine-readable training preferences (robots.txt, ai.txt, TDM reservations).
          </p>
        </div>
        {tab === 'optouts' ? (
          <Button onClick={() => { setFormError(null); setCreateOptoutOpen(true) }}>+ Record Opt-Out</Button>
        ) : (
          <Button onClick={() => { setFormError(null); setCreateSignalOpen(true) }}>+ Capture Signal</Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
          <button onClick={load} className="ml-3 underline hover:text-red-200">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Opt-Outs" value={counts.total} />
        <Stat label="Pending" value={counts.pending} tone="amber" />
        <Stat label="Applied" value={counts.applied} tone="green" />
        <Stat label="Rejected" value={counts.rejected} tone="red" />
        <Stat label="Disallow Signals" value={signalCounts.disallow} tone="rose" />
        <Stat label="Recheck Due" value={signalCounts.recheckDue} tone="amber" />
      </div>

      <div className="flex items-center gap-2 border-b border-slate-800">
        <TabButton active={tab === 'optouts'} onClick={() => { setTab('optouts'); setStatusFilter('all') }}>
          Opt-Out Register ({counts.total})
        </TabButton>
        <TabButton active={tab === 'signals'} onClick={() => { setTab('signals'); setStatusFilter('all') }}>
          Preference Signals ({signalCounts.total})
        </TabButton>
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          {tab === 'optouts' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
                All ({counts.total})
              </FilterChip>
              {HONOR_STATUSES.map((st) => (
                <FilterChip key={st} active={statusFilter === st} onClick={() => setStatusFilter(st)}>
                  {st} ({counts[st]})
                </FilterChip>
              ))}
            </div>
          )}
          <div className="ml-auto">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'optouts' ? 'Search subject, source, scope...' : 'Search signal type, URL, source...'}
              className="w-64 max-w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-600 focus:outline-none"
            />
          </div>
        </CardBody>
      </Card>

      {tab === 'optouts' ? (
        filteredOptouts.length === 0 ? (
          <EmptyState
            icon="🚫"
            title={optouts.length === 0 ? 'No opt-outs recorded' : 'No opt-outs match your filters'}
            description={
              optouts.length === 0
                ? 'Record an opt-out request to track suppression of a subject or rights-holder.'
                : 'Try clearing the search or selecting a different status.'
            }
            action={
              optouts.length === 0 ? (
                <Button onClick={() => { setFormError(null); setCreateOptoutOpen(true) }}>+ Record Opt-Out</Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Subject</Th>
                <Th>Type</Th>
                <Th>Source</Th>
                <Th>Scope</Th>
                <Th>Channel</Th>
                <Th>Status</Th>
                <Th>Received</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filteredOptouts.map((o) => (
                <Tr key={o.id}>
                  <Td className="font-medium text-slate-100">
                    {o.subject_identity || '—'}
                    {o.rejection_reason && o.honor_status === 'rejected' && (
                      <div className="mt-0.5 text-xs text-red-400/80">Reason: {o.rejection_reason}</div>
                    )}
                  </Td>
                  <Td><Badge tone={o.optout_type === 'rights-holder' ? 'purple' : 'blue'}>{o.optout_type}</Badge></Td>
                  <Td className="text-slate-400">{sourceName(o.source_id)}</Td>
                  <Td className="text-slate-400">{o.scope || '—'}</Td>
                  <Td className="text-slate-400">{o.channel || '—'}</Td>
                  <Td>
                    <Badge>{o.honor_status}</Badge>
                    {o.applied_at && <div className="mt-0.5 text-xs text-slate-600">{fmtDate(o.applied_at)}</div>}
                  </Td>
                  <Td className="text-slate-400">{fmtDate(o.received_at)}</Td>
                  <Td className="text-right">
                    {o.honor_status === 'pending' ? (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="primary"
                          className="px-2.5 py-1 text-xs"
                          disabled={rowBusy === o.id}
                          onClick={() => apply(o)}
                        >
                          {rowBusy === o.id ? '...' : 'Apply'}
                        </Button>
                        <Button
                          variant="danger"
                          className="px-2.5 py-1 text-xs"
                          onClick={() => { setFormError(null); setRejectReason(''); setRejecting(o) }}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">{o.honor_status === 'applied' ? 'Honored' : 'Closed'}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )
      ) : filteredSignals.length === 0 ? (
        <EmptyState
          icon="🤖"
          title={signals.length === 0 ? 'No preference signals captured' : 'No signals match your search'}
          description={
            signals.length === 0
              ? 'Capture a robots.txt, ai.txt, or TDM-reservation signal with its snapshot hash for provenance.'
              : 'Try a different search term.'
          }
          action={
            signals.length === 0 ? (
              <Button onClick={() => { setFormError(null); setCreateSignalOpen(true) }}>+ Capture Signal</Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Signal Type</Th>
              <Th>Directive</Th>
              <Th>Source</Th>
              <Th>Captured URL</Th>
              <Th>Snapshot</Th>
              <Th>Captured</Th>
              <Th>Recheck Due</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filteredSignals.map((s) => (
              <Tr key={s.id}>
                <Td className="font-medium text-slate-100">{s.signal_type}</Td>
                <Td><Badge tone={s.directive === 'disallow' ? 'rose' : 'green'}>{s.directive}</Badge></Td>
                <Td className="text-slate-400">{sourceName(s.source_id)}</Td>
                <Td className="max-w-[16rem] truncate text-slate-400">
                  {s.captured_url ? (
                    <a href={s.captured_url} target="_blank" rel="noreferrer" className="text-fuchsia-400 hover:underline">
                      {s.captured_url}
                    </a>
                  ) : '—'}
                </Td>
                <Td className="font-mono text-xs text-slate-500">
                  {s.snapshot_sha256 ? s.snapshot_sha256.slice(0, 12) + '…' : '—'}
                </Td>
                <Td className="text-slate-400">{fmtDate(s.captured_at)}</Td>
                <Td className={isPast(s.recheck_due) ? 'text-amber-400' : 'text-slate-400'}>
                  {fmtDate(s.recheck_due)}
                </Td>
                <Td className="text-right">
                  <Button
                    variant="danger"
                    className="px-2.5 py-1 text-xs"
                    disabled={rowBusy === s.id}
                    onClick={() => deleteSignal(s)}
                  >
                    {rowBusy === s.id ? '...' : 'Delete'}
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {createOptoutOpen && (
        <OptoutForm
          sources={sources}
          busy={busy}
          error={formError}
          onClose={() => setCreateOptoutOpen(false)}
          onSubmit={async (body) => {
            setBusy(true)
            setFormError(null)
            try {
              const created = await api.createOptout(body)
              setOptouts((prev) => [created, ...prev])
              setCreateOptoutOpen(false)
            } catch (e) {
              setFormError(e instanceof Error ? e.message : 'Failed to record opt-out')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}

      {createSignalOpen && (
        <SignalForm
          sources={sources}
          busy={busy}
          error={formError}
          onClose={() => setCreateSignalOpen(false)}
          onSubmit={async (body) => {
            setBusy(true)
            setFormError(null)
            try {
              const created = await api.createPreferenceSignal(body)
              setSignals((prev) => [created, ...prev])
              setCreateSignalOpen(false)
            } catch (e) {
              setFormError(e instanceof Error ? e.message : 'Failed to capture signal')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}

      {rejecting && (
        <Modal
          open
          onClose={() => setRejecting(null)}
          title="Reject Opt-Out"
          footer={
            <>
              <Button variant="secondary" onClick={() => setRejecting(null)} disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={doReject} disabled={busy || !rejectReason.trim()}>
                {busy ? <Spinner label="Rejecting..." /> : 'Reject'}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {formError && (
              <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{formError}</div>
            )}
            <p className="text-sm text-slate-400">
              Rejecting <span className="text-slate-200">{rejecting.subject_identity || 'this opt-out'}</span> requires a documented reason for the audit trail.
            </p>
            <Field label="Rejection Reason" required>
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} className={inputCls} placeholder="Why is this opt-out being rejected?" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active ? 'border-fuchsia-500 text-fuchsia-300' : 'border-transparent text-slate-500 hover:text-slate-300'
      }`}
    >
      {children}
    </button>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
        active
          ? 'border-fuchsia-600 bg-fuchsia-950/40 text-fuchsia-300'
          : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function OptoutForm({
  sources,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  sources: Source[]
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [optoutType, setOptoutType] = useState<string>('individual')
  const [subjectIdentity, setSubjectIdentity] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [scope, setScope] = useState('')
  const [channel, setChannel] = useState('')
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  function submit() {
    onSubmit({
      optout_type: optoutType,
      subject_identity: subjectIdentity || null,
      source_id: sourceId || null,
      scope: scope || null,
      channel: channel || null,
      received_at: receivedAt || null,
      honor_status: 'pending',
      notes: notes || null,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record Opt-Out"
      className="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !subjectIdentity.trim()}>
            {busy ? <Spinner label="Recording..." /> : 'Record'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Opt-Out Type">
            <select value={optoutType} onChange={(e) => setOptoutType(e.target.value)} className={inputCls}>
              {OPTOUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Subject Identity" required>
            <input value={subjectIdentity} onChange={(e) => setSubjectIdentity(e.target.value)} className={inputCls} placeholder="Name, email, or holder name" />
          </Field>
          <Field label="Data Source" hint="Optional — blank = workspace-wide">
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={inputCls}>
              <option value="">Workspace-wide</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Channel">
            <input list="optout-channels" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls} placeholder="e.g. web-form" />
            <datalist id="optout-channels">
              {CHANNELS.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="Scope">
            <input value={scope} onChange={(e) => setScope(e.target.value)} className={inputCls} placeholder="e.g. all training, images only" />
          </Field>
          <Field label="Received At">
            <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} placeholder="Context, verification details..." />
        </Field>
      </div>
    </Modal>
  )
}

function SignalForm({
  sources,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  sources: Source[]
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [signalType, setSignalType] = useState('robots.txt')
  const [directive, setDirective] = useState<string>('disallow')
  const [sourceId, setSourceId] = useState('')
  const [capturedUrl, setCapturedUrl] = useState('')
  const [snapshotRef, setSnapshotRef] = useState('')
  const [snapshotSha, setSnapshotSha] = useState('')
  const [capturedAt, setCapturedAt] = useState(new Date().toISOString().slice(0, 10))
  const [recheckDue, setRecheckDue] = useState('')

  function submit() {
    onSubmit({
      signal_type: signalType,
      directive,
      source_id: sourceId || null,
      captured_url: capturedUrl || null,
      snapshot_ref: snapshotRef || null,
      snapshot_sha256: snapshotSha || null,
      captured_at: capturedAt || null,
      recheck_due: recheckDue || null,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Capture Preference Signal"
      className="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !capturedUrl.trim()}>
            {busy ? <Spinner label="Capturing..." /> : 'Capture'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Signal Type">
            <select value={signalType} onChange={(e) => setSignalType(e.target.value)} className={inputCls}>
              {SIGNAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Directive">
            <select value={directive} onChange={(e) => setDirective(e.target.value)} className={inputCls}>
              {DIRECTIVES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Data Source" hint="Optional">
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={inputCls}>
              <option value="">Unlinked</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Captured URL" required>
            <input value={capturedUrl} onChange={(e) => setCapturedUrl(e.target.value)} className={inputCls} placeholder="https://example.com/robots.txt" />
          </Field>
          <Field label="Snapshot Ref">
            <input value={snapshotRef} onChange={(e) => setSnapshotRef(e.target.value)} className={inputCls} placeholder="storage path / archive id" />
          </Field>
          <Field label="Snapshot SHA-256">
            <input value={snapshotSha} onChange={(e) => setSnapshotSha(e.target.value)} className={`${inputCls} font-mono`} placeholder="content hash" />
          </Field>
          <Field label="Captured At">
            <input type="date" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Recheck Due">
            <input type="date" value={recheckDue} onChange={(e) => setRecheckDue(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-600 focus:outline-none'

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-400">
        {label} {required && <span className="text-fuchsia-500">*</span>}
        {hint && <span className="font-normal text-slate-600">— {hint}</span>}
      </span>
      {children}
    </label>
  )
}
