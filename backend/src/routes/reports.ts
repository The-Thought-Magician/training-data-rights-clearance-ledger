import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  data_sources,
  clearances,
  claims,
  models,
  model_versions,
  lineage_bindings,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Resolve the workspace to report over. Prefer a ?workspace_id= query param;
// otherwise fall back to the workspace owned by the requesting user (if any),
// otherwise the most-recently-created workspace's id is left to the caller via
// the data itself (we report across the resolved workspace only).
async function resolveWorkspaceId(c: any): Promise<string | null> {
  const q = c.req.query('workspace_id')
  if (q) return q
  const userId = getUserId(c)
  if (userId) {
    // workspaces table is imported lazily to avoid a hard dependency cycle in
    // case of partial scaffolds; use a direct query through data_sources owner.
    const rows = await db
      .select({ workspace_id: data_sources.workspace_id })
      .from(data_sources)
      .where(eq(data_sources.created_by, userId))
      .limit(1)
    if (rows[0]) return rows[0].workspace_id
  }
  // No explicit workspace — report over the first workspace we can find via any source.
  const any = await db.select({ workspace_id: data_sources.workspace_id }).from(data_sources).limit(1)
  return any[0]?.workspace_id ?? null
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000))
}

function periodKey(d: Date): string {
  // ISO week-ish bucket by calendar day truncated to week start (Monday).
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = dt.getUTCDay() // 0 = Sun
  const diff = (day === 0 ? 6 : day - 1)
  dt.setUTCDate(dt.getUTCDate() - diff)
  return dt.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// GET /clearance-throughput — sources cleared per period, backlog, avg time-to-clear
// ---------------------------------------------------------------------------

router.get('/clearance-throughput', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  if (!workspaceId) {
    return c.json({ throughput: [], backlog: 0, avgDays: 0 })
  }

  const allClearances = await db
    .select()
    .from(clearances)
    .where(eq(clearances.workspace_id, workspaceId))
    .orderBy(desc(clearances.created_at))

  const allSources = await db
    .select()
    .from(data_sources)
    .where(eq(data_sources.workspace_id, workspaceId))

  // Throughput: cleared clearances bucketed by week of decided_at.
  const buckets = new Map<string, number>()
  const clearDurations: number[] = []
  for (const cl of allClearances) {
    if (cl.status === 'cleared' && cl.decided_at) {
      const key = periodKey(new Date(cl.decided_at))
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
      if (cl.created_at) {
        clearDurations.push(daysBetween(new Date(cl.created_at), new Date(cl.decided_at)))
      }
    }
  }

  const throughput = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([period, cleared]) => ({ period, cleared }))

  // Backlog: sources not yet cleared (draft/review or pending/blocked clearance).
  const clearanceBySource = new Map(allClearances.map((cl) => [cl.source_id, cl]))
  let backlog = 0
  for (const s of allSources) {
    const cl = clearanceBySource.get(s.id)
    const isCleared = cl?.status === 'cleared' || s.status === 'cleared'
    const isRetired = s.status === 'retired'
    if (!isCleared && !isRetired) backlog++
  }

  const avgDays =
    clearDurations.length > 0
      ? Math.round(
          (clearDurations.reduce((a, b) => a + b, 0) / clearDurations.length) * 10,
        ) / 10
      : 0

  return c.json({ throughput, backlog, avgDays })
})

// ---------------------------------------------------------------------------
// GET /coverage — % of model-bound sources fully cleared, overall + per model
// ---------------------------------------------------------------------------

router.get('/coverage', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  if (!workspaceId) {
    return c.json({ overall: { bound: 0, cleared: 0, pct: 0 }, byModel: [] })
  }

  const allModels = await db
    .select()
    .from(models)
    .where(eq(models.workspace_id, workspaceId))

  const allVersions = await db
    .select()
    .from(model_versions)
    .where(eq(model_versions.workspace_id, workspaceId))

  const allBindings = await db
    .select()
    .from(lineage_bindings)
    .where(eq(lineage_bindings.workspace_id, workspaceId))

  const allClearances = await db
    .select()
    .from(clearances)
    .where(eq(clearances.workspace_id, workspaceId))

  const clearedSourceIds = new Set(
    allClearances.filter((cl) => cl.status === 'cleared').map((cl) => cl.source_id),
  )

  const versionToModel = new Map(allVersions.map((v) => [v.id, v.model_id]))

  // Aggregate distinct bound source ids per model.
  const modelSources = new Map<string, Set<string>>()
  const overallBound = new Set<string>()
  for (const b of allBindings) {
    overallBound.add(b.source_id)
    const modelId = versionToModel.get(b.model_version_id)
    if (!modelId) continue
    let set = modelSources.get(modelId)
    if (!set) {
      set = new Set()
      modelSources.set(modelId, set)
    }
    set.add(b.source_id)
  }

  let overallCleared = 0
  for (const sid of overallBound) if (clearedSourceIds.has(sid)) overallCleared++
  const overallPct =
    overallBound.size > 0 ? Math.round((overallCleared / overallBound.size) * 1000) / 10 : 0

  const byModel = allModels.map((m) => {
    const set = modelSources.get(m.id) ?? new Set<string>()
    let cleared = 0
    for (const sid of set) if (clearedSourceIds.has(sid)) cleared++
    const bound = set.size
    return {
      model_id: m.id,
      name: m.name,
      bound,
      cleared,
      pct: bound > 0 ? Math.round((cleared / bound) * 1000) / 10 : 0,
    }
  })

  return c.json({
    overall: { bound: overallBound.size, cleared: overallCleared, pct: overallPct },
    byModel,
  })
})

// ---------------------------------------------------------------------------
// GET /claims-summary — claim volume + resolution time by type/status
// ---------------------------------------------------------------------------

router.get('/claims-summary', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  if (!workspaceId) {
    return c.json({ byType: [], byStatus: [], avgResolutionDays: 0 })
  }

  const allClaims = await db
    .select()
    .from(claims)
    .where(eq(claims.workspace_id, workspaceId))

  const typeCounts = new Map<string, number>()
  const statusCounts = new Map<string, number>()
  const resolutionDays: number[] = []

  for (const cl of allClaims) {
    typeCounts.set(cl.claim_type, (typeCounts.get(cl.claim_type) ?? 0) + 1)
    statusCounts.set(cl.status, (statusCounts.get(cl.status) ?? 0) + 1)
    if (cl.resolved_at && cl.created_at) {
      resolutionDays.push(daysBetween(new Date(cl.created_at), new Date(cl.resolved_at)))
    }
  }

  const byType = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([claim_type, count]) => ({ claim_type, count }))

  const byStatus = [...statusCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({ status, count }))

  const avgResolutionDays =
    resolutionDays.length > 0
      ? Math.round((resolutionDays.reduce((a, b) => a + b, 0) / resolutionDays.length) * 10) / 10
      : 0

  return c.json({ byType, byStatus, avgResolutionDays, total: allClaims.length })
})

export default router
