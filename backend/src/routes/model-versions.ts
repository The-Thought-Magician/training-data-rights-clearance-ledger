import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import {
  model_versions,
  models,
  lineage_bindings,
  data_sources,
  clearances,
  claim_impacts,
  members,
  ledger_entries,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveWorkspaceId(userId: string): Promise<string | null> {
  const [m] = await db
    .select()
    .from(members)
    .where(eq(members.user_id, userId))
    .orderBy(members.created_at)
    .limit(1)
  return m ? m.workspace_id : null
}

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

async function appendLedger(
  workspaceId: string,
  entityType: string,
  entityId: string,
  action: string,
  payload: Record<string, unknown>,
  actorId: string,
) {
  const [prev] = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, workspaceId))
    .orderBy(desc(ledger_entries.seq))
    .limit(1)
  const seq = prev ? prev.seq + 1 : 1
  const prevHash = prev ? prev.entry_hash : '0'.repeat(64)
  const createdAt = new Date()
  const canonical = JSON.stringify({
    workspace_id: workspaceId,
    seq,
    entity_type: entityType,
    entity_id: entityId,
    action,
    payload,
    actor_id: actorId,
    prev_hash: prevHash,
    created_at: createdAt.toISOString(),
  })
  const entryHash = sha256(canonical)
  const [entry] = await db
    .insert(ledger_entries)
    .values({
      workspace_id: workspaceId,
      seq,
      entity_type: entityType,
      entity_id: entityId,
      action,
      payload,
      actor_id: actorId,
      prev_hash: prevHash,
      entry_hash: entryHash,
      created_at: createdAt,
    })
    .returning()
  return entry
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

// Compute manifest hash deterministically from a version's bound sources.
function computeManifestHash(
  version: { model_id: string; version: string; base_model: string | null; training_type: string | null },
  bindings: Array<{ source_id: string; proportion: number | null; preprocessing: string | null }>,
): string {
  const sorted = [...bindings].sort((a, b) => (a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0))
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
  return sha256(canonical)
}

// Evaluate release readiness: every bound source must be cleared (or overridden).
async function computeReadiness(workspaceId: string, versionId: string) {
  const bindings = await db
    .select()
    .from(lineage_bindings)
    .where(eq(lineage_bindings.model_version_id, versionId))

  const blockers: Array<{ source_id: string; source_name: string; reason: string }> = []

  if (bindings.length === 0) {
    blockers.push({ source_id: '', source_name: '', reason: 'No sources bound to this version' })
  }

  const sourceIds = bindings.map((b) => b.source_id)
  const sources = sourceIds.length
    ? await db.select().from(data_sources).where(inArray(data_sources.id, sourceIds))
    : []
  const clearanceRows = sourceIds.length
    ? await db.select().from(clearances).where(inArray(clearances.source_id, sourceIds))
    : []
  const clearanceBySource = new Map(clearanceRows.map((cl) => [cl.source_id, cl]))
  const sourceById = new Map(sources.map((s) => [s.id, s]))

  for (const b of bindings) {
    const src = sourceById.get(b.source_id)
    const name = src ? src.name : b.source_id
    const cl = clearanceBySource.get(b.source_id)
    if (!cl) {
      blockers.push({ source_id: b.source_id, source_name: name, reason: 'No clearance evaluated' })
    } else if (cl.status === 'blocked') {
      blockers.push({ source_id: b.source_id, source_name: name, reason: 'Source clearance blocked' })
    } else if (cl.status === 'pending') {
      blockers.push({ source_id: b.source_id, source_name: name, reason: 'Clearance still pending' })
    } else if (src && src.status === 'blocked') {
      blockers.push({ source_id: b.source_id, source_name: name, reason: 'Source register status is blocked' })
    }
  }

  return { ready: blockers.length === 0, blockers, boundSources: bindings.length }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  model_id: z.string().min(1),
  version: z.string().min(1),
  base_model: z.string().optional().nullable(),
  training_type: z.enum(['train', 'fine-tune']).optional().default('train'),
  training_date: z.string().datetime().optional().nullable(),
})

const updateSchema = z.object({
  version: z.string().min(1).optional(),
  base_model: z.string().optional().nullable(),
  training_type: z.enum(['train', 'fine-tune']).optional(),
  training_date: z.string().datetime().optional().nullable(),
  release_status: z.enum(['draft', 'ready', 'released', 'quarantined']).optional(),
})

const releaseSchema = z.object({
  issued_to: z.string().optional(),
  notes: z.string().optional().default(''),
  force: z.boolean().optional().default(false),
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — public — list versions (filter model_id)
router.get('/', async (c) => {
  const modelId = c.req.query('model_id')
  const rows = modelId
    ? await db
        .select()
        .from(model_versions)
        .where(eq(model_versions.model_id, modelId))
        .orderBy(desc(model_versions.created_at))
    : await db.select().from(model_versions).orderBy(desc(model_versions.created_at))
  return c.json(rows)
})

// GET /:id — public — version + bound sources + readiness + impacts
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [version] = await db.select().from(model_versions).where(eq(model_versions.id, id))
  if (!version) return c.json({ error: 'Not found' }, 404)

  const bindings = await db
    .select()
    .from(lineage_bindings)
    .where(eq(lineage_bindings.model_version_id, id))
    .orderBy(desc(lineage_bindings.created_at))

  const readiness = await computeReadiness(version.workspace_id, id)

  const impacts = await db
    .select()
    .from(claim_impacts)
    .where(eq(claim_impacts.model_version_id, id))
    .orderBy(desc(claim_impacts.created_at))

  return c.json({ version, bindings, readiness, impacts })
})

// GET /:id/readiness — public — release readiness report
router.get('/:id/readiness', async (c) => {
  const id = c.req.param('id')
  const [version] = await db.select().from(model_versions).where(eq(model_versions.id, id))
  if (!version) return c.json({ error: 'Not found' }, 404)
  const readiness = await computeReadiness(version.workspace_id, id)
  return c.json(readiness)
})

// POST / — auth — create version (computes manifest_hash from bindings)
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [model] = await db.select().from(models).where(eq(models.id, body.model_id))
  if (!model) return c.json({ error: 'Model not found' }, 404)

  const workspaceId = model.workspace_id
  const role = await memberRole(workspaceId, userId)
  if (!role) return c.json({ error: 'Forbidden' }, 403)

  // New version has no bindings yet; manifest hash is computed over an empty source set.
  const manifestHash = computeManifestHash(
    {
      model_id: body.model_id,
      version: body.version,
      base_model: body.base_model ?? null,
      training_type: body.training_type ?? 'train',
    },
    [],
  )

  const [created] = await db
    .insert(model_versions)
    .values({
      workspace_id: workspaceId,
      model_id: body.model_id,
      version: body.version,
      base_model: body.base_model ?? null,
      training_type: body.training_type ?? 'train',
      training_date: body.training_date ? new Date(body.training_date) : null,
      manifest_hash: manifestHash,
      release_status: 'draft',
      created_by: userId,
    })
    .returning()

  await logActivity(workspaceId, userId, 'model_version', created.id, 'created', `Version ${created.version}`)
  return c.json(created, 201)
})

// PUT /:id — auth (owner) — update; recomputes manifest_hash from current bindings
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(model_versions).where(eq(model_versions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) {
    const role = await memberRole(existing.workspace_id, userId)
    if (role !== 'admin' && role !== 'ml-lead') return c.json({ error: 'Forbidden' }, 403)
  }

  const bindings = await db
    .select()
    .from(lineage_bindings)
    .where(eq(lineage_bindings.model_version_id, id))

  const next = {
    model_id: existing.model_id,
    version: body.version ?? existing.version,
    base_model: body.base_model !== undefined ? body.base_model : existing.base_model,
    training_type: body.training_type ?? existing.training_type ?? 'train',
  }
  const manifestHash = computeManifestHash(next, bindings)

  const [updated] = await db
    .update(model_versions)
    .set({
      version: next.version,
      base_model: next.base_model ?? null,
      training_type: next.training_type,
      training_date: body.training_date ? new Date(body.training_date) : existing.training_date,
      release_status: body.release_status ?? existing.release_status,
      manifest_hash: manifestHash,
    })
    .where(eq(model_versions.id, id))
    .returning()

  await logActivity(existing.workspace_id, userId, 'model_version', id, 'updated', `Version ${updated.version}`)
  return c.json(updated)
})

// POST /:id/release — auth — sign off release (records released_by, ledger entry)
router.post('/:id/release', authMiddleware, zValidator('json', releaseSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [version] = await db.select().from(model_versions).where(eq(model_versions.id, id))
  if (!version) return c.json({ error: 'Not found' }, 404)

  const role = await memberRole(version.workspace_id, userId)
  if (role !== 'admin' && role !== 'ml-lead' && role !== 'legal') {
    return c.json({ error: 'Forbidden: release requires admin, ml-lead, or legal role' }, 403)
  }

  const readiness = await computeReadiness(version.workspace_id, id)
  if (!readiness.ready && !body.force) {
    return c.json(
      { error: 'Release readiness check failed', blockers: readiness.blockers, ready: false },
      409,
    )
  }

  // Recompute manifest hash from current bindings to lock the released manifest.
  const bindings = await db
    .select()
    .from(lineage_bindings)
    .where(eq(lineage_bindings.model_version_id, id))
  const manifestHash = computeManifestHash(
    {
      model_id: version.model_id,
      version: version.version,
      base_model: version.base_model,
      training_type: version.training_type ?? 'train',
    },
    bindings,
  )

  const releasedAt = new Date()
  const [released] = await db
    .update(model_versions)
    .set({
      release_status: 'released',
      released_at: releasedAt,
      released_by: userId,
      manifest_hash: manifestHash,
    })
    .where(eq(model_versions.id, id))
    .returning()

  const ledger = await appendLedger(
    version.workspace_id,
    'model_version',
    id,
    'released',
    {
      version: version.version,
      model_id: version.model_id,
      manifest_hash: manifestHash,
      bound_sources: bindings.length,
      forced: !readiness.ready && body.force,
      issued_to: body.issued_to ?? null,
      notes: body.notes ?? '',
    },
    userId,
  )

  await logActivity(
    version.workspace_id,
    userId,
    'model_version',
    id,
    'released',
    `Released version ${version.version}`,
  )

  return c.json({ ...released, ledger })
})

export default router
