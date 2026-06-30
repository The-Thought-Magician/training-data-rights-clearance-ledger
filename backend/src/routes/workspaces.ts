import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspaces,
  members,
  clearance_requirements,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'workspace'
  )
}

const DEFAULT_REQUIREMENTS: Array<{ key: string; label: string; description: string }> = [
  { key: 'license', label: 'License Cleared', description: 'A license permitting AI training is recorded for this source.' },
  { key: 'copyright', label: 'Copyright Screening Passed', description: 'A copyright screening has passed with no unresolved flags.' },
  { key: 'pii', label: 'PII Screening Passed', description: 'A PII screening has passed with an established lawful basis.' },
  { key: 'optouts', label: 'Opt-Outs Honored', description: 'All received opt-outs for this source have been applied.' },
  { key: 'approver', label: 'Approver Sign-Off', description: 'A legal/authorized approver has signed off on clearance.' },
]

/** Resolve the membership rows for a user across all workspaces. */
async function memberships(userId: string) {
  return db.select().from(members).where(eq(members.user_id, userId))
}

// ---------------------------------------------------------------------------
// GET / — list workspaces the user belongs to
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const mine = await memberships(userId)
  if (mine.length === 0) return c.json([])
  const ids = mine.map((m) => m.workspace_id)
  const rows = await db
    .select()
    .from(workspaces)
    .where(inArray(workspaces.id, ids))
    .orderBy(desc(workspaces.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /current — the user's active/first workspace with member role
// ---------------------------------------------------------------------------

router.get('/current', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const mine = await memberships(userId)
  if (mine.length === 0) return c.json({ workspace: null, role: null })
  // earliest membership = first/active workspace
  mine.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
  const membership = mine[0]
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, membership.workspace_id))
  return c.json({ workspace: workspace ?? null, role: membership.role })
})

// ---------------------------------------------------------------------------
// POST / — create workspace; creator becomes admin; seed clearance reqs
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64).optional(),
  email: z.string().email().optional(),
  member_name: z.string().min(1).max(120).optional(),
  default_required_checks: z.array(z.string()).optional(),
  settings: z.record(z.unknown()).optional(),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // ensure unique slug
  let base = body.slug ? slugify(body.slug) : slugify(body.name)
  let slug = base
  let attempt = 1
  // collision-resolve against existing slugs
  // (small table; linear probe is fine)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [clash] = await db.select().from(workspaces).where(eq(workspaces.slug, slug))
    if (!clash) break
    slug = `${base}-${attempt++}`
  }

  const [ws] = await db
    .insert(workspaces)
    .values({
      name: body.name,
      slug,
      owner_id: userId,
      ...(body.default_required_checks ? { default_required_checks: body.default_required_checks } : {}),
      ...(body.settings ? { settings: body.settings } : {}),
    })
    .returning()

  // creator becomes admin member
  await db.insert(members).values({
    workspace_id: ws.id,
    user_id: userId,
    email: body.email ?? null,
    name: body.member_name ?? null,
    role: 'admin',
  })

  // seed default clearance requirements
  for (const req of DEFAULT_REQUIREMENTS) {
    await db
      .insert(clearance_requirements)
      .values({
        workspace_id: ws.id,
        key: req.key,
        label: req.label,
        description: req.description,
        is_required: (ws.default_required_checks ?? []).includes(req.key),
      })
      .onConflictDoNothing({ target: [clearance_requirements.workspace_id, clearance_requirements.key] })
  }

  await db.insert(activity_log).values({
    workspace_id: ws.id,
    actor_id: userId,
    entity_type: 'workspace',
    entity_id: ws.id,
    action: 'created',
    detail: `Created workspace "${ws.name}"`,
  })

  return c.json(ws, 201)
})

// ---------------------------------------------------------------------------
// GET /:id — workspace detail (must be a member)
// ---------------------------------------------------------------------------

router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [membership] = await db
    .select()
    .from(members)
    .where(and(eq(members.workspace_id, id), eq(members.user_id, userId)))
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  return c.json(ws)
})

// ---------------------------------------------------------------------------
// PUT /:id — update (admin only)
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().min(1).max(64).optional(),
  settings: z.record(z.unknown()).optional(),
  default_required_checks: z.array(z.string()).optional(),
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [membership] = await db
    .select()
    .from(members)
    .where(and(eq(members.workspace_id, id), eq(members.user_id, userId)))
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  if (membership.role !== 'admin') return c.json({ error: 'Admin role required' }, 403)

  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.settings !== undefined) patch.settings = body.settings
  if (body.default_required_checks !== undefined) patch.default_required_checks = body.default_required_checks
  if (body.slug !== undefined) {
    let candidate = slugify(body.slug)
    const [clash] = await db.select().from(workspaces).where(eq(workspaces.slug, candidate))
    if (clash && clash.id !== id) return c.json({ error: 'Slug already in use' }, 409)
    patch.slug = candidate
  }

  if (Object.keys(patch).length === 0) return c.json(existing)

  const [updated] = await db.update(workspaces).set(patch).where(eq(workspaces.id, id)).returning()

  // keep clearance_requirements.is_required in sync when required checks change
  if (body.default_required_checks !== undefined) {
    const reqs = await db
      .select()
      .from(clearance_requirements)
      .where(eq(clearance_requirements.workspace_id, id))
    for (const r of reqs) {
      const shouldRequire = body.default_required_checks.includes(r.key)
      if (r.is_required !== shouldRequire) {
        await db
          .update(clearance_requirements)
          .set({ is_required: shouldRequire })
          .where(eq(clearance_requirements.id, r.id))
      }
    }
  }

  await db.insert(activity_log).values({
    workspace_id: id,
    actor_id: userId,
    entity_type: 'workspace',
    entity_id: id,
    action: 'updated',
    detail: `Updated workspace settings`,
  })

  return c.json(updated)
})

export default router
