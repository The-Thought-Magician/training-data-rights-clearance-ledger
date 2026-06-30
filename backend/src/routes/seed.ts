import { Hono } from 'hono'
import { createHash, randomUUID } from 'node:crypto'
import { db } from '../db/index.js'
import {
  workspaces,
  members,
  data_sources,
  provenance_events,
  custody_handoffs,
  evidence_artifacts,
  licenses,
  license_templates,
  copyright_screenings,
  pii_screenings,
  optouts,
  preference_signals,
  rights_holders,
  models,
  model_versions,
  lineage_bindings,
  clearance_requirements,
  clearances,
  clearance_certificates,
  claims,
  claim_impacts,
  ledger_entries,
  policies,
  risk_scores,
  activity_log,
  notifications,
  tasks,
} from '../db/schema.js'
import { eq, and, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const DEMO_SLUG_PREFIX = 'demo-'

function slugFor(userId: string): string {
  // Stable, collision-resistant slug derived from the user id.
  return `${DEMO_SLUG_PREFIX}${createHash('sha256').update(userId).digest('hex').slice(0, 12)}`
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

function daysAhead(n: number): Date {
  return new Date(Date.now() + n * 86_400_000)
}

// ---------------------------------------------------------------------------
// Ledger chain builder — appends hash-chained entries within one workspace.
// ---------------------------------------------------------------------------

interface LedgerInput {
  entity_type: string
  entity_id: string
  action: string
  payload: Record<string, unknown>
  actor_id: string
}

function buildLedgerRows(workspaceId: string, actorId: string, inputs: LedgerInput[]) {
  const rows: Array<typeof ledger_entries.$inferInsert> = []
  let prevHash = 'GENESIS'
  let seq = 0
  for (const inp of inputs) {
    const id = randomUUID()
    const createdAt = new Date()
    const material = JSON.stringify({
      workspace_id: workspaceId,
      seq,
      entity_type: inp.entity_type,
      entity_id: inp.entity_id,
      action: inp.action,
      payload: inp.payload,
      actor_id: inp.actor_id,
      prev_hash: prevHash,
    })
    const entryHash = sha256(material)
    rows.push({
      id,
      workspace_id: workspaceId,
      seq,
      entity_type: inp.entity_type,
      entity_id: inp.entity_id,
      action: inp.action,
      payload: inp.payload,
      actor_id: inp.actor_id,
      prev_hash: prevHash,
      entry_hash: entryHash,
      created_at: createdAt,
    })
    prevHash = entryHash
    seq++
  }
  return rows
}

// ---------------------------------------------------------------------------
// reset — delete all demo workspaces owned by the current user (children first)
// ---------------------------------------------------------------------------

async function deleteWorkspaceData(workspaceId: string) {
  // Delete in FK-safe order (children before parents).
  await db.delete(clearance_certificates).where(eq(clearance_certificates.workspace_id, workspaceId))
  await db.delete(claim_impacts).where(eq(claim_impacts.workspace_id, workspaceId))
  await db.delete(claims).where(eq(claims.workspace_id, workspaceId))
  await db.delete(lineage_bindings).where(eq(lineage_bindings.workspace_id, workspaceId))
  await db.delete(model_versions).where(eq(model_versions.workspace_id, workspaceId))
  await db.delete(models).where(eq(models.workspace_id, workspaceId))
  await db.delete(clearances).where(eq(clearances.workspace_id, workspaceId))
  await db.delete(clearance_requirements).where(eq(clearance_requirements.workspace_id, workspaceId))
  await db.delete(risk_scores).where(eq(risk_scores.workspace_id, workspaceId))
  await db.delete(copyright_screenings).where(eq(copyright_screenings.workspace_id, workspaceId))
  await db.delete(pii_screenings).where(eq(pii_screenings.workspace_id, workspaceId))
  await db.delete(optouts).where(eq(optouts.workspace_id, workspaceId))
  await db.delete(preference_signals).where(eq(preference_signals.workspace_id, workspaceId))
  await db.delete(licenses).where(eq(licenses.workspace_id, workspaceId))
  await db.delete(license_templates).where(eq(license_templates.workspace_id, workspaceId))
  await db.delete(evidence_artifacts).where(eq(evidence_artifacts.workspace_id, workspaceId))
  await db.delete(custody_handoffs).where(eq(custody_handoffs.workspace_id, workspaceId))
  await db.delete(provenance_events).where(eq(provenance_events.workspace_id, workspaceId))
  await db.delete(rights_holders).where(eq(rights_holders.workspace_id, workspaceId))
  await db.delete(policies).where(eq(policies.workspace_id, workspaceId))
  await db.delete(ledger_entries).where(eq(ledger_entries.workspace_id, workspaceId))
  await db.delete(activity_log).where(eq(activity_log.workspace_id, workspaceId))
  await db.delete(notifications).where(eq(notifications.workspace_id, workspaceId))
  await db.delete(tasks).where(eq(tasks.workspace_id, workspaceId))
  await db.delete(data_sources).where(eq(data_sources.workspace_id, workspaceId))
  await db.delete(members).where(eq(members.workspace_id, workspaceId))
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
}

router.post('/reset', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const slug = slugFor(userId)
  const demos = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.owner_id, userId), eq(workspaces.slug, slug)))
  for (const ws of demos) {
    await deleteWorkspaceData(ws.id)
  }
  return c.json({ success: true, removed: demos.length })
})

// ---------------------------------------------------------------------------
// demo — provision a realistic demo workspace for the current user
// ---------------------------------------------------------------------------

router.post('/demo', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const slug = slugFor(userId)

  // Idempotent: clear any prior demo workspace for this user first.
  const existing = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.owner_id, userId), eq(workspaces.slug, slug)))
  for (const ws of existing) {
    await deleteWorkspaceData(ws.id)
  }

  // --- Workspace -----------------------------------------------------------
  const workspaceId = randomUUID()
  await db.insert(workspaces).values({
    id: workspaceId,
    name: 'Acme AI — Demo Workspace',
    slug,
    owner_id: userId,
    default_required_checks: ['license', 'copyright', 'pii', 'optouts', 'approver'],
    settings: { demo: true },
    created_at: daysAgo(60),
  })

  // --- Members -------------------------------------------------------------
  await db.insert(members).values([
    {
      workspace_id: workspaceId,
      user_id: userId,
      email: 'you@acme.ai',
      name: 'You (Admin)',
      role: 'admin',
    },
    {
      workspace_id: workspaceId,
      user_id: `${userId}-legal`,
      email: 'legal@acme.ai',
      name: 'Dana Counsel',
      role: 'legal',
    },
    {
      workspace_id: workspaceId,
      user_id: `${userId}-mllead`,
      email: 'ml@acme.ai',
      name: 'Sam Trainer',
      role: 'ml-lead',
    },
    {
      workspace_id: workspaceId,
      user_id: `${userId}-dataops`,
      email: 'dataops@acme.ai',
      name: 'Pat Pipeline',
      role: 'dataops',
    },
  ])

  // --- Clearance requirements ---------------------------------------------
  const reqDefs = [
    { key: 'license', label: 'License permits AI training', is_required: true },
    { key: 'copyright', label: 'Copyright screening passed', is_required: true },
    { key: 'pii', label: 'PII screening passed', is_required: true },
    { key: 'optouts', label: 'Opt-outs honored', is_required: true },
    { key: 'approver', label: 'Legal approver sign-off', is_required: true },
  ]
  await db.insert(clearance_requirements).values(
    reqDefs.map((r) => ({
      workspace_id: workspaceId,
      key: r.key,
      label: r.label,
      description: '',
      is_required: r.is_required,
    })),
  )

  // --- Rights holders ------------------------------------------------------
  const rh1 = randomUUID()
  const rh2 = randomUUID()
  const rh3 = randomUUID()
  await db.insert(rights_holders).values([
    {
      id: rh1,
      workspace_id: workspaceId,
      name: 'Global News Publishing Co.',
      holder_type: 'publisher',
      contact_email: 'rights@globalnews.example',
      jurisdiction: 'US',
      created_by: userId,
    },
    {
      id: rh2,
      workspace_id: workspaceId,
      name: 'OpenPhoto Collective',
      holder_type: 'collecting-society',
      contact_email: 'licensing@openphoto.example',
      jurisdiction: 'EU',
      created_by: userId,
    },
    {
      id: rh3,
      workspace_id: workspaceId,
      name: 'Jane Author',
      holder_type: 'individual',
      contact_email: 'jane@authors.example',
      jurisdiction: 'UK',
      created_by: userId,
    },
  ])

  // --- License templates ---------------------------------------------------
  await db.insert(license_templates).values([
    {
      workspace_id: workspaceId,
      name: 'CC BY 4.0',
      license_type: 'cc-by',
      permits_ai_training: true,
      permits_commercial: true,
      permits_derivatives: true,
      requires_attribution: true,
      share_alike: false,
      description: 'Creative Commons Attribution 4.0',
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      name: 'CC BY-NC 4.0',
      license_type: 'cc-by-nc',
      permits_ai_training: true,
      permits_commercial: false,
      permits_derivatives: true,
      requires_attribution: true,
      share_alike: false,
      description: 'Non-commercial only',
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      name: 'Proprietary Vendor Agreement',
      license_type: 'proprietary',
      permits_ai_training: true,
      permits_commercial: true,
      permits_derivatives: false,
      requires_attribution: false,
      share_alike: false,
      description: 'Negotiated commercial data license',
      created_by: userId,
    },
  ])

  // --- Data sources --------------------------------------------------------
  type SourceSeed = {
    id: string
    name: string
    source_type: string
    modality: string
    vendor?: string
    status: string
    risk_score: number
    collection: string
  }
  const srcCommons: SourceSeed = {
    id: randomUUID(),
    name: 'Wikipedia Snapshot 2025-Q1',
    source_type: 'public-domain',
    modality: 'text',
    status: 'cleared',
    risk_score: 0.08,
    collection: 'pretraining-text',
  }
  const srcLicensedNews: SourceSeed = {
    id: randomUUID(),
    name: 'Global News Licensed Archive',
    source_type: 'licensed',
    modality: 'text',
    vendor: 'Global News Publishing Co.',
    status: 'cleared',
    risk_score: 0.22,
    collection: 'pretraining-text',
  }
  const srcScrapedWeb: SourceSeed = {
    id: randomUUID(),
    name: 'Open Web Crawl (mixed)',
    source_type: 'web-scrape',
    modality: 'text',
    status: 'review',
    risk_score: 0.61,
    collection: 'pretraining-text',
  }
  const srcImages: SourceSeed = {
    id: randomUUID(),
    name: 'OpenPhoto Image Set',
    source_type: 'licensed',
    modality: 'image',
    vendor: 'OpenPhoto Collective',
    status: 'review',
    risk_score: 0.34,
    collection: 'vision-pretrain',
  }
  const srcUserData: SourceSeed = {
    id: randomUUID(),
    name: 'Product Support Transcripts',
    source_type: 'user-generated',
    modality: 'text',
    status: 'blocked',
    risk_score: 0.88,
    collection: 'fine-tune',
  }
  const srcSynthetic: SourceSeed = {
    id: randomUUID(),
    name: 'Synthetic QA Pairs v2',
    source_type: 'synthetic',
    modality: 'text',
    status: 'cleared',
    risk_score: 0.05,
    collection: 'fine-tune',
  }
  const sources = [srcCommons, srcLicensedNews, srcScrapedWeb, srcImages, srcUserData, srcSynthetic]

  await db.insert(data_sources).values(
    sources.map((s, i) => ({
      id: s.id,
      workspace_id: workspaceId,
      name: s.name,
      description: `Demo data source: ${s.name}`,
      source_type: s.source_type,
      modality: s.modality,
      origin_url: s.source_type === 'web-scrape' ? 'https://crawl.example/seed' : null,
      vendor: s.vendor ?? null,
      acquisition_method:
        s.source_type === 'web-scrape'
          ? 'scraped'
          : s.source_type === 'licensed'
            ? 'licensed'
            : s.source_type === 'synthetic'
              ? 'generated'
              : 'downloaded',
      acquisition_date: daysAgo(50 - i * 5),
      acquirer: 'Pat Pipeline',
      justification: 'Demo seed entry',
      record_count: 100000 * (i + 1),
      size_bytes: 1024 * 1024 * (i + 1) * 50,
      format: s.modality === 'image' ? 'webdataset' : 'jsonl',
      tags: [s.collection],
      collection: s.collection,
      status: s.status,
      risk_score: s.risk_score,
      created_by: userId,
      created_at: daysAgo(50 - i * 5),
      updated_at: daysAgo(10),
    })),
  )

  // --- Provenance + custody ------------------------------------------------
  await db.insert(provenance_events).values([
    {
      workspace_id: workspaceId,
      source_id: srcLicensedNews.id,
      event_type: 'acquired-from',
      description: 'Licensed bulk archive from Global News Publishing Co.',
      recorded_by: userId,
      occurred_at: daysAgo(48),
    },
    {
      workspace_id: workspaceId,
      source_id: srcScrapedWeb.id,
      event_type: 'transformed',
      description: 'Deduplicated and language-filtered',
      recorded_by: userId,
      occurred_at: daysAgo(20),
    },
    {
      workspace_id: workspaceId,
      source_id: srcSynthetic.id,
      event_type: 'derived-from',
      description: 'Generated from cleared Wikipedia snapshot',
      related_source_id: srcCommons.id,
      recorded_by: userId,
      occurred_at: daysAgo(15),
    },
  ])

  await db.insert(custody_handoffs).values([
    {
      workspace_id: workspaceId,
      source_id: srcLicensedNews.id,
      from_party: 'Global News Publishing Co.',
      to_party: 'Acme DataOps',
      reason: 'Initial delivery',
      recorded_by: userId,
      occurred_at: daysAgo(48),
    },
    {
      workspace_id: workspaceId,
      source_id: srcLicensedNews.id,
      from_party: 'Acme DataOps',
      to_party: 'Acme ML Platform',
      reason: 'Ingestion into training store',
      recorded_by: userId,
      occurred_at: daysAgo(40),
    },
  ])

  // --- Evidence artifacts --------------------------------------------------
  await db.insert(evidence_artifacts).values([
    {
      workspace_id: workspaceId,
      source_id: srcLicensedNews.id,
      entity_type: 'license',
      kind: 'contract',
      filename: 'global-news-license.pdf',
      content_type: 'application/pdf',
      size_bytes: 482931,
      sha256: sha256('global-news-license'),
      uploaded_by: userId,
    },
    {
      workspace_id: workspaceId,
      source_id: srcScrapedWeb.id,
      entity_type: 'source',
      kind: 'robots-snapshot',
      filename: 'robots-snapshot.txt',
      content_type: 'text/plain',
      size_bytes: 1840,
      sha256: sha256('robots-snapshot'),
      uploaded_by: userId,
    },
  ])

  // --- Licenses ------------------------------------------------------------
  await db.insert(licenses).values([
    {
      workspace_id: workspaceId,
      source_id: srcCommons.id,
      license_name: 'CC0 / Public Domain',
      license_type: 'public-domain',
      permits_ai_training: true,
      permits_commercial: true,
      permits_derivatives: true,
      requires_attribution: false,
      share_alike: false,
      status: 'active',
      conflict_flags: [],
      effective_date: daysAgo(50),
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      source_id: srcLicensedNews.id,
      license_name: 'Global News Commercial License',
      license_type: 'proprietary',
      permits_ai_training: true,
      permits_commercial: true,
      permits_derivatives: false,
      requires_attribution: true,
      share_alike: false,
      rights_holder_id: rh1,
      document_ref: 'global-news-license.pdf',
      status: 'active',
      conflict_flags: [],
      effective_date: daysAgo(48),
      expiry_date: daysAhead(20),
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      source_id: srcImages.id,
      license_name: 'OpenPhoto Non-Commercial',
      license_type: 'cc-by-nc',
      permits_ai_training: true,
      permits_commercial: false,
      permits_derivatives: true,
      requires_attribution: true,
      share_alike: false,
      rights_holder_id: rh2,
      status: 'active',
      conflict_flags: ['permits_commercial=false but workspace ships commercial models'],
      effective_date: daysAgo(30),
      created_by: userId,
    },
  ])

  // --- Screenings ----------------------------------------------------------
  await db.insert(copyright_screenings).values([
    {
      workspace_id: workspaceId,
      source_id: srcCommons.id,
      status: 'passed',
      method: 'automated',
      reviewer: 'Dana Counsel',
      flagged_works: [],
      risk_score: 0.05,
      screened_at: daysAgo(45),
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      source_id: srcScrapedWeb.id,
      status: 'flagged',
      method: 'automated',
      reviewer: 'Dana Counsel',
      flagged_works: [{ work: 'Bestselling Novel excerpt', rights_holder: 'Jane Author' }],
      risk_score: 0.7,
      remediation_action: 'Remove flagged documents',
      remediation_owner: 'Pat Pipeline',
      remediation_due: daysAhead(7),
      remediation_status: 'open',
      screened_at: daysAgo(18),
      created_by: userId,
    },
  ])

  await db.insert(pii_screenings).values([
    {
      workspace_id: workspaceId,
      source_id: srcUserData.id,
      status: 'failed',
      method: 'automated',
      reviewer: 'Pat Pipeline',
      pii_categories: ['email', 'phone', 'name'],
      lawful_basis: 'not-applicable',
      anonymization_status: 'none',
      remediation_action: 'Anonymize before any training use',
      remediation_owner: 'Pat Pipeline',
      remediation_due: daysAhead(14),
      remediation_status: 'open',
      screened_at: daysAgo(12),
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      source_id: srcLicensedNews.id,
      status: 'passed',
      method: 'manual',
      reviewer: 'Dana Counsel',
      pii_categories: [],
      lawful_basis: 'legitimate-interest',
      anonymization_status: 'pseudonymized',
      screened_at: daysAgo(40),
      created_by: userId,
    },
  ])

  // --- Opt-outs + preference signals --------------------------------------
  await db.insert(optouts).values([
    {
      workspace_id: workspaceId,
      source_id: srcScrapedWeb.id,
      rights_holder_id: rh3,
      subject_identity: 'Jane Author',
      optout_type: 'rights-holder',
      scope: 'all',
      channel: 'email',
      honor_status: 'applied',
      applied_at: daysAgo(5),
      received_at: daysAgo(10),
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      source_id: srcUserData.id,
      subject_identity: 'support-user-4821',
      optout_type: 'individual',
      scope: 'all',
      channel: 'web-form',
      honor_status: 'pending',
      received_at: daysAgo(2),
      created_by: userId,
    },
  ])

  await db.insert(preference_signals).values([
    {
      workspace_id: workspaceId,
      source_id: srcScrapedWeb.id,
      signal_type: 'robots.txt',
      directive: 'disallow',
      captured_url: 'https://crawl.example/robots.txt',
      snapshot_ref: 'robots-snapshot.txt',
      snapshot_sha256: sha256('robots-snapshot'),
      captured_at: daysAgo(19),
      recheck_due: daysAhead(11),
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      source_id: srcImages.id,
      signal_type: 'noai',
      directive: 'disallow',
      captured_url: 'https://openphoto.example/ai.txt',
      captured_at: daysAgo(25),
      created_by: userId,
    },
  ])

  // --- Models + versions + lineage ----------------------------------------
  const modelA = randomUUID()
  const modelB = randomUUID()
  await db.insert(models).values([
    {
      id: modelA,
      workspace_id: workspaceId,
      name: 'Acme-LLM',
      description: 'Foundation language model',
      purpose: 'General assistant',
      created_by: userId,
    },
    {
      id: modelB,
      workspace_id: workspaceId,
      name: 'Acme-Vision',
      description: 'Image understanding model',
      purpose: 'Vision tasks',
      created_by: userId,
    },
  ])

  const verA1 = randomUUID()
  const verA2 = randomUUID()
  const verB1 = randomUUID()
  await db.insert(model_versions).values([
    {
      id: verA1,
      workspace_id: workspaceId,
      model_id: modelA,
      version: '1.0.0',
      base_model: 'scratch',
      training_type: 'train',
      training_date: daysAgo(35),
      manifest_hash: sha256(`${verA1}:manifest`),
      release_status: 'released',
      released_at: daysAgo(30),
      released_by: userId,
      created_by: userId,
    },
    {
      id: verA2,
      workspace_id: workspaceId,
      model_id: modelA,
      version: '1.1.0',
      base_model: 'Acme-LLM 1.0.0',
      training_type: 'fine-tune',
      training_date: daysAgo(8),
      manifest_hash: sha256(`${verA2}:manifest`),
      release_status: 'draft',
      created_by: userId,
    },
    {
      id: verB1,
      workspace_id: workspaceId,
      model_id: modelB,
      version: '0.9.0',
      base_model: 'scratch',
      training_type: 'train',
      training_date: daysAgo(10),
      manifest_hash: sha256(`${verB1}:manifest`),
      release_status: 'quarantined',
      created_by: userId,
    },
  ])

  await db.insert(lineage_bindings).values([
    {
      workspace_id: workspaceId,
      model_version_id: verA1,
      source_id: srcCommons.id,
      proportion: 0.6,
      preprocessing: 'dedupe',
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      model_version_id: verA1,
      source_id: srcLicensedNews.id,
      proportion: 0.4,
      preprocessing: 'tokenize',
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      model_version_id: verA2,
      source_id: srcSynthetic.id,
      proportion: 0.5,
      preprocessing: 'none',
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      model_version_id: verA2,
      source_id: srcScrapedWeb.id,
      proportion: 0.5,
      preprocessing: 'filter',
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      model_version_id: verB1,
      source_id: srcImages.id,
      proportion: 1.0,
      preprocessing: 'resize',
      created_by: userId,
    },
  ])

  // --- Clearances + certificate -------------------------------------------
  const clrCommons = randomUUID()
  const clrNews = randomUUID()
  await db.insert(clearances).values([
    {
      id: clrCommons,
      workspace_id: workspaceId,
      source_id: srcCommons.id,
      status: 'cleared',
      unmet_requirements: [],
      approver_id: `${userId}-legal`,
      approver_role: 'legal',
      decision_rationale: 'Public domain; all checks pass',
      decided_at: daysAgo(44),
      created_by: userId,
      created_at: daysAgo(46),
    },
    {
      id: clrNews,
      workspace_id: workspaceId,
      source_id: srcLicensedNews.id,
      status: 'cleared',
      unmet_requirements: [],
      approver_id: `${userId}-legal`,
      approver_role: 'legal',
      decision_rationale: 'Licensed for AI training, PII pseudonymized',
      decided_at: daysAgo(38),
      created_by: userId,
      created_at: daysAgo(42),
    },
    {
      workspace_id: workspaceId,
      source_id: srcSynthetic.id,
      status: 'cleared',
      unmet_requirements: [],
      approver_id: `${userId}-legal`,
      approver_role: 'legal',
      decision_rationale: 'Derived from cleared sources only',
      decided_at: daysAgo(14),
      created_by: userId,
      created_at: daysAgo(15),
    },
    {
      workspace_id: workspaceId,
      source_id: srcScrapedWeb.id,
      status: 'pending',
      unmet_requirements: ['copyright', 'optouts'],
      created_by: userId,
      created_at: daysAgo(18),
    },
    {
      workspace_id: workspaceId,
      source_id: srcUserData.id,
      status: 'blocked',
      unmet_requirements: ['pii', 'license'],
      decision_rationale: 'PII screening failed',
      decided_at: daysAgo(11),
      created_by: userId,
      created_at: daysAgo(12),
    },
  ])

  await db.insert(clearance_certificates).values([
    {
      workspace_id: workspaceId,
      source_id: srcCommons.id,
      clearance_id: clrCommons,
      certificate_hash: sha256(`cert:${clrCommons}`),
      issued_to: 'Acme ML Platform',
      payload: { source: srcCommons.name, requirements: 'all-met' },
      issued_by: `${userId}-legal`,
    },
    {
      workspace_id: workspaceId,
      source_id: srcLicensedNews.id,
      clearance_id: clrNews,
      certificate_hash: sha256(`cert:${clrNews}`),
      issued_to: 'Acme ML Platform',
      payload: { source: srcLicensedNews.name, requirements: 'all-met' },
      issued_by: `${userId}-legal`,
    },
  ])

  // --- Claims + impacts ----------------------------------------------------
  const claim1 = randomUUID()
  const claim2 = randomUUID()
  await db.insert(claims).values([
    {
      id: claim1,
      workspace_id: workspaceId,
      claimant: 'Jane Author',
      rights_holder_id: rh3,
      claim_type: 'copyright',
      description: 'Copyrighted novel excerpt found in crawl data',
      severity: 'high',
      status: 'investigating',
      source_id: srcScrapedWeb.id,
      response_deadline: daysAhead(5),
      legal_hold: true,
      created_by: userId,
      created_at: daysAgo(6),
      updated_at: daysAgo(2),
    },
    {
      id: claim2,
      workspace_id: workspaceId,
      claimant: 'support-user-4821',
      claim_type: 'privacy',
      description: 'Request to remove personal data from support transcripts',
      severity: 'medium',
      status: 'resolved',
      source_id: srcUserData.id,
      legal_hold: false,
      resolution: 'Records anonymized and opt-out applied',
      resolved_at: daysAgo(1),
      created_by: userId,
      created_at: daysAgo(9),
      updated_at: daysAgo(1),
    },
  ])

  await db.insert(claim_impacts).values([
    {
      workspace_id: workspaceId,
      claim_id: claim1,
      model_version_id: verA2,
      impact: 'review',
      resolved: false,
      notes: 'Acme-LLM 1.1.0 trained on the affected crawl',
    },
  ])

  // --- Policies ------------------------------------------------------------
  await db.insert(policies).values([
    {
      workspace_id: workspaceId,
      name: 'Block sources without AI-training rights',
      description: 'Any source whose license disallows AI training is blocked',
      conditions: [{ field: 'license.permits_ai_training', op: 'eq', value: false }],
      action: 'block',
      severity: 'high',
      is_active: true,
      version: 1,
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      name: 'Flag unscreened PII',
      description: 'Flag sources without a passing PII screening',
      conditions: [{ field: 'pii.status', op: 'neq', value: 'passed' }],
      action: 'flag',
      severity: 'medium',
      is_active: true,
      version: 1,
      created_by: userId,
    },
  ])

  // --- Risk scores ---------------------------------------------------------
  await db.insert(risk_scores).values(
    sources.map((s) => ({
      workspace_id: workspaceId,
      source_id: s.id,
      license_risk: Math.min(1, s.risk_score * 0.8),
      copyright_risk: Math.min(1, s.risk_score * 1.1),
      pii_risk: s.id === srcUserData.id ? 0.95 : s.risk_score * 0.5,
      optout_risk: s.id === srcScrapedWeb.id ? 0.6 : 0.1,
      composite_risk: s.risk_score,
      computed_at: daysAgo(7),
    })),
  )

  // --- Tasks + notifications ----------------------------------------------
  await db.insert(tasks).values([
    {
      workspace_id: workspaceId,
      assigned_to: userId,
      task_type: 'remediation',
      entity_type: 'source',
      entity_id: srcUserData.id,
      title: 'Anonymize Product Support Transcripts',
      description: 'PII screening failed; anonymize before any use',
      due_date: daysAhead(14),
      status: 'open',
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      assigned_to: userId,
      task_type: 'review',
      entity_type: 'source',
      entity_id: srcScrapedWeb.id,
      title: 'Resolve copyright flag on Open Web Crawl',
      description: 'Remove flagged documents and re-screen',
      due_date: daysAhead(7),
      status: 'in-progress',
      created_by: userId,
    },
  ])

  await db.insert(notifications).values([
    {
      workspace_id: workspaceId,
      user_id: userId,
      kind: 'new-claim',
      title: 'New copyright claim received',
      body: 'Jane Author filed a copyright claim against Open Web Crawl',
      link: `/dashboard/claims/${claim1}`,
      is_read: false,
    },
    {
      workspace_id: workspaceId,
      user_id: userId,
      kind: 'license-expiry',
      title: 'License expiring soon',
      body: 'Global News Commercial License expires in 20 days',
      link: '/dashboard/licenses',
      is_read: false,
    },
    {
      workspace_id: workspaceId,
      user_id: userId,
      kind: 'screening-failed',
      title: 'PII screening failed',
      body: 'Product Support Transcripts failed PII screening',
      link: '/dashboard/pii',
      is_read: true,
    },
  ])

  // --- Activity log --------------------------------------------------------
  await db.insert(activity_log).values([
    {
      workspace_id: workspaceId,
      actor_id: userId,
      entity_type: 'workspace',
      entity_id: workspaceId,
      action: 'seed-demo',
      detail: 'Demo workspace provisioned',
    },
    {
      workspace_id: workspaceId,
      actor_id: `${userId}-legal`,
      entity_type: 'clearance',
      entity_id: clrCommons,
      action: 'approve',
      detail: 'Cleared Wikipedia Snapshot 2025-Q1',
    },
    {
      workspace_id: workspaceId,
      actor_id: userId,
      entity_type: 'claim',
      entity_id: claim1,
      action: 'intake',
      detail: 'Copyright claim received from Jane Author',
    },
  ])

  // --- Evidence ledger (hash-chained) -------------------------------------
  const ledgerRows = buildLedgerRows(workspaceId, userId, [
    {
      entity_type: 'source',
      entity_id: srcCommons.id,
      action: 'create',
      payload: { name: srcCommons.name },
      actor_id: userId,
    },
    {
      entity_type: 'license',
      entity_id: srcLicensedNews.id,
      action: 'attach-license',
      payload: { license: 'Global News Commercial License' },
      actor_id: userId,
    },
    {
      entity_type: 'clearance',
      entity_id: clrCommons,
      action: 'clear',
      payload: { source: srcCommons.name },
      actor_id: `${userId}-legal`,
    },
    {
      entity_type: 'clearance',
      entity_id: clrNews,
      action: 'clear',
      payload: { source: srcLicensedNews.name },
      actor_id: `${userId}-legal`,
    },
    {
      entity_type: 'optout',
      entity_id: srcScrapedWeb.id,
      action: 'apply-optout',
      payload: { subject: 'Jane Author' },
      actor_id: userId,
    },
    {
      entity_type: 'model',
      entity_id: verA1,
      action: 'release',
      payload: { model: 'Acme-LLM', version: '1.0.0' },
      actor_id: userId,
    },
    {
      entity_type: 'claim',
      entity_id: claim1,
      action: 'intake',
      payload: { claimant: 'Jane Author', type: 'copyright' },
      actor_id: userId,
    },
  ])
  await db.insert(ledger_entries).values(ledgerRows)

  const counts = {
    members: 4,
    rightsHolders: 3,
    licenseTemplates: 3,
    sources: sources.length,
    licenses: 3,
    copyrightScreenings: 2,
    piiScreenings: 2,
    optouts: 2,
    preferenceSignals: 2,
    models: 2,
    modelVersions: 3,
    lineageBindings: 5,
    clearances: 5,
    certificates: 2,
    claims: 2,
    claimImpacts: 1,
    policies: 2,
    riskScores: sources.length,
    tasks: 2,
    notifications: 3,
    activity: 3,
    ledgerEntries: ledgerRows.length,
  }

  return c.json({ workspaceId, counts })
})

export default router
