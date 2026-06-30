import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  preference_signals,
  data_sources,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const signalSchema = z.object({
  source_id: z.string().min(1),
  signal_type: z.enum(['robots.txt', 'ai.txt', 'tdm-reservation', 'noai', 'noimageai']),
  directive: z.enum(['allow', 'disallow']),
  captured_url: z.string().url().optional(),
  snapshot_ref: z.string().optional(),
  // raw captured content; if provided we compute its sha256 as a snapshot hash
  snapshot_content: z.string().optional(),
  // allow an explicitly supplied hash too (overrides computed one)
  snapshot_sha256: z.string().optional(),
  captured_at: z.string().datetime().optional(),
  recheck_due: z.string().datetime().optional(),
})

// ---------------------------------------------------------------------------
// GET / — public — list preference signals (filter by source_id)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const sourceId = c.req.query('source_id')
  const rows = sourceId
    ? await db
        .select()
        .from(preference_signals)
        .where(eq(preference_signals.source_id, sourceId))
        .orderBy(desc(preference_signals.captured_at))
    : await db
        .select()
        .from(preference_signals)
        .orderBy(desc(preference_signals.captured_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — auth — record a captured signal (with snapshot sha256)
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', signalSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [source] = await db
    .select()
    .from(data_sources)
    .where(eq(data_sources.id, body.source_id))
  if (!source) return c.json({ error: 'Source not found' }, 404)

  // snapshot hash: prefer explicit hash, else compute from supplied content,
  // else hash a deterministic descriptor of the captured signal.
  let snapshotHash = body.snapshot_sha256
  if (!snapshotHash) {
    if (body.snapshot_content !== undefined) {
      snapshotHash = await sha256Hex(body.snapshot_content)
    } else {
      snapshotHash = await sha256Hex(
        JSON.stringify({
          signal_type: body.signal_type,
          directive: body.directive,
          captured_url: body.captured_url ?? '',
          captured_at: body.captured_at ?? new Date().toISOString(),
        }),
      )
    }
  }

  const [created] = await db
    .insert(preference_signals)
    .values({
      workspace_id: source.workspace_id,
      source_id: body.source_id,
      signal_type: body.signal_type,
      directive: body.directive,
      captured_url: body.captured_url,
      snapshot_ref: body.snapshot_ref,
      snapshot_sha256: snapshotHash,
      captured_at: body.captured_at ? new Date(body.captured_at) : new Date(),
      recheck_due: body.recheck_due ? new Date(body.recheck_due) : null,
      created_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: source.workspace_id,
    actor_id: userId,
    entity_type: 'preference_signal',
    entity_id: created.id,
    action: 'created',
    detail: `Captured ${body.signal_type} (${body.directive}) for source ${source.name}`,
  })

  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// DELETE /:id — auth (owner) — delete
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(preference_signals)
    .where(eq(preference_signals.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(preference_signals).where(eq(preference_signals.id, id))

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'preference_signal',
    entity_id: id,
    action: 'deleted',
    detail: `Deleted ${existing.signal_type} signal`,
  })

  return c.json({ success: true })
})

export default router
