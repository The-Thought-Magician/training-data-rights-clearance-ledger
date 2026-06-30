import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import {
  clearances,
  clearance_requirements,
  clearance_certificates,
  data_sources,
  licenses,
  copyright_screenings,
  pii_screenings,
  optouts,
  workspaces,
  members,
  ledger_entries,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_REQUIREMENTS: Array<{ key: string; label: string; description: string }> = [
  { key: 'license', label: 'License on file', description: 'An active license permitting AI training is recorded.' },
  { key: 'copyright', label: 'Copyright screening passed', description: 'Copyright screening completed without unresolved flags.' },
  { key: 'pii', label: 'PII screening passed', description: 'PII screening completed without unresolved flags.' },
  { key: 'optouts', label: 'Opt-outs honored', description: 'No pending opt-outs remain for this source.' },
  { key: 'approver', label: 'Approver sign-off', description: 'A legal approver has signed off the clearance.' },
]

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

// Resolve the active set of requirement keys for a workspace.
async function requiredKeys(workspaceId: string): Promise<string[]> {
  const reqs = await db
    .select()
    .from(clearance_requirements)
    .where(eq(clearance_requirements.workspace_id, workspaceId))
  if (reqs.length > 0) {
    return reqs.filter((r) => r.is_required).map((r) => r.key)
  }
  // Fall back to the workspace's default_required_checks.
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  return ws?.default_required_checks ?? DEFAULT_REQUIREMENTS.map((r) => r.key)
}

// Evaluate which required checks are unmet for a source. `hasApprover` flags
// whether an approver sign-off is already recorded on the clearance.
async function evaluateUnmet(
  source: typeof data_sources.$inferSelect,
  keys: string[],
  hasApprover: boolean,
): Promise<string[]> {
  const unmet: string[] = []
  const sourceId = source.id

  for (const key of keys) {
    if (key === 'license') {
      const lic = await db
        .select()
        .from(licenses)
        .where(and(eq(licenses.source_id, sourceId), eq(licenses.status, 'active')))
      const ok = lic.some((l) => l.permits_ai_training === true)
      if (!ok) unmet.push('license')
    } else if (key === 'copyright') {
      const screenings = await db
        .select()
        .from(copyright_screenings)
        .where(eq(copyright_screenings.source_id, sourceId))
        .orderBy(desc(copyright_screenings.created_at))
      const latest = screenings[0]
      const ok =
        latest &&
        latest.status === 'passed' &&
        (latest.remediation_status === 'none' || latest.remediation_status === 'resolved')
      if (!ok) unmet.push('copyright')
    } else if (key === 'pii') {
      const screenings = await db
        .select()
        .from(pii_screenings)
        .where(eq(pii_screenings.source_id, sourceId))
        .orderBy(desc(pii_screenings.created_at))
      const latest = screenings[0]
      const ok =
        latest &&
        latest.status === 'passed' &&
        (latest.remediation_status === 'none' || latest.remediation_status === 'resolved')
      if (!ok) unmet.push('pii')
    } else if (key === 'optouts') {
      const pending = await db
        .select()
        .from(optouts)
        .where(and(eq(optouts.source_id, sourceId), eq(optouts.honor_status, 'pending')))
      if (pending.length > 0) unmet.push('optouts')
    } else if (key === 'approver') {
      if (!hasApprover) unmet.push('approver')
    }
  }
  return unmet
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const requirementsSchema = z.object({
  requirements: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      description: z.string().optional().default(''),
      is_required: z.boolean(),
    }),
  ),
})

const approveSchema = z.object({
  approver_role: z.string().optional().default('legal'),
  decision_rationale: z.string().optional().default(''),
  issued_to: z.string().optional(),
})

const overrideSchema = z.object({
  override_justification: z.string().min(1),
  decision_rationale: z.string().optional().default(''),
})

// ---------------------------------------------------------------------------
// Requirements config
// ---------------------------------------------------------------------------

// GET /requirements — public — workspace clearance requirements
router.get('/requirements', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (workspaceId) {
    const reqs = await db
      .select()
      .from(clearance_requirements)
      .where(eq(clearance_requirements.workspace_id, workspaceId))
      .orderBy(clearance_requirements.created_at)
    return c.json(reqs)
  }
  const reqs = await db
    .select()
    .from(clearance_requirements)
    .orderBy(clearance_requirements.created_at)
  return c.json(reqs)
})

// PUT /requirements — auth (admin) — set required checks
router.put('/requirements', authMiddleware, zValidator('json', requirementsSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Resolve the user's workspace via membership.
  const [membership] = await db
    .select()
    .from(members)
    .where(eq(members.user_id, userId))
    .orderBy(members.created_at)
    .limit(1)
  if (!membership) return c.json({ error: 'No workspace membership' }, 403)
  const workspaceId = membership.workspace_id
  if (membership.role !== 'admin') return c.json({ error: 'Forbidden: admin required' }, 403)

  for (const r of body.requirements) {
    await db
      .insert(clearance_requirements)
      .values({
        workspace_id: workspaceId,
        key: r.key,
        label: r.label,
        description: r.description ?? '',
        is_required: r.is_required,
      })
      .onConflictDoUpdate({
        target: [clearance_requirements.workspace_id, clearance_requirements.key],
        set: { label: r.label, description: r.description ?? '', is_required: r.is_required },
      })
  }

  // Keep the workspace default_required_checks in sync.
  const requiredCheckKeys = body.requirements.filter((r) => r.is_required).map((r) => r.key)
  await db
    .update(workspaces)
    .set({ default_required_checks: requiredCheckKeys })
    .where(eq(workspaces.id, workspaceId))

  await logActivity(workspaceId, userId, 'clearance_requirement', workspaceId, 'configured', 'Updated required checks')

  const reqs = await db
    .select()
    .from(clearance_requirements)
    .where(eq(clearance_requirements.workspace_id, workspaceId))
    .orderBy(clearance_requirements.created_at)
  return c.json(reqs)
})

// ---------------------------------------------------------------------------
// Clearances
// ---------------------------------------------------------------------------

// GET / — public — list clearances (filter status)
router.get('/', async (c) => {
  const status = c.req.query('status')
  const rows = status
    ? await db.select().from(clearances).where(eq(clearances.status, status)).orderBy(desc(clearances.created_at))
    : await db.select().from(clearances).orderBy(desc(clearances.created_at))
  return c.json(rows)
})

// GET /source/:sourceId — public — clearance for a source
router.get('/source/:sourceId', async (c) => {
  const sourceId = c.req.param('sourceId')
  const [cl] = await db.select().from(clearances).where(eq(clearances.source_id, sourceId))
  if (!cl) return c.json({ error: 'Not found' }, 404)
  return c.json(cl)
})

// GET /certificates — public — list certificates (filter source_id)
router.get('/certificates', async (c) => {
  const sourceId = c.req.query('source_id')
  const rows = sourceId
    ? await db
        .select()
        .from(clearance_certificates)
        .where(eq(clearance_certificates.source_id, sourceId))
        .orderBy(desc(clearance_certificates.created_at))
    : await db.select().from(clearance_certificates).orderBy(desc(clearance_certificates.created_at))
  return c.json(rows)
})

// POST /evaluate/:sourceId — auth — evaluate gate; upserts clearance
router.post('/evaluate/:sourceId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const sourceId = c.req.param('sourceId')

  const [source] = await db.select().from(data_sources).where(eq(data_sources.id, sourceId))
  if (!source) return c.json({ error: 'Source not found' }, 404)

  const role = await memberRole(source.workspace_id, userId)
  if (!role) return c.json({ error: 'Forbidden' }, 403)

  const [existing] = await db.select().from(clearances).where(eq(clearances.source_id, sourceId))
  const hasApprover = !!(existing && existing.approver_id)

  const keys = await requiredKeys(source.workspace_id)
  const unmet = await evaluateUnmet(source, keys, hasApprover)

  // An overridden clearance stays overridden unless re-evaluated clears it.
  let status: 'pending' | 'cleared' | 'blocked' | 'overridden'
  if (existing && existing.is_override) {
    status = 'overridden'
  } else if (unmet.length === 0) {
    status = 'cleared'
  } else if (unmet.length === 1 && unmet[0] === 'approver') {
    // All automated checks pass; only the human sign-off remains.
    status = 'pending'
  } else {
    status = 'blocked'
  }

  let clearance
  if (existing) {
    ;[clearance] = await db
      .update(clearances)
      .set({ status, unmet_requirements: unmet, decided_at: status === 'cleared' ? new Date() : existing.decided_at })
      .where(eq(clearances.id, existing.id))
      .returning()
  } else {
    ;[clearance] = await db
      .insert(clearances)
      .values({
        workspace_id: source.workspace_id,
        source_id: sourceId,
        status,
        unmet_requirements: unmet,
        created_by: userId,
      })
      .returning()
  }

  // Reflect the gate outcome on the source register status (unless retired).
  if (source.status !== 'retired') {
    let srcStatus = source.status
    if (status === 'cleared' || status === 'overridden') srcStatus = 'cleared'
    else if (status === 'blocked') srcStatus = 'blocked'
    else srcStatus = 'review'
    if (srcStatus !== source.status) {
      await db.update(data_sources).set({ status: srcStatus, updated_at: new Date() }).where(eq(data_sources.id, sourceId))
    }
  }

  await logActivity(
    source.workspace_id,
    userId,
    'clearance',
    clearance.id,
    'evaluated',
    `Status ${status}; unmet: ${unmet.join(', ') || 'none'}`,
  )

  return c.json({ status, unmet_requirements: unmet, clearance })
})

// POST /approve/:sourceId — auth (legal) — sign-off → cleared, issue certificate
router.post('/approve/:sourceId', authMiddleware, zValidator('json', approveSchema), async (c) => {
  const userId = getUserId(c)
  const sourceId = c.req.param('sourceId')
  const body = c.req.valid('json')

  const [source] = await db.select().from(data_sources).where(eq(data_sources.id, sourceId))
  if (!source) return c.json({ error: 'Source not found' }, 404)

  const role = await memberRole(source.workspace_id, userId)
  if (role !== 'legal' && role !== 'admin') {
    return c.json({ error: 'Forbidden: approval requires legal or admin role' }, 403)
  }

  // Re-evaluate the automated checks (treating approver as now satisfied).
  const keys = await requiredKeys(source.workspace_id)
  const unmetAutomated = (await evaluateUnmet(source, keys, true)).filter((k) => k !== 'approver')
  if (unmetAutomated.length > 0) {
    return c.json(
      { error: 'Cannot approve: unmet requirements remain', unmet_requirements: unmetAutomated },
      409,
    )
  }

  const [existing] = await db.select().from(clearances).where(eq(clearances.source_id, sourceId))
  const decidedAt = new Date()

  let clearance
  if (existing) {
    ;[clearance] = await db
      .update(clearances)
      .set({
        status: 'cleared',
        unmet_requirements: [],
        approver_id: userId,
        approver_role: body.approver_role ?? 'legal',
        decision_rationale: body.decision_rationale ?? '',
        is_override: false,
        decided_at: decidedAt,
      })
      .where(eq(clearances.id, existing.id))
      .returning()
  } else {
    ;[clearance] = await db
      .insert(clearances)
      .values({
        workspace_id: source.workspace_id,
        source_id: sourceId,
        status: 'cleared',
        unmet_requirements: [],
        approver_id: userId,
        approver_role: body.approver_role ?? 'legal',
        decision_rationale: body.decision_rationale ?? '',
        is_override: false,
        decided_at: decidedAt,
        created_by: userId,
      })
      .returning()
  }

  // Issue a hashed clearance certificate.
  const payload = {
    source_id: sourceId,
    source_name: source.name,
    workspace_id: source.workspace_id,
    clearance_id: clearance.id,
    approver_id: userId,
    approver_role: body.approver_role ?? 'legal',
    rationale: body.decision_rationale ?? '',
    required_checks: keys,
    issued_to: body.issued_to ?? null,
    issued_at: decidedAt.toISOString(),
  }
  const certificateHash = sha256(JSON.stringify(payload))

  const [certificate] = await db
    .insert(clearance_certificates)
    .values({
      workspace_id: source.workspace_id,
      source_id: sourceId,
      clearance_id: clearance.id,
      certificate_hash: certificateHash,
      issued_to: body.issued_to ?? null,
      payload,
      issued_by: userId,
    })
    .returning()

  // Reflect on the source register.
  if (source.status !== 'retired') {
    await db.update(data_sources).set({ status: 'cleared', updated_at: new Date() }).where(eq(data_sources.id, sourceId))
  }

  const ledger = await appendLedger(
    source.workspace_id,
    'clearance',
    clearance.id,
    'approved',
    { source_id: sourceId, certificate_id: certificate.id, certificate_hash: certificateHash, approver_role: body.approver_role ?? 'legal' },
    userId,
  )

  await logActivity(
    source.workspace_id,
    userId,
    'clearance',
    clearance.id,
    'approved',
    `Cleared and certified source ${source.name}`,
  )

  return c.json({ clearance, certificate, ledger })
})

// POST /override/:sourceId — auth (admin) — override-block with justification
router.post('/override/:sourceId', authMiddleware, zValidator('json', overrideSchema), async (c) => {
  const userId = getUserId(c)
  const sourceId = c.req.param('sourceId')
  const body = c.req.valid('json')

  const [source] = await db.select().from(data_sources).where(eq(data_sources.id, sourceId))
  if (!source) return c.json({ error: 'Source not found' }, 404)

  const role = await memberRole(source.workspace_id, userId)
  if (role !== 'admin') return c.json({ error: 'Forbidden: override requires admin role' }, 403)

  const keys = await requiredKeys(source.workspace_id)
  const [existing] = await db.select().from(clearances).where(eq(clearances.source_id, sourceId))
  const unmet = await evaluateUnmet(source, keys, !!(existing && existing.approver_id))
  const decidedAt = new Date()

  let clearance
  if (existing) {
    ;[clearance] = await db
      .update(clearances)
      .set({
        status: 'overridden',
        unmet_requirements: unmet,
        approver_id: userId,
        approver_role: role,
        is_override: true,
        override_justification: body.override_justification,
        decision_rationale: body.decision_rationale ?? '',
        decided_at: decidedAt,
      })
      .where(eq(clearances.id, existing.id))
      .returning()
  } else {
    ;[clearance] = await db
      .insert(clearances)
      .values({
        workspace_id: source.workspace_id,
        source_id: sourceId,
        status: 'overridden',
        unmet_requirements: unmet,
        approver_id: userId,
        approver_role: role,
        is_override: true,
        override_justification: body.override_justification,
        decision_rationale: body.decision_rationale ?? '',
        decided_at: decidedAt,
        created_by: userId,
      })
      .returning()
  }

  if (source.status !== 'retired') {
    await db.update(data_sources).set({ status: 'cleared', updated_at: new Date() }).where(eq(data_sources.id, sourceId))
  }

  const ledger = await appendLedger(
    source.workspace_id,
    'clearance',
    clearance.id,
    'overridden',
    { source_id: sourceId, justification: body.override_justification, unmet_at_override: unmet },
    userId,
  )

  await logActivity(
    source.workspace_id,
    userId,
    'clearance',
    clearance.id,
    'overridden',
    `Override-cleared source ${source.name}`,
  )

  return c.json({ ...clearance, ledger })
})

export default router
