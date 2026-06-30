'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'

interface DocumentationPack {
  id: string
  workspace_id: string
  pack_type: string
  subject_type: string
  subject_id: string
  title: string | null
  content: unknown
  content_hash: string | null
  generated_by: string | null
  created_at: string
}

interface ModelVersion {
  id: string
  model_id: string
  version: string
  base_model?: string | null
  release_status?: string | null
}

interface DataSource {
  id: string
  name: string
  status?: string | null
}

const PACK_TYPES: { value: string; label: string; desc: string }[] = [
  { value: 'gpai-summary', label: 'GPAI Training Summary', desc: 'EU AI Act general-purpose model training-content summary.' },
  { value: 'source-dossier', label: 'Source Dossier', desc: 'Full provenance, license, screening, and clearance record for one source.' },
  { value: 'litigation-pack', label: 'Litigation Pack', desc: 'Evidence bundle assembled for a takedown or rights dispute.' },
]

function packTypeTone(t: string): 'blue' | 'purple' | 'amber' | 'zinc' {
  if (t === 'gpai-summary') return 'blue'
  if (t === 'source-dossier') return 'purple'
  if (t === 'litigation-pack') return 'amber'
  return 'zinc'
}

function packTypeLabel(t: string): string {
  return PACK_TYPES.find((p) => p.value === t)?.label ?? t
}

// Renders arbitrary JSON pack content as readable sections.
function ContentView({ content }: { content: unknown }) {
  if (content == null) return <p className="text-sm text-zinc-500">No content.</p>
  if (typeof content === 'string') {
    return <pre className="whitespace-pre-wrap break-words text-sm text-zinc-300">{content}</pre>
  }
  if (Array.isArray(content)) {
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">
        {content.map((v, i) => (
          <li key={i}>{typeof v === 'object' ? <ContentView content={v} /> : String(v)}</li>
        ))}
      </ul>
    )
  }
  if (typeof content === 'object') {
    return (
      <div className="space-y-4">
        {Object.entries(content as Record<string, unknown>).map(([key, val]) => (
          <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {key.replace(/_/g, ' ')}
            </div>
            {typeof val === 'object' && val !== null ? (
              <ContentView content={val} />
            ) : (
              <div className="text-sm text-zinc-300">{String(val)}</div>
            )}
          </div>
        ))}
      </div>
    )
  }
  return <pre className="text-sm text-zinc-300">{String(content)}</pre>
}

export default function DocumentationPacksPage() {
  const [packs, setPacks] = useState<DocumentationPack[]>([])
  const [versions, setVersions] = useState<ModelVersion[]>([])
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [typeFilter, setTypeFilter] = useState('')
  const [q, setQ] = useState('')

  // Generate modal
  const [genOpen, setGenOpen] = useState(false)
  const [genType, setGenType] = useState('gpai-summary')
  const [genSubjectType, setGenSubjectType] = useState<'model_version' | 'source'>('model_version')
  const [genSubjectId, setGenSubjectId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  // Viewer modal
  const [viewOpen, setViewOpen] = useState(false)
  const [viewing, setViewing] = useState<DocumentationPack | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [p, mv, s] = await Promise.all([
        api.listDocumentationPacks(),
        api.listModelVersions(),
        api.listSources(),
      ])
      setPacks(Array.isArray(p) ? p : [])
      setVersions(Array.isArray(mv) ? mv : [])
      setSources(Array.isArray(s) ? s : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documentation packs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function openGenerate() {
    setGenType('gpai-summary')
    setGenSubjectType('model_version')
    setGenSubjectId('')
    setGenError(null)
    setGenOpen(true)
  }

  async function generate() {
    if (!genSubjectId) {
      setGenError('Select a subject')
      return
    }
    setGenerating(true)
    setGenError(null)
    try {
      await api.generateDocumentationPack({
        pack_type: genType,
        subject_type: genSubjectType,
        subject_id: genSubjectId,
      })
      setGenOpen(false)
      await load()
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function openView(pack: DocumentationPack) {
    setViewing(pack)
    setViewError(null)
    setViewOpen(true)
    // Re-fetch the full pack to get rendered content (list may omit content).
    setViewLoading(true)
    try {
      const full = await api.getDocumentationPack(pack.id)
      if (full && typeof full === 'object') setViewing(full as DocumentationPack)
    } catch (err) {
      setViewError(err instanceof Error ? err.message : 'Failed to load pack content')
    } finally {
      setViewLoading(false)
    }
  }

  function subjectLabel(pack: DocumentationPack): string {
    if (pack.subject_type === 'model_version') {
      const v = versions.find((x) => x.id === pack.subject_id)
      return v ? `version ${v.version}` : pack.subject_id.slice(0, 8)
    }
    const s = sources.find((x) => x.id === pack.subject_id)
    return s ? s.name : pack.subject_id.slice(0, 8)
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return packs.filter((p) => {
      if (typeFilter && p.pack_type !== typeFilter) return false
      if (needle) {
        const hay = `${p.title ?? ''} ${p.pack_type} ${p.subject_type} ${p.subject_id}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [packs, typeFilter, q])

  const countsByType = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const p of packs) acc[p.pack_type] = (acc[p.pack_type] ?? 0) + 1
    return acc
  }, [packs])

  const subjectOptions =
    genSubjectType === 'model_version'
      ? versions.map((v) => ({ id: v.id, label: `${v.version}${v.base_model ? ` · ${v.base_model}` : ''}` }))
      : sources.map((s) => ({ id: s.id, label: s.name }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Documentation Packs</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Generate hash-stamped compliance dossiers, GPAI training summaries, and litigation evidence bundles.
          </p>
        </div>
        <Button onClick={openGenerate}>+ Generate Pack</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total Packs" value={packs.length} />
        <Stat label="GPAI Summaries" value={countsByType['gpai-summary'] ?? 0} tone="default" />
        <Stat label="Source Dossiers" value={countsByType['source-dossier'] ?? 0} tone="default" />
        <Stat label="Litigation Packs" value={countsByType['litigation-pack'] ?? 0} tone="default" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title, subject..."
          className="w-64 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
        >
          <option value="">All pack types</option>
          {PACK_TYPES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <PageSpinner label="Loading documentation packs..." />
      ) : error ? (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-red-300">{error}</p>
              <Button variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={packs.length === 0 ? 'No documentation packs yet' : 'No packs match your filters'}
          description={
            packs.length === 0
              ? 'Generate a GPAI summary, source dossier, or litigation pack to assemble a hash-verified compliance record.'
              : 'Try clearing the search or type filter.'
          }
          action={packs.length === 0 ? <Button onClick={openGenerate}>+ Generate Pack</Button> : undefined}
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Title</Th>
              <Th>Type</Th>
              <Th>Subject</Th>
              <Th>Content Hash</Th>
              <Th>Generated</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map((p) => (
              <Tr key={p.id}>
                <Td>
                  <div className="font-medium text-zinc-100">{p.title ?? packTypeLabel(p.pack_type)}</div>
                </Td>
                <Td>
                  <Badge tone={packTypeTone(p.pack_type)}>{packTypeLabel(p.pack_type)}</Badge>
                </Td>
                <Td>
                  <span className="text-zinc-300">{subjectLabel(p)}</span>
                  <span className="ml-1 text-xs text-zinc-600">({p.subject_type})</span>
                </Td>
                <Td>
                  {p.content_hash ? (
                    <span className="font-mono text-xs text-zinc-500" title={p.content_hash}>
                      {p.content_hash.slice(0, 12)}…
                    </span>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td className="text-xs text-zinc-500">{p.created_at.slice(0, 10)}</Td>
                <Td className="text-right">
                  <Button variant="ghost" className="px-2 py-1" onClick={() => void openView(p)}>
                    View
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {/* Generate modal */}
      <Modal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title="Generate Documentation Pack"
        footer={
          <>
            <Button variant="secondary" onClick={() => setGenOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void generate()} disabled={generating}>
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {genError && (
            <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {genError}
            </div>
          )}
          <div>
            <span className="mb-2 block text-xs font-medium text-zinc-400">Pack type</span>
            <div className="grid gap-2">
              {PACK_TYPES.map((p) => (
                <label
                  key={p.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    genType === p.value
                      ? 'border-rose-600 bg-rose-950/20'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="packType"
                    value={p.value}
                    checked={genType === p.value}
                    onChange={() => setGenType(p.value)}
                    className="mt-1 h-4 w-4 accent-rose-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-zinc-100">{p.label}</div>
                    <div className="text-xs text-zinc-500">{p.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-400">Subject type</span>
            <div className="flex gap-2">
              {(['model_version', 'source'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setGenSubjectType(st)
                    setGenSubjectId('')
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    genSubjectType === st
                      ? 'border-rose-600 bg-rose-950/20 text-rose-300'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {st === 'model_version' ? 'Model version' : 'Source'}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">
              Subject<span className="text-rose-500"> *</span>
            </span>
            <select
              value={genSubjectId}
              onChange={(e) => setGenSubjectId(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-rose-600 focus:outline-none"
            >
              <option value="">
                {subjectOptions.length ? 'Select…' : `No ${genSubjectType === 'model_version' ? 'model versions' : 'sources'} available`}
              </option>
              {subjectOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Modal>

      {/* Viewer modal */}
      <Modal
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        title={viewing ? viewing.title ?? packTypeLabel(viewing.pack_type) : 'Documentation Pack'}
        className="max-w-2xl"
        footer={
          <Button variant="secondary" onClick={() => setViewOpen(false)}>
            Close
          </Button>
        }
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={packTypeTone(viewing.pack_type)}>{packTypeLabel(viewing.pack_type)}</Badge>
              <span className="text-xs text-zinc-500">
                {subjectLabel(viewing)} · {viewing.subject_type}
              </span>
              <span className="ml-auto text-xs text-zinc-600">{viewing.created_at.slice(0, 19).replace('T', ' ')}</span>
            </div>
            {viewing.content_hash && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Content hash</div>
                <div className="mt-0.5 break-all font-mono text-xs text-zinc-300">{viewing.content_hash}</div>
              </div>
            )}
            {viewError && (
              <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {viewError}
              </div>
            )}
            {viewLoading ? (
              <div className="py-6">
                <Spinner label="Loading content..." />
              </div>
            ) : (
              <div className="max-h-[55vh] overflow-y-auto pr-1">
                <ContentView content={viewing.content} />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
