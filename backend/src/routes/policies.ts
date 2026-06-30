import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  policies,
  policy_violations,
  data_sources,
  licenses,
  copyright_screenings,
  pii_screenings,
  optouts,
  members,
  workspaces,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Resolve the active workspace for a user (first membership, else owned).
async function resolveWorkspaceId(userId: string): Promise<string | null> {
  const [m] = await db.select().from(members).where(eq(members.user_id, userId)).limit(1)
  if (m) return m.workspace_id
  const [w] = await db.select().from(workspaces).where(eq(workspaces.owner_id, userId)).limit(1)
  return w ? w.id : null
}

async function logActivity(
  workspaceId: string,
  actorId: string,
  entityType: string,
  entityId: string | null,
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

type Condition = { field: string; op: string; value: unknown }

// Evaluate a single condition against a flattened evaluation context.
function evalCondition(cond: Condition, ctx: Record<string, unknown>): boolean {
  const actual = ctx[cond.field]
  const expected = cond.value
  switch (cond.op) {
    case 'eq':
      return actual === expected
    case 'neq':
      return actual !== expected
    case 'is_true':
      return actual === true
    case 'is_false':
      return actual === false || actual === undefined || actual === null
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
    case 'in':
      return Array.isArray(expected) && expected.includes(actual as never)
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual as never)
    case 'exists':
      return actual !== undefined && actual !== null && actual !== ''
    case 'missing':
      return actual === undefined || actual === null || actual === ''
    case 'contains':
      return Array.isArray(actual) && actual.includes(expected as never)
    default:
      return false
  }
}

// Build a flattened evaluation context for a source from its related rows.
async function buildSourceContext(workspaceId: string, sourceId: string) {
  const [source] = await db
    .select()
    .from(data_sources)
    .where(and(eq(data_sources.id, sourceId), eq(data_sources.workspace_id, workspaceId)))
  if (!source) return null

  const lic = await db.select().from(licenses).where(eq(licenses.source_id, sourceId))
  const cop = await db
    .select()
    .from(copyright_screenings)
    .where(eq(copyright_screenings.source_id, sourceId))
  const pii = await db.select().from(pii_screenings).where(eq(pii_screenings.source_id, sourceId))
  const oo = await db.select().from(optouts).where(eq(optouts.source_id, sourceId))

  const activeLicense = lic.find((l) => l.status === 'active') ?? lic[0]
  const latestCopyright = cop.sort(
    (a, b) => (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0),
  )[0]
  const latestPii = pii.sort(
    (a, b) => (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0),
  )[0]
  const pendingOptouts = oo.filter((o) => o.honor_status === 'pending').length

  const ctx: Record<string, unknown> = {
    'source.status': source.status,
    'source.source_type': source.source_type,
    'source.modality': source.modality,
    'source.acquisition_method': source.acquisition_method,
    'source.risk_score': source.risk_score,
    'source.tags': source.tags,
    'source.collection': source.collection,
    'source.vendor': source.vendor,
    'license.exists': !!activeLicense,
    'license.license_type': activeLicense?.license_type,
    'license.permits_ai_training': activeLicense?.permits_ai_training,
    'license.permits_commercial': activeLicense?.permits_commercial,
    'license.permits_derivatives': activeLicense?.permits_derivatives,
    'license.requires_attribution': activeLicense?.requires_attribution,
    'license.share_alike': activeLicense?.share_alike,
    'license.status': activeLicense?.status,
    'license.conflict_count': activeLicense?.conflict_flags?.length ?? 0,
    'copyright.status': latestCopyright?.status,
    'copyright.flagged_count': latestCopyright?.flagged_works?.length ?? 0,
    'pii.status': latestPii?.status,
    'pii.category_count': latestPii?.pii_categories?.length ?? 0,
    'pii.lawful_basis': latestPii?.lawful_basis,
    'pii.anonymization_status': latestPii?.anonymization_status,
    'optouts.pending_count': pendingOptouts,
  }
  return { source, ctx }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const conditionSchema = z.object({
  field: z.string().min(1),
  op: z.string().min(1),
  value: z.unknown().optional(),
})

const policySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  conditions: z.array(conditionSchema).optional().default([]),
  action: z.enum(['block', 'flag', 'require-review']).optional().default('flag'),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  is_active: z.boolean().optional().default(true),
})

// ---------------------------------------------------------------------------
// GET / — list policies (public read)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const rows = workspaceId
    ? await db
        .select()
        .from(policies)
        .where(eq(policies.workspace_id, workspaceId))
        .orderBy(desc(policies.created_at))
    : await db.select().from(policies).orderBy(desc(policies.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /violations — list violations (public read; filter source_id, resolved)
// ---------------------------------------------------------------------------

router.get('/violations', async (c) => {
  const sourceId = c.req.query('source_id')
  const resolvedQ = c.req.query('resolved')
  const conds = []
  if (sourceId) conds.push(eq(policy_violations.source_id, sourceId))
  if (resolvedQ === 'true') conds.push(eq(policy_violations.resolved, true))
  if (resolvedQ === 'false') conds.push(eq(policy_violations.resolved, false))
  const rows =
    conds.length > 0
      ? await db
          .select()
          .from(policy_violations)
          .where(and(...conds))
          .orderBy(desc(policy_violations.detected_at))
      : await db.select().from(policy_violations).orderBy(desc(policy_violations.detected_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — create policy (auth)
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', policySchema), async (c) => {
  const userId = getUserId(c)
  const workspaceId = await resolveWorkspaceId(userId)
  if (!workspaceId) return c.json({ error: 'No workspace' }, 400)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(policies)
    .values({
      workspace_id: workspaceId,
      name: body.name,
      description: body.description,
      conditions: body.conditions as Condition[],
      action: body.action,
      severity: body.severity,
      is_active: body.is_active,
      version: 1,
      created_by: userId,
    })
    .returning()
  await logActivity(workspaceId, userId, 'policy', created.id, 'created', `Created policy ${created.name}`)
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update / toggle active (auth, owner)
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', policySchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(policies).where(eq(policies.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.conditions !== undefined) patch.conditions = body.conditions as Condition[]
  if (body.action !== undefined) patch.action = body.action
  if (body.severity !== undefined) patch.severity = body.severity
  if (body.is_active !== undefined) patch.is_active = body.is_active
  // bump version on any substantive change
  patch.version = (existing.version ?? 1) + 1
  const [updated] = await db.update(policies).set(patch).where(eq(policies.id, id)).returning()
  await logActivity(existing.workspace_id, userId, 'policy', id, 'updated', `Updated policy ${updated.name}`)
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete (auth, owner)
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(policies).where(eq(policies.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)
  // clear dependent violations first
  await db.delete(policy_violations).where(eq(policy_violations.policy_id, id))
  await db.delete(policies).where(eq(policies.id, id))
  await logActivity(existing.workspace_id, userId, 'policy', id, 'deleted', `Deleted policy ${existing.name}`)
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// POST /evaluate/:sourceId — evaluate active policies; write policy_violations
// ---------------------------------------------------------------------------

router.post('/evaluate/:sourceId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const sourceId = c.req.param('sourceId')
  const workspaceId = await resolveWorkspaceId(userId)
  if (!workspaceId) return c.json({ error: 'No workspace' }, 400)

  const built = await buildSourceContext(workspaceId, sourceId)
  if (!built) return c.json({ error: 'Source not found' }, 404)
  const { ctx } = built

  const active = await db
    .select()
    .from(policies)
    .where(and(eq(policies.workspace_id, workspaceId), eq(policies.is_active, true)))

  // Clear prior unresolved violations for this source so re-evaluation is idempotent.
  await db
    .delete(policy_violations)
    .where(and(eq(policy_violations.source_id, sourceId), eq(policy_violations.resolved, false)))

  const violations = []
  for (const policy of active) {
    const conds = (policy.conditions ?? []) as Condition[]
    if (conds.length === 0) continue
    // A policy matches (is violated) when ALL of its conditions hold.
    const matched = conds.every((cond) => evalCondition(cond, ctx))
    if (matched) {
      const detail = `Policy "${policy.name}" (${policy.action}, ${policy.severity}) matched: ${conds
        .map((co) => `${co.field} ${co.op} ${JSON.stringify(co.value)}`)
        .join(' AND ')}`
      const [v] = await db
        .insert(policy_violations)
        .values({
          workspace_id: workspaceId,
          policy_id: policy.id,
          source_id: sourceId,
          detail,
          resolved: false,
        })
        .returning()
      violations.push({ ...v, policy_name: policy.name, action: policy.action, severity: policy.severity })
    }
  }

  await logActivity(
    workspaceId,
    userId,
    'source',
    sourceId,
    'policy-evaluated',
    `${violations.length} violation(s) across ${active.length} active policies`,
  )

  return c.json({ violations })
})

export default router
