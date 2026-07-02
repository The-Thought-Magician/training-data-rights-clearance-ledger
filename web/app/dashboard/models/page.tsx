'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'

interface Model {
  id: string
  name: string
  description?: string | null
  purpose?: string | null
  created_at?: string
}

interface ModelVersion {
  id: string
  model_id: string
  version: string
  base_model?: string | null
  training_type?: string | null
  training_date?: string | null
  manifest_hash?: string | null
  release_status: string
  released_at?: string | null
  created_at?: string
}

const TRAINING_TYPES = ['train', 'fine-tune']

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString()
}

const emptyModel = { name: '', description: '', purpose: '' }
const emptyVersion = { model_id: '', version: '', base_model: '', training_type: 'train', training_date: '' }

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([])
  const [versions, setVersions] = useState<ModelVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [modelOpen, setModelOpen] = useState(false)
  const [modelForm, setModelForm] = useState(emptyModel)
  const [modelSaving, setModelSaving] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  const [versionOpen, setVersionOpen] = useState(false)
  const [versionForm, setVersionForm] = useState(emptyVersion)
  const [versionSaving, setVersionSaving] = useState(false)
  const [versionError, setVersionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, v] = await Promise.all([api.listModels(), api.listModelVersions()])
      setModels(Array.isArray(m) ? m : [])
      setVersions(Array.isArray(v) ? v : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load models')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const versionsByModel = useMemo(() => {
    const map: Record<string, ModelVersion[]> = {}
    for (const v of versions) {
      ;(map[v.model_id] ||= []).push(v)
    }
    return map
  }, [versions])

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase()
    return models.filter((m) => {
      if (q && !(m.name?.toLowerCase().includes(q) || m.purpose?.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q))) {
        return false
      }
      if (statusFilter !== 'all') {
        const vs = versionsByModel[m.id] || []
        if (!vs.some((v) => v.release_status === statusFilter)) return false
      }
      return true
    })
  }, [models, search, statusFilter, versionsByModel])

  const releasedCount = useMemo(() => versions.filter((v) => v.release_status === 'released').length, [versions])
  const quarantinedCount = useMemo(() => versions.filter((v) => v.release_status === 'quarantined').length, [versions])

  async function submitModel(e: React.FormEvent) {
    e.preventDefault()
    if (!modelForm.name.trim()) { setModelError('Name is required'); return }
    setModelSaving(true)
    setModelError(null)
    try {
      await api.createModel({
        name: modelForm.name.trim(),
        description: modelForm.description.trim() || null,
        purpose: modelForm.purpose.trim() || null,
      })
      setModelOpen(false)
      setModelForm(emptyModel)
      await load()
    } catch (e: any) {
      setModelError(e?.message || 'Create failed')
    } finally {
      setModelSaving(false)
    }
  }

  function openVersion(modelId?: string) {
    setVersionForm({ ...emptyVersion, model_id: modelId || models[0]?.id || '' })
    setVersionError(null)
    setVersionOpen(true)
  }

  async function submitVersion(e: React.FormEvent) {
    e.preventDefault()
    if (!versionForm.model_id) { setVersionError('Select a model'); return }
    if (!versionForm.version.trim()) { setVersionError('Version is required'); return }
    setVersionSaving(true)
    setVersionError(null)
    try {
      await api.createModelVersion({
        model_id: versionForm.model_id,
        version: versionForm.version.trim(),
        base_model: versionForm.base_model.trim() || null,
        training_type: versionForm.training_type,
        training_date: versionForm.training_date || null,
      })
      setVersionOpen(false)
      setVersionForm(emptyVersion)
      await load()
    } catch (e: any) {
      setVersionError(e?.message || 'Create failed')
    } finally {
      setVersionSaving(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-fuchsia-500 focus:outline-none'

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Models</h1>
          <p className="mt-1 text-sm text-slate-500">Models and their trained versions, with release status and data lineage.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => openVersion()} disabled={models.length === 0}>+ Version</Button>
          <Button onClick={() => { setModelForm(emptyModel); setModelError(null); setModelOpen(true) }}>+ New Model</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Models" value={models.length} />
        <Stat label="Versions" value={versions.length} tone="rose" />
        <Stat label="Released" value={releasedCount} tone="green" />
        <Stat label="Quarantined" value={quarantinedCount} tone="red" />
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input className={inputCls + ' sm:max-w-xs'} placeholder="Search models..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className={inputCls + ' sm:w-56'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All version statuses</option>
            <option value="draft">Has draft</option>
            <option value="ready">Has ready</option>
            <option value="released">Has released</option>
            <option value="quarantined">Has quarantined</option>
          </select>
          <div className="text-xs text-slate-500 sm:ml-auto">{filteredModels.length} of {models.length} models</div>
        </CardBody>
      </Card>

      {loading ? (
        <PageSpinner label="Loading models..." />
      ) : error ? (
        <Card><CardBody>
          <div className="text-sm text-red-400">{error}</div>
          <Button variant="secondary" className="mt-3" onClick={load}>Retry</Button>
        </CardBody></Card>
      ) : models.length === 0 ? (
        <EmptyState
          icon="🤖"
          title="No models yet"
          description="Create a model, then add versions and bind data sources to track lineage and release readiness."
          action={<Button onClick={() => { setModelForm(emptyModel); setModelError(null); setModelOpen(true) }}>+ New Model</Button>}
        />
      ) : filteredModels.length === 0 ? (
        <EmptyState icon="🔍" title="No matches" description="Adjust your search or status filter." />
      ) : (
        <div className="space-y-5">
          {filteredModels.map((m) => {
            const vs = (versionsByModel[m.id] || []).slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            return (
              <Card key={m.id}>
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-100">{m.name}</h2>
                    {m.purpose && <p className="mt-0.5 text-sm text-slate-400">{m.purpose}</p>}
                    {m.description && <p className="mt-1 text-xs text-slate-500">{m.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-500">{vs.length} version{vs.length === 1 ? '' : 's'}</span>
                    <Button variant="secondary" className="px-3 py-1.5" onClick={() => openVersion(m.id)}>+ Version</Button>
                  </div>
                </CardHeader>
                <CardBody className="p-0">
                  {vs.length === 0 ? (
                    <div className="px-5 py-6 text-center text-sm text-slate-500">
                      No versions yet. <button className="text-fuchsia-400 hover:underline" onClick={() => openVersion(m.id)}>Add the first version</button>.
                    </div>
                  ) : (
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>Version</Th>
                          <Th>Status</Th>
                          <Th>Base model</Th>
                          <Th>Training</Th>
                          <Th>Trained</Th>
                          <Th>Manifest</Th>
                          <Th className="text-right">Lineage</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {vs.map((v) => (
                          <Tr key={v.id}>
                            <Td className="font-medium text-slate-100">{v.version}</Td>
                            <Td><Badge>{v.release_status}</Badge></Td>
                            <Td>{v.base_model || '—'}</Td>
                            <Td>{v.training_type || '—'}</Td>
                            <Td>{fmtDate(v.training_date)}</Td>
                            <Td className="font-mono text-xs text-slate-500">{v.manifest_hash ? v.manifest_hash.slice(0, 10) : '—'}</Td>
                            <Td className="text-right">
                              <Link href={`/dashboard/models/${v.id}`}>
                                <Button variant="ghost" className="px-3 py-1">Open →</Button>
                              </Link>
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      {/* New model modal */}
      <Modal
        open={modelOpen}
        onClose={() => !modelSaving && setModelOpen(false)}
        title="New Model"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModelOpen(false)} disabled={modelSaving}>Cancel</Button>
            <Button onClick={submitModel} disabled={modelSaving}>{modelSaving ? <Spinner /> : 'Create'}</Button>
          </>
        }
      >
        <form onSubmit={submitModel} className="space-y-4">
          {modelError && <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{modelError}</div>}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Name *</label>
            <input className={inputCls} value={modelForm.name} onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })} placeholder="Vision Classifier" autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Purpose</label>
            <input className={inputCls} value={modelForm.purpose} onChange={(e) => setModelForm({ ...modelForm, purpose: e.target.value })} placeholder="Image content moderation" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Description</label>
            <textarea className={inputCls} rows={3} value={modelForm.description} onChange={(e) => setModelForm({ ...modelForm, description: e.target.value })} />
          </div>
        </form>
      </Modal>

      {/* New version modal */}
      <Modal
        open={versionOpen}
        onClose={() => !versionSaving && setVersionOpen(false)}
        title="New Model Version"
        footer={
          <>
            <Button variant="secondary" onClick={() => setVersionOpen(false)} disabled={versionSaving}>Cancel</Button>
            <Button onClick={submitVersion} disabled={versionSaving}>{versionSaving ? <Spinner /> : 'Create'}</Button>
          </>
        }
      >
        <form onSubmit={submitVersion} className="space-y-4">
          {versionError && <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{versionError}</div>}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Model *</label>
            <select className={inputCls} value={versionForm.model_id} onChange={(e) => setVersionForm({ ...versionForm, model_id: e.target.value })}>
              <option value="">Select a model…</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Version *</label>
            <input className={inputCls} value={versionForm.version} onChange={(e) => setVersionForm({ ...versionForm, version: e.target.value })} placeholder="1.0.0" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Base model</label>
            <input className={inputCls} value={versionForm.base_model} onChange={(e) => setVersionForm({ ...versionForm, base_model: e.target.value })} placeholder="llama-3-8b" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Training type</label>
              <select className={inputCls} value={versionForm.training_type} onChange={(e) => setVersionForm({ ...versionForm, training_type: e.target.value })}>
                {TRAINING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Training date</label>
              <input type="date" className={inputCls} value={versionForm.training_date} onChange={(e) => setVersionForm({ ...versionForm, training_date: e.target.value })} />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
