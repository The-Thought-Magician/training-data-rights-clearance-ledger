'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'

interface RightsHolder {
  id: string
  name: string
  holder_type: string
  contact_email?: string | null
  jurisdiction?: string | null
  notes?: string | null
  created_at?: string
}

interface HolderDetail {
  holder: RightsHolder
  licenses: any[]
  optouts: any[]
  claims: any[]
}

const HOLDER_TYPES = ['individual', 'publisher', 'vendor', 'collecting-society']

const holderTone = (t: string) => {
  switch (t) {
    case 'publisher': return 'blue'
    case 'vendor': return 'purple'
    case 'collecting-society': return 'amber'
    default: return 'zinc'
  }
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString()
}

const emptyForm = { name: '', holder_type: 'publisher', contact_email: '', jurisdiction: '', notes: '' }

export default function RightsHoldersPage() {
  const [holders, setHolders] = useState<RightsHolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<RightsHolder | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [detail, setDetail] = useState<HolderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<RightsHolder | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listRightsHolders()
      setHolders(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load rights holders')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    try {
      const d = await api.getRightsHolder(id)
      setDetail({
        holder: d.holder ?? d,
        licenses: d.licenses ?? [],
        optouts: d.optouts ?? [],
        claims: d.claims ?? [],
      })
    } catch (e: any) {
      setDetailError(e?.message || 'Failed to load linked items')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (drawerId) loadDetail(drawerId)
  }, [drawerId, loadDetail])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return holders.filter((h) => {
      if (typeFilter !== 'all' && h.holder_type !== typeFilter) return false
      if (!q) return true
      return (
        h.name?.toLowerCase().includes(q) ||
        h.contact_email?.toLowerCase().includes(q) ||
        h.jurisdiction?.toLowerCase().includes(q)
      )
    })
  }, [holders, search, typeFilter])

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const h of holders) c[h.holder_type] = (c[h.holder_type] || 0) + 1
    return c
  }, [holders])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(h: RightsHolder) {
    setEditing(h)
    setForm({
      name: h.name || '',
      holder_type: h.holder_type || 'publisher',
      contact_email: h.contact_email || '',
      jurisdiction: h.jurisdiction || '',
      notes: h.notes || '',
    })
    setFormError(null)
    setFormOpen(true)
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setFormError('Name is required'); return }
    setSaving(true)
    setFormError(null)
    const body = {
      name: form.name.trim(),
      holder_type: form.holder_type,
      contact_email: form.contact_email.trim() || null,
      jurisdiction: form.jurisdiction.trim() || null,
      notes: form.notes.trim() || null,
    }
    try {
      if (editing) {
        await api.updateRightsHolder(editing.id, body)
      } else {
        await api.createRightsHolder(body)
      }
      setFormOpen(false)
      await load()
      if (editing && drawerId === editing.id) await loadDetail(editing.id)
    } catch (e: any) {
      setFormError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteRightsHolder(deleting.id)
      if (drawerId === deleting.id) setDrawerId(null)
      setDeleting(null)
      await load()
    } catch (e: any) {
      setDetailError(e?.message || 'Delete failed')
    } finally {
      setDeleteBusy(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-rose-500 focus:outline-none'

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Rights Holders</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Registry of individuals, publishers, vendors and collecting societies tied to your data.
          </p>
        </div>
        <Button onClick={openCreate}>+ New Rights Holder</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total" value={holders.length} />
        <Stat label="Publishers" value={typeCounts['publisher'] || 0} tone="rose" />
        <Stat label="Vendors" value={typeCounts['vendor'] || 0} />
        <Stat label="Societies" value={typeCounts['collecting-society'] || 0} tone="amber" />
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            className={inputCls + ' sm:max-w-xs'}
            placeholder="Search name, email, jurisdiction..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className={inputCls + ' sm:w-56'}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All types</option>
            {HOLDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="text-xs text-zinc-500 sm:ml-auto">
            {filtered.length} of {holders.length} shown
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <PageSpinner label="Loading rights holders..." />
      ) : error ? (
        <Card><CardBody>
          <div className="text-sm text-red-400">{error}</div>
          <Button variant="secondary" className="mt-3" onClick={load}>Retry</Button>
        </CardBody></Card>
      ) : holders.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="No rights holders yet"
          description="Add the people and organizations that hold rights over your training data."
          action={<Button onClick={openCreate}>+ New Rights Holder</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No matches" description="Adjust your search or type filter." />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Contact</Th>
              <Th>Jurisdiction</Th>
              <Th>Added</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map((h) => (
              <Tr key={h.id} className="cursor-pointer" onClick={() => setDrawerId(h.id)}>
                <Td className="font-medium text-zinc-100">{h.name}</Td>
                <Td><Badge tone={holderTone(h.holder_type) as any}>{h.holder_type}</Badge></Td>
                <Td>{h.contact_email || '—'}</Td>
                <Td>{h.jurisdiction || '—'}</Td>
                <Td>{fmtDate(h.created_at)}</Td>
                <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-flex gap-2">
                    <Button variant="ghost" className="px-2 py-1" onClick={() => setDrawerId(h.id)}>View</Button>
                    <Button variant="ghost" className="px-2 py-1" onClick={() => openEdit(h)}>Edit</Button>
                    <Button variant="ghost" className="px-2 py-1 text-red-400" onClick={() => setDeleting(h)}>Delete</Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {/* Create / edit modal */}
      <Modal
        open={formOpen}
        onClose={() => !saving && setFormOpen(false)}
        title={editing ? 'Edit Rights Holder' : 'New Rights Holder'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? <Spinner /> : editing ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitForm} className="space-y-4">
          {formError && <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{formError}</div>}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Name *</label>
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Publishing Ltd." autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Type</label>
            <select className={inputCls} value={form.holder_type} onChange={(e) => setForm({ ...form, holder_type: e.target.value })}>
              {HOLDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Contact email</label>
            <input className={inputCls} type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} placeholder="legal@acme.com" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Jurisdiction</label>
            <input className={inputCls} value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} placeholder="EU / US-CA / UK" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Notes</label>
            <textarea className={inputCls} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleting}
        onClose={() => !deleteBusy && setDeleting(null)}
        title="Delete rights holder"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? <Spinner /> : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          Delete <span className="font-medium text-zinc-100">{deleting?.name}</span>? This cannot be undone.
        </p>
      </Modal>

      {/* Linked-items drawer */}
      {drawerId && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={() => setDrawerId(null)}>
          <div
            className="h-full w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <h2 className="text-base font-semibold text-zinc-100">Linked items</h2>
              <button onClick={() => setDrawerId(null)} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close">✕</button>
            </div>
            <div className="space-y-6 px-5 py-5">
              {detailLoading ? (
                <Spinner label="Loading..." />
              ) : detailError ? (
                <div className="text-sm text-red-400">{detailError}</div>
              ) : detail ? (
                <>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-zinc-100">{detail.holder.name}</h3>
                      <Badge tone={holderTone(detail.holder.holder_type) as any}>{detail.holder.holder_type}</Badge>
                    </div>
                    <dl className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between"><dt className="text-zinc-500">Contact</dt><dd className="text-zinc-300">{detail.holder.contact_email || '—'}</dd></div>
                      <div className="flex justify-between"><dt className="text-zinc-500">Jurisdiction</dt><dd className="text-zinc-300">{detail.holder.jurisdiction || '—'}</dd></div>
                      <div className="flex justify-between"><dt className="text-zinc-500">Added</dt><dd className="text-zinc-300">{fmtDate(detail.holder.created_at)}</dd></div>
                    </dl>
                    {detail.holder.notes && <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-400">{detail.holder.notes}</p>}
                    <div className="mt-4 flex gap-2">
                      <Button variant="secondary" className="px-3 py-1.5" onClick={() => openEdit(detail.holder)}>Edit</Button>
                      <Button variant="danger" className="px-3 py-1.5" onClick={() => setDeleting(detail.holder)}>Delete</Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <div className="text-2xl font-semibold text-zinc-100">{detail.licenses.length}</div>
                      <div className="text-xs text-zinc-500">Licenses</div>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <div className="text-2xl font-semibold text-zinc-100">{detail.optouts.length}</div>
                      <div className="text-xs text-zinc-500">Opt-outs</div>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <div className="text-2xl font-semibold text-zinc-100">{detail.claims.length}</div>
                      <div className="text-xs text-zinc-500">Claims</div>
                    </div>
                  </div>

                  <DrawerSection title="Licenses" items={detail.licenses} render={(l: any) => (
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-200">{l.license_name || l.license_type || 'License'}</span>
                      {l.status && <Badge>{l.status}</Badge>}
                    </div>
                  )} />

                  <DrawerSection title="Opt-outs" items={detail.optouts} render={(o: any) => (
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-200">{o.subject_identity || o.optout_type || 'Opt-out'}</span>
                      {o.honor_status && <Badge>{o.honor_status}</Badge>}
                    </div>
                  )} />

                  <DrawerSection title="Claims" items={detail.claims} render={(c: any) => (
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-200">{c.claim_type || 'Claim'}{c.claimant ? ` · ${c.claimant}` : ''}</span>
                      <div className="flex gap-1">
                        {c.severity && <Badge>{c.severity}</Badge>}
                        {c.status && <Badge>{c.status}</Badge>}
                      </div>
                    </div>
                  )} />
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DrawerSection({ title, items, render }: { title: string; items: any[]; render: (i: any) => React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title} ({items.length})</h4>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-600">None linked.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={it.id || i} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm">
              {render(it)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
