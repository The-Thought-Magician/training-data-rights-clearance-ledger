import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { tasks, activity_log } from '../db/schema.js'
import { and, desc, eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  assigned_to: z.string().min(1).optional(),
  task_type: z.enum(['remediation', 'approval', 'review']),
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  due_date: z.string().datetime().optional(),
  status: z.enum(['open', 'in-progress', 'done']).optional().default('open'),
})

const updateSchema = z.object({
  status: z.enum(['open', 'in-progress', 'done']).optional(),
  assigned_to: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  due_date: z.string().datetime().nullable().optional(),
})

// GET / — auth — current user's tasks (optional status filter)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const status = c.req.query('status')
  const conds = [eq(tasks.assigned_to, userId)]
  if (status) conds.push(eq(tasks.status, status))
  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conds))
    .orderBy(desc(tasks.created_at))
  return c.json(rows)
})

// POST / — auth — create a task (defaults assignee to the creator)
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [task] = await db
    .insert(tasks)
    .values({
      workspace_id: body.workspace_id,
      assigned_to: body.assigned_to ?? userId,
      task_type: body.task_type,
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      title: body.title,
      description: body.description,
      due_date: body.due_date ? new Date(body.due_date) : undefined,
      status: body.status,
      created_by: userId,
    })
    .returning()
  await db.insert(activity_log).values({
    workspace_id: task.workspace_id,
    actor_id: userId,
    entity_type: 'task',
    entity_id: task.id,
    action: 'created',
    detail: task.title,
  })
  return c.json(task, 201)
})

// PUT /:id — auth — update status/assignee/title/description/due_date
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  // Creator or current assignee may modify the task
  if (existing.created_by !== userId && existing.assigned_to !== userId)
    return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) patch.status = body.status
  if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to
  if (body.title !== undefined) patch.title = body.title
  if (body.description !== undefined) patch.description = body.description
  if (body.due_date !== undefined) patch.due_date = body.due_date ? new Date(body.due_date) : null
  const [updated] = await db.update(tasks).set(patch).where(eq(tasks.id, id)).returning()
  await db.insert(activity_log).values({
    workspace_id: updated.workspace_id,
    actor_id: userId,
    entity_type: 'task',
    entity_id: updated.id,
    action: 'updated',
    detail: `status=${updated.status}`,
  })
  return c.json(updated)
})

export default router
