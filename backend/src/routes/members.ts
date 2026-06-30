import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { members, activity_log } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const ROLES = ['admin', 'legal', 'ml-lead', 'dataops', 'viewer'] as const

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** The caller's first/active membership (earliest joined). */
async function currentMembership(userId: string) {
  const mine = await db.select().from(members).where(eq(members.user_id, userId))
  if (mine.length === 0) return null
  mine.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
  return mine[0]
}

async function membershipIn(userId: string, workspaceId: string) {
  const [m] = await db
    .select()
    .from(members)
    .where(and(eq(members.workspace_id, workspaceId), eq(members.user_id, userId)))
  return m ?? null
}

// ---------------------------------------------------------------------------
// GET / — list members of the current workspace
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  // allow explicit ?workspace_id= override, else the caller's active workspace
  const wsParam = c.req.query('workspace_id')
  let workspaceId = wsParam ?? null
  if (workspaceId) {
    const m = await membershipIn(userId, workspaceId)
    if (!m) return c.json({ error: 'Forbidden' }, 403)
  } else {
    const m = await currentMembership(userId)
    if (!m) return c.json([])
    workspaceId = m.workspace_id
  }
  const rows = await db
    .select()
    .from(members)
    .where(eq(members.workspace_id, workspaceId))
    .orderBy(desc(members.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — add member (admin only)
// ---------------------------------------------------------------------------

const addSchema = z.object({
  user_id: z.string().min(1),
  email: z.string().email().optional(),
  name: z.string().min(1).max(120).optional(),
  role: z.enum(ROLES).default('viewer'),
  workspace_id: z.string().min(1).optional(),
})

router.post('/', authMiddleware, zValidator('json', addSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  let workspaceId = body.workspace_id ?? null
  if (!workspaceId) {
    const m = await currentMembership(userId)
    if (!m) return c.json({ error: 'No workspace' }, 400)
    workspaceId = m.workspace_id
  }

  const caller = await membershipIn(userId, workspaceId)
  if (!caller) return c.json({ error: 'Forbidden' }, 403)
  if (caller.role !== 'admin') return c.json({ error: 'Admin role required' }, 403)

  // prevent duplicate membership
  const existing = await membershipIn(body.user_id, workspaceId)
  if (existing) return c.json({ error: 'User is already a member' }, 409)

  const [m] = await db
    .insert(members)
    .values({
      workspace_id: workspaceId,
      user_id: body.user_id,
      email: body.email ?? null,
      name: body.name ?? null,
      role: body.role,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    actor_id: userId,
    entity_type: 'member',
    entity_id: m.id,
    action: 'added',
    detail: `Added member ${body.name ?? body.user_id} as ${body.role}`,
  })

  return c.json(m, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — change role (admin only)
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  role: z.enum(ROLES).optional(),
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [target] = await db.select().from(members).where(eq(members.id, id))
  if (!target) return c.json({ error: 'Not found' }, 404)

  const caller = await membershipIn(userId, target.workspace_id)
  if (!caller) return c.json({ error: 'Forbidden' }, 403)
  if (caller.role !== 'admin') return c.json({ error: 'Admin role required' }, 403)

  const body = c.req.valid('json')

  // do not allow demoting the last admin
  if (body.role && body.role !== 'admin' && target.role === 'admin') {
    const admins = await db
      .select()
      .from(members)
      .where(and(eq(members.workspace_id, target.workspace_id), eq(members.role, 'admin')))
    if (admins.length <= 1) return c.json({ error: 'Cannot demote the last admin' }, 409)
  }

  const patch: Record<string, unknown> = {}
  if (body.role !== undefined) patch.role = body.role
  if (body.name !== undefined) patch.name = body.name
  if (body.email !== undefined) patch.email = body.email
  if (Object.keys(patch).length === 0) return c.json(target)

  const [updated] = await db.update(members).set(patch).where(eq(members.id, id)).returning()

  await db.insert(activity_log).values({
    workspace_id: target.workspace_id,
    actor_id: userId,
    entity_type: 'member',
    entity_id: id,
    action: 'updated',
    detail: body.role ? `Changed role to ${body.role}` : 'Updated member',
  })

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — remove member (admin only)
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [target] = await db.select().from(members).where(eq(members.id, id))
  if (!target) return c.json({ error: 'Not found' }, 404)

  const caller = await membershipIn(userId, target.workspace_id)
  if (!caller) return c.json({ error: 'Forbidden' }, 403)
  if (caller.role !== 'admin') return c.json({ error: 'Admin role required' }, 403)

  // do not allow removing the last admin
  if (target.role === 'admin') {
    const admins = await db
      .select()
      .from(members)
      .where(and(eq(members.workspace_id, target.workspace_id), eq(members.role, 'admin')))
    if (admins.length <= 1) return c.json({ error: 'Cannot remove the last admin' }, 409)
  }

  await db.delete(members).where(eq(members.id, id))

  await db.insert(activity_log).values({
    workspace_id: target.workspace_id,
    actor_id: userId,
    entity_type: 'member',
    entity_id: id,
    action: 'removed',
    detail: `Removed member ${target.name ?? target.user_id}`,
  })

  return c.json({ success: true })
})

export default router
