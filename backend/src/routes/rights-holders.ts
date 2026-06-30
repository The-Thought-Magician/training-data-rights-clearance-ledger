import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  rights_holders,
  licenses,
  optouts,
  claims,
  activity_log,
  members,
  workspaces,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const holderSchema = z.object({
  name: z.string().min(1),
  holder_type: z
    .enum(['individual', 'publisher', 'vendor', 'collecting-society'])
    .optional()
    .default('individual'),
  contact_email: z.string().email().optional(),
  jurisdiction: z.string().optional(),
  notes: z.string().optional().default(''),
})

// ---------------------------------------------------------------------------
// GET / — public — list rights-holders
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const rows = await db
    .select()
    .from(rights_holders)
    .orderBy(desc(rights_holders.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — public — holder + linked licenses/optouts/claims
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [holder] = await db
    .select()
    .from(rights_holders)
    .where(eq(rights_holders.id, id))
  if (!holder) return c.json({ error: 'Not found' }, 404)

  const [linkedLicenses, linkedOptouts, linkedClaims] = await Promise.all([
    db.select().from(licenses).where(eq(licenses.rights_holder_id, id)),
    db.select().from(optouts).where(eq(optouts.rights_holder_id, id)),
    db.select().from(claims).where(eq(claims.rights_holder_id, id)),
  ])

  return c.json({
    holder,
    licenses: linkedLicenses,
    optouts: linkedOptouts,
    claims: linkedClaims,
  })
})

// ---------------------------------------------------------------------------
// POST / — auth — create
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', holderSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // resolve the user's workspace via membership; fall back to first workspace
  const workspaceId = await resolveWorkspaceId(userId)
  if (!workspaceId) return c.json({ error: 'No workspace found for user' }, 400)

  const [created] = await db
    .insert(rights_holders)
    .values({
      workspace_id: workspaceId,
      name: body.name,
      holder_type: body.holder_type,
      contact_email: body.contact_email,
      jurisdiction: body.jurisdiction,
      notes: body.notes,
      created_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    actor_id: userId,
    entity_type: 'rights_holder',
    entity_id: created.id,
    action: 'created',
    detail: `Created rights-holder ${created.name}`,
  })

  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — auth (owner) — update
// ---------------------------------------------------------------------------

router.put(
  '/:id',
  authMiddleware,
  zValidator('json', holderSchema.partial()),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db
      .select()
      .from(rights_holders)
      .where(eq(rights_holders.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')
    const [updated] = await db
      .update(rights_holders)
      .set(body)
      .where(eq(rights_holders.id, id))
      .returning()

    await db.insert(activity_log).values({
      workspace_id: existing.workspace_id,
      actor_id: userId,
      entity_type: 'rights_holder',
      entity_id: id,
      action: 'updated',
      detail: `Updated rights-holder ${updated.name}`,
    })

    return c.json(updated)
  },
)

// ---------------------------------------------------------------------------
// DELETE /:id — auth (owner) — delete
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(rights_holders)
    .where(eq(rights_holders.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(rights_holders).where(eq(rights_holders.id, id))

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'rights_holder',
    entity_id: id,
    action: 'deleted',
    detail: `Deleted rights-holder ${existing.name}`,
  })

  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// workspace resolution — find the workspace the user belongs to
// ---------------------------------------------------------------------------

async function resolveWorkspaceId(userId: string): Promise<string | null> {
  const [membership] = await db
    .select()
    .from(members)
    .where(eq(members.user_id, userId))
    .orderBy(desc(members.created_at))
  if (membership) return membership.workspace_id
  const [owned] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.owner_id, userId))
    .orderBy(desc(workspaces.created_at))
  return owned ? owned.id : null
}

export default router
