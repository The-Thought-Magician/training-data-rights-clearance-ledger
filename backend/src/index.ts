import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { eq } from 'drizzle-orm'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import { plans, workspaces, members, clearance_requirements } from './db/schema.js'

import workspacesRoutes from './routes/workspaces.js'
import membersRoutes from './routes/members.js'
import sourcesRoutes from './routes/sources.js'
import evidenceRoutes from './routes/evidence.js'
import licensesRoutes from './routes/licenses.js'
import licenseTemplatesRoutes from './routes/license-templates.js'
import copyrightScreeningsRoutes from './routes/copyright-screenings.js'
import piiScreeningsRoutes from './routes/pii-screenings.js'
import optoutsRoutes from './routes/optouts.js'
import preferenceSignalsRoutes from './routes/preference-signals.js'
import rightsHoldersRoutes from './routes/rights-holders.js'
import modelsRoutes from './routes/models.js'
import modelVersionsRoutes from './routes/model-versions.js'
import lineageRoutes from './routes/lineage.js'
import clearanceRoutes from './routes/clearance.js'
import claimsRoutes from './routes/claims.js'
import ledgerRoutes from './routes/ledger.js'
import approvalsRoutes from './routes/approvals.js'
import policiesRoutes from './routes/policies.js'
import riskRoutes from './routes/risk.js'
import activityRoutes from './routes/activity.js'
import notificationsRoutes from './routes/notifications.js'
import tasksRoutes from './routes/tasks.js'
import documentationPacksRoutes from './routes/documentation-packs.js'
import reportsRoutes from './routes/reports.js'
import seedRoutes from './routes/seed.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://training-data-rights-clearance-ledger.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/members', membersRoutes)
api.route('/sources', sourcesRoutes)
api.route('/evidence', evidenceRoutes)
api.route('/licenses', licensesRoutes)
api.route('/license-templates', licenseTemplatesRoutes)
api.route('/copyright-screenings', copyrightScreeningsRoutes)
api.route('/pii-screenings', piiScreeningsRoutes)
api.route('/optouts', optoutsRoutes)
api.route('/preference-signals', preferenceSignalsRoutes)
api.route('/rights-holders', rightsHoldersRoutes)
api.route('/models', modelsRoutes)
api.route('/model-versions', modelVersionsRoutes)
api.route('/lineage', lineageRoutes)
api.route('/clearance', clearanceRoutes)
api.route('/claims', claimsRoutes)
api.route('/ledger', ledgerRoutes)
api.route('/approvals', approvalsRoutes)
api.route('/policies', policiesRoutes)
api.route('/risk', riskRoutes)
api.route('/activity', activityRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/tasks', tasksRoutes)
api.route('/documentation-packs', documentationPacksRoutes)
api.route('/reports', reportsRoutes)
api.route('/seed', seedRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// Idempotent seed: plans (free/pro) + a demo workspace with an admin member and
// the default clearance requirements. Count-then-insert so re-runs are no-ops.
async function seedIfEmpty() {
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 4900 },
    ])
    console.log('Seeded plans')
  }

  const demoWorkspaceId = 'demo-workspace'
  const demoUserId = 'demo-user'
  const existingDemo = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, demoWorkspaceId))
    .limit(1)
  if (existingDemo.length === 0) {
    await db.insert(workspaces).values({
      id: demoWorkspaceId,
      name: 'Demo Workspace',
      slug: 'demo',
      owner_id: demoUserId,
    })
    await db.insert(members).values({
      workspace_id: demoWorkspaceId,
      user_id: demoUserId,
      email: 'demo@example.com',
      name: 'Demo Admin',
      role: 'admin',
    })
    const defaultRequirements = [
      { key: 'license', label: 'License verified', description: 'A license permitting AI training is recorded.' },
      { key: 'copyright', label: 'Copyright screening passed', description: 'Copyright screening completed without unresolved flags.' },
      { key: 'pii', label: 'PII screening passed', description: 'PII screening completed without unresolved flags.' },
      { key: 'optouts', label: 'Opt-outs honored', description: 'All applicable opt-outs have been applied or rejected with reason.' },
      { key: 'approver', label: 'Approver sign-off', description: 'A legal approver has signed off on the source.' },
    ]
    for (const req of defaultRequirements) {
      await db.insert(clearance_requirements).values({
        workspace_id: demoWorkspaceId,
        key: req.key,
        label: req.label,
        description: req.description,
        is_required: true,
      })
    }
    console.log('Seeded demo workspace, admin member, and clearance requirements')
  }
}

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check detects a
// live service immediately. Only AFTER serve() do we run migrate() and
// seedIfEmpty() (both idempotent), each wrapped in its own try/catch. Never await
// DB work before serve() — a cold/slow DB connection would block the port bind
// and trip a Render deploy timeout.
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
  } catch (e) {
    console.error('Migration error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
