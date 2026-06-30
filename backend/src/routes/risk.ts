import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  risk_scores,
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

const clamp = (n: number) => Math.max(0, Math.min(100, n))

// Each sub-score is 0..100. Composite is a weighted blend.
function computeLicenseRisk(active: typeof licenses.$inferSelect | undefined): number {
  if (!active) return 90 // unknown license is high risk
  let r = 0
  if (!active.permits_ai_training) r += 50
  if (!active.permits_commercial) r += 15
  if (!active.permits_derivatives) r += 10
  if (active.share_alike) r += 10
  if ((active.conflict_flags?.length ?? 0) > 0) r += 25
  if (active.license_type === 'none-unknown') r += 30
  if (active.status === 'expired' || active.status === 'terminated') r += 30
  return clamp(r)
}

function computeCopyrightRisk(latest: typeof copyright_screenings.$inferSelect | undefined): number {
  if (!latest) return 60 // unscreened
  switch (latest.status) {
    case 'passed':
      return clamp((latest.flagged_works?.length ?? 0) * 5)
    case 'failed':
      return 100
    case 'flagged':
      return clamp(70 + (latest.flagged_works?.length ?? 0) * 5)
    case 'in-progress':
      return 45
    case 'not-started':
    default:
      return 60
  }
}

function computePiiRisk(latest: typeof pii_screenings.$inferSelect | undefined): number {
  if (!latest) return 55 // unscreened
  let r = 0
  switch (latest.status) {
    case 'passed':
      r = 5
      break
    case 'failed':
      r = 100
      break
    case 'flagged':
      r = 70
      break
    case 'in-progress':
      r = 45
      break
    default:
      r = 55
  }
  r += (latest.pii_categories?.length ?? 0) * 5
  if (latest.anonymization_status === 'anonymized') r -= 25
  else if (latest.anonymization_status === 'pseudonymized') r -= 10
  if (!latest.lawful_basis || latest.lawful_basis === 'not-applicable') r += 10
  return clamp(r)
}

function computeOptoutRisk(rows: (typeof optouts.$inferSelect)[]): number {
  if (rows.length === 0) return 0
  const pending = rows.filter((o) => o.honor_status === 'pending').length
  const rejected = rows.filter((o) => o.honor_status === 'rejected').length
  return clamp(pending * 20 + rejected * 30)
}

async function recomputeForSource(workspaceId: string, sourceId: string) {
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

  const licenseRisk = computeLicenseRisk(activeLicense)
  const copyrightRisk = computeCopyrightRisk(latestCopyright)
  const piiRisk = computePiiRisk(latestPii)
  const optoutRisk = computeOptoutRisk(oo)

  // Weighted composite: license + copyright dominate, then pii, then optout.
  const composite = clamp(
    licenseRisk * 0.35 + copyrightRisk * 0.3 + piiRisk * 0.2 + optoutRisk * 0.15,
  )

  const values = {
    workspace_id: workspaceId,
    source_id: sourceId,
    license_risk: licenseRisk,
    copyright_risk: copyrightRisk,
    pii_risk: piiRisk,
    optout_risk: optoutRisk,
    composite_risk: composite,
    computed_at: new Date(),
  }

  const [score] = await db
    .insert(risk_scores)
    .values(values)
    .onConflictDoUpdate({
      target: risk_scores.source_id,
      set: {
        license_risk: values.license_risk,
        copyright_risk: values.copyright_risk,
        pii_risk: values.pii_risk,
        optout_risk: values.optout_risk,
        composite_risk: values.composite_risk,
        computed_at: values.computed_at,
      },
    })
    .returning()

  // Reflect composite onto the source register.
  await db.update(data_sources).set({ risk_score: composite, updated_at: new Date() }).where(eq(data_sources.id, sourceId))

  return score
}

// ---------------------------------------------------------------------------
// GET / — list risk scores (public read)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const rows = workspaceId
    ? await db
        .select()
        .from(risk_scores)
        .where(eq(risk_scores.workspace_id, workspaceId))
        .orderBy(desc(risk_scores.composite_risk))
    : await db.select().from(risk_scores).orderBy(desc(risk_scores.composite_risk))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /dashboard — portfolio rollup (public read)
// ---------------------------------------------------------------------------

router.get('/dashboard', async (c) => {
  const workspaceId = c.req.query('workspace_id')

  const sources = workspaceId
    ? await db.select().from(data_sources).where(eq(data_sources.workspace_id, workspaceId))
    : await db.select().from(data_sources)

  const statusCounts: Record<string, number> = {
    draft: 0,
    review: 0,
    cleared: 0,
    blocked: 0,
    retired: 0,
  }
  for (const s of sources) {
    statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1
  }

  const scores = workspaceId
    ? await db.select().from(risk_scores).where(eq(risk_scores.workspace_id, workspaceId))
    : await db.select().from(risk_scores)

  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const topRisks = scores
    .filter((r) => sourceById.has(r.source_id))
    .sort((a, b) => (b.composite_risk ?? 0) - (a.composite_risk ?? 0))
    .slice(0, 10)
    .map((r) => ({
      source_id: r.source_id,
      source_name: sourceById.get(r.source_id)?.name ?? 'Unknown',
      composite_risk: r.composite_risk ?? 0,
      license_risk: r.license_risk ?? 0,
      copyright_risk: r.copyright_risk ?? 0,
      pii_risk: r.pii_risk ?? 0,
      optout_risk: r.optout_risk ?? 0,
    }))

  const blocked = sources
    .filter((s) => s.status === 'blocked')
    .map((s) => ({ id: s.id, name: s.name, risk_score: s.risk_score ?? 0 }))

  // Expiring/expired licenses within 30 days.
  const allLicenses = workspaceId
    ? await db.select().from(licenses).where(eq(licenses.workspace_id, workspaceId))
    : await db.select().from(licenses)
  const now = Date.now()
  const horizon = now + 30 * 24 * 60 * 60 * 1000
  const expiring = allLicenses
    .filter((l) => l.expiry_date && l.expiry_date.getTime() <= horizon)
    .map((l) => ({
      id: l.id,
      source_id: l.source_id,
      license_name: l.license_name,
      expiry_date: l.expiry_date,
      expired: !!(l.expiry_date && l.expiry_date.getTime() < now),
    }))

  return c.json({ statusCounts, topRisks, blocked, expiring })
})

// ---------------------------------------------------------------------------
// GET /source/:sourceId — risk score for a source (public read)
// ---------------------------------------------------------------------------

router.get('/source/:sourceId', async (c) => {
  const sourceId = c.req.param('sourceId')
  const [score] = await db
    .select()
    .from(risk_scores)
    .where(eq(risk_scores.source_id, sourceId))
  if (!score) return c.json({ error: 'Not found' }, 404)
  return c.json(score)
})

// ---------------------------------------------------------------------------
// POST /recompute/:sourceId — recompute composite risk (auth)
// ---------------------------------------------------------------------------

router.post('/recompute/:sourceId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const sourceId = c.req.param('sourceId')
  const workspaceId = await resolveWorkspaceId(userId)
  if (!workspaceId) return c.json({ error: 'No workspace' }, 400)
  const score = await recomputeForSource(workspaceId, sourceId)
  if (!score) return c.json({ error: 'Source not found' }, 404)
  await logActivity(
    workspaceId,
    userId,
    'source',
    sourceId,
    'risk-recomputed',
    `Composite risk = ${(score.composite_risk ?? 0).toFixed(1)}`,
  )
  return c.json(score)
})

export default router
