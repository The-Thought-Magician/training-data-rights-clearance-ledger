'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table'

type Notification = {
  id: string
  kind?: string | null
  title?: string | null
  body?: string | null
  link?: string | null
  is_read?: boolean
  created_at?: string
}

type Task = {
  id: string
  assigned_to?: string | null
  task_type?: string | null
  entity_type?: string | null
  entity_id?: string | null
  title?: string | null
  description?: string | null
  due_date?: string | null
  status?: string
  created_by?: string | null
  created_at?: string
}

const TASK_STATUSES = ['open', 'in-progress', 'done'] as const
const TASK_TYPES = ['remediation', 'approval', 'review'] as const

function fmtDate(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtRelative(v?: string | null) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return fmtDate(v)
}

function isOverdue(due?: string | null, status?: string) {
  if (!due || status === 'done') return false
  const d = new Date(due)
  if (isNaN(d.getTime())) return false
  return d.getTime() < Date.now()
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [notifFilter, setNotifFilter] = useState<'all' | 'unread'>('all')
  const [taskFilter, setTaskFilter] = useState<'all' | typeof TASK_STATUSES[number]>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ns, ts] = await Promise.all([api.listNotifications(), api.listTasks()])
      setNotifications(Array.isArray(ns) ? ns : [])
      setTasks(Array.isArray(ts) ? ts : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const unreadCount = useMemo(() => notifications.filter((n) => !n.is_read).length, [notifications])
  const visibleNotifs = useMemo(
    () => (notifFilter === 'unread' ? notifications.filter((n) => !n.is_read) : notifications),
    [notifications, notifFilter],
  )

  const taskCounts = useMemo(() => {
    const c: Record<string, number> = { all: tasks.length, open: 0, 'in-progress': 0, done: 0, overdue: 0 }
    for (const t of tasks) {
      if (t.status && t.status in c) c[t.status] += 1
      if (isOverdue(t.due_date, t.status)) c.overdue += 1
    }
    return c
  }, [tasks])

  const visibleTasks = useMemo(
    () => (taskFilter === 'all' ? tasks : tasks.filter((t) => t.status === taskFilter)),
    [tasks, taskFilter],
  )

  async function markRead(n: Notification) {
    if (n.is_read) return
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)))
    try {
      await api.markNotificationRead(n.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark read')
      load()
    }
  }

  async function markAll() {
    if (unreadCount === 0) return
    setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })))
    try {
      await api.markAllNotificationsRead()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all read')
      load()
    }
  }

  async function setTaskStatus(t: Task, status: string) {
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status } : x)))
    try {
      const updated = await api.updateTask(t.id, { status })
      setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...updated } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update task')
      load()
    }
  }

  if (loading) return <PageSpinner label="Loading notifications..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Notifications &amp; Tasks</h1>
          <p className="mt-1 text-sm text-slate-500">
            Stay on top of clearance alerts and the remediation, approval, and review work assigned to you.
          </p>
        </div>
        <Button onClick={() => { setFormError(null); setCreateOpen(true) }}>+ New Task</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
          <button onClick={load} className="ml-3 underline hover:text-red-200">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Unread" value={unreadCount} tone={unreadCount > 0 ? 'rose' : 'default'} />
        <Stat label="Open Tasks" value={taskCounts.open} tone="amber" />
        <Stat label="In Progress" value={taskCounts['in-progress']} />
        <Stat label="Overdue" value={taskCounts.overdue} tone={taskCounts.overdue > 0 ? 'red' : 'default'} />
        <Stat label="Done" value={taskCounts.done} tone="green" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Notifications */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Notifications</h2>
              <p className="text-xs text-slate-500">{notifications.length} total · {unreadCount} unread</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-slate-700 p-0.5 text-xs">
                {(['all', 'unread'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setNotifFilter(f)}
                    className={`rounded-md px-2.5 py-1 capitalize transition-colors ${
                      notifFilter === f ? 'bg-fuchsia-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={markAll} disabled={unreadCount === 0}>
                Mark all read
              </Button>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {visibleNotifs.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon="🔔"
                  title={notifications.length === 0 ? 'No notifications' : 'All caught up'}
                  description={
                    notifications.length === 0
                      ? 'Alerts about expiring licenses, flagged screenings, and approvals will appear here.'
                      : 'You have no unread notifications.'
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-800">
                {visibleNotifs.map((n) => {
                  const inner = (
                    <div className="flex items-start gap-3 px-5 py-4">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-slate-700' : 'bg-fuchsia-500'}`}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {n.kind && <Badge tone="zinc" className="capitalize">{n.kind}</Badge>}
                          <span className={`truncate text-sm font-medium ${n.is_read ? 'text-slate-400' : 'text-slate-100'}`}>
                            {n.title || 'Notification'}
                          </span>
                        </div>
                        {n.body && <p className="mt-1 text-sm text-slate-500">{n.body}</p>}
                        <div className="mt-1 flex items-center gap-3 text-xs text-slate-600">
                          <span>{fmtRelative(n.created_at)}</span>
                          {n.link && <span className="text-fuchsia-400">Open ↗</span>}
                        </div>
                      </div>
                      {!n.is_read && (
                        <button
                          onClick={(e) => { e.preventDefault(); markRead(n) }}
                          className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  )
                  return (
                    <li key={n.id} className="hover:bg-slate-900/40">
                      {n.link ? (
                        <Link href={n.link} onClick={() => markRead(n)} className="block">
                          {inner}
                        </Link>
                      ) : (
                        <button onClick={() => markRead(n)} className="block w-full text-left">
                          {inner}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Tasks */}
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">My Tasks</h2>
              <p className="text-xs text-slate-500">{tasks.length} total</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip active={taskFilter === 'all'} onClick={() => setTaskFilter('all')}>All ({taskCounts.all})</Chip>
              {TASK_STATUSES.map((st) => (
                <Chip key={st} active={taskFilter === st} onClick={() => setTaskFilter(st)}>
                  {st} ({taskCounts[st]})
                </Chip>
              ))}
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {visibleTasks.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon="✅"
                  title={tasks.length === 0 ? 'No tasks yet' : 'No tasks in this view'}
                  description={
                    tasks.length === 0
                      ? 'Create a task to track remediation, approval, or review work.'
                      : 'Try a different status filter.'
                  }
                  action={tasks.length === 0 ? <Button onClick={() => { setFormError(null); setCreateOpen(true) }}>+ New Task</Button> : undefined}
                />
              </div>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Task</Th>
                    <Th>Type</Th>
                    <Th>Due</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {visibleTasks.map((t) => {
                    const overdue = isOverdue(t.due_date, t.status)
                    return (
                      <Tr key={t.id}>
                        <Td>
                          <div className="font-medium text-slate-100">{t.title || 'Untitled task'}</div>
                          {t.description && <div className="mt-0.5 max-w-md truncate text-xs text-slate-500">{t.description}</div>}
                          {t.entity_type && (
                            <div className="mt-0.5 text-xs text-slate-600">
                              {t.entity_type}{t.entity_id ? ` · ${t.entity_id.slice(0, 8)}` : ''}
                            </div>
                          )}
                        </Td>
                        <Td><Badge tone="zinc" className="capitalize">{t.task_type || 'task'}</Badge></Td>
                        <Td>
                          {t.due_date ? (
                            <span className={overdue ? 'font-medium text-red-400' : 'text-slate-400'}>
                              {fmtDate(t.due_date)}{overdue && ' (overdue)'}
                            </span>
                          ) : <span className="text-slate-600">—</span>}
                        </Td>
                        <Td><Badge>{t.status || 'open'}</Badge></Td>
                        <Td className="text-right">
                          <select
                            value={t.status || 'open'}
                            onChange={(e) => setTaskStatus(t, e.target.value)}
                            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-fuchsia-600 focus:outline-none"
                            aria-label="Set task status"
                          >
                            {TASK_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                          </select>
                        </Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {createOpen && (
        <TaskForm
          busy={busy}
          error={formError}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (body) => {
            setBusy(true)
            setFormError(null)
            try {
              const created = await api.createTask(body)
              setTasks((prev) => [created, ...prev])
              setCreateOpen(false)
            } catch (e) {
              setFormError(e instanceof Error ? e.message : 'Failed to create task')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

function TaskForm({
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
  const [title, setTitle] = useState('')
  const [taskType, setTaskType] = useState<string>('review')
  const [description, setDescription] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [entityType, setEntityType] = useState('')
  const [entityId, setEntityId] = useState('')

  function submit() {
    onSubmit({
      title: title.trim(),
      task_type: taskType,
      description: description.trim() || null,
      assigned_to: assignedTo.trim() || null,
      due_date: dueDate || null,
      entity_type: entityType.trim() || null,
      entity_id: entityId.trim() || null,
      status: 'open',
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New Task"
      className="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy ? <Spinner label="Creating..." /> : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>
        )}
        <Field label="Title" required>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Remediate flagged works in dataset X" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Type">
            <select value={taskType} onChange={(e) => setTaskType(e.target.value)} className={inputCls}>
              {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Due Date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Assigned To" hint="user id / email">
            <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={inputCls} placeholder="Leave blank to self-assign" />
          </Field>
          <Field label="Entity Type" hint="optional">
            <input value={entityType} onChange={(e) => setEntityType(e.target.value)} className={inputCls} placeholder="e.g. source, claim" />
          </Field>
        </div>
        <Field label="Entity ID" hint="optional">
          <input value={entityId} onChange={(e) => setEntityId(e.target.value)} className={inputCls} placeholder="Linked record id" />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} placeholder="What needs to happen..." />
        </Field>
      </div>
    </Modal>
  )
}
