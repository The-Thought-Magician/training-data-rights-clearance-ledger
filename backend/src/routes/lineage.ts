import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import {
  lineage_bindings,
  model_versions,
  data_sources,
  members,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function memberRole(workspaceId: string, userId: string): Promise<string | null> {
  const [m] = await db
    .select()
    .from(members)
    .where(and(eq(members.workspace_id, workspaceId), eq(members.user_id, userId)))
    .limit(1)
  return m ? m.role : null
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

async function logActivity(
  workspaceId: string,
  actorId: string,
  entityType: string,
  entityId: string,
  action: string,
  detail = '',
) {
  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    actor_id: actorId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    detail,
  })
}

// Recompute and persist a model version's manifest_hash from its current bindings.
async function recomputeManifest(versionId: string) {
  const [version] = await db.select().from(model_versions).where(eq(model_versions.id, versionId))
  if (!version) return
  const bindings = await db
    .select()
    .from(lineage_bindings)
    .where(eq(lineage_bindings.model_version_id, versionId))
  const sorted = [...bindings].sort((a, b) =>
    a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0,
  )
  const canonical = JSON.stringify({
    model_id: version.model_id,
    version: version.version,
    base_model: version.base_model ?? null,
    training_type: version.training_type ?? 'train',
    sources: sorted.map((b) => ({
      source_id: b.source_id,
      proportion: b.proportion ?? null,
      preprocessing: b.preprocessing ?? '',
    })),
  })
  const manifestHash = sha256(canonical)
  await db.update(model_versions).set({ manifest_hash: manifestHash }).where(eq(model_versions.id, versionId))
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const bindSchema = z.object({
  model_version_id: z.string().min(1),
  source_id: z.string().min(1),
  proportion: z.number().min(0).max(1).optional().nullable(),
  preprocessing: z.string().optional().default(''),
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — public — list bindings (filter model_version_id or source_id)
router.get('/', async (c) => {
  const modelVersionId = c.req.query('model_version_id')
  const sourceId = c.req.query('source_id')
  let rows
  if (modelVersionId) {
    rows = await db
      .select()
      .from(lineage_bindings)
      .where(eq(lineage_bindings.model_version_id, modelVersionId))
      .orderBy(desc(lineage_bindings.created_at))
  } else if (sourceId) {
    rows = await db
      .select()
      .from(lineage_bindings)
      .where(eq(lineage_bindings.source_id, sourceId))
      .orderBy(desc(lineage_bindings.created_at))
  } else {
    rows = await db.select().from(lineage_bindings).orderBy(desc(lineage_bindings.created_at))
  }
  return c.json(rows)
})

// GET /source/:sourceId/models — public — reverse lookup: model versions a source touched
router.get('/source/:sourceId/models', async (c) => {
  const sourceId = c.req.param('sourceId')
  const bindings = await db
    .select()
    .from(lineage_bindings)
    .where(eq(lineage_bindings.source_id, sourceId))
  const versionIds = [...new Set(bindings.map((b) => b.model_version_id))]
  if (versionIds.length === 0) return c.json([])
  const versions = await db
    .select()
    .from(model_versions)
    .where(inArray(model_versions.id, versionIds))
    .orderBy(desc(model_versions.created_at))
  return c.json(versions)
})

// POST / — auth — bind source to model version
router.post('/', authMiddleware, zValidator('json', bindSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [version] = await db
    .select()
    .from(model_versions)
    .where(eq(model_versions.id, body.model_version_id))
  if (!version) return c.json({ error: 'Model version not found' }, 404)

  const [source] = await db.select().from(data_sources).where(eq(data_sources.id, body.source_id))
  if (!source) return c.json({ error: 'Source not found' }, 404)

  if (source.workspace_id !== version.workspace_id) {
    return c.json({ error: 'Source and model version belong to different workspaces' }, 400)
  }

  const role = await memberRole(version.workspace_id, userId)
  if (!role) return c.json({ error: 'Forbidden' }, 403)

  const [existing] = await db
    .select()
    .from(lineage_bindings)
    .where(
      and(
        eq(lineage_bindings.model_version_id, body.model_version_id),
        eq(lineage_bindings.source_id, body.source_id),
      ),
    )
  if (existing) return c.json({ error: 'Binding already exists' }, 409)

  const [created] = await db
    .insert(lineage_bindings)
    .values({
      workspace_id: version.workspace_id,
      model_version_id: body.model_version_id,
      source_id: body.source_id,
      proportion: body.proportion ?? null,
      preprocessing: body.preprocessing ?? '',
      created_by: userId,
    })
    .returning()

  await recomputeManifest(body.model_version_id)
  await logActivity(
    version.workspace_id,
    userId,
    'lineage',
    created.id,
    'bound',
    `Bound source ${source.name} to version ${version.version}`,
  )
  return c.json(created, 201)
})

// DELETE /:id — auth (owner) — unbind
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(lineage_bindings).where(eq(lineage_bindings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  if (existing.created_by !== userId) {
    const role = await memberRole(existing.workspace_id, userId)
    if (role !== 'admin' && role !== 'ml-lead') return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(lineage_bindings).where(eq(lineage_bindings.id, id))
  await recomputeManifest(existing.model_version_id)
  await logActivity(existing.workspace_id, userId, 'lineage', id, 'unbound', 'Removed lineage binding')
  return c.json({ success: true })
})

export default router
