'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'

interface License {
  id: string
  source_id: string | null
  license_name: string
  license_type: string | null
  permits_ai_training: boolean
  permits_commercial: boolean
  permits_derivatives: boolean
  requires_attribution: boolean
  share_alike: boolean
  territorial_restrictions: string | null
  rights_holder_id: string | null
  document_ref: string | null
  effective_date: string | null
  expiry_date: string | null
  status: string | null
  conflict_flags: string[] | null
  notes: string | null
  created_at: string
}

type Tab = 'all' | 'conflicts' | 'expiring'

const emptyForm = {
  source_id: '',
  license_name: '',
  license_type: 'commercial',
  permits_ai_training: true,
  permits_commercial: true,
  permits_derivatives: false,
  requires_attribution: false,
  share_alike: false,
  territorial_restrictions: '',
  document_ref: '',
  effective_date: '',
  expiry_date: '',
  status: 'active',
  notes: '',
}

type FormState = typeof emptyForm

function boolBadge(v: boolean) {
  return v ? <Badge tone="green">yes</Badge> : <Badge tone="zinc">no</Badge>
}

function daysUntil(date: string | null): number | null {
  if (!date) return null
  const ms = new Date(date).getTime() - Date.now()
  return Math.ceil(ms / 86400000)
}

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<License[]>([])
  const [conflicts, setConflicts] = useState<License[]>([])
  const [expiring, setExpiring] = useState<License[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [trainingOnly, setTrainingOnly] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<License | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [a, c, e] = await Promise.all([
        api.listLicenses(),
        api.getLicenseConflicts(),
        api.getExpiringLicenses(),
      ])
      setLicenses(Array.isArray(a) ? a : [])
      setConflicts(Array.isArray(c) ? c : [])
      setExpiring(Array.isArray(e) ? e : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load licenses')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(l: License) {
    setEditing(l)
    setForm({
      source_id: l.source_id ?? '',
      license_name: l.license_name ?? '',
      license_type: l.license_type ?? 'commercial',
      permits_ai_training: !!l.permits_ai_training,
      permits_commercial: !!l.permits_commercial,
      permits_derivatives: !!l.permits_derivatives,
      requires_attribution: !!l.requires_attribution,
      share_alike: !!l.share_alike,
      territorial_restrictions: l.territorial_restrictions ?? '',
      document_ref: l.document_ref ?? '',
      effective_date: l.effective_date ? l.effective_date.slice(0, 10) : '',
      expiry_date: l.expiry_date ? l.expiry_date.slice(0, 10) : '',
      status: l.status ?? 'active',
      notes: l.notes ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submit() {
    if (!form.license_name.trim()) {
      setFormError('License name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    const body = {
      ...form,
      source_id: form.source_id.trim() || null,
      territorial_restrictions: form.territorial_restrictions.trim() || null,
      document_ref: form.document_ref.trim() || null,
      effective_date: form.effective_date || null,
      expiry_date: form.expiry_date || null,
      notes: form.notes.trim() || null,
    }
    try {
      if (editing) {
        await api.updateLicense(editing.id, body)
      } else {
        await api.createLicense(body)
      }
      setModalOpen(false)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(l: License) {
    if (!confirm(`Delete license "${l.license_name}"? This cannot be undone.`)) return
    try {
      await api.deleteLicense(l.id)
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const rows = tab === 'conflicts' ? conflicts : tab === 'expiring' ? expiring : licenses

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((l) => {
      if (needle) {
        const hay = `${l.license_name} ${l.license_type ?? ''} ${l.notes ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      if (statusFilter && (l.status ?? '') !== statusFilter) return false
      if (trainingOnly && !l.permits_ai_training) return false
      return true
    })
  }, [rows, q, statusFilter, trainingOnly])

  const trainingPermitted = licenses.filter((l) => l.permits_ai_training).length
  const statuses = useMemo(
    () => Array.from(new Set(licenses.map((l) => l.status).filter(Boolean))) as string[],
    [licenses],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">License Tracker</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Track licensing terms, conflicts, and expiries across every training data source.
          </p>
        </div>
        <Button onClick={openCreate}>+ New License</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total Licenses" value={licenses.length} />
        <Stat label="AI Training OK" value={trainingPermitted} tone="green" />
        <Stat label="Conflicts" value={conflicts.length} tone={conflicts.length ? 'red' : 'default'} />
        <Stat label="Expiring / Expired" value={expiring.length} tone={expiring.length ? 'amber' : 'default'} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800">
        {([
          ['all', `All (${licenses.length})`],
          ['conflicts', `Conflicts (${conflicts.length})`],
          ['expiring', `Expiring (${expiring.length})`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-rose-500 text-rose-300'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, type, notes..."
          className="w-64 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={trainingOnly}
            onChange={(e) => setTrainingOnly(e.target.checked)}
            className="h-4 w-4 accent-rose-600"
          />
          AI training permitted only
        </label>
      </div>

      {loading ? (
        <PageSpinner label="Loading licenses..." />
      ) : error ? (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between">
              <p className="text-sm text-red-300">{error}</p>
              <Button variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={tab === 'all' ? 'No licenses yet' : `No ${tab} licenses`}
          description={
            tab === 'all'
              ? 'Register a license to begin tracking AI-training rights and obligations.'
              : 'Nothing matches this view right now.'
          }
          action={tab === 'all' ? <Button onClick={openCreate}>+ New License</Button> : undefined}
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>License</Th>
              <Th>Type</Th>
              <Th>AI Train</Th>
              <Th>Commercial</Th>
              <Th>Derivatives</Th>
              <Th>Attribution</Th>
              <Th>Expiry</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map((l) => {
              const d = daysUntil(l.expiry_date)
              return (
                <Tr key={l.id}>
                  <Td>
                    <div className="font-medium text-zinc-100">{l.license_name}</div>
                    {l.source_id && (
                      <Link
                        href={`/dashboard/sources/${l.source_id}`}
                        className="text-xs text-rose-400 hover:underline"
                      >
                        view source
                      </Link>
                    )}
                    {l.conflict_flags && l.conflict_flags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {l.conflict_flags.map((c, i) => (
                          <Badge key={i} tone="red">
                            {c}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td>{l.license_type ?? '—'}</Td>
                  <Td>{boolBadge(l.permits_ai_training)}</Td>
                  <Td>{boolBadge(l.permits_commercial)}</Td>
                  <Td>{boolBadge(l.permits_derivatives)}</Td>
                  <Td>{boolBadge(l.requires_attribution)}</Td>
                  <Td>
                    {l.expiry_date ? (
                      <span>
                        {l.expiry_date.slice(0, 10)}
                        {d !== null && (
                          <span
                            className={`ml-1 text-xs ${
                              d < 0 ? 'text-red-400' : d < 30 ? 'text-amber-400' : 'text-zinc-500'
                            }`}
                          >
                            ({d < 0 ? `${-d}d ago` : `${d}d`})
                          </span>
                        )}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>{l.status ? <Badge>{l.status}</Badge> : '—'}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" className="px-2 py-1" onClick={() => openEdit(l)}>
                        Edit
                      </Button>
                      <Button variant="ghost" className="px-2 py-1 text-red-400" onClick={() => void remove(l)}>
                        Delete
                      </Button>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit License' : 'New License'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create License'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="License name" required>
              <input
                value={form.license_name}
                onChange={(e) => setForm({ ...form, license_name: e.target.value })}
                className={inputCls}
                placeholder="CC BY 4.0"
              />
            </Field>
            <Field label="License type">
              <select
                value={form.license_type}
                onChange={(e) => setForm({ ...form, license_type: e.target.value })}
                className={inputCls}
              >
                {['commercial', 'open-source', 'creative-commons', 'public-domain', 'proprietary', 'custom'].map(
                  (t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ),
                )}
              </select>
            </Field>
          </div>
          <Field label="Source ID (optional)">
            <input
              value={form.source_id}
              onChange={(e) => setForm({ ...form, source_id: e.target.value })}
              className={inputCls}
              placeholder="Link to a data source"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            {([
              ['permits_ai_training', 'Permits AI training'],
              ['permits_commercial', 'Permits commercial'],
              ['permits_derivatives', 'Permits derivatives'],
              ['requires_attribution', 'Requires attribution'],
              ['share_alike', 'Share-alike'],
            ] as [keyof FormState, string][]).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form[key] as boolean}
                  onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                  className="h-4 w-4 accent-rose-600"
                />
                {label}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Effective date">
              <input
                type="date"
                value={form.effective_date}
                onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Expiry date">
              <input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Territorial restrictions">
              <input
                value={form.territorial_restrictions}
                onChange={(e) => setForm({ ...form, territorial_restrictions: e.target.value })}
                className={inputCls}
                placeholder="e.g. EU only"
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className={inputCls}
              >
                {['active', 'expired', 'revoked', 'pending'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Document reference">
            <input
              value={form.document_ref}
              onChange={(e) => setForm({ ...form, document_ref: e.target.value })}
              className={inputCls}
              placeholder="URL or storage ref"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={`${inputCls} h-20 resize-none`}
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none'

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
    </label>
  )
}
