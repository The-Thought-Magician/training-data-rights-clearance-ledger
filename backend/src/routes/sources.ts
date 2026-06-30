import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, ilike } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  data_sources,
  provenance_events,
  custody_handoffs,
  licenses,
  copyright_screenings,
  pii_screenings,
  optouts,
  preference_signals,
  clearances,
  lineage_bindings,
  model_versions,
  risk_scores,
  members,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

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

async function isMember(userId: string, workspaceId: string) {
  const [m] = await db
    .select()
    .from(members)
    .where(and(eq(members.workspace_id, workspaceId), eq(members.user_id, userId)))
  return !!m
}

// ---------------------------------------------------------------------------
// GET / — list sources (public). filters: status, source_type, collection, q
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const conds = []
  const wsId = c.req.query('workspace_id')
  if (wsId) conds.push(eq(data_sources.workspace_id, wsId))
  const status = c.req.query('status')
  if (status) conds.push(eq(data_sources.status, status))
  const sourceType = c.req.query('source_type')
  if (sourceType) conds.push(eq(data_sources.source_type, sourceType))
  const collection = c.req.query('collection')
  if (collection) conds.push(eq(data_sources.collection, collection))
  const q = c.req.query('q')
  if (q) conds.push(ilike(data_sources.name, `%${q}%`))

  const rows = await db
    .select()
    .from(data_sources)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(data_sources.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — source detail (public)
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const [s] = await db.select().from(data_sources).where(eq(data_sources.id, c.req.param('id')))
  if (!s) return c.json({ error: 'Not found' }, 404)
  return c.json(s)
})

// ---------------------------------------------------------------------------
// GET /:id/full — aggregate everything attached to a source (public)
// ---------------------------------------------------------------------------

router.get('/:id/full', async (c) => {
  const id = c.req.param('id')
  const [source] = await db.select().from(data_sources).where(eq(data_sources.id, id))
  if (!source) return c.json({ error: 'Not found' }, 404)

  const [license] = await db
    .select()
    .from(licenses)
    .where(eq(licenses.source_id, id))
    .orderBy(desc(licenses.created_at))
    .limit(1)

  const copyright = await db
    .select()
    .from(copyright_screenings)
    .where(eq(copyright_screenings.source_id, id))
    .orderBy(desc(copyright_screenings.created_at))

  const pii = await db
    .select()
    .from(pii_screenings)
    .where(eq(pii_screenings.source_id, id))
    .orderBy(desc(pii_screenings.created_at))

  const sourceOptouts = await db
    .select()
    .from(optouts)
    .where(eq(optouts.source_id, id))
    .orderBy(desc(optouts.received_at))

  const signals = await db
    .select()
    .from(preference_signals)
    .where(eq(preference_signals.source_id, id))
    .orderBy(desc(preference_signals.captured_at))

  const [clearance] = await db.select().from(clearances).where(eq(clearances.source_id, id))

  // lineage: bindings for this source joined to their model versions
  const bindings = await db
    .select()
    .from(lineage_bindings)
    .where(eq(lineage_bindings.source_id, id))
  const lineage: Array<{ binding: typeof bindings[number]; version: unknown }> = []
  for (const b of bindings) {
    const [version] = await db
      .select()
      .from(model_versions)
      .where(eq(model_versions.id, b.model_version_id))
    lineage.push({ binding: b, version: version ?? null })
  }

  const [risk] = await db.select().from(risk_scores).where(eq(risk_scores.source_id, id))

  return c.json({
    source,
    license: license ?? null,
    copyright,
    pii,
    optouts: sourceOptouts,
    signals,
    clearance: clearance ?? null,
    lineage,
    risk: risk ?? null,
  })
})

// ---------------------------------------------------------------------------
// POST / — create source (auth)
// ---------------------------------------------------------------------------

const SOURCE_TYPES = ['web-scrape', 'licensed', 'purchased', 'user-generated', 'synthetic', 'public-domain', 'internal'] as const
const MODALITIES = ['text', 'image', 'audio', 'video', 'code', 'tabular'] as const
const STATUSES = ['draft', 'review', 'cleared', 'blocked', 'retired'] as const
const ACQUISITION_METHODS = ['scraped', 'downloaded', 'purchased', 'licensed', 'generated', 'contributed'] as const

const createSchema = z.object({
  workspace_id: z.string().min(1).optional(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  source_type: z.enum(SOURCE_TYPES),
  modality: z.enum(MODALITIES).default('text'),
  origin_url: z.string().optional(),
  vendor: z.string().optional(),
  upstream_source_id: z.string().optional(),
  acquisition_method: z.enum(ACQUISITION_METHODS).optional(),
  acquisition_date: z.string().optional(),
  acquirer: z.string().optional(),
  justification: z.string().optional(),
  record_count: z.number().int().optional(),
  size_bytes: z.number().int().optional(),
  format: z.string().optional(),
  tags: z.array(z.string()).optional(),
  collection: z.string().optional(),
  status: z.enum(STATUSES).optional(),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  let workspaceId = body.workspace_id ?? null
  if (!workspaceId) {
    const m = await currentMembership(userId)
    if (!m) return c.json({ error: 'No workspace' }, 400)
    workspaceId = m.workspace_id
  } else if (!(await isMember(userId, workspaceId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [s] = await db
    .insert(data_sources)
    .values({
      workspace_id: workspaceId,
      name: body.name,
      description: body.description ?? '',
      source_type: body.source_type,
      modality: body.modality,
      origin_url: body.origin_url ?? null,
      vendor: body.vendor ?? null,
      upstream_source_id: body.upstream_source_id ?? null,
      acquisition_method: body.acquisition_method ?? null,
      acquisition_date: body.acquisition_date ? new Date(body.acquisition_date) : null,
      acquirer: body.acquirer ?? null,
      justification: body.justification ?? '',
      record_count: body.record_count ?? null,
      size_bytes: body.size_bytes ?? null,
      format: body.format ?? null,
      tags: body.tags ?? [],
      collection: body.collection ?? null,
      status: body.status ?? 'draft',
      created_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    actor_id: userId,
    entity_type: 'source',
    entity_id: s.id,
    action: 'created',
    detail: `Registered data source "${s.name}"`,
  })

  return c.json(s, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update source (owner)
// ---------------------------------------------------------------------------

const updateSchema = createSchema.partial().omit({ workspace_id: true })

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(data_sources).where(eq(data_sources.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId && !(await isMember(userId, existing.workspace_id))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  for (const k of [
    'name', 'description', 'source_type', 'modality', 'origin_url', 'vendor',
    'upstream_source_id', 'acquirer', 'justification', 'record_count', 'size_bytes',
    'format', 'tags', 'collection', 'status', 'acquisition_method',
  ] as const) {
    if (body[k] !== undefined) patch[k] = body[k]
  }
  if (body.acquisition_date !== undefined) {
    patch.acquisition_date = body.acquisition_date ? new Date(body.acquisition_date) : null
  }

  const [updated] = await db.update(data_sources).set(patch).where(eq(data_sources.id, id)).returning()

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'source',
    entity_id: id,
    action: 'updated',
    detail: `Updated data source "${updated.name}"`,
  })

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete source (owner)
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(data_sources).where(eq(data_sources.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId && !(await isMember(userId, existing.workspace_id))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // clear dependent rows that have NOT NULL FKs to this source so the delete succeeds
  await db.delete(provenance_events).where(eq(provenance_events.source_id, id))
  await db.delete(custody_handoffs).where(eq(custody_handoffs.source_id, id))
  await db.delete(preference_signals).where(eq(preference_signals.source_id, id))
  await db.delete(copyright_screenings).where(eq(copyright_screenings.source_id, id))
  await db.delete(pii_screenings).where(eq(pii_screenings.source_id, id))
  await db.delete(licenses).where(eq(licenses.source_id, id))
  await db.delete(lineage_bindings).where(eq(lineage_bindings.source_id, id))
  await db.delete(risk_scores).where(eq(risk_scores.source_id, id))
  await db.delete(clearances).where(eq(clearances.source_id, id))
  await db.delete(data_sources).where(eq(data_sources.id, id))

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'source',
    entity_id: id,
    action: 'deleted',
    detail: `Deleted data source "${existing.name}"`,
  })

  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Provenance sub-resource
// ---------------------------------------------------------------------------

router.get('/:id/provenance', async (c) => {
  const id = c.req.param('id')
  const rows = await db
    .select()
    .from(provenance_events)
    .where(eq(provenance_events.source_id, id))
    .orderBy(desc(provenance_events.occurred_at))
  return c.json(rows)
})

const PROVENANCE_TYPES = ['acquired-from', 'transformed', 'merged', 'split', 'derived-from', 're-licensed'] as const

const provenanceSchema = z.object({
  event_type: z.enum(PROVENANCE_TYPES),
  description: z.string().optional(),
  related_source_id: z.string().optional(),
  occurred_at: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

router.post('/:id/provenance', authMiddleware, zValidator('json', provenanceSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [source] = await db.select().from(data_sources).where(eq(data_sources.id, id))
  if (!source) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(userId, source.workspace_id))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const [ev] = await db
    .insert(provenance_events)
    .values({
      workspace_id: source.workspace_id,
      source_id: id,
      event_type: body.event_type,
      description: body.description ?? '',
      related_source_id: body.related_source_id ?? null,
      occurred_at: body.occurred_at ? new Date(body.occurred_at) : new Date(),
      recorded_by: userId,
      metadata: body.metadata ?? {},
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: source.workspace_id,
    actor_id: userId,
    entity_type: 'source',
    entity_id: id,
    action: 'provenance-added',
    detail: `Recorded provenance event: ${body.event_type}`,
  })

  return c.json(ev, 201)
})

// ---------------------------------------------------------------------------
// Custody sub-resource
// ---------------------------------------------------------------------------

router.get('/:id/custody', async (c) => {
  const id = c.req.param('id')
  const rows = await db
    .select()
    .from(custody_handoffs)
    .where(eq(custody_handoffs.source_id, id))
    .orderBy(desc(custody_handoffs.occurred_at))
  return c.json(rows)
})

const custodySchema = z.object({
  from_party: z.string().optional(),
  to_party: z.string().min(1),
  reason: z.string().optional(),
  occurred_at: z.string().optional(),
})

router.post('/:id/custody', authMiddleware, zValidator('json', custodySchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [source] = await db.select().from(data_sources).where(eq(data_sources.id, id))
  if (!source) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(userId, source.workspace_id))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const [h] = await db
    .insert(custody_handoffs)
    .values({
      workspace_id: source.workspace_id,
      source_id: id,
      from_party: body.from_party ?? null,
      to_party: body.to_party,
      reason: body.reason ?? '',
      occurred_at: body.occurred_at ? new Date(body.occurred_at) : new Date(),
      recorded_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: source.workspace_id,
    actor_id: userId,
    entity_type: 'source',
    entity_id: id,
    action: 'custody-handoff',
    detail: `Custody handoff to ${body.to_party}`,
  })

  return c.json(h, 201)
})

export default router
