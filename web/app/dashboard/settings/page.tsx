'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table'

type Workspace = {
  id: string
  name?: string
  slug?: string
  owner_id?: string
  default_required_checks?: unknown
  settings?: Record<string, unknown> | null
  created_at?: string
}

type Member = {
  id: string
  workspace_id?: string
  user_id?: string
  email?: string | null
  name?: string | null
  role?: string
  created_at?: string
}

type Requirement = {
  id?: string
  key: string
  label?: string
  description?: string | null
  is_required?: boolean
}

type BillingPlan = {
  subscription?: { plan_id?: string; status?: string; current_period_end?: string | null } | null
  plan?: { id?: string; name?: string; price_cents?: number } | null
  stripeEnabled?: boolean
}

const ROLES = ['admin', 'legal', 'ml-lead', 'dataops', 'viewer'] as const
const TABS = ['Workspace', 'Team', 'Clearance', 'Billing', 'Demo Data'] as const
type Tab = typeof TABS[number]

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

function roleTone(role?: string): 'rose' | 'purple' | 'blue' | 'amber' | 'zinc' {
  switch (role) {
    case 'admin': return 'rose'
    case 'legal': return 'purple'
    case 'ml-lead': return 'blue'
    case 'dataops': return 'amber'
    default: return 'zinc'
  }
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Workspace')

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [billing, setBilling] = useState<BillingPlan | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [cur, mem, req, bill] = await Promise.all([
        api.getCurrentWorkspace(),
        api.listMembers().catch(() => []),
        api.getClearanceRequirements().catch(() => []),
        api.getBillingPlan().catch(() => null),
      ])
      setWorkspace(cur?.workspace ?? cur ?? null)
      setRole(cur?.role ?? null)
      setMembers(Array.isArray(mem) ? mem : [])
      setRequirements(Array.isArray(req) ? req : [])
      setBilling(bill ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function flash(msg: string) {
    setBanner(msg)
    setTimeout(() => setBanner(null), 4000)
  }

  if (loading) return <PageSpinner label="Loading settings..." />

  const isAdmin = role === 'admin' || role == null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your workspace, team, clearance requirements, billing, and demo data.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
          <button onClick={load} className="ml-3 underline hover:text-red-200">Retry</button>
        </div>
      )}
      {banner && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">
          {banner}
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-slate-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'border-fuchsia-500 text-fuchsia-300'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Workspace' && (
        <WorkspaceTab workspace={workspace} role={role} canEdit={isAdmin} onSaved={(w) => { setWorkspace(w); flash('Workspace updated') }} setError={setError} />
      )}
      {tab === 'Team' && (
        <TeamTab members={members} setMembers={setMembers} canEdit={isAdmin} flash={flash} setError={setError} />
      )}
      {tab === 'Clearance' && (
        <ClearanceTab requirements={requirements} setRequirements={setRequirements} canEdit={isAdmin} flash={flash} setError={setError} />
      )}
      {tab === 'Billing' && (
        <BillingTab billing={billing} setError={setError} />
      )}
      {tab === 'Demo Data' && (
        <DemoTab flash={flash} setError={setError} reload={load} />
      )}
    </div>
  )
}

/* ---------- Workspace ---------- */

function WorkspaceTab({
  workspace,
  role,
  canEdit,
  onSaved,
  setError,
}: {
  workspace: Workspace | null
  role: string | null
  canEdit: boolean
  onSaved: (w: Workspace) => void
  setError: (s: string | null) => void
}) {
  const [name, setName] = useState(workspace?.name ?? '')
  const [slug, setSlug] = useState(workspace?.slug ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(workspace?.name ?? '')
    setSlug(workspace?.slug ?? '')
  }, [workspace])

  if (!workspace) {
    return <EmptyState icon="🏢" title="No workspace found" description="Create a workspace to begin." />
  }

  async function save() {
    if (!workspace) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateWorkspace(workspace.id, { name: name.trim(), slug: slug.trim() })
      onSaved({ ...workspace, ...updated })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update workspace')
    } finally {
      setBusy(false)
    }
  }

  const dirty = name.trim() !== (workspace.name ?? '') || slug.trim() !== (workspace.slug ?? '')

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Workspace</h2>
        {role && <Badge tone={roleTone(role)}>your role: {role}</Badge>}
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} disabled={!canEdit} />
          </Field>
          <Field label="Slug" hint="url-safe identifier">
            <input value={slug} onChange={(e) => setSlug(e.target.value)} className={inputCls} disabled={!canEdit} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Workspace ID</div>
            <div className="mt-1 font-mono text-xs text-slate-300">{workspace.id}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Created</div>
            <div className="mt-1 text-slate-300">
              {workspace.created_at ? new Date(workspace.created_at).toLocaleDateString() : '—'}
            </div>
          </div>
        </div>
        {canEdit ? (
          <div className="flex justify-end">
            <Button onClick={save} disabled={busy || !dirty || !name.trim()}>
              {busy ? <Spinner label="Saving..." /> : 'Save Changes'}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-slate-600">Only workspace admins can edit these settings.</p>
        )}
      </CardBody>
    </Card>
  )
}

/* ---------- Team ---------- */

function TeamTab({
  members,
  setMembers,
  canEdit,
  flash,
  setError,
}: {
  members: Member[]
  setMembers: React.Dispatch<React.SetStateAction<Member[]>>
  canEdit: boolean
  flash: (s: string) => void
  setError: (s: string | null) => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function changeRole(m: Member, role: string) {
    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, role } : x)))
    try {
      const updated = await api.updateMember(m.id, { role })
      setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...updated } : x)))
      flash('Role updated')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role')
    }
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.name || m.email || 'this member'} from the workspace?`)) return
    const prev = members
    setMembers((p) => p.filter((x) => x.id !== m.id))
    try {
      await api.removeMember(m.id)
      flash('Member removed')
    } catch (e) {
      setMembers(prev)
      setError(e instanceof Error ? e.message : 'Failed to remove member')
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Team Members</h2>
          <p className="text-xs text-slate-500">{members.length} member{members.length === 1 ? '' : 's'}</p>
        </div>
        {canEdit && <Button onClick={() => { setFormError(null); setAddOpen(true) }}>+ Add Member</Button>}
      </CardHeader>
      <CardBody className="p-0">
        {members.length === 0 ? (
          <div className="p-5">
            <EmptyState icon="👥" title="No members yet" description="Invite teammates to collaborate on clearance work." />
          </div>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Member</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                {canEdit && <Th className="text-right">Actions</Th>}
              </Tr>
            </Thead>
            <Tbody>
              {members.map((m) => (
                <Tr key={m.id}>
                  <Td className="font-medium text-slate-100">{m.name || m.user_id?.slice(0, 12) || '—'}</Td>
                  <Td className="text-slate-400">{m.email || '—'}</Td>
                  <Td>
                    {canEdit ? (
                      <select
                        value={m.role || 'viewer'}
                        onChange={(e) => changeRole(m, e.target.value)}
                        className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-fuchsia-600 focus:outline-none"
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <Badge tone={roleTone(m.role)}>{m.role || 'viewer'}</Badge>
                    )}
                  </Td>
                  {canEdit && (
                    <Td className="text-right">
                      <Button variant="ghost" className="px-2 py-1 text-xs text-red-400 hover:text-red-300" onClick={() => remove(m)}>
                        Remove
                      </Button>
                    </Td>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardBody>

      {addOpen && (
        <AddMemberForm
          busy={busy}
          error={formError}
          onClose={() => setAddOpen(false)}
          onSubmit={async (body) => {
            setBusy(true)
            setFormError(null)
            try {
              const created = await api.addMember(body)
              setMembers((prev) => [...prev, created])
              setAddOpen(false)
              flash('Member added')
            } catch (e) {
              setFormError(e instanceof Error ? e.message : 'Failed to add member')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </Card>
  )
}

function AddMemberForm({
  busy,
  error,
  onClose,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [userId, setUserId] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<string>('viewer')

  function submit() {
    onSubmit({
      user_id: userId.trim(),
      email: email.trim() || null,
      name: name.trim() || null,
      role,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Member"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !userId.trim()}>
            {busy ? <Spinner label="Adding..." /> : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>}
        <Field label="User ID" required>
          <input value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls} placeholder="Auth user id" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Email">
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="person@org.com" />
          </Field>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Full name" />
          </Field>
        </div>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  )
}

/* ---------- Clearance requirements ---------- */

function ClearanceTab({
  requirements,
  setRequirements,
  canEdit,
  flash,
  setError,
}: {
  requirements: Requirement[]
  setRequirements: React.Dispatch<React.SetStateAction<Requirement[]>>
  canEdit: boolean
  flash: (s: string) => void
  setError: (s: string | null) => void
}) {
  const [draft, setDraft] = useState<Requirement[]>(requirements)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDraft(requirements)
  }, [requirements])

  function toggle(key: string) {
    setDraft((prev) => prev.map((r) => (r.key === key ? { ...r, is_required: !r.is_required } : r)))
  }

  function addNew() {
    const label = prompt('New requirement label (e.g. "License verified")')
    if (!label) return
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (!key) return
    if (draft.some((r) => r.key === key)) {
      setError('A requirement with that key already exists')
      return
    }
    setDraft((prev) => [...prev, { key, label, is_required: true }])
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const body = draft.map((r) => ({ key: r.key, label: r.label ?? r.key, description: r.description ?? null, is_required: !!r.is_required }))
      const updated = await api.setClearanceRequirements(body)
      setRequirements(Array.isArray(updated) ? updated : draft)
      flash('Clearance requirements saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save requirements')
    } finally {
      setBusy(false)
    }
  }

  const dirty = JSON.stringify(draft.map((r) => [r.key, !!r.is_required])) !== JSON.stringify(requirements.map((r) => [r.key, !!r.is_required])) || draft.length !== requirements.length

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Clearance Requirements</h2>
          <p className="text-xs text-slate-500">Checks every source must satisfy before it can be cleared.</p>
        </div>
        {canEdit && <Button variant="secondary" onClick={addNew}>+ Add Requirement</Button>}
      </CardHeader>
      <CardBody className="space-y-3">
        {draft.length === 0 ? (
          <EmptyState icon="🔒" title="No requirements configured" description="Add requirements to gate clearance approvals." />
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
            {draft.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-100">{r.label || r.key}</div>
                  <div className="font-mono text-xs text-slate-600">{r.key}</div>
                  {r.description && <div className="mt-0.5 text-xs text-slate-500">{r.description}</div>}
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={!!r.is_required}
                    onChange={() => toggle(r.key)}
                    disabled={!canEdit}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-fuchsia-600"
                  />
                  Required
                </label>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="flex justify-end">
            <Button onClick={save} disabled={busy || !dirty}>
              {busy ? <Spinner label="Saving..." /> : 'Save Requirements'}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/* ---------- Billing ---------- */

function BillingTab({ billing, setError }: { billing: BillingPlan | null; setError: (s: string | null) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const planName = billing?.plan?.name ?? billing?.subscription?.plan_id ?? 'free'
  const priceCents = billing?.plan?.price_cents ?? 0
  const status = billing?.subscription?.status ?? 'active'
  const stripeEnabled = billing?.stripeEnabled ?? false
  const isPro = (billing?.plan?.id ?? billing?.subscription?.plan_id) === 'pro'

  async function checkout() {
    setBusy('checkout')
    setError(null)
    try {
      const res = await api.startCheckout()
      if (res?.url) window.location.href = res.url
      else setError('Checkout is not available right now.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Billing is not configured (Stripe disabled).')
    } finally {
      setBusy(null)
    }
  }

  async function portal() {
    setBusy('portal')
    setError(null)
    try {
      const res = await api.openPortal()
      if (res?.url) window.location.href = res.url
      else setError('Billing portal is not available right now.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Billing is not configured (Stripe disabled).')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-100">Current Plan</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold capitalize text-slate-100">{planName}</span>
                <Badge tone={isPro ? 'rose' : 'zinc'}>{status}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {priceCents > 0 ? `$${(priceCents / 100).toFixed(2)} / month` : 'Free — all features included'}
              </p>
            </div>
            <div className="flex gap-2">
              {!isPro && (
                <Button onClick={checkout} disabled={busy != null}>
                  {busy === 'checkout' ? <Spinner label="Redirecting..." /> : 'Upgrade to Pro'}
                </Button>
              )}
              <Button variant="secondary" onClick={portal} disabled={busy != null}>
                {busy === 'portal' ? <Spinner label="Opening..." /> : 'Manage Billing'}
              </Button>
            </div>
          </div>
          {billing?.subscription?.current_period_end && (
            <div className="text-xs text-slate-500">
              Current period ends {new Date(billing.subscription.current_period_end).toLocaleDateString()}
            </div>
          )}
          {!stripeEnabled && (
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
              Stripe is not configured in this environment. All features are free; checkout and portal actions are disabled.
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

/* ---------- Demo data ---------- */

function DemoTab({ flash, setError, reload }: { flash: (s: string) => void; setError: (s: string | null) => void; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [counts, setCounts] = useState<Record<string, number> | null>(null)

  async function seed() {
    setBusy('seed')
    setError(null)
    try {
      const res = await api.seedDemo()
      setCounts(res?.counts ?? null)
      flash('Demo workspace provisioned')
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to seed demo data')
    } finally {
      setBusy(null)
    }
  }

  async function reset() {
    if (!confirm('This will delete all demo data in your current workspace. Continue?')) return
    setBusy('reset')
    setError(null)
    try {
      await api.resetDemo()
      setCounts(null)
      flash('Demo data cleared')
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset demo data')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-100">Demo Data</h2>
        <p className="text-xs text-slate-500">
          Populate your workspace with a realistic dataset to explore the platform, then clear it when you are done.
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={seed} disabled={busy != null}>
            {busy === 'seed' ? <Spinner label="Seeding..." /> : 'Seed Demo Workspace'}
          </Button>
          <Button variant="danger" onClick={reset} disabled={busy != null}>
            {busy === 'reset' ? <Spinner label="Resetting..." /> : 'Reset Demo Data'}
          </Button>
        </div>
        {counts && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Seeded records</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {Object.entries(counts).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <div className="text-xs capitalize text-slate-500">{k.replace(/_/g, ' ')}</div>
                  <div className="text-lg font-semibold tabular-nums text-slate-100">{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-slate-600">
          Seeding adds sources, licenses, screenings, opt-outs, models, versions, lineage, claims, and ledger entries.
          Reset removes the demo workspace data for your account.
        </p>
      </CardBody>
    </Card>
  )
}
