import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { copyright_screenings, data_sources, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const flaggedWorkSchema = z.object({
  work: z.string(),
  rights_holder: z.string(),
})

const createSchema = z.object({
  source_id: z.string().min(1),
  status: z
    .enum(['not-started', 'in-progress', 'passed', 'flagged', 'failed'])
    .optional()
    .default('not-started'),
  method: z.enum(['manual', 'automated', 'vendor']).optional(),
  reviewer: z.string().optional(),
  flagged_works: z.array(flaggedWorkSchema).optional().default([]),
  risk_score: z.number().optional(),
  remediation_action: z.string().optional(),
  remediation_owner: z.string().optional(),
  remediation_due: z.string().optional(),
  remediation_status: z.enum(['none', 'open', 'resolved']).optional(),
  notes: z.string().optional(),
  screened_at: z.string().optional(),
})

const updateSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'passed', 'flagged', 'failed']).optional(),
  method: z.enum(['manual', 'automated', 'vendor']).optional(),
  reviewer: z.string().optional(),
  flagged_works: z.array(flaggedWorkSchema).optional(),
  risk_score: z.number().optional(),
  remediation_action: z.string().optional(),
  remediation_owner: z.string().optional(),
  remediation_due: z.string().nullable().optional(),
  remediation_status: z.enum(['none', 'open', 'resolved']).optional(),
  notes: z.string().optional(),
  screened_at: z.string().nullable().optional(),
})

// Public: list screenings (filter by source_id, status)
router.get('/', async (c) => {
  const sourceId = c.req.query('source_id')
  const status = c.req.query('status')
  const conds = []
  if (sourceId) conds.push(eq(copyright_screenings.source_id, sourceId))
  if (status) conds.push(eq(copyright_screenings.status, status))
  const rows = await db
    .select()
    .from(copyright_screenings)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(copyright_screenings.created_at))
  return c.json(rows)
})

// Public: detail
router.get('/:id', async (c) => {
  const [row] = await db
    .select()
    .from(copyright_screenings)
    .where(eq(copyright_screenings.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// Auth: create screening
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [source] = await db
    .select()
    .from(data_sources)
    .where(eq(data_sources.id, body.source_id))
  if (!source) return c.json({ error: 'Source not found' }, 404)

  const [row] = await db
    .insert(copyright_screenings)
    .values({
      workspace_id: source.workspace_id,
      source_id: body.source_id,
      status: body.status,
      method: body.method,
      reviewer: body.reviewer,
      flagged_works: body.flagged_works,
      risk_score: body.risk_score ?? 0,
      remediation_action: body.remediation_action,
      remediation_owner: body.remediation_owner,
      remediation_due: body.remediation_due ? new Date(body.remediation_due) : undefined,
      remediation_status: body.remediation_status ?? 'none',
      notes: body.notes ?? '',
      screened_at: body.screened_at ? new Date(body.screened_at) : undefined,
      created_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: source.workspace_id,
    actor_id: userId,
    entity_type: 'copyright_screening',
    entity_id: row.id,
    action: 'created',
    detail: `Copyright screening for source ${source.name} (${row.status})`,
  })

  return c.json(row, 201)
})

// Auth (owner): update status/flagged_works/remediation
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(copyright_screenings)
    .where(eq(copyright_screenings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) patch.status = body.status
  if (body.method !== undefined) patch.method = body.method
  if (body.reviewer !== undefined) patch.reviewer = body.reviewer
  if (body.flagged_works !== undefined) patch.flagged_works = body.flagged_works
  if (body.risk_score !== undefined) patch.risk_score = body.risk_score
  if (body.remediation_action !== undefined) patch.remediation_action = body.remediation_action
  if (body.remediation_owner !== undefined) patch.remediation_owner = body.remediation_owner
  if (body.remediation_due !== undefined)
    patch.remediation_due = body.remediation_due ? new Date(body.remediation_due) : null
  if (body.remediation_status !== undefined) patch.remediation_status = body.remediation_status
  if (body.notes !== undefined) patch.notes = body.notes
  if (body.screened_at !== undefined)
    patch.screened_at = body.screened_at ? new Date(body.screened_at) : null

  const [updated] = await db
    .update(copyright_screenings)
    .set(patch)
    .where(eq(copyright_screenings.id, id))
    .returning()

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'copyright_screening',
    entity_id: id,
    action: 'updated',
    detail: `Copyright screening updated (status ${updated.status})`,
  })

  return c.json(updated)
})

export default router
