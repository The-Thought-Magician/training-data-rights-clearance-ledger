import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { evidence_artifacts, data_sources, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const evidenceSchema = z.object({
  workspace_id: z.string().min(1),
  source_id: z.string().min(1).optional().nullable(),
  entity_type: z.enum(['source', 'license', 'claim', 'screening']).optional().default('source'),
  entity_id: z.string().min(1).optional().nullable(),
  kind: z.enum(['contract', 'invoice', 'robots-snapshot', 'screenshot', 'email', 'report', 'other']),
  filename: z.string().min(1),
  content_type: z.string().optional().nullable(),
  size_bytes: z.number().int().nonnegative().optional().nullable(),
  sha256: z.string().min(1),
  storage_ref: z.string().optional().nullable(),
})

// Public: list evidence artifacts, filterable by source_id / entity_type / entity_id
router.get('/', async (c) => {
  const source_id = c.req.query('source_id')
  const entity_type = c.req.query('entity_type')
  const entity_id = c.req.query('entity_id')
  const conditions = []
  if (source_id) conditions.push(eq(evidence_artifacts.source_id, source_id))
  if (entity_type) conditions.push(eq(evidence_artifacts.entity_type, entity_type))
  if (entity_id) conditions.push(eq(evidence_artifacts.entity_id, entity_id))
  const rows = await db
    .select()
    .from(evidence_artifacts)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(evidence_artifacts.created_at))
  return c.json(rows)
})

// Auth: register an evidence artifact (its hash + metadata)
router.post('/', authMiddleware, zValidator('json', evidenceSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // If a source is referenced, verify it belongs to the same workspace.
  if (body.source_id) {
    const [src] = await db
      .select()
      .from(data_sources)
      .where(eq(data_sources.id, body.source_id))
    if (!src) return c.json({ error: 'Source not found' }, 404)
    if (src.workspace_id !== body.workspace_id)
      return c.json({ error: 'Source belongs to a different workspace' }, 403)
  }

  const [artifact] = await db
    .insert(evidence_artifacts)
    .values({
      workspace_id: body.workspace_id,
      source_id: body.source_id ?? null,
      entity_type: body.entity_type ?? 'source',
      entity_id: body.entity_id ?? null,
      kind: body.kind,
      filename: body.filename,
      content_type: body.content_type ?? null,
      size_bytes: body.size_bytes ?? null,
      sha256: body.sha256,
      storage_ref: body.storage_ref ?? null,
      uploaded_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: body.workspace_id,
    actor_id: userId,
    entity_type: 'evidence',
    entity_id: artifact.id,
    action: 'registered',
    detail: `Registered evidence ${artifact.filename} (${artifact.kind})`,
  })

  return c.json(artifact, 201)
})

// Auth (uploader only): remove an evidence artifact
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(evidence_artifacts)
    .where(eq(evidence_artifacts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.uploaded_by !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(evidence_artifacts).where(eq(evidence_artifacts.id, id))

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'evidence',
    entity_id: id,
    action: 'deleted',
    detail: `Deleted evidence ${existing.filename}`,
  })

  return c.json({ success: true })
})

export default router
