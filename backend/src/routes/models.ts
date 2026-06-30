import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  models,
  model_versions,
  members,
  workspaces,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const modelSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  purpose: z.string().optional().default(''),
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

// ---------------------------------------------------------------------------
// GET / — public — list models
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const rows = await db.select().from(models).orderBy(desc(models.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — public — model detail + its versions
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [model] = await db.select().from(models).where(eq(models.id, id))
  if (!model) return c.json({ error: 'Not found' }, 404)

  const versions = await db
    .select()
    .from(model_versions)
    .where(eq(model_versions.model_id, id))
    .orderBy(desc(model_versions.created_at))

  return c.json({ model, versions })
})

// ---------------------------------------------------------------------------
// POST / — auth — create model
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', modelSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const workspaceId = await resolveWorkspaceId(userId)
  if (!workspaceId) return c.json({ error: 'No workspace found for user' }, 400)

  const [created] = await db
    .insert(models)
    .values({
      workspace_id: workspaceId,
      name: body.name,
      description: body.description,
      purpose: body.purpose,
      created_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    actor_id: userId,
    entity_type: 'model',
    entity_id: created.id,
    action: 'created',
    detail: `Created model ${created.name}`,
  })

  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — auth (owner) — update
// ---------------------------------------------------------------------------

router.put(
  '/:id',
  authMiddleware,
  zValidator('json', modelSchema.partial()),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db.select().from(models).where(eq(models.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')
    const [updated] = await db
      .update(models)
      .set(body)
      .where(eq(models.id, id))
      .returning()

    await db.insert(activity_log).values({
      workspace_id: existing.workspace_id,
      actor_id: userId,
      entity_type: 'model',
      entity_id: id,
      action: 'updated',
      detail: `Updated model ${updated.name}`,
    })

    return c.json(updated)
  },
)

// ---------------------------------------------------------------------------
// DELETE /:id — auth (owner) — delete (rejects if versions still bound)
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(models).where(eq(models.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [version] = await db
    .select()
    .from(model_versions)
    .where(eq(model_versions.model_id, id))
  if (version) {
    return c.json(
      { error: 'Cannot delete model with existing versions' },
      409,
    )
  }

  await db.delete(models).where(eq(models.id, id))

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'model',
    entity_id: id,
    action: 'deleted',
    detail: `Deleted model ${existing.name}`,
  })

  return c.json({ success: true })
})

export default router
