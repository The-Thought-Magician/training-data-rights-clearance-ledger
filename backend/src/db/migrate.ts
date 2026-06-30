import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    owner_id text NOT NULL,
    default_required_checks jsonb DEFAULT '["license","copyright","pii","optouts","approver"]'::jsonb,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    email text,
    name text,
    role text NOT NULL DEFAULT 'viewer',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS data_sources (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    description text DEFAULT '',
    source_type text NOT NULL,
    modality text NOT NULL DEFAULT 'text',
    origin_url text,
    vendor text,
    upstream_source_id text,
    acquisition_method text,
    acquisition_date timestamptz,
    acquirer text,
    justification text DEFAULT '',
    record_count integer,
    size_bytes integer,
    format text,
    tags jsonb DEFAULT '[]'::jsonb,
    collection text,
    status text NOT NULL DEFAULT 'draft',
    risk_score real DEFAULT 0,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS provenance_events (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_id text NOT NULL REFERENCES data_sources(id),
    event_type text NOT NULL,
    description text DEFAULT '',
    related_source_id text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    recorded_by text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS evidence_artifacts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_id text REFERENCES data_sources(id),
    entity_type text NOT NULL DEFAULT 'source',
    entity_id text,
    kind text NOT NULL,
    filename text NOT NULL,
    content_type text,
    size_bytes integer,
    sha256 text NOT NULL,
    storage_ref text,
    uploaded_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS custody_handoffs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_id text NOT NULL REFERENCES data_sources(id),
    from_party text,
    to_party text NOT NULL,
    reason text DEFAULT '',
    occurred_at timestamptz NOT NULL DEFAULT now(),
    recorded_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS licenses (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_id text NOT NULL REFERENCES data_sources(id),
    license_name text NOT NULL,
    license_type text NOT NULL,
    permits_ai_training boolean DEFAULT false,
    permits_commercial boolean DEFAULT false,
    permits_derivatives boolean DEFAULT false,
    requires_attribution boolean DEFAULT false,
    share_alike boolean DEFAULT false,
    territorial_restrictions text,
    rights_holder_id text,
    document_ref text,
    effective_date timestamptz,
    expiry_date timestamptz,
    status text NOT NULL DEFAULT 'active',
    conflict_flags jsonb DEFAULT '[]'::jsonb,
    notes text DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS license_templates (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    license_type text NOT NULL,
    permits_ai_training boolean DEFAULT false,
    permits_commercial boolean DEFAULT false,
    permits_derivatives boolean DEFAULT false,
    requires_attribution boolean DEFAULT false,
    share_alike boolean DEFAULT false,
    description text DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS copyright_screenings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_id text NOT NULL REFERENCES data_sources(id),
    status text NOT NULL DEFAULT 'not-started',
    method text,
    reviewer text,
    flagged_works jsonb DEFAULT '[]'::jsonb,
    risk_score real DEFAULT 0,
    remediation_action text,
    remediation_owner text,
    remediation_due timestamptz,
    remediation_status text DEFAULT 'none',
    notes text DEFAULT '',
    screened_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS pii_screenings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_id text NOT NULL REFERENCES data_sources(id),
    status text NOT NULL DEFAULT 'not-started',
    method text,
    reviewer text,
    pii_categories jsonb DEFAULT '[]'::jsonb,
    lawful_basis text,
    anonymization_status text DEFAULT 'none',
    anonymization_technique text,
    remediation_action text,
    remediation_owner text,
    remediation_due timestamptz,
    remediation_status text DEFAULT 'none',
    notes text DEFAULT '',
    screened_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS optouts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_id text REFERENCES data_sources(id),
    rights_holder_id text,
    subject_identity text NOT NULL,
    optout_type text NOT NULL,
    scope text DEFAULT 'all',
    channel text,
    received_at timestamptz NOT NULL DEFAULT now(),
    honor_status text NOT NULL DEFAULT 'pending',
    rejection_reason text,
    applied_at timestamptz,
    notes text DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS preference_signals (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_id text NOT NULL REFERENCES data_sources(id),
    signal_type text NOT NULL,
    directive text NOT NULL,
    captured_url text,
    snapshot_ref text,
    snapshot_sha256 text,
    captured_at timestamptz NOT NULL DEFAULT now(),
    recheck_due timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS rights_holders (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    holder_type text NOT NULL DEFAULT 'individual',
    contact_email text,
    jurisdiction text,
    notes text DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS models (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    description text DEFAULT '',
    purpose text DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS model_versions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    model_id text NOT NULL REFERENCES models(id),
    version text NOT NULL,
    base_model text,
    training_type text DEFAULT 'train',
    training_date timestamptz,
    manifest_hash text,
    release_status text NOT NULL DEFAULT 'draft',
    released_at timestamptz,
    released_by text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (model_id, version)
  )`,

  `CREATE TABLE IF NOT EXISTS lineage_bindings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    model_version_id text NOT NULL REFERENCES model_versions(id),
    source_id text NOT NULL REFERENCES data_sources(id),
    proportion real,
    preprocessing text DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (model_version_id, source_id)
  )`,

  `CREATE TABLE IF NOT EXISTS clearance_requirements (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    key text NOT NULL,
    label text NOT NULL,
    description text DEFAULT '',
    is_required boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, key)
  )`,

  `CREATE TABLE IF NOT EXISTS clearances (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_id text NOT NULL REFERENCES data_sources(id),
    status text NOT NULL DEFAULT 'pending',
    unmet_requirements jsonb DEFAULT '[]'::jsonb,
    approver_id text,
    approver_role text,
    decision_rationale text DEFAULT '',
    is_override boolean DEFAULT false,
    override_justification text,
    decided_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id)
  )`,

  `CREATE TABLE IF NOT EXISTS clearance_certificates (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_id text NOT NULL REFERENCES data_sources(id),
    clearance_id text NOT NULL REFERENCES clearances(id),
    certificate_hash text NOT NULL,
    issued_to text,
    payload jsonb DEFAULT '{}'::jsonb,
    issued_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS claims (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    claimant text NOT NULL,
    rights_holder_id text,
    claim_type text NOT NULL,
    description text DEFAULT '',
    severity text NOT NULL DEFAULT 'medium',
    status text NOT NULL DEFAULT 'received',
    source_id text REFERENCES data_sources(id),
    response_deadline timestamptz,
    legal_hold boolean DEFAULT false,
    resolution text DEFAULT '',
    resolved_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS claim_impacts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    claim_id text NOT NULL REFERENCES claims(id),
    model_version_id text NOT NULL REFERENCES model_versions(id),
    impact text NOT NULL DEFAULT 'review',
    resolved boolean DEFAULT false,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (claim_id, model_version_id)
  )`,

  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    seq integer NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    actor_id text NOT NULL,
    prev_hash text NOT NULL,
    entry_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, seq)
  )`,

  `CREATE TABLE IF NOT EXISTS approval_requests (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    request_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    title text NOT NULL,
    description text DEFAULT '',
    mode text NOT NULL DEFAULT 'sequential',
    status text NOT NULL DEFAULT 'pending',
    requested_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS approval_steps (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    request_id text NOT NULL REFERENCES approval_requests(id),
    step_order integer NOT NULL DEFAULT 0,
    required_role text,
    assigned_to text,
    decision text NOT NULL DEFAULT 'pending',
    comment text DEFAULT '',
    decided_by text,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS policies (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    description text DEFAULT '',
    conditions jsonb DEFAULT '[]'::jsonb,
    action text NOT NULL DEFAULT 'flag',
    severity text NOT NULL DEFAULT 'medium',
    is_active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS policy_violations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    policy_id text NOT NULL REFERENCES policies(id),
    source_id text NOT NULL REFERENCES data_sources(id),
    detail text DEFAULT '',
    resolved boolean DEFAULT false,
    detected_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS risk_scores (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_id text NOT NULL REFERENCES data_sources(id),
    license_risk real DEFAULT 0,
    copyright_risk real DEFAULT 0,
    pii_risk real DEFAULT 0,
    optout_risk real DEFAULT 0,
    composite_risk real DEFAULT 0,
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id)
  )`,

  `CREATE TABLE IF NOT EXISTS activity_log (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    actor_id text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    action text NOT NULL,
    detail text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text DEFAULT '',
    link text,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    assigned_to text NOT NULL,
    task_type text NOT NULL,
    entity_type text,
    entity_id text,
    title text NOT NULL,
    description text DEFAULT '',
    due_date timestamptz,
    status text NOT NULL DEFAULT 'open',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS documentation_packs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    pack_type text NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    title text NOT NULL,
    content jsonb DEFAULT '{}'::jsonb,
    content_hash text,
    generated_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free' REFERENCES plans(id),
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
]

const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_members_workspace ON members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_data_sources_workspace ON data_sources(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_data_sources_status ON data_sources(status)`,
  `CREATE INDEX IF NOT EXISTS idx_provenance_workspace ON provenance_events(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provenance_source ON provenance_events(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_workspace ON evidence_artifacts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_source ON evidence_artifacts(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_custody_source ON custody_handoffs(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_licenses_workspace ON licenses(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_licenses_source ON licenses(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_license_templates_workspace ON license_templates(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_copyright_workspace ON copyright_screenings(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_copyright_source ON copyright_screenings(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pii_workspace ON pii_screenings(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pii_source ON pii_screenings(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_optouts_workspace ON optouts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_optouts_source ON optouts(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_preference_workspace ON preference_signals(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_preference_source ON preference_signals(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rights_holders_workspace ON rights_holders(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_models_workspace ON models(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_model_versions_workspace ON model_versions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_model_versions_model ON model_versions(model_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lineage_workspace ON lineage_bindings(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lineage_model_version ON lineage_bindings(model_version_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lineage_source ON lineage_bindings(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_clearance_req_workspace ON clearance_requirements(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_clearances_workspace ON clearances(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_clearances_source ON clearances(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_certificates_workspace ON clearance_certificates(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_certificates_source ON clearance_certificates(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_workspace ON claims(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claim_impacts_workspace ON claim_impacts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claim_impacts_claim ON claim_impacts(claim_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_workspace ON ledger_entries(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_entity ON ledger_entries(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_requests_workspace ON approval_requests(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_steps_request ON approval_steps(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_policies_workspace ON policies(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_policy_violations_workspace ON policy_violations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_policy_violations_source ON policy_violations(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_risk_scores_workspace ON risk_scores(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_log(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to)`,
  `CREATE INDEX IF NOT EXISTS idx_docpacks_workspace ON documentation_packs(workspace_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  for (const idx of indexes) {
    await db.execute(sql.raw(idx))
  }
  console.log('Migration complete: tables and indexes provisioned')
}
