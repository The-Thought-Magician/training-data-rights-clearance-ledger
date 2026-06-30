import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { licenses, data_sources, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const licenseSchema = z.object({
  workspace_id: z.string().min(1),
  source_id: z.string().min(1),
  license_name: z.string().min(1),
  license_type: z.enum([
    'cc-by',
    'cc-by-nc',
    'proprietary',
    'public-domain',
    'custom',
    'none-unknown',
  ]),
  permits_ai_training: z.boolean().optional().default(false),
  permits_commercial: z.boolean().optional().default(false),
  permits_derivatives: z.boolean().optional().default(false),
  requires_attribution: z.boolean().optional().default(false),
  share_alike: z.boolean().optional().default(false),
  territorial_restrictions: z.string().optional().nullable(),
  rights_holder_id: z.string().optional().nullable(),
  document_ref: z.string().optional().nullable(),
  effective_date: z.string().datetime().optional().nullable(),
  expiry_date: z.string().datetime().optional().nullable(),
  status: z.enum(['active', 'expired', 'terminated', 'superseded']).optional().default('active'),
  notes: z.string().optional().default(''),
})

type LicenseRow = typeof licenses.$inferSelect
type SourceRow = typeof data_sources.$inferSelect

// ---------------------------------------------------------------------------
// Conflict computation
//
// A license is in conflict when the rights it grants are broader than what an
// upstream (parent) source's license actually permits, or when its dates are
// inconsistent / it has expired. Permission flags are monotonic: a derivative
// can never grant more than its parent.
// ---------------------------------------------------------------------------

function computeConflictFlags(
  license: Pick<
    LicenseRow,
    | 'permits_ai_training'
    | 'permits_commercial'
    | 'permits_derivatives'
    | 'requires_attribution'
    | 'share_alike'
    | 'effective_date'
    | 'expiry_date'
    | 'status'
  >,
  parentLicenses: LicenseRow[],
): string[] {
  const flags = new Set<string>()

  // Date sanity
  if (license.effective_date && license.expiry_date) {
    if (license.expiry_date.getTime() < license.effective_date.getTime()) {
      flags.add('expiry-before-effective')
    }
  }
  if (license.expiry_date && license.expiry_date.getTime() < Date.now()) {
    flags.add('expired')
  }

  // Upstream permission narrowing: a child cannot grant more than its parent.
  for (const parent of parentLicenses) {
    if (license.permits_ai_training && !parent.permits_ai_training) {
      flags.add('ai-training-broader-than-parent')
    }
    if (license.permits_commercial && !parent.permits_commercial) {
      flags.add('commercial-broader-than-parent')
    }
    if (license.permits_derivatives && !parent.permits_derivatives) {
      flags.add('derivatives-broader-than-parent')
    }
    // share-alike viral obligation must propagate downstream
    if (parent.share_alike && !license.share_alike) {
      flags.add('share-alike-not-propagated')
    }
    // attribution obligation must propagate downstream
    if (parent.requires_attribution && !license.requires_attribution) {
      flags.add('attribution-not-propagated')
    }
  }

  return [...flags]
}

// Resolve the licenses attached to a source's upstream parent (if any).
async function getParentLicenses(source: SourceRow | undefined): Promise<LicenseRow[]> {
  if (!source || !source.upstream_source_id) return []
  return db.select().from(licenses).where(eq(licenses.source_id, source.upstream_source_id))
}

// ---------------------------------------------------------------------------
// Reads (public)
// ---------------------------------------------------------------------------

// List licenses, filterable by source_id / status
router.get('/', async (c) => {
  const source_id = c.req.query('source_id')
  const status = c.req.query('status')
  const conditions = []
  if (source_id) conditions.push(eq(licenses.source_id, source_id))
  if (status) conditions.push(eq(licenses.status, status))
  const rows = await db
    .select()
    .from(licenses)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(licenses.created_at))
  return c.json(rows)
})

// Licenses with conflict flags, recomputed live against parents
router.get('/conflicts', async (c) => {
  const workspace_id = c.req.query('workspace_id')
  const rows = await db
    .select()
    .from(licenses)
    .where(workspace_id ? eq(licenses.workspace_id, workspace_id) : undefined)
    .orderBy(desc(licenses.created_at))

  const out: Array<LicenseRow & { conflict_flags: string[] }> = []
  for (const lic of rows) {
    const [src] = await db.select().from(data_sources).where(eq(data_sources.id, lic.source_id))
    const parents = await getParentLicenses(src)
    const flags = computeConflictFlags(lic, parents)
    if (flags.length > 0) out.push({ ...lic, conflict_flags: flags })
  }
  return c.json(out)
})

// Licenses expiring or expired within N days (default 30)
router.get('/expiring', async (c) => {
  const days = Math.max(0, parseInt(c.req.query('days') ?? '30', 10) || 30)
  const workspace_id = c.req.query('workspace_id')
  const horizon = Date.now() + days * 86_400_000
  const rows = await db
    .select()
    .from(licenses)
    .where(workspace_id ? eq(licenses.workspace_id, workspace_id) : undefined)
    .orderBy(desc(licenses.created_at))
  const expiring = rows.filter(
    (l) => l.expiry_date !== null && l.expiry_date.getTime() <= horizon,
  )
  return c.json(expiring)
})

// License detail
router.get('/:id', async (c) => {
  const [lic] = await db.select().from(licenses).where(eq(licenses.id, c.req.param('id')))
  if (!lic) return c.json({ error: 'Not found' }, 404)
  return c.json(lic)
})

// ---------------------------------------------------------------------------
// Writes (auth)
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', licenseSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [src] = await db.select().from(data_sources).where(eq(data_sources.id, body.source_id))
  if (!src) return c.json({ error: 'Source not found' }, 404)
  if (src.workspace_id !== body.workspace_id)
    return c.json({ error: 'Source belongs to a different workspace' }, 403)

  const effective_date = body.effective_date ? new Date(body.effective_date) : null
  const expiry_date = body.expiry_date ? new Date(body.expiry_date) : null

  const parents = await getParentLicenses(src)
  const conflict_flags = computeConflictFlags(
    {
      permits_ai_training: body.permits_ai_training,
      permits_commercial: body.permits_commercial,
      permits_derivatives: body.permits_derivatives,
      requires_attribution: body.requires_attribution,
      share_alike: body.share_alike,
      effective_date,
      expiry_date,
      status: body.status,
    },
    parents,
  )

  const [lic] = await db
    .insert(licenses)
    .values({
      workspace_id: body.workspace_id,
      source_id: body.source_id,
      license_name: body.license_name,
      license_type: body.license_type,
      permits_ai_training: body.permits_ai_training,
      permits_commercial: body.permits_commercial,
      permits_derivatives: body.permits_derivatives,
      requires_attribution: body.requires_attribution,
      share_alike: body.share_alike,
      territorial_restrictions: body.territorial_restrictions ?? null,
      rights_holder_id: body.rights_holder_id ?? null,
      document_ref: body.document_ref ?? null,
      effective_date,
      expiry_date,
      status: body.status,
      conflict_flags,
      notes: body.notes ?? '',
      created_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: body.workspace_id,
    actor_id: userId,
    entity_type: 'license',
    entity_id: lic.id,
    action: 'created',
    detail: `Created license ${lic.license_name} (${lic.license_type})`,
  })

  return c.json(lic, 201)
})

router.put('/:id', authMiddleware, zValidator('json', licenseSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(licenses).where(eq(licenses.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')

  const effective_date =
    body.effective_date !== undefined
      ? body.effective_date
        ? new Date(body.effective_date)
        : null
      : existing.effective_date
  const expiry_date =
    body.expiry_date !== undefined
      ? body.expiry_date
        ? new Date(body.expiry_date)
        : null
      : existing.expiry_date

  // Recompute conflict flags from the merged state.
  const merged = {
    permits_ai_training: body.permits_ai_training ?? existing.permits_ai_training ?? false,
    permits_commercial: body.permits_commercial ?? existing.permits_commercial ?? false,
    permits_derivatives: body.permits_derivatives ?? existing.permits_derivatives ?? false,
    requires_attribution: body.requires_attribution ?? existing.requires_attribution ?? false,
    share_alike: body.share_alike ?? existing.share_alike ?? false,
    effective_date,
    expiry_date,
    status: body.status ?? existing.status,
  }
  const [src] = await db.select().from(data_sources).where(eq(data_sources.id, existing.source_id))
  const parents = await getParentLicenses(src)
  const conflict_flags = computeConflictFlags(merged, parents)

  const [updated] = await db
    .update(licenses)
    .set({
      ...(body.license_name !== undefined ? { license_name: body.license_name } : {}),
      ...(body.license_type !== undefined ? { license_type: body.license_type } : {}),
      permits_ai_training: merged.permits_ai_training,
      permits_commercial: merged.permits_commercial,
      permits_derivatives: merged.permits_derivatives,
      requires_attribution: merged.requires_attribution,
      share_alike: merged.share_alike,
      ...(body.territorial_restrictions !== undefined
        ? { territorial_restrictions: body.territorial_restrictions ?? null }
        : {}),
      ...(body.rights_holder_id !== undefined
        ? { rights_holder_id: body.rights_holder_id ?? null }
        : {}),
      ...(body.document_ref !== undefined ? { document_ref: body.document_ref ?? null } : {}),
      effective_date,
      expiry_date,
      status: merged.status,
      conflict_flags,
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    })
    .where(eq(licenses.id, id))
    .returning()

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'license',
    entity_id: id,
    action: 'updated',
    detail: `Updated license ${updated.license_name}`,
  })

  return c.json(updated)
})

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(licenses).where(eq(licenses.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(licenses).where(eq(licenses.id, id))

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'license',
    entity_id: id,
    action: 'deleted',
    detail: `Deleted license ${existing.license_name}`,
  })

  return c.json({ success: true })
})

export default router
