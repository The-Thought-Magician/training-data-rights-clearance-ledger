'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'

interface LicenseTemplate {
  id: string
  name: string
  license_type?: string
  permits_ai_training?: boolean
  permits_commercial?: boolean
  permits_derivatives?: boolean
  requires_attribution?: boolean
  share_alike?: boolean
  description?: string
}

const SOURCE_TYPES = ['web-crawl', 'licensed-dataset', 'first-party', 'vendor-feed', 'synthetic', 'public-domain', 'other']
const MODALITIES = ['text', 'image', 'audio', 'video', 'code', 'tabular', 'multimodal']
const ACQUISITION_METHODS = ['purchase', 'license', 'scrape', 'partnership', 'donation', 'internal', 'other']
const FORMATS = ['jsonl', 'parquet', 'csv', 'images', 'audio', 'video', 'text', 'mixed']

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-600 focus:outline-none'
const labelCls = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500'

export default function NewSourcePage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<LicenseTemplate[]>([])
  const [tplLoading, setTplLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sourceType, setSourceType] = useState(SOURCE_TYPES[0])
  const [modality, setModality] = useState(MODALITIES[0])
  const [originUrl, setOriginUrl] = useState('')
  const [vendor, setVendor] = useState('')
  const [acquisitionMethod, setAcquisitionMethod] = useState(ACQUISITION_METHODS[0])
  const [acquisitionDate, setAcquisitionDate] = useState('')
  const [acquirer, setAcquirer] = useState('')
  const [justification, setJustification] = useState('')
  const [recordCount, setRecordCount] = useState('')
  const [sizeBytes, setSizeBytes] = useState('')
  const [format, setFormat] = useState(FORMATS[0])
  const [collection, setCollection] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [templateId, setTemplateId] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const data = await api.listLicenseTemplates()
        if (active) setTemplates(Array.isArray(data) ? data : [])
      } catch {
        if (active) setTemplates([])
      } finally {
        if (active) setTplLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const selectedTemplate = templates.find((t) => t.id === templateId)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSubmitting(true)
    setError(null)
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || undefined,
      source_type: sourceType,
      modality,
      origin_url: originUrl.trim() || undefined,
      vendor: vendor.trim() || undefined,
      acquisition_method: acquisitionMethod,
      acquisition_date: acquisitionDate || undefined,
      acquirer: acquirer.trim() || undefined,
      justification: justification.trim() || undefined,
      record_count: recordCount ? Number(recordCount) : undefined,
      size_bytes: sizeBytes ? Number(sizeBytes) : undefined,
      format,
      collection: collection.trim() || undefined,
      tags,
    }
    // Pass the chosen license template so the backend can seed an initial license if it supports it.
    if (templateId) body.license_template_id = templateId
    try {
      const created = await api.createSource(body)
      const id = created?.id
      router.push(id ? `/dashboard/sources/${id}` : '/dashboard/sources')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to register source')
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/dashboard/sources" className="text-xs text-fuchsia-400 hover:text-fuchsia-300">
          ← Back to register
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-100">Register data source</h1>
        <p className="mt-1 text-sm text-slate-500">
          Capture provenance and acquisition facts so the source can move through clearance.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Identity */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Identity</h2>
          </CardHeader>
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>
                Name <span className="text-fuchsia-500">*</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Common Crawl 2024-Q1 snapshot"
                className={inputCls}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What this source contains and why it was acquired."
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Source type</label>
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className={inputCls}>
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Modality</label>
              <select value={modality} onChange={(e) => setModality(e.target.value)} className={inputCls}>
                {MODALITIES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Collection</label>
              <input
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
                placeholder="Logical grouping"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Tags (comma separated)</label>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="english, news, 2024"
                className={inputCls}
              />
            </div>
          </CardBody>
        </Card>

        {/* Provenance / acquisition */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Acquisition & provenance</h2>
          </CardHeader>
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Origin URL</label>
              <input
                value={originUrl}
                onChange={(e) => setOriginUrl(e.target.value)}
                placeholder="https://..."
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Vendor</label>
              <input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="Supplier / origin org"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Acquisition method</label>
              <select
                value={acquisitionMethod}
                onChange={(e) => setAcquisitionMethod(e.target.value)}
                className={inputCls}
              >
                {ACQUISITION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Acquisition date</label>
              <input
                type="date"
                value={acquisitionDate}
                onChange={(e) => setAcquisitionDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Acquirer</label>
              <input
                value={acquirer}
                onChange={(e) => setAcquirer(e.target.value)}
                placeholder="Who acquired it"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Justification</label>
              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                rows={2}
                placeholder="Business / legal basis for acquiring this source."
                className={inputCls}
              />
            </div>
          </CardBody>
        </Card>

        {/* Composition */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Composition</h2>
          </CardHeader>
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Record count</label>
              <input
                type="number"
                min="0"
                value={recordCount}
                onChange={(e) => setRecordCount(e.target.value)}
                placeholder="0"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Size (bytes)</label>
              <input
                type="number"
                min="0"
                value={sizeBytes}
                onChange={(e) => setSizeBytes(e.target.value)}
                placeholder="0"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value)} className={inputCls}>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </CardBody>
        </Card>

        {/* License template */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Starting license template</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            {tplLoading ? (
              <Spinner label="Loading templates..." />
            ) : templates.length === 0 ? (
              <p className="text-sm text-slate-500">
                No license templates yet. You can add one later from{' '}
                <Link href="/dashboard/license-templates" className="text-fuchsia-400 hover:text-fuchsia-300">
                  License Templates
                </Link>
                .
              </p>
            ) : (
              <>
                <div>
                  <label className={labelCls}>Template (optional)</label>
                  <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputCls}>
                    <option value="">No template</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.license_type ? ` (${t.license_type})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedTemplate && (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                    {selectedTemplate.description && (
                      <p className="mb-3 text-sm text-slate-400">{selectedTemplate.description}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={selectedTemplate.permits_ai_training ? 'green' : 'red'}>
                        {selectedTemplate.permits_ai_training ? 'AI training OK' : 'No AI training'}
                      </Badge>
                      <Badge tone={selectedTemplate.permits_commercial ? 'green' : 'red'}>
                        {selectedTemplate.permits_commercial ? 'Commercial OK' : 'Non-commercial'}
                      </Badge>
                      <Badge tone={selectedTemplate.permits_derivatives ? 'green' : 'red'}>
                        {selectedTemplate.permits_derivatives ? 'Derivatives OK' : 'No derivatives'}
                      </Badge>
                      {selectedTemplate.requires_attribution && <Badge tone="amber">Attribution required</Badge>}
                      {selectedTemplate.share_alike && <Badge tone="amber">Share-alike</Badge>}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Link href="/dashboard/sources">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Spinner label="Registering..." /> : 'Register source'}
          </Button>
        </div>
      </form>
    </div>
  )
}
