import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, asc, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  approval_requests,
  approval_steps,
  members,
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

const createSchema = z.object({
  request_type: z.enum(['clearance', 'release', 'override', 'license']),
  entity_type: z.string().min(1),
  entity_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  mode: z.enum(['sequential', 'parallel']).optional().default('sequential'),
  steps: z
    .array(
      z.object({
        required_role: z.string().optional().nullable(),
        assigned_to: z.string().optional().nullable(),
        step_order: z.number().int().optional(),
      }),
    )
    .min(1),
})

const decideSchema = z.object({
  step_id: z.string().min(1),
  decision: z.enum(['approve', 'reject', 'request-changes']),
  comment: z.string().optional().default(''),
})

// ---------------------------------------------------------------------------
// status recomputation given a request + its steps
// ---------------------------------------------------------------------------

function computeStatus(
  mode: string,
  steps: (typeof approval_steps.$inferSelect)[],
): 'pending' | 'approved' | 'rejected' | 'changes-requested' {
  if (steps.some((s) => s.decision === 'reject')) return 'rejected'
  if (steps.some((s) => s.decision === 'request-changes')) return 'changes-requested'
  const allApproved = steps.length > 0 && steps.every((s) => s.decision === 'approve')
  if (allApproved) return 'approved'
  return 'pending'
}

// ---------------------------------------------------------------------------
// GET / — list approval requests (filter status) — public
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const status = c.req.query('status')
  const requestType = c.req.query('request_type')
  const conds = []
  if (status) conds.push(eq(approval_requests.status, status))
  if (requestType) conds.push(eq(approval_requests.request_type, requestType))
  const rows = await db
    .select()
    .from(approval_requests)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(approval_requests.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /mine — requests with a step assigned to me and pending — auth
// ---------------------------------------------------------------------------

router.get('/mine', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = await resolveWorkspaceId(userId)

  // steps assigned to me that are still pending
  const mySteps = await db
    .select()
    .from(approval_steps)
    .where(and(eq(approval_steps.assigned_to, userId), eq(approval_steps.decision, 'pending')))

  // also include steps whose required_role matches my workspace role (unassigned)
  let myRole: string | null = null
  if (workspaceId) {
    const [m] = await db
      .select()
      .from(members)
      .where(and(eq(members.workspace_id, workspaceId), eq(members.user_id, userId)))
    myRole = m?.role ?? null
  }
  if (myRole) {
    const roleSteps = await db
      .select()
      .from(approval_steps)
      .where(and(eq(approval_steps.required_role, myRole), eq(approval_steps.decision, 'pending')))
    for (const s of roleSteps) {
      if (!s.assigned_to && !mySteps.some((ms) => ms.id === s.id)) mySteps.push(s)
    }
  }

  const requestIds = [...new Set(mySteps.map((s) => s.request_id))]
  if (requestIds.length === 0) return c.json([])

  const out: (typeof approval_requests.$inferSelect)[] = []
  for (const rid of requestIds) {
    const [req] = await db
      .select()
      .from(approval_requests)
      .where(and(eq(approval_requests.id, rid), eq(approval_requests.status, 'pending')))
    if (req) out.push(req)
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  return c.json(out)
})

// ---------------------------------------------------------------------------
// GET /:id — request + steps — public
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [request] = await db.select().from(approval_requests).where(eq(approval_requests.id, id))
  if (!request) return c.json({ error: 'Not found' }, 404)
  const steps = await db
    .select()
    .from(approval_steps)
    .where(eq(approval_steps.request_id, id))
    .orderBy(asc(approval_steps.step_order))
  return c.json({ request, steps })
})

// ---------------------------------------------------------------------------
// POST / — create approval request with steps — auth
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const workspaceId = await resolveWorkspaceId(userId)
  if (!workspaceId) return c.json({ error: 'No workspace' }, 403)
  const body = c.req.valid('json')

  const [request] = await db
    .insert(approval_requests)
    .values({
      workspace_id: workspaceId,
      request_type: body.request_type,
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      title: body.title,
      description: body.description,
      mode: body.mode,
      status: 'pending',
      requested_by: userId,
    })
    .returning()

  const stepRows = []
  let order = 0
  for (const s of body.steps) {
    const [step] = await db
      .insert(approval_steps)
      .values({
        workspace_id: workspaceId,
        request_id: request.id,
        step_order: s.step_order ?? order,
        required_role: s.required_role ?? null,
        assigned_to: s.assigned_to ?? null,
        decision: 'pending',
      })
      .returning()
    stepRows.push(step)
    order++
  }

  await appendLedger(
    workspaceId,
    'approval',
    request.id,
    'approval.created',
    { request_type: request.request_type, entity_type: request.entity_type, entity_id: request.entity_id, steps: stepRows.length, mode: request.mode },
    userId,
  )
  await logActivity(
    workspaceId,
    userId,
    'approval',
    request.id,
    'created',
    `${request.request_type} approval "${request.title}" with ${stepRows.length} step(s)`,
  )

  return c.json({ request, steps: stepRows }, 201)
})

// ---------------------------------------------------------------------------
// POST /:id/decide — record a step decision; advances request status — auth
// ---------------------------------------------------------------------------

router.post('/:id/decide', authMiddleware, zValidator('json', decideSchema), async (c) => {
  const userId = getUserId(c)
  const requestId = c.req.param('id')
  const body = c.req.valid('json')

  const [request] = await db
    .select()
    .from(approval_requests)
    .where(eq(approval_requests.id, requestId))
  if (!request) return c.json({ error: 'Not found' }, 404)

  const steps = await db
    .select()
    .from(approval_steps)
    .where(eq(approval_steps.request_id, requestId))
    .orderBy(asc(approval_steps.step_order))

  const target = steps.find((s) => s.id === body.step_id)
  if (!target) return c.json({ error: 'Step not found on this request' }, 404)
  if (target.decision !== 'pending')
    return c.json({ error: 'Step already decided' }, 409)

  // authorization: assignee, or member with the step's required role, or workspace member
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.workspace_id, request.workspace_id), eq(members.user_id, userId)))
  const isAssignee = target.assigned_to === userId
  const matchesRole = !!target.required_role && member?.role === target.required_role
  if (!isAssignee && !matchesRole && !member)
    return c.json({ error: 'Forbidden' }, 403)

  // sequential mode: must decide the lowest-ordered still-pending step
  if (request.mode === 'sequential') {
    const firstPending = steps.find((s) => s.decision === 'pending')
    if (firstPending && firstPending.id !== target.id)
      return c.json({ error: 'Out-of-order decision; an earlier step is still pending' }, 409)
  }

  const now = new Date()
  const [updatedStep] = await db
    .update(approval_steps)
    .set({ decision: body.decision, comment: body.comment, decided_by: userId, decided_at: now })
    .where(eq(approval_steps.id, target.id))
    .returning()

  const refreshed = steps.map((s) => (s.id === updatedStep.id ? updatedStep : s))
  const newStatus = computeStatus(request.mode, refreshed)

  const [updatedRequest] = await db
    .update(approval_requests)
    .set({ status: newStatus, updated_at: now })
    .where(eq(approval_requests.id, requestId))
    .returning()

  await appendLedger(
    request.workspace_id,
    'approval',
    requestId,
    'approval.step.decided',
    { step_id: target.id, decision: body.decision, request_status: newStatus },
    userId,
  )
  await logActivity(
    request.workspace_id,
    userId,
    'approval',
    requestId,
    'step-decided',
    `Step ${target.step_order} ${body.decision}; request now ${newStatus}`,
  )

  return c.json({ request: updatedRequest, steps: refreshed })
})

export default router
