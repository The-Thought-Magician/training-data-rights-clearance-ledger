'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface LicenseTemplate {
  id: string
  name: string
  license_type: string | null
  permits_ai_training: boolean
  permits_commercial: boolean
  permits_derivatives: boolean
  requires_attribution: boolean
  share_alike: boolean
  description: string | null
  created_by: string | null
  created_at: string
}

const emptyForm = {
  name: '',
  license_type: 'creative-commons',
  permits_ai_training: true,
  permits_commercial: true,
  permits_derivatives: false,
  requires_attribution: true,
  share_alike: false,
  description: '',
}

type FormState = typeof emptyForm

const presets: Record<string, Partial<FormState>> = {
  'CC BY 4.0': {
    name: 'CC BY 4.0',
    license_type: 'creative-commons',
    permits_ai_training: true,
    permits_commercial: true,
    permits_derivatives: true,
    requires_attribution: true,
    share_alike: false,
    description: 'Creative Commons Attribution 4.0 International',
  },
  'CC BY-SA 4.0': {
    name: 'CC BY-SA 4.0',
    license_type: 'creative-commons',
    permits_ai_training: true,
    permits_commercial: true,
    permits_derivatives: true,
    requires_attribution: true,
    share_alike: true,
    description: 'Attribution-ShareAlike 4.0 International',
  },
  'CC BY-NC 4.0': {
    name: 'CC BY-NC 4.0',
    license_type: 'creative-commons',
    permits_ai_training: true,
    permits_commercial: false,
    permits_derivatives: true,
    requires_attribution: true,
    share_alike: false,
    description: 'Attribution-NonCommercial 4.0 International',
  },
  'Public Domain (CC0)': {
    name: 'Public Domain (CC0)',
    license_type: 'public-domain',
    permits_ai_training: true,
    permits_commercial: true,
    permits_derivatives: true,
    requires_attribution: false,
    share_alike: false,
    description: 'No rights reserved',
  },
  'Proprietary (All Rights Reserved)': {
    name: 'Proprietary (All Rights Reserved)',
    license_type: 'proprietary',
    permits_ai_training: false,
    permits_commercial: false,
    permits_derivatives: false,
    requires_attribution: false,
    share_alike: false,
    description: 'All rights reserved — no training without explicit grant',
  },
}

const perms: [keyof FormState, string][] = [
  ['permits_ai_training', 'AI training'],
  ['permits_commercial', 'Commercial'],
  ['permits_derivatives', 'Derivatives'],
  ['requires_attribution', 'Attribution'],
  ['share_alike', 'Share-alike'],
]

export default function LicenseTemplatesPage() {
  const [templates, setTemplates] = useState<LicenseTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const t = await api.listLicenseTemplates()
      setTemplates(Array.isArray(t) ? t : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function applyPreset(name: string) {
    const p = presets[name]
    if (p) setForm({ ...emptyForm, ...p })
  }

  async function submit() {
    if (!form.name.trim()) {
      setFormError('Template name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.createLicenseTemplate({
        ...form,
        description: form.description.trim() || null,
      })
      setModalOpen(false)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(t: LicenseTemplate) {
    if (!confirm(`Delete template "${t.name}"?`)) return
    try {
      await api.deleteLicenseTemplate(t.id)
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return templates
    return templates.filter((t) =>
      `${t.name} ${t.license_type ?? ''} ${t.description ?? ''}`.toLowerCase().includes(needle),
    )
  }, [templates, q])

  const trainingOk = templates.filter((t) => t.permits_ai_training).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">License Template Library</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Reusable license profiles to apply consistent rights terms to new data sources.
          </p>
        </div>
        <Button onClick={openCreate}>+ New Template</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Templates" value={templates.length} />
        <Stat label="AI Training OK" value={trainingOk} tone="green" />
        <Stat label="Restrictive" value={templates.length - trainingOk} tone={templates.length - trainingOk ? 'amber' : 'default'} />
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search templates..."
        className="w-64 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none"
      />

      {loading ? (
        <PageSpinner label="Loading templates..." />
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
          title="No templates yet"
          description="Create license templates to speed up source onboarding with consistent terms."
          action={<Button onClick={openCreate}>+ New Template</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <CardBody className="flex flex-1 flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-zinc-100">{t.name}</h3>
                    {t.license_type && (
                      <Badge tone="purple" className="mt-1">
                        {t.license_type}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-red-400"
                    onClick={() => void remove(t)}
                  >
                    Delete
                  </Button>
                </div>
                {t.description && <p className="text-sm text-zinc-500">{t.description}</p>}
                <div className="mt-auto flex flex-wrap gap-1.5">
                  {perms.map(([key, label]) => (
                    <Badge key={key} tone={t[key] ? 'green' : 'zinc'}>
                      {t[key] ? '✓' : '✕'} {label}
                    </Badge>
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New License Template"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? 'Saving...' : 'Create Template'}
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
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-400">Start from a preset</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(presets).map((name) => (
                <button
                  key={name}
                  onClick={() => applyPreset(name)}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:border-rose-600 hover:text-rose-300"
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">
                Name<span className="text-rose-500"> *</span>
              </span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputCls}
                placeholder="e.g. CC BY 4.0"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">License type</span>
              <select
                value={form.license_type}
                onChange={(e) => setForm({ ...form, license_type: e.target.value })}
                className={inputCls}
              >
                {['creative-commons', 'commercial', 'open-source', 'public-domain', 'proprietary', 'custom'].map(
                  (t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            {perms.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form[key] as boolean}
                  onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                  className="h-4 w-4 accent-rose-600"
                />
                Permits {label.toLowerCase()}
              </label>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Description</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className={`${inputCls} h-20 resize-none`}
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-rose-600 focus:outline-none'
