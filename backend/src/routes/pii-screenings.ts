import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { pii_screenings, data_sources, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  source_id: z.string().min(1),
  status: z
    .enum(['not-started', 'in-progress', 'passed', 'flagged', 'failed'])
    .optional()
    .default('not-started'),
  method: z.enum(['manual', 'automated', 'vendor']).optional(),
  reviewer: z.string().optional(),
  pii_categories: z.array(z.string()).optional().default([]),
  lawful_basis: z
    .enum(['consent', 'legitimate-interest', 'contract', 'not-applicable'])
    .optional(),
  anonymization_status: z.enum(['none', 'pseudonymized', 'anonymized']).optional(),
  anonymization_technique: z.string().optional(),
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
  pii_categories: z.array(z.string()).optional(),
  lawful_basis: z
    .enum(['consent', 'legitimate-interest', 'contract', 'not-applicable'])
    .nullable()
    .optional(),
  anonymization_status: z.enum(['none', 'pseudonymized', 'anonymized']).optional(),
  anonymization_technique: z.string().nullable().optional(),
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
  if (sourceId) conds.push(eq(pii_screenings.source_id, sourceId))
  if (status) conds.push(eq(pii_screenings.status, status))
  const rows = await db
    .select()
    .from(pii_screenings)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(pii_screenings.created_at))
  return c.json(rows)
})

// Public: detail
router.get('/:id', async (c) => {
  const [row] = await db
    .select()
    .from(pii_screenings)
    .where(eq(pii_screenings.id, c.req.param('id')))
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
    .insert(pii_screenings)
    .values({
      workspace_id: source.workspace_id,
      source_id: body.source_id,
      status: body.status,
      method: body.method,
      reviewer: body.reviewer,
      pii_categories: body.pii_categories,
      lawful_basis: body.lawful_basis,
      anonymization_status: body.anonymization_status ?? 'none',
      anonymization_technique: body.anonymization_technique,
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
    entity_type: 'pii_screening',
    entity_id: row.id,
    action: 'created',
    detail: `PII screening for source ${source.name} (${row.status})`,
  })

  return c.json(row, 201)
})

// Auth (owner): update status/categories/lawful_basis/remediation
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(pii_screenings)
    .where(eq(pii_screenings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) patch.status = body.status
  if (body.method !== undefined) patch.method = body.method
  if (body.reviewer !== undefined) patch.reviewer = body.reviewer
  if (body.pii_categories !== undefined) patch.pii_categories = body.pii_categories
  if (body.lawful_basis !== undefined) patch.lawful_basis = body.lawful_basis
  if (body.anonymization_status !== undefined)
    patch.anonymization_status = body.anonymization_status
  if (body.anonymization_technique !== undefined)
    patch.anonymization_technique = body.anonymization_technique
  if (body.remediation_action !== undefined) patch.remediation_action = body.remediation_action
  if (body.remediation_owner !== undefined) patch.remediation_owner = body.remediation_owner
  if (body.remediation_due !== undefined)
    patch.remediation_due = body.remediation_due ? new Date(body.remediation_due) : null
  if (body.remediation_status !== undefined) patch.remediation_status = body.remediation_status
  if (body.notes !== undefined) patch.notes = body.notes
  if (body.screened_at !== undefined)
    patch.screened_at = body.screened_at ? new Date(body.screened_at) : null

  const [updated] = await db
    .update(pii_screenings)
    .set(patch)
    .where(eq(pii_screenings.id, id))
    .returning()

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'pii_screening',
    entity_id: id,
    action: 'updated',
    detail: `PII screening updated (status ${updated.status})`,
  })

  return c.json(updated)
})

export default router
