import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Workspaces & Members
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  owner_id: text('owner_id').notNull(),
  default_required_checks: jsonb('default_required_checks').$type<string[]>().default(['license', 'copyright', 'pii', 'optouts', 'approver']),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const members = pgTable('members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  email: text('email'),
  name: text('name'),
  role: text('role').notNull().default('viewer'), // admin | legal | ml-lead | dataops | viewer
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ---------------------------------------------------------------------------
// Data Source Register
// ---------------------------------------------------------------------------

export const data_sources = pgTable('data_sources', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  description: text('description').default(''),
  source_type: text('source_type').notNull(), // web-scrape | licensed | purchased | user-generated | synthetic | public-domain | internal
  modality: text('modality').notNull().default('text'), // text | image | audio | video | code | tabular
  origin_url: text('origin_url'),
  vendor: text('vendor'),
  upstream_source_id: text('upstream_source_id'),
  acquisition_method: text('acquisition_method'), // scraped | downloaded | purchased | licensed | generated | contributed
  acquisition_date: timestamp('acquisition_date'),
  acquirer: text('acquirer'),
  justification: text('justification').default(''),
  record_count: integer('record_count'),
  size_bytes: integer('size_bytes'),
  format: text('format'),
  tags: jsonb('tags').$type<string[]>().default([]),
  collection: text('collection'),
  status: text('status').notNull().default('draft'), // draft | review | cleared | blocked | retired
  risk_score: real('risk_score').default(0),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const provenance_events = pgTable('provenance_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_id: text('source_id').notNull().references(() => data_sources.id),
  event_type: text('event_type').notNull(), // acquired-from | transformed | merged | split | derived-from | re-licensed
  description: text('description').default(''),
  related_source_id: text('related_source_id'),
  occurred_at: timestamp('occurred_at').defaultNow().notNull(),
  recorded_by: text('recorded_by').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const evidence_artifacts = pgTable('evidence_artifacts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_id: text('source_id').references(() => data_sources.id),
  entity_type: text('entity_type').notNull().default('source'), // source | license | claim | screening
  entity_id: text('entity_id'),
  kind: text('kind').notNull(), // contract | invoice | robots-snapshot | screenshot | email | report | other
  filename: text('filename').notNull(),
  content_type: text('content_type'),
  size_bytes: integer('size_bytes'),
  sha256: text('sha256').notNull(),
  storage_ref: text('storage_ref'),
  uploaded_by: text('uploaded_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const custody_handoffs = pgTable('custody_handoffs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_id: text('source_id').notNull().references(() => data_sources.id),
  from_party: text('from_party'),
  to_party: text('to_party').notNull(),
  reason: text('reason').default(''),
  occurred_at: timestamp('occurred_at').defaultNow().notNull(),
  recorded_by: text('recorded_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------

export const licenses = pgTable('licenses', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_id: text('source_id').notNull().references(() => data_sources.id),
  license_name: text('license_name').notNull(),
  license_type: text('license_type').notNull(), // cc-by | cc-by-nc | proprietary | public-domain | custom | none-unknown
  permits_ai_training: boolean('permits_ai_training').default(false),
  permits_commercial: boolean('permits_commercial').default(false),
  permits_derivatives: boolean('permits_derivatives').default(false),
  requires_attribution: boolean('requires_attribution').default(false),
  share_alike: boolean('share_alike').default(false),
  territorial_restrictions: text('territorial_restrictions'),
  rights_holder_id: text('rights_holder_id'),
  document_ref: text('document_ref'),
  effective_date: timestamp('effective_date'),
  expiry_date: timestamp('expiry_date'),
  status: text('status').notNull().default('active'), // active | expired | terminated | superseded
  conflict_flags: jsonb('conflict_flags').$type<string[]>().default([]),
  notes: text('notes').default(''),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const license_templates = pgTable('license_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  license_type: text('license_type').notNull(),
  permits_ai_training: boolean('permits_ai_training').default(false),
  permits_commercial: boolean('permits_commercial').default(false),
  permits_derivatives: boolean('permits_derivatives').default(false),
  requires_attribution: boolean('requires_attribution').default(false),
  share_alike: boolean('share_alike').default(false),
  description: text('description').default(''),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Screenings
// ---------------------------------------------------------------------------

export const copyright_screenings = pgTable('copyright_screenings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_id: text('source_id').notNull().references(() => data_sources.id),
  status: text('status').notNull().default('not-started'), // not-started | in-progress | passed | flagged | failed
  method: text('method'), // manual | automated | vendor
  reviewer: text('reviewer'),
  flagged_works: jsonb('flagged_works').$type<Array<{ work: string; rights_holder: string }>>().default([]),
  risk_score: real('risk_score').default(0),
  remediation_action: text('remediation_action'),
  remediation_owner: text('remediation_owner'),
  remediation_due: timestamp('remediation_due'),
  remediation_status: text('remediation_status').default('none'), // none | open | resolved
  notes: text('notes').default(''),
  screened_at: timestamp('screened_at'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const pii_screenings = pgTable('pii_screenings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_id: text('source_id').notNull().references(() => data_sources.id),
  status: text('status').notNull().default('not-started'), // not-started | in-progress | passed | flagged | failed
  method: text('method'),
  reviewer: text('reviewer'),
  pii_categories: jsonb('pii_categories').$type<string[]>().default([]),
  lawful_basis: text('lawful_basis'), // consent | legitimate-interest | contract | not-applicable
  anonymization_status: text('anonymization_status').default('none'), // none | pseudonymized | anonymized
  anonymization_technique: text('anonymization_technique'),
  remediation_action: text('remediation_action'),
  remediation_owner: text('remediation_owner'),
  remediation_due: timestamp('remediation_due'),
  remediation_status: text('remediation_status').default('none'),
  notes: text('notes').default(''),
  screened_at: timestamp('screened_at'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Opt-outs & Preference Signals
// ---------------------------------------------------------------------------

export const optouts = pgTable('optouts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_id: text('source_id').references(() => data_sources.id),
  rights_holder_id: text('rights_holder_id'),
  subject_identity: text('subject_identity').notNull(),
  optout_type: text('optout_type').notNull(), // individual | rights-holder
  scope: text('scope').default('all'),
  channel: text('channel'), // email | web-form | letter | api
  received_at: timestamp('received_at').defaultNow().notNull(),
  honor_status: text('honor_status').notNull().default('pending'), // pending | applied | rejected
  rejection_reason: text('rejection_reason'),
  applied_at: timestamp('applied_at'),
  notes: text('notes').default(''),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const preference_signals = pgTable('preference_signals', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_id: text('source_id').notNull().references(() => data_sources.id),
  signal_type: text('signal_type').notNull(), // robots.txt | ai.txt | tdm-reservation | noai | noimageai
  directive: text('directive').notNull(), // allow | disallow
  captured_url: text('captured_url'),
  snapshot_ref: text('snapshot_ref'),
  snapshot_sha256: text('snapshot_sha256'),
  captured_at: timestamp('captured_at').defaultNow().notNull(),
  recheck_due: timestamp('recheck_due'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const rights_holders = pgTable('rights_holders', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  holder_type: text('holder_type').notNull().default('individual'), // individual | publisher | vendor | collecting-society
  contact_email: text('contact_email'),
  jurisdiction: text('jurisdiction'),
  notes: text('notes').default(''),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Models & Lineage
// ---------------------------------------------------------------------------

export const models = pgTable('models', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  description: text('description').default(''),
  purpose: text('purpose').default(''),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const model_versions = pgTable('model_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  model_id: text('model_id').notNull().references(() => models.id),
  version: text('version').notNull(),
  base_model: text('base_model'),
  training_type: text('training_type').default('train'), // train | fine-tune
  training_date: timestamp('training_date'),
  manifest_hash: text('manifest_hash'),
  release_status: text('release_status').notNull().default('draft'), // draft | ready | released | quarantined
  released_at: timestamp('released_at'),
  released_by: text('released_by'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.model_id, t.version)])

export const lineage_bindings = pgTable('lineage_bindings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  model_version_id: text('model_version_id').notNull().references(() => model_versions.id),
  source_id: text('source_id').notNull().references(() => data_sources.id),
  proportion: real('proportion'),
  preprocessing: text('preprocessing').default(''),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.model_version_id, t.source_id)])

// ---------------------------------------------------------------------------
// Clearance
// ---------------------------------------------------------------------------

export const clearance_requirements = pgTable('clearance_requirements', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  key: text('key').notNull(), // license | copyright | pii | optouts | approver
  label: text('label').notNull(),
  description: text('description').default(''),
  is_required: boolean('is_required').default(true).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.key)])

export const clearances = pgTable('clearances', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_id: text('source_id').notNull().references(() => data_sources.id),
  status: text('status').notNull().default('pending'), // pending | cleared | blocked | overridden
  unmet_requirements: jsonb('unmet_requirements').$type<string[]>().default([]),
  approver_id: text('approver_id'),
  approver_role: text('approver_role'),
  decision_rationale: text('decision_rationale').default(''),
  is_override: boolean('is_override').default(false),
  override_justification: text('override_justification'),
  decided_at: timestamp('decided_at'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.source_id)])

export const clearance_certificates = pgTable('clearance_certificates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_id: text('source_id').notNull().references(() => data_sources.id),
  clearance_id: text('clearance_id').notNull().references(() => clearances.id),
  certificate_hash: text('certificate_hash').notNull(),
  issued_to: text('issued_to'),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  issued_by: text('issued_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Claims / Disputes
// ---------------------------------------------------------------------------

export const claims = pgTable('claims', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  claimant: text('claimant').notNull(),
  rights_holder_id: text('rights_holder_id'),
  claim_type: text('claim_type').notNull(), // copyright | privacy | contract | takedown
  description: text('description').default(''),
  severity: text('severity').notNull().default('medium'), // low | medium | high | critical
  status: text('status').notNull().default('received'), // received | investigating | valid | invalid | remediating | resolved | escalated
  source_id: text('source_id').references(() => data_sources.id),
  response_deadline: timestamp('response_deadline'),
  legal_hold: boolean('legal_hold').default(false),
  resolution: text('resolution').default(''),
  resolved_at: timestamp('resolved_at'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const claim_impacts = pgTable('claim_impacts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  claim_id: text('claim_id').notNull().references(() => claims.id),
  model_version_id: text('model_version_id').notNull().references(() => model_versions.id),
  impact: text('impact').notNull().default('review'), // review | retrain | quarantine | re-release | none
  resolved: boolean('resolved').default(false),
  notes: text('notes').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.claim_id, t.model_version_id)])

// ---------------------------------------------------------------------------
// Evidence Ledger (hash-chained)
// ---------------------------------------------------------------------------

export const ledger_entries = pgTable('ledger_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  seq: integer('seq').notNull(),
  entity_type: text('entity_type').notNull(), // source | license | screening | clearance | approval | optout | lineage | claim | model
  entity_id: text('entity_id').notNull(),
  action: text('action').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  actor_id: text('actor_id').notNull(),
  prev_hash: text('prev_hash').notNull(),
  entry_hash: text('entry_hash').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.seq)])

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export const approval_requests = pgTable('approval_requests', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  request_type: text('request_type').notNull(), // clearance | release | override | license
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  title: text('title').notNull(),
  description: text('description').default(''),
  mode: text('mode').notNull().default('sequential'), // sequential | parallel
  status: text('status').notNull().default('pending'), // pending | approved | rejected | changes-requested
  requested_by: text('requested_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const approval_steps = pgTable('approval_steps', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  request_id: text('request_id').notNull().references(() => approval_requests.id),
  step_order: integer('step_order').notNull().default(0),
  required_role: text('required_role'),
  assigned_to: text('assigned_to'),
  decision: text('decision').notNull().default('pending'), // pending | approve | reject | request-changes
  comment: text('comment').default(''),
  decided_by: text('decided_by'),
  decided_at: timestamp('decided_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export const policies = pgTable('policies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  description: text('description').default(''),
  conditions: jsonb('conditions').$type<Array<{ field: string; op: string; value: unknown }>>().default([]),
  action: text('action').notNull().default('flag'), // block | flag | require-review
  severity: text('severity').notNull().default('medium'),
  is_active: boolean('is_active').default(true).notNull(),
  version: integer('version').notNull().default(1),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const policy_violations = pgTable('policy_violations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  policy_id: text('policy_id').notNull().references(() => policies.id),
  source_id: text('source_id').notNull().references(() => data_sources.id),
  detail: text('detail').default(''),
  resolved: boolean('resolved').default(false),
  detected_at: timestamp('detected_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export const risk_scores = pgTable('risk_scores', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_id: text('source_id').notNull().references(() => data_sources.id),
  license_risk: real('license_risk').default(0),
  copyright_risk: real('copyright_risk').default(0),
  pii_risk: real('pii_risk').default(0),
  optout_risk: real('optout_risk').default(0),
  composite_risk: real('composite_risk').default(0),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.source_id)])

// ---------------------------------------------------------------------------
// Activity, Notifications, Tasks
// ---------------------------------------------------------------------------

export const activity_log = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  actor_id: text('actor_id').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id'),
  action: text('action').notNull(),
  detail: text('detail').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  kind: text('kind').notNull(), // approval | license-expiry | new-claim | screening-failed | optout-applied
  title: text('title').notNull(),
  body: text('body').default(''),
  link: text('link'),
  is_read: boolean('is_read').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  assigned_to: text('assigned_to').notNull(),
  task_type: text('task_type').notNull(), // remediation | approval | review
  entity_type: text('entity_type'),
  entity_id: text('entity_id'),
  title: text('title').notNull(),
  description: text('description').default(''),
  due_date: timestamp('due_date'),
  status: text('status').notNull().default('open'), // open | in-progress | done
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Documentation Packs
// ---------------------------------------------------------------------------

export const documentation_packs = pgTable('documentation_packs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  pack_type: text('pack_type').notNull(), // gpai-summary | source-dossier | litigation-pack
  subject_type: text('subject_type').notNull(), // model_version | source
  subject_id: text('subject_id').notNull(),
  title: text('title').notNull(),
  content: jsonb('content').$type<Record<string, unknown>>().default({}),
  content_hash: text('content_hash'),
  generated_by: text('generated_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(), // 'free' | 'pro'
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free').references(() => plans.id),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
