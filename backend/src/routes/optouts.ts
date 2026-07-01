import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { optouts, data_sources, ledger_entries, activity_log, members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { computeEntryHash, GENESIS_HASH } from '../lib/ledgerHash.js'

const router = new Hono()

// Append a hash-chained entry to the workspace ledger. Computes the next seq,
// links prev_hash to the latest entry, and derives entry_hash deterministically.
async function appendLedger(args: {
  workspaceId: string
  entityType: string
  entityId: string
  action: string
  payload: Record<string, unknown>
  actorId: string
}) {
  const [last] = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, args.workspaceId))
    .orderBy(desc(ledger_entries.seq))
    .limit(1)

  const seq = (last?.seq ?? -1) + 1
  const prevHash = last?.entry_hash ?? GENESIS_HASH
  const entryHash = computeEntryHash({
    workspace_id: args.workspaceId,
    seq,
    entity_type: args.entityType,
    entity_id: args.entityId,
    action: args.action,
    payload: args.payload,
    actor_id: args.actorId,
    prev_hash: prevHash,
  })

  const [entry] = await db
    .insert(ledger_entries)
    .values({
      workspace_id: args.workspaceId,
      seq,
      entity_type: args.entityType,
      entity_id: args.entityId,
      action: args.action,
      payload: args.payload,
      actor_id: args.actorId,
      prev_hash: prevHash,
      entry_hash: entryHash,
    })
    .returning()
  return entry
}

const createSchema = z.object({
  source_id: z.string().optional(),
  rights_holder_id: z.string().optional(),
  subject_identity: z.string().min(1),
  optout_type: z.enum(['individual', 'rights-holder']),
  scope: z.string().optional(),
  channel: z.enum(['email', 'web-form', 'letter', 'api']).optional(),
  received_at: z.string().optional(),
  notes: z.string().optional(),
})

const rejectSchema = z.object({
  rejection_reason: z.string().min(1),
})

// Resolve workspace for an opt-out: from source if linked, else require explicit on body.
async function workspaceForSource(sourceId: string | undefined): Promise<string | null> {
  if (!sourceId) return null
  const [source] = await db
    .select()
    .from(data_sources)
    .where(eq(data_sources.id, sourceId))
  return source?.workspace_id ?? null
}

// Public: list opt-outs (filter source_id, honor_status)
router.get('/', async (c) => {
  const sourceId = c.req.query('source_id')
  const honorStatus = c.req.query('honor_status')
  const conds = []
  if (sourceId) conds.push(eq(optouts.source_id, sourceId))
  if (honorStatus) conds.push(eq(optouts.honor_status, honorStatus))
  const rows = await db
    .select()
    .from(optouts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(optouts.received_at))
  return c.json(rows)
})

// Auth: record opt-out
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  let workspaceId = await workspaceForSource(body.source_id)
  if (!workspaceId) {
    // Fall back to the user's own membership workspace when no source is linked.
    const [m] = await db.select().from(members).where(eq(members.user_id, userId))
    workspaceId = m?.workspace_id ?? null
  }
  if (!workspaceId) return c.json({ error: 'No workspace context' }, 400)

  const [row] = await db
    .insert(optouts)
    .values({
      workspace_id: workspaceId,
      source_id: body.source_id,
      rights_holder_id: body.rights_holder_id,
      subject_identity: body.subject_identity,
      optout_type: body.optout_type,
      scope: body.scope ?? 'all',
      channel: body.channel,
      received_at: body.received_at ? new Date(body.received_at) : undefined,
      notes: body.notes ?? '',
      created_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    actor_id: userId,
    entity_type: 'optout',
    entity_id: row.id,
    action: 'recorded',
    detail: `Opt-out recorded for ${row.subject_identity} (${row.optout_type})`,
  })

  return c.json(row, 201)
})

// Auth: mark applied (sets applied_at, writes ledger entry)
router.post('/:id/apply', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(optouts).where(eq(optouts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.honor_status === 'applied')
    return c.json({ error: 'Opt-out already applied' }, 400)

  const appliedAt = new Date()
  const [updated] = await db
    .update(optouts)
    .set({ honor_status: 'applied', applied_at: appliedAt, rejection_reason: null })
    .where(eq(optouts.id, id))
    .returning()

  const ledgerEntry = await appendLedger({
    workspaceId: existing.workspace_id,
    entityType: 'optout',
    entityId: id,
    action: 'applied',
    payload: {
      subject_identity: existing.subject_identity,
      optout_type: existing.optout_type,
      scope: existing.scope,
      source_id: existing.source_id,
      applied_at: appliedAt.toISOString(),
    },
    actorId: userId,
  })

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'optout',
    entity_id: id,
    action: 'applied',
    detail: `Opt-out applied for ${existing.subject_identity} (ledger seq ${ledgerEntry.seq})`,
  })

  return c.json(updated)
})

// Auth: reject with reason
router.post('/:id/reject', authMiddleware, zValidator('json', rejectSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [existing] = await db.select().from(optouts).where(eq(optouts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.honor_status === 'applied')
    return c.json({ error: 'Cannot reject an already-applied opt-out' }, 400)

  const [updated] = await db
    .update(optouts)
    .set({
      honor_status: 'rejected',
      rejection_reason: body.rejection_reason,
      applied_at: null,
    })
    .where(eq(optouts.id, id))
    .returning()

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'optout',
    entity_id: id,
    action: 'rejected',
    detail: `Opt-out rejected for ${existing.subject_identity}: ${body.rejection_reason}`,
  })

  return c.json(updated)
})

export default router
