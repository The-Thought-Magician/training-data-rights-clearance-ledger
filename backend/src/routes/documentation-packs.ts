import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import {
  documentation_packs,
  data_sources,
  licenses,
  copyright_screenings,
  pii_screenings,
  optouts,
  preference_signals,
  custody_handoffs,
  provenance_events,
  evidence_artifacts,
  clearances,
  clearance_certificates,
  risk_scores,
  model_versions,
  models,
  lineage_bindings,
  claims,
  claim_impacts,
  activity_log,
} from '../db/schema.js'
import { and, desc, eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

function hashContent(content: unknown): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

// ---------------------------------------------------------------------------
// Content assemblers — each returns a structured JSON document built from the DB
// ---------------------------------------------------------------------------

async function buildSourceDossier(sourceId: string) {
  const [source] = await db.select().from(data_sources).where(eq(data_sources.id, sourceId))
  if (!source) return null
  const [
    sourceLicenses,
    copyright,
    pii,
    sourceOptouts,
    signals,
    custody,
    provenance,
    evidence,
    clearanceRows,
    certificates,
    risk,
    bindings,
  ] = await Promise.all([
    db.select().from(licenses).where(eq(licenses.source_id, sourceId)),
    db.select().from(copyright_screenings).where(eq(copyright_screenings.source_id, sourceId)),
    db.select().from(pii_screenings).where(eq(pii_screenings.source_id, sourceId)),
    db.select().from(optouts).where(eq(optouts.source_id, sourceId)),
    db.select().from(preference_signals).where(eq(preference_signals.source_id, sourceId)),
    db.select().from(custody_handoffs).where(eq(custody_handoffs.source_id, sourceId)),
    db.select().from(provenance_events).where(eq(provenance_events.source_id, sourceId)),
    db.select().from(evidence_artifacts).where(eq(evidence_artifacts.source_id, sourceId)),
    db.select().from(clearances).where(eq(clearances.source_id, sourceId)),
    db.select().from(clearance_certificates).where(eq(clearance_certificates.source_id, sourceId)),
    db.select().from(risk_scores).where(eq(risk_scores.source_id, sourceId)),
    db.select().from(lineage_bindings).where(eq(lineage_bindings.source_id, sourceId)),
  ])
  return {
    document_type: 'source-dossier',
    generated_at: new Date().toISOString(),
    source,
    licenses: sourceLicenses,
    copyright_screenings: copyright,
    pii_screenings: pii,
    optouts: sourceOptouts,
    preference_signals: signals,
    custody_chain: custody,
    provenance: provenance,
    evidence: evidence,
    clearance: clearanceRows[0] ?? null,
    certificates,
    risk: risk[0] ?? null,
    used_in_model_versions: bindings.map((b) => b.model_version_id),
  }
}

async function buildGpaiSummary(modelVersionId: string) {
  const [version] = await db
    .select()
    .from(model_versions)
    .where(eq(model_versions.id, modelVersionId))
  if (!version) return null
  const [model] = await db.select().from(models).where(eq(models.id, version.model_id))
  const bindings = await db
    .select()
    .from(lineage_bindings)
    .where(eq(lineage_bindings.model_version_id, modelVersionId))

  const sourceSummaries: Array<Record<string, unknown>> = []
  for (const b of bindings) {
    const [source] = await db.select().from(data_sources).where(eq(data_sources.id, b.source_id))
    if (!source) continue
    const lic = await db.select().from(licenses).where(eq(licenses.source_id, b.source_id))
    const [clearance] = await db
      .select()
      .from(clearances)
      .where(eq(clearances.source_id, b.source_id))
    sourceSummaries.push({
      source_id: source.id,
      name: source.name,
      modality: source.modality,
      source_type: source.source_type,
      vendor: source.vendor,
      origin_url: source.origin_url,
      collection: source.collection,
      record_count: source.record_count,
      proportion: b.proportion,
      preprocessing: b.preprocessing,
      licenses: lic.map((l) => ({
        license_name: l.license_name,
        license_type: l.license_type,
        permits_ai_training: l.permits_ai_training,
        requires_attribution: l.requires_attribution,
      })),
      clearance_status: clearance?.status ?? 'pending',
    })
  }

  // Aggregate modality / source-type breakdown for the public-facing summary.
  const modalityBreakdown: Record<string, number> = {}
  const sourceTypeBreakdown: Record<string, number> = {}
  for (const s of sourceSummaries) {
    const modality = String(s.modality ?? 'unknown')
    const stype = String(s.source_type ?? 'unknown')
    modalityBreakdown[modality] = (modalityBreakdown[modality] ?? 0) + 1
    sourceTypeBreakdown[stype] = (sourceTypeBreakdown[stype] ?? 0) + 1
  }
  const clearedCount = sourceSummaries.filter((s) => s.clearance_status === 'cleared').length

  return {
    document_type: 'gpai-summary',
    generated_at: new Date().toISOString(),
    model: model ?? null,
    model_version: version,
    training_data_summary: {
      total_sources: sourceSummaries.length,
      cleared_sources: clearedCount,
      modality_breakdown: modalityBreakdown,
      source_type_breakdown: sourceTypeBreakdown,
    },
    sources: sourceSummaries,
  }
}

async function buildLitigationPack(subjectType: string, subjectId: string) {
  // A litigation pack centers on a source (or a model version): the full chain of
  // custody, every license, screening, opt-out and the claims touching it.
  const sourceIds: string[] = []
  let modelVersion: typeof model_versions.$inferSelect | null = null

  if (subjectType === 'source') {
    sourceIds.push(subjectId)
  } else {
    const [version] = await db
      .select()
      .from(model_versions)
      .where(eq(model_versions.id, subjectId))
    if (!version) return null
    modelVersion = version
    const bindings = await db
      .select()
      .from(lineage_bindings)
      .where(eq(lineage_bindings.model_version_id, subjectId))
    for (const b of bindings) sourceIds.push(b.source_id)
  }

  const sourceRecords: Array<Record<string, unknown>> = []
  const allClaims: Array<Record<string, unknown>> = []
  const seenClaims = new Set<string>()

  for (const sid of sourceIds) {
    const dossier = await buildSourceDossier(sid)
    if (dossier) sourceRecords.push(dossier)
    const sourceClaims = await db.select().from(claims).where(eq(claims.source_id, sid))
    for (const cl of sourceClaims) {
      if (seenClaims.has(cl.id)) continue
      seenClaims.add(cl.id)
      const impacts = await db
        .select()
        .from(claim_impacts)
        .where(eq(claim_impacts.claim_id, cl.id))
      allClaims.push({ claim: cl, impacts })
    }
  }

  return {
    document_type: 'litigation-pack',
    generated_at: new Date().toISOString(),
    subject_type: subjectType,
    subject_id: subjectId,
    model_version: modelVersion,
    sources: sourceRecords,
    claims: allClaims,
    claim_count: allClaims.length,
    legal_holds: allClaims.filter((x) => (x.claim as { legal_hold?: boolean }).legal_hold).length,
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — public — list packs (filter subject_type, subject_id, pack_type)
router.get('/', async (c) => {
  const subjectType = c.req.query('subject_type')
  const subjectId = c.req.query('subject_id')
  const packType = c.req.query('pack_type')
  const conds = []
  if (subjectType) conds.push(eq(documentation_packs.subject_type, subjectType))
  if (subjectId) conds.push(eq(documentation_packs.subject_id, subjectId))
  if (packType) conds.push(eq(documentation_packs.pack_type, packType))
  const rows = await db
    .select()
    .from(documentation_packs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(documentation_packs.created_at))
  return c.json(rows)
})

// GET /:id — public — pack detail (rendered content)
router.get('/:id', async (c) => {
  const [pack] = await db
    .select()
    .from(documentation_packs)
    .where(eq(documentation_packs.id, c.req.param('id')))
  if (!pack) return c.json({ error: 'Not found' }, 404)
  return c.json(pack)
})

const generateSchema = z.object({
  workspace_id: z.string().min(1),
  pack_type: z.enum(['gpai-summary', 'source-dossier', 'litigation-pack']),
  subject_type: z.enum(['model_version', 'source']),
  subject_id: z.string().min(1),
  title: z.string().min(1).optional(),
})

// POST /generate — auth — assemble a pack from live DB state + content_hash
router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, pack_type, subject_type, subject_id, title } = c.req.valid('json')

  let content: Record<string, unknown> | null = null
  if (pack_type === 'source-dossier') {
    if (subject_type !== 'source')
      return c.json({ error: 'source-dossier requires subject_type=source' }, 400)
    content = await buildSourceDossier(subject_id)
  } else if (pack_type === 'gpai-summary') {
    if (subject_type !== 'model_version')
      return c.json({ error: 'gpai-summary requires subject_type=model_version' }, 400)
    content = await buildGpaiSummary(subject_id)
  } else {
    content = await buildLitigationPack(subject_type, subject_id)
  }

  if (!content) return c.json({ error: 'Subject not found' }, 404)

  const contentHash = hashContent(content)
  const resolvedTitle =
    title ??
    `${pack_type} — ${subject_type} ${subject_id} (${new Date().toISOString().slice(0, 10)})`

  const [pack] = await db
    .insert(documentation_packs)
    .values({
      workspace_id,
      pack_type,
      subject_type,
      subject_id,
      title: resolvedTitle,
      content,
      content_hash: contentHash,
      generated_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id,
    actor_id: userId,
    entity_type: 'documentation_pack',
    entity_id: pack.id,
    action: 'generated',
    detail: `${pack_type} for ${subject_type} ${subject_id}`,
  })

  return c.json(pack, 201)
})

export default router
