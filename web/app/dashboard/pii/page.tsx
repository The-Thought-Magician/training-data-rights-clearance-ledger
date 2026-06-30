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

type Screening = {
  id: string
  source_id: string
  status: string
  method?: string | null
  reviewer?: string | null
  pii_categories?: unknown
  lawful_basis?: string | null
  anonymization_status?: string | null
  anonymization_technique?: string | null
  remediation_action?: string | null
  remediation_owner?: string | null
  remediation_due?: string | null
  remediation_status?: string | null
  notes?: string | null
  screened_at?: string | null
  created_at?: string
}

type Source = { id: string; name: string }

const STATUSES = ['not-started', 'in-progress', 'passed', 'flagged', 'failed'] as const
const METHODS = ['manual-review', 'automated-scan', 'regex-detector', 'ner-model', 'vendor-attestation']
const PII_CATEGORIES = [
  'names', 'email', 'phone', 'address', 'government-id', 'financial', 'health', 'biometric',
  'geolocation', 'ip-address', 'credentials', 'children-data', 'special-category',
]
const LAWFUL_BASES = ['consent', 'contract', 'legal-obligation', 'vital-interest', 'public-task', 'legitimate-interest', 'not-applicable']
const ANON_STATUSES = ['none', 'pseudonymized', 'anonymized', 'redacted', 'aggregated']

function fmtDate(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function asCategories(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string' && v.trim()) return v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
  return []
}

export default function PiiScreeningPage() {
  const [screenings, setScreenings] = useState<Screening[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Screening | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [scr, src] = await Promise.all([api.listPiiScreenings(), api.listSources()])
      setScreenings(Array.isArray(scr) ? scr : [])
      setSources(Array.isArray(src) ? src : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load PII screenings')
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
    return (id: string) => map.get(id) ?? id.slice(0, 8)
  }, [sources])

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: screenings.length }
    for (const st of STATUSES) c[st] = 0
    let withSpecial = 0
    let unanonymized = 0
    for (const s of screenings) {
      if (s.status in c) c[s.status] += 1
      const cats = asCategories(s.pii_categories)
      if (cats.some((x) => x === 'special-category' || x === 'health' || x === 'biometric' || x === 'children-data')) withSpecial += 1
      if (!s.anonymization_status || s.anonymization_status === 'none') {
        if (cats.length > 0) unanonymized += 1
      }
    }
    c.withSpecial = withSpecial
    c.unanonymized = unanonymized
    return c
  }, [screenings])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return screenings.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (!q) return true
      const name = sourceName(s.source_id).toLowerCase()
      return (
        name.includes(q) ||
        (s.reviewer ?? '').toLowerCase().includes(q) ||
        (s.lawful_basis ?? '').toLowerCase().includes(q) ||
        asCategories(s.pii_categories).join(' ').toLowerCase().includes(q)
      )
    })
  }, [screenings, statusFilter, search, sourceName])

  async function quickStatus(s: Screening, status: string) {
    setScreenings((prev) => prev.map((x) => (x.id === s.id ? { ...x, status } : x)))
    try {
      const updated = await api.updatePiiScreening(s.id, { status, screened_at: new Date().toISOString() })
      setScreenings((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...updated } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
      load()
    }
  }

  if (loading) return <PageSpinner label="Loading PII screenings..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">PII Screening</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Detect and document personal data, lawful basis, and anonymization across training sources.
          </p>
        </div>
        <Button onClick={() => { setFormError(null); setCreateOpen(true) }}>+ New Screening</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
          <button onClick={load} className="ml-3 underline hover:text-red-200">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total" value={counts.total} />
        <Stat label="In Progress" value={counts['in-progress']} tone="amber" />
        <Stat label="Passed" value={counts.passed} tone="green" />
        <Stat label="Flagged" value={counts.flagged} tone="amber" />
        <Stat label="Special-Category" value={counts.withSpecial} tone="rose" />
        <Stat label="Un-anonymized" value={counts.unanonymized} tone="red" />
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
              All ({counts.total})
            </FilterChip>
            {STATUSES.map((st) => (
              <FilterChip key={st} active={statusFilter === st} onClick={() => setStatusFilter(st)}>
                {st} ({counts[st]})
              </FilterChip>
            ))}
          </div>
          <div className="ml-auto">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search source, reviewer, category, basis..."
              className="w-64 max-w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-rose-600 focus:outline-none"
            />
          </div>
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon="🛡"
          title={screenings.length === 0 ? 'No PII screenings yet' : 'No screenings match your filters'}
          description={
            screenings.length === 0
              ? 'Start a PII screening on a data source to record detected categories and lawful basis.'
              : 'Try clearing the search or selecting a different status.'
          }
          action={
            screenings.length === 0 ? (
              <Button onClick={() => { setFormError(null); setCreateOpen(true) }}>+ New Screening</Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th>PII Categories</Th>
              <Th>Lawful Basis</Th>
              <Th>Anonymization</Th>
              <Th>Reviewer</Th>
              <Th>Screened</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map((s) => {
              const cats = asCategories(s.pii_categories)
              return (
                <Tr key={s.id}>
                  <Td className="font-medium text-zinc-100">{sourceName(s.source_id)}</Td>
                  <Td><Badge>{s.status}</Badge></Td>
                  <Td>
                    {cats.length === 0 ? (
                      <span className="text-zinc-600">none</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {cats.slice(0, 3).map((c) => (
                          <Badge key={c} tone={SENSITIVE.has(c) ? 'rose' : 'zinc'}>{c}</Badge>
                        ))}
                        {cats.length > 3 && <Badge tone="zinc">+{cats.length - 3}</Badge>}
                      </div>
                    )}
                  </Td>
                  <Td className="text-zinc-400">{s.lawful_basis || '—'}</Td>
                  <Td>
                    {s.anonymization_status && s.anonymization_status !== 'none' ? (
                      <Badge tone="green">{s.anonymization_status}</Badge>
                    ) : (
                      <Badge tone="zinc">none</Badge>
                    )}
                  </Td>
                  <Td className="text-zinc-400">{s.reviewer || '—'}</Td>
                  <Td className="text-zinc-400">{fmtDate(s.screened_at)}</Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <select
                        value={s.status}
                        onChange={(e) => quickStatus(s, e.target.value)}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-rose-600 focus:outline-none"
                        aria-label="Set status"
                      >
                        {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                      </select>
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setFormError(null); setEditing(s) }}>
                        Edit
                      </Button>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      )}

      {createOpen && (
        <ScreeningForm
          mode="create"
          sources={sources}
          busy={busy}
          error={formError}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (body) => {
            setBusy(true)
            setFormError(null)
            try {
              const created = await api.createPiiScreening(body)
              setScreenings((prev) => [created, ...prev])
              setCreateOpen(false)
            } catch (e) {
              setFormError(e instanceof Error ? e.message : 'Failed to create screening')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}

      {editing && (
        <ScreeningForm
          mode="edit"
          sources={sources}
          initial={editing}
          busy={busy}
          error={formError}
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            setBusy(true)
            setFormError(null)
            try {
              const updated = await api.updatePiiScreening(editing.id, body)
              setScreenings((prev) => prev.map((x) => (x.id === editing.id ? { ...x, ...updated } : x)))
              setEditing(null)
            } catch (e) {
              setFormError(e instanceof Error ? e.message : 'Failed to update screening')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}

const SENSITIVE = new Set(['special-category', 'health', 'biometric', 'children-data', 'government-id', 'financial'])

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
        active
          ? 'border-rose-600 bg-rose-950/40 text-rose-300'
          : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function ScreeningForm({
  mode,
  sources,
  initial,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  sources: Source[]
  initial?: Screening
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [sourceId, setSourceId] = useState(initial?.source_id ?? (sources[0]?.id ?? ''))
  const [status, setStatus] = useState(initial?.status ?? 'not-started')
  const [method, setMethod] = useState(initial?.method ?? '')
  const [reviewer, setReviewer] = useState(initial?.reviewer ?? '')
  const [cats, setCats] = useState<string[]>(asCategories(initial?.pii_categories))
  const [lawfulBasis, setLawfulBasis] = useState(initial?.lawful_basis ?? '')
  const [anonStatus, setAnonStatus] = useState(initial?.anonymization_status ?? 'none')
  const [anonTech, setAnonTech] = useState(initial?.anonymization_technique ?? '')
  const [remAction, setRemAction] = useState(initial?.remediation_action ?? '')
  const [remOwner, setRemOwner] = useState(initial?.remediation_owner ?? '')
  const [remDue, setRemDue] = useState(initial?.remediation_due ? initial.remediation_due.slice(0, 10) : '')
  const [remStatus, setRemStatus] = useState(initial?.remediation_status ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  function toggleCat(c: string) {
    setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  function submit() {
    const body: Record<string, unknown> = {
      source_id: sourceId,
      status,
      method: method || null,
      reviewer: reviewer || null,
      pii_categories: cats,
      lawful_basis: lawfulBasis || null,
      anonymization_status: anonStatus || null,
      anonymization_technique: anonTech || null,
      remediation_action: remAction || null,
      remediation_owner: remOwner || null,
      remediation_due: remDue || null,
      remediation_status: remStatus || null,
      notes: notes || null,
    }
    if (status === 'passed' || status === 'flagged' || status === 'failed') {
      body.screened_at = initial?.screened_at ?? new Date().toISOString()
    }
    onSubmit(body)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'New PII Screening' : 'Edit PII Screening'}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !sourceId}>
            {busy ? <Spinner label={mode === 'create' ? 'Creating...' : 'Saving...'} /> : mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Data Source" required>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={inputCls} disabled={mode === 'edit'}>
              {sources.length === 0 && <option value="">No sources available</option>}
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          </Field>
          <Field label="Method">
            <input list="pii-methods" value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls} placeholder="e.g. ner-model" />
            <datalist id="pii-methods">
              {METHODS.map((m) => <option key={m} value={m} />)}
            </datalist>
          </Field>
          <Field label="Reviewer">
            <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} className={inputCls} placeholder="Reviewer name" />
          </Field>
        </div>

        <Field label="PII Categories" hint="Click to toggle">
          <div className="flex flex-wrap gap-1.5">
            {PII_CATEGORIES.map((c) => {
              const on = cats.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCat(c)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    on
                      ? SENSITIVE.has(c)
                        ? 'border-rose-700 bg-rose-950/60 text-rose-300'
                        : 'border-rose-600 bg-rose-950/40 text-rose-300'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {c}
                </button>
              )
            })}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Lawful Basis">
            <select value={lawfulBasis} onChange={(e) => setLawfulBasis(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {LAWFUL_BASES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Anonymization Status">
            <select value={anonStatus} onChange={(e) => setAnonStatus(e.target.value)} className={inputCls}>
              {ANON_STATUSES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Anonymization Technique">
            <input value={anonTech} onChange={(e) => setAnonTech(e.target.value)} className={inputCls} placeholder="e.g. k-anonymity, hashing" />
          </Field>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Remediation</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Action">
              <input value={remAction} onChange={(e) => setRemAction(e.target.value)} className={inputCls} placeholder="e.g. redact email fields" />
            </Field>
            <Field label="Owner">
              <input value={remOwner} onChange={(e) => setRemOwner(e.target.value)} className={inputCls} placeholder="Responsible person" />
            </Field>
            <Field label="Due Date">
              <input type="date" value={remDue} onChange={(e) => setRemDue(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Remediation Status">
              <select value={remStatus} onChange={(e) => setRemStatus(e.target.value)} className={inputCls}>
                <option value="">—</option>
                <option value="open">open</option>
                <option value="in-progress">in-progress</option>
                <option value="done">done</option>
              </select>
            </Field>
          </div>
        </div>

        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} placeholder="Context, findings, decisions..." />
        </Field>
      </div>
    </Modal>
  )
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-rose-600 focus:outline-none'

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-zinc-400">
        {label} {required && <span className="text-rose-500">*</span>}
        {hint && <span className="font-normal text-zinc-600">— {hint}</span>}
      </span>
      {children}
    </label>
  )
}
