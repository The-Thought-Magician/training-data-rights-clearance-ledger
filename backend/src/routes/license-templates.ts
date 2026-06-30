import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { license_templates, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const templateSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  license_type: z.enum([
    'cc-by',
    'cc-by-nc',
    'proprietary',
    'public-domain',
    'custom',
    'none-unknown',
  ]),
  permits_ai_training: z.boolean().optional().default(false),
  permits_commercial: z.boolean().optional().default(false),
  permits_derivatives: z.boolean().optional().default(false),
  requires_attribution: z.boolean().optional().default(false),
  share_alike: z.boolean().optional().default(false),
  description: z.string().optional().default(''),
})

// Public: list templates, optionally scoped to a workspace
router.get('/', async (c) => {
  const workspace_id = c.req.query('workspace_id')
  const rows = await db
    .select()
    .from(license_templates)
    .where(workspace_id ? eq(license_templates.workspace_id, workspace_id) : undefined)
    .orderBy(desc(license_templates.created_at))
  return c.json(rows)
})

// Auth: create a template with pre-filled permission flags
router.post('/', authMiddleware, zValidator('json', templateSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [tpl] = await db
    .insert(license_templates)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      license_type: body.license_type,
      permits_ai_training: body.permits_ai_training,
      permits_commercial: body.permits_commercial,
      permits_derivatives: body.permits_derivatives,
      requires_attribution: body.requires_attribution,
      share_alike: body.share_alike,
      description: body.description ?? '',
      created_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: body.workspace_id,
    actor_id: userId,
    entity_type: 'license_template',
    entity_id: tpl.id,
    action: 'created',
    detail: `Created license template ${tpl.name}`,
  })

  return c.json(tpl, 201)
})

// Auth (owner): delete a template
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(license_templates)
    .where(eq(license_templates.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(license_templates).where(eq(license_templates.id, id))

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    entity_type: 'license_template',
    entity_id: id,
    action: 'deleted',
    detail: `Deleted license template ${existing.name}`,
  })

  return c.json({ success: true })
})

export default router
