import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { activity_log } from '../db/schema.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET / — activity feed (public read)
// Filters: actor_id, entity_type, entity_id, workspace_id; paginated (limit, offset)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const actorId = c.req.query('actor_id')
  const entityType = c.req.query('entity_type')
  const entityId = c.req.query('entity_id')
  const workspaceId = c.req.query('workspace_id')

  const limitRaw = parseInt(c.req.query('limit') ?? '100', 10)
  const offsetRaw = parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 100
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0

  const conds = []
  if (actorId) conds.push(eq(activity_log.actor_id, actorId))
  if (entityType) conds.push(eq(activity_log.entity_type, entityType))
  if (entityId) conds.push(eq(activity_log.entity_id, entityId))
  if (workspaceId) conds.push(eq(activity_log.workspace_id, workspaceId))

  const base = db.select().from(activity_log)
  const rows =
    conds.length > 0
      ? await base
          .where(and(...conds))
          .orderBy(desc(activity_log.created_at))
          .limit(limit)
          .offset(offset)
      : await base.orderBy(desc(activity_log.created_at)).limit(limit).offset(offset)

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /entity/:entityType/:entityId — per-entity timeline (public read)
// ---------------------------------------------------------------------------

router.get('/entity/:entityType/:entityId', async (c) => {
  const entityType = c.req.param('entityType')
  const entityId = c.req.param('entityId')
  const rows = await db
    .select()
    .from(activity_log)
    .where(and(eq(activity_log.entity_type, entityType), eq(activity_log.entity_id, entityId)))
    .orderBy(desc(activity_log.created_at))
  return c.json(rows)
})

export default router
