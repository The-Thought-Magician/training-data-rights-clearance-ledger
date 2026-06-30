import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  claims,
  claim_impacts,
  members,
  data_sources,
  lineage_bindings,
  model_versions,
  ledger_entries,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function resolveWorkspaceId(userId: string): Promise<string | null> {
  const [m] = await db
    .select()
    .from(members)
    .where(eq(members.user_id, userId))
    .orderBy(members.created_at)
  return m?.workspace_id ?? null
}

function sha256Hex(input: string): string {
  // FNV-1a 64-bit style rolling hash rendered as hex; deterministic, dependency-free.
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ ((c << 5) | (c >>> 2)), 0x01000193) >>> 0
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0')
  return hex(h1) + hex(h2) + hex(Math.imul(h1 ^ h2, 0x01000193) >>> 0) + hex((h1 + h2) >>> 0)
}

async function appendLedger(
  workspaceId: string,
  entityType: string,
  entityId: string,
  action: string,
  payload: Record<string, unknown>,
  actorId: string,
) {
  const [last] = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, workspaceId))
    .orderBy(desc(ledger_entries.seq))
    .limit(1)
  const seq = (last?.seq ?? 0) + 1
  const prev_hash = last?.entry_hash ?? '0'.repeat(40)
  const createdAt = new Date()
  const body = JSON.stringify({
    seq,
    entity_type: entityType,
    entity_id: entityId,
    action,
    payload,
    actor_id: actorId,
    prev_hash,
    created_at: createdAt.toISOString(),
  })
  const entry_hash = sha256Hex(body)
  await db.insert(ledger_entries).values({
    workspace_id: workspaceId,
    seq,
    entity_type: entityType,
    entity_id: entityId,
    action,
    payload,
    actor_id: actorId,
    prev_hash,
    entry_hash,
    created_at: createdAt,
  })
}

async function logActivity(
  workspaceId: string,
  actorId: string,
  entityType: string,
  entityId: string,
  action: string,
  detail: string,
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

// ---------------------------------------------------------------------------
// schemas
// ---------------------------------------------------------------------------

const createClaimSchema = z.object({
  claimant: z.string().min(1),
  rights_holder_id: z.string().optional().nullable(),
  claim_type: z.enum(['copyright', 'privacy', 'contract', 'takedown']),
  description: z.string().optional().default(''),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  source_id: z.string().optional().nullable(),
  response_deadline: z.string().datetime().optional().nullable(),
  legal_hold: z.boolean().optional().default(false),
})

const updateClaimSchema = z.object({
  status: z
    .enum(['received', 'investigating', 'valid', 'invalid', 'remediating', 'resolved', 'escalated'])
    .optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  legal_hold: z.boolean().optional(),
  resolution: z.string().optional(),
  description: z.string().optional(),
  response_deadline: z.string().datetime().optional().nullable(),
})

const impactSchema = z.object({
  model_version_id: z.string().min(1),
  impact: z.enum(['review', 'retrain', 'quarantine', 're-release', 'none']).optional().default('review'),
  notes: z.string().optional().default(''),
})

const updateImpactSchema = z.object({
  impact: z.enum(['review', 'retrain', 'quarantine', 're-release', 'none']).optional(),
  resolved: z.boolean().optional(),
  notes: z.string().optional(),
})

// ---------------------------------------------------------------------------
// GET / — list claims (filter status, claim_type) — public
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const status = c.req.query('status')
  const claimType = c.req.query('claim_type')
  const conds = []
  if (status) conds.push(eq(claims.status, status))
  if (claimType) conds.push(eq(claims.claim_type, claimType))
  const rows = await db
    .select()
    .from(claims)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(claims.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — claim + impacts + affected model versions (via lineage of source)
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [claim] = await db.select().from(claims).where(eq(claims.id, id))
  if (!claim) return c.json({ error: 'Not found' }, 404)

  const impacts = await db
    .select()
    .from(claim_impacts)
    .where(eq(claim_impacts.claim_id, id))
    .orderBy(desc(claim_impacts.created_at))

  // affected model versions: union of those bound to the claim's source (lineage)
  // and those already recorded as impacts.
  const affectedMap = new Map<string, typeof model_versions.$inferSelect>()

  if (claim.source_id) {
    const boundRows = await db
      .select({ mv: model_versions })
      .from(lineage_bindings)
      .innerJoin(model_versions, eq(lineage_bindings.model_version_id, model_versions.id))
      .where(eq(lineage_bindings.source_id, claim.source_id))
    for (const r of boundRows) affectedMap.set(r.mv.id, r.mv)
  }

  for (const imp of impacts) {
    if (!affectedMap.has(imp.model_version_id)) {
      const [mv] = await db
        .select()
        .from(model_versions)
        .where(eq(model_versions.id, imp.model_version_id))
      if (mv) affectedMap.set(mv.id, mv)
    }
  }

  return c.json({ claim, impacts, affectedVersions: [...affectedMap.values()] })
})

// ---------------------------------------------------------------------------
// POST / — intake claim (auto-derives claim_impacts from source lineage)
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createClaimSchema), async (c) => {
  const userId = getUserId(c)
  const workspaceId = await resolveWorkspaceId(userId)
  if (!workspaceId) return c.json({ error: 'No workspace' }, 403)
  const body = c.req.valid('json')

  // if a source is referenced, validate it belongs to the workspace
  if (body.source_id) {
    const [src] = await db
      .select()
      .from(data_sources)
      .where(and(eq(data_sources.id, body.source_id), eq(data_sources.workspace_id, workspaceId)))
    if (!src) return c.json({ error: 'Source not found in workspace' }, 404)
  }

  const [claim] = await db
    .insert(claims)
    .values({
      workspace_id: workspaceId,
      claimant: body.claimant,
      rights_holder_id: body.rights_holder_id ?? null,
      claim_type: body.claim_type,
      description: body.description,
      severity: body.severity,
      source_id: body.source_id ?? null,
      response_deadline: body.response_deadline ? new Date(body.response_deadline) : null,
      legal_hold: body.legal_hold,
      created_by: userId,
    })
    .returning()

  // auto-derive impacts: every model version that trained on the claim's source
  let derivedImpacts: (typeof claim_impacts.$inferSelect)[] = []
  if (claim.source_id) {
    const bound = await db
      .select({ mvId: lineage_bindings.model_version_id })
      .from(lineage_bindings)
      .where(eq(lineage_bindings.source_id, claim.source_id))
    const seen = new Set<string>()
    const defaultImpact = claim.severity === 'critical' || claim.severity === 'high' ? 'quarantine' : 'review'
    for (const b of bound) {
      if (seen.has(b.mvId)) continue
      seen.add(b.mvId)
      const [imp] = await db
        .insert(claim_impacts)
        .values({
          workspace_id: workspaceId,
          claim_id: claim.id,
          model_version_id: b.mvId,
          impact: defaultImpact,
          notes: `Auto-derived from lineage on source ${claim.source_id}`,
        })
        .onConflictDoNothing({ target: [claim_impacts.claim_id, claim_impacts.model_version_id] })
        .returning()
      if (imp) derivedImpacts.push(imp)
    }
  }

  await appendLedger(
    workspaceId,
    'claim',
    claim.id,
    'claim.intake',
    { claim_type: claim.claim_type, severity: claim.severity, source_id: claim.source_id, derived_impacts: derivedImpacts.length },
    userId,
  )
  await logActivity(
    workspaceId,
    userId,
    'claim',
    claim.id,
    'intake',
    `Claim from ${claim.claimant} (${claim.claim_type}); ${derivedImpacts.length} impact(s) auto-derived`,
  )

  return c.json({ ...claim, impacts: derivedImpacts }, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update status/severity/legal_hold/resolution
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateClaimSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(claims).where(eq(claims.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) {
    // also allow workspace members to manage claims
    const [m] = await db
      .select()
      .from(members)
      .where(and(eq(members.workspace_id, existing.workspace_id), eq(members.user_id, userId)))
    if (!m) return c.json({ error: 'Forbidden' }, 403)
  }
  const body = c.req.valid('json')

  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.status !== undefined) {
    patch.status = body.status
    if (body.status === 'resolved') patch.resolved_at = new Date()
  }
  if (body.severity !== undefined) patch.severity = body.severity
  if (body.legal_hold !== undefined) patch.legal_hold = body.legal_hold
  if (body.resolution !== undefined) patch.resolution = body.resolution
  if (body.description !== undefined) patch.description = body.description
  if (body.response_deadline !== undefined)
    patch.response_deadline = body.response_deadline ? new Date(body.response_deadline) : null

  const [updated] = await db.update(claims).set(patch).where(eq(claims.id, id)).returning()

  await appendLedger(
    existing.workspace_id,
    'claim',
    id,
    'claim.update',
    { changed: Object.keys(patch).filter((k) => k !== 'updated_at') },
    userId,
  )
  await logActivity(
    existing.workspace_id,
    userId,
    'claim',
    id,
    'update',
    `Updated claim${body.status ? ` → ${body.status}` : ''}${body.legal_hold !== undefined ? `; legal-hold=${body.legal_hold}` : ''}`,
  )

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// POST /:id/impacts — add/update an impact row (model_version_id, impact)
// ---------------------------------------------------------------------------

router.post('/:id/impacts', authMiddleware, zValidator('json', impactSchema), async (c) => {
  const userId = getUserId(c)
  const claimId = c.req.param('id')
  const [claim] = await db.select().from(claims).where(eq(claims.id, claimId))
  if (!claim) return c.json({ error: 'Claim not found' }, 404)
  const body = c.req.valid('json')

  const [mv] = await db
    .select()
    .from(model_versions)
    .where(
      and(
        eq(model_versions.id, body.model_version_id),
        eq(model_versions.workspace_id, claim.workspace_id),
      ),
    )
  if (!mv) return c.json({ error: 'Model version not found in workspace' }, 404)

  const [impact] = await db
    .insert(claim_impacts)
    .values({
      workspace_id: claim.workspace_id,
      claim_id: claimId,
      model_version_id: body.model_version_id,
      impact: body.impact,
      notes: body.notes,
    })
    .onConflictDoUpdate({
      target: [claim_impacts.claim_id, claim_impacts.model_version_id],
      set: { impact: body.impact, notes: body.notes },
    })
    .returning()

  await appendLedger(
    claim.workspace_id,
    'claim',
    claimId,
    'claim.impact.set',
    { model_version_id: body.model_version_id, impact: body.impact },
    userId,
  )
  await logActivity(
    claim.workspace_id,
    userId,
    'claim',
    claimId,
    'impact-set',
    `Impact ${body.impact} on model version ${body.model_version_id}`,
  )

  return c.json(impact, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id/impacts/:impactId — resolve/update an impact
// ---------------------------------------------------------------------------

router.put('/:id/impacts/:impactId', authMiddleware, zValidator('json', updateImpactSchema), async (c) => {
  const userId = getUserId(c)
  const claimId = c.req.param('id')
  const impactId = c.req.param('impactId')
  const [existing] = await db
    .select()
    .from(claim_impacts)
    .where(and(eq(claim_impacts.id, impactId), eq(claim_impacts.claim_id, claimId)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')

  const patch: Record<string, unknown> = {}
  if (body.impact !== undefined) patch.impact = body.impact
  if (body.resolved !== undefined) patch.resolved = body.resolved
  if (body.notes !== undefined) patch.notes = body.notes
  if (Object.keys(patch).length === 0) return c.json(existing)

  const [updated] = await db
    .update(claim_impacts)
    .set(patch)
    .where(eq(claim_impacts.id, impactId))
    .returning()

  await appendLedger(
    existing.workspace_id,
    'claim',
    claimId,
    'claim.impact.update',
    { impact_id: impactId, ...patch },
    userId,
  )
  await logActivity(
    existing.workspace_id,
    userId,
    'claim',
    claimId,
    'impact-update',
    `Updated impact ${impactId}${body.resolved !== undefined ? ` resolved=${body.resolved}` : ''}`,
  )

  return c.json(updated)
})

export default router
