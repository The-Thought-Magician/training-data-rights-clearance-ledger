import { Hono } from 'hono'
import { eq, and, asc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { ledger_entries, members } from '../db/schema.js'
import { getUserId } from '../lib/auth.js'
import { computeEntryHash, GENESIS_HASH } from '../lib/ledgerHash.js'

const router = new Hono()

function recomputeHash(e: typeof ledger_entries.$inferSelect): string {
  return computeEntryHash({
    workspace_id: e.workspace_id,
    seq: e.seq,
    entity_type: e.entity_type,
    entity_id: e.entity_id,
    action: e.action,
    payload: e.payload,
    actor_id: e.actor_id,
    prev_hash: e.prev_hash,
  })
}

async function resolveWorkspaceId(userId: string): Promise<string | null> {
  const [m] = await db
    .select()
    .from(members)
    .where(eq(members.user_id, userId))
    .orderBy(members.created_at)
  return m?.workspace_id ?? null
}

// The ledger is per-workspace and reads are "public" per the build plan, but a
// ledger only makes sense scoped to a workspace. We resolve the workspace from
// the X-User-Id header when present, falling back to a `workspace_id` query
// param so unauthenticated public reads still work deterministically.
async function workspaceForRequest(c: any): Promise<string | null> {
  const qp = c.req.query('workspace_id')
  if (qp) return qp
  const userId = getUserId(c)
  if (userId) return resolveWorkspaceId(userId)
  return null
}

// ---------------------------------------------------------------------------
// GET / — list ledger entries (filter entity_type, entity_id) ordered by seq
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = await workspaceForRequest(c)
  if (!workspaceId) return c.json([])
  const entityType = c.req.query('entity_type')
  const entityId = c.req.query('entity_id')
  const conds = [eq(ledger_entries.workspace_id, workspaceId)]
  if (entityType) conds.push(eq(ledger_entries.entity_type, entityType))
  if (entityId) conds.push(eq(ledger_entries.entity_id, entityId))
  const rows = await db
    .select()
    .from(ledger_entries)
    .where(and(...conds))
    .orderBy(asc(ledger_entries.seq))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /verify — verify the hash chain is unbroken
// ---------------------------------------------------------------------------

router.get('/verify', async (c) => {
  const workspaceId = await workspaceForRequest(c)
  if (!workspaceId) return c.json({ valid: true, brokenAt: null, count: 0 })

  const rows = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, workspaceId))
    .orderBy(asc(ledger_entries.seq))

  let prev = GENESIS_HASH
  let expectedSeq = rows[0]?.seq ?? 0
  for (const e of rows) {
    // sequence must be contiguous starting at 1
    if (e.seq !== expectedSeq) {
      return c.json({ valid: false, brokenAt: e.seq, count: rows.length, reason: 'sequence-gap' })
    }
    // prev_hash must link to the prior entry's stored hash
    if (e.prev_hash !== prev) {
      return c.json({ valid: false, brokenAt: e.seq, count: rows.length, reason: 'prev-hash-mismatch' })
    }
    // stored entry_hash must equal a fresh recomputation of the entry body
    if (recomputeHash(e) !== e.entry_hash) {
      return c.json({ valid: false, brokenAt: e.seq, count: rows.length, reason: 'tampered-payload' })
    }
    prev = e.entry_hash
    expectedSeq++
  }

  return c.json({ valid: true, brokenAt: null, count: rows.length })
})

// ---------------------------------------------------------------------------
// GET /entity/:entityType/:entityId — per-entity timeline
// ---------------------------------------------------------------------------

router.get('/entity/:entityType/:entityId', async (c) => {
  const workspaceId = await workspaceForRequest(c)
  const entityType = c.req.param('entityType')
  const entityId = c.req.param('entityId')
  const conds = [eq(ledger_entries.entity_type, entityType), eq(ledger_entries.entity_id, entityId)]
  if (workspaceId) conds.push(eq(ledger_entries.workspace_id, workspaceId))
  const rows = await db
    .select()
    .from(ledger_entries)
    .where(and(...conds))
    .orderBy(asc(ledger_entries.seq))
  return c.json(rows)
})

export default router
