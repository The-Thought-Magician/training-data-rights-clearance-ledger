# Build Plan — Training Data Rights Clearance Ledger (AUTHORITATIVE BUILD CONTRACT)

This is the single source of truth. Filenames, mount paths, api method names, and page files declared here are binding. Every api method is implemented by exactly one route endpoint and consumed by at least one page.

Stack: Hono 4.12.27 backend (Render) + Next.js 16 / React 19 / Tailwind 4 frontend (Vercel) + Neon Postgres + `@neondatabase/auth` 0.4.2-beta. Backend trusts `X-User-Id` via `getUserId(c)`; routes mount under `/api/v1` via a child Hono `api` router; every route file `export default router`. Frontend calls `fetch('/api/proxy/<path>')` 1:1 to `/api/v1/<path>`. `web/proxy.ts` only (no middleware.ts). All features free; Stripe optional (503 when unconfigured).

---

## (a) Tables (columns)

- **workspaces**: id, name, slug(unique), owner_id, default_required_checks(jsonb), settings(jsonb), created_at
- **members**: id, workspace_id→workspaces, user_id, email, name, role(admin|legal|ml-lead|dataops|viewer), created_at; UNIQUE(workspace_id,user_id)
- **data_sources**: id, workspace_id→workspaces, name, description, source_type, modality, origin_url, vendor, upstream_source_id, acquisition_method, acquisition_date, acquirer, justification, record_count, size_bytes, format, tags(jsonb), collection, status(draft|review|cleared|blocked|retired), risk_score(real), created_by, created_at, updated_at
- **provenance_events**: id, workspace_id, source_id→data_sources, event_type, description, related_source_id, occurred_at, recorded_by, metadata(jsonb), created_at
- **evidence_artifacts**: id, workspace_id, source_id→data_sources, entity_type, entity_id, kind, filename, content_type, size_bytes, sha256, storage_ref, uploaded_by, created_at
- **custody_handoffs**: id, workspace_id, source_id→data_sources, from_party, to_party, reason, occurred_at, recorded_by, created_at
- **licenses**: id, workspace_id, source_id→data_sources, license_name, license_type, permits_ai_training(bool), permits_commercial(bool), permits_derivatives(bool), requires_attribution(bool), share_alike(bool), territorial_restrictions, rights_holder_id, document_ref, effective_date, expiry_date, status, conflict_flags(jsonb), notes, created_by, created_at
- **license_templates**: id, workspace_id, name, license_type, permits_ai_training(bool), permits_commercial(bool), permits_derivatives(bool), requires_attribution(bool), share_alike(bool), description, created_by, created_at
- **copyright_screenings**: id, workspace_id, source_id→data_sources, status(not-started|in-progress|passed|flagged|failed), method, reviewer, flagged_works(jsonb), risk_score(real), remediation_action, remediation_owner, remediation_due, remediation_status, notes, screened_at, created_by, created_at
- **pii_screenings**: id, workspace_id, source_id→data_sources, status, method, reviewer, pii_categories(jsonb), lawful_basis, anonymization_status, anonymization_technique, remediation_action, remediation_owner, remediation_due, remediation_status, notes, screened_at, created_by, created_at
- **optouts**: id, workspace_id, source_id→data_sources, rights_holder_id, subject_identity, optout_type(individual|rights-holder), scope, channel, received_at, honor_status(pending|applied|rejected), rejection_reason, applied_at, notes, created_by, created_at
- **preference_signals**: id, workspace_id, source_id→data_sources, signal_type(robots.txt|ai.txt|tdm-reservation|noai|noimageai), directive(allow|disallow), captured_url, snapshot_ref, snapshot_sha256, captured_at, recheck_due, created_by, created_at
- **rights_holders**: id, workspace_id, name, holder_type(individual|publisher|vendor|collecting-society), contact_email, jurisdiction, notes, created_by, created_at
- **models**: id, workspace_id, name, description, purpose, created_by, created_at
- **model_versions**: id, workspace_id, model_id→models, version, base_model, training_type(train|fine-tune), training_date, manifest_hash, release_status(draft|ready|released|quarantined), released_at, released_by, created_by, created_at; UNIQUE(model_id,version)
- **lineage_bindings**: id, workspace_id, model_version_id→model_versions, source_id→data_sources, proportion(real), preprocessing, created_by, created_at; UNIQUE(model_version_id,source_id)
- **clearance_requirements**: id, workspace_id, key, label, description, is_required(bool), created_at; UNIQUE(workspace_id,key)
- **clearances**: id, workspace_id, source_id→data_sources, status(pending|cleared|blocked|overridden), unmet_requirements(jsonb), approver_id, approver_role, decision_rationale, is_override(bool), override_justification, decided_at, created_by, created_at; UNIQUE(source_id)
- **clearance_certificates**: id, workspace_id, source_id→data_sources, clearance_id→clearances, certificate_hash, issued_to, payload(jsonb), issued_by, created_at
- **claims**: id, workspace_id, claimant, rights_holder_id, claim_type(copyright|privacy|contract|takedown), description, severity(low|medium|high|critical), status(received|investigating|valid|invalid|remediating|resolved|escalated), source_id→data_sources, response_deadline, legal_hold(bool), resolution, resolved_at, created_by, created_at, updated_at
- **claim_impacts**: id, workspace_id, claim_id→claims, model_version_id→model_versions, impact(review|retrain|quarantine|re-release|none), resolved(bool), notes, created_at; UNIQUE(claim_id,model_version_id)
- **ledger_entries**: id, workspace_id, seq(int), entity_type, entity_id, action, payload(jsonb), actor_id, prev_hash, entry_hash, created_at; UNIQUE(workspace_id,seq)
- **approval_requests**: id, workspace_id, request_type(clearance|release|override|license), entity_type, entity_id, title, description, mode(sequential|parallel), status(pending|approved|rejected|changes-requested), requested_by, created_at, updated_at
- **approval_steps**: id, workspace_id, request_id→approval_requests, step_order(int), required_role, assigned_to, decision(pending|approve|reject|request-changes), comment, decided_by, decided_at, created_at
- **policies**: id, workspace_id, name, description, conditions(jsonb), action(block|flag|require-review), severity, is_active(bool), version(int), created_by, created_at
- **policy_violations**: id, workspace_id, policy_id→policies, source_id→data_sources, detail, resolved(bool), detected_at, created_at
- **risk_scores**: id, workspace_id, source_id→data_sources, license_risk(real), copyright_risk(real), pii_risk(real), optout_risk(real), composite_risk(real), computed_at, created_at; UNIQUE(source_id)
- **activity_log**: id, workspace_id, actor_id, entity_type, entity_id, action, detail, created_at
- **notifications**: id, workspace_id, user_id, kind, title, body, link, is_read(bool), created_at
- **tasks**: id, workspace_id, assigned_to, task_type(remediation|approval|review), entity_type, entity_id, title, description, due_date, status(open|in-progress|done), created_by, created_at
- **documentation_packs**: id, workspace_id, pack_type(gpai-summary|source-dossier|litigation-pack), subject_type(model_version|source), subject_id, title, content(jsonb), content_hash, generated_by, created_at
- **plans**: id('free'|'pro'), name, price_cents(int), created_at
- **subscriptions**: id, user_id(unique), plan_id→plans('free' default), stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (mount under `/api/v1`)

All write endpoints require auth (`authMiddleware`, `getUserId(c)`), validate with zod, and enforce workspace/ownership. Reads are public unless noted. Every consequential write also appends an `activity_log` row and (where noted) a `ledger_entries` row.

### 1. `workspaces.ts` → mount `/workspaces`
- `GET /` — auth — list workspaces the user belongs to — `Workspace[]`
- `GET /current` — auth — the user's active/first workspace with member role — `{ workspace, role }`
- `POST /` — auth — create workspace (creator becomes admin member, seeds default clearance_requirements) — `Workspace`
- `GET /:id` — auth — workspace detail — `Workspace`
- `PUT /:id` — auth (admin) — update name/slug/settings/default_required_checks — `Workspace`

### 2. `members.ts` → mount `/members`
- `GET /` — auth — list members of current workspace — `Member[]`
- `POST /` — auth (admin) — add member (user_id, email, name, role) — `Member`
- `PUT /:id` — auth (admin) — change role — `Member`
- `DELETE /:id` — auth (admin) — remove member — `{ success }`

### 3. `sources.ts` → mount `/sources`
- `GET /` — public — list sources (filter by status, source_type, collection, q) — `DataSource[]`
- `GET /:id` — public — source detail — `DataSource`
- `GET /:id/full` — public — aggregate: source + license + screenings + optouts + preference signals + clearance + lineage + risk — `{ source, license, copyright, pii, optouts, signals, clearance, lineage, risk }`
- `POST /` — auth — create source — `DataSource`
- `PUT /:id` — auth (owner) — update source — `DataSource`
- `DELETE /:id` — auth (owner) — delete source — `{ success }`
- `GET /:id/provenance` — public — provenance events for source — `ProvenanceEvent[]`
- `POST /:id/provenance` — auth — add provenance event — `ProvenanceEvent`
- `GET /:id/custody` — public — custody handoffs — `CustodyHandoff[]`
- `POST /:id/custody` — auth — add custody handoff — `CustodyHandoff`

### 4. `evidence.ts` → mount `/evidence`
- `GET /` — public — list evidence (filter by source_id, entity_type, entity_id) — `EvidenceArtifact[]`
- `POST /` — auth — register evidence artifact (filename, kind, sha256, content_type, size_bytes) — `EvidenceArtifact`
- `DELETE /:id` — auth (uploader) — remove — `{ success }`

### 5. `licenses.ts` → mount `/licenses`
- `GET /` — public — list licenses (filter source_id, status) — `License[]`
- `GET /conflicts` — public — licenses with conflict_flags non-empty, computed against parents — `License[]`
- `GET /expiring` — public — licenses expiring/expired (within N days) — `License[]`
- `GET /:id` — public — license detail — `License`
- `POST /` — auth — create license (auto-computes conflict_flags vs parent/derivatives) — `License`
- `PUT /:id` — auth (owner) — update license — `License`
- `DELETE /:id` — auth (owner) — delete — `{ success }`

### 6. `license-templates.ts` → mount `/license-templates`
- `GET /` — public — list templates — `LicenseTemplate[]`
- `POST /` — auth — create template — `LicenseTemplate`
- `DELETE /:id` — auth (owner) — delete — `{ success }`

### 7. `copyright-screenings.ts` → mount `/copyright-screenings`
- `GET /` — public — list (filter source_id, status) — `CopyrightScreening[]`
- `GET /:id` — public — detail — `CopyrightScreening`
- `POST /` — auth — create screening — `CopyrightScreening`
- `PUT /:id` — auth (owner) — update status/flagged_works/remediation — `CopyrightScreening`

### 8. `pii-screenings.ts` → mount `/pii-screenings`
- `GET /` — public — list (filter source_id, status) — `PiiScreening[]`
- `GET /:id` — public — detail — `PiiScreening`
- `POST /` — auth — create screening — `PiiScreening`
- `PUT /:id` — auth (owner) — update status/categories/lawful_basis/remediation — `PiiScreening`

### 9. `optouts.ts` → mount `/optouts`
- `GET /` — public — list (filter source_id, honor_status) — `Optout[]`
- `POST /` — auth — record opt-out — `Optout`
- `POST /:id/apply` — auth — mark applied (sets applied_at, ledger entry) — `Optout`
- `POST /:id/reject` — auth — reject with reason — `Optout`

### 10. `preference-signals.ts` → mount `/preference-signals`
- `GET /` — public — list (filter source_id) — `PreferenceSignal[]`
- `POST /` — auth — record captured signal (with snapshot sha256) — `PreferenceSignal`
- `DELETE /:id` — auth (owner) — delete — `{ success }`

### 11. `rights-holders.ts` → mount `/rights-holders`
- `GET /` — public — list rights-holders — `RightsHolder[]`
- `GET /:id` — public — holder + linked sources/licenses/optouts/claims — `{ holder, licenses, optouts, claims }`
- `POST /` — auth — create — `RightsHolder`
- `PUT /:id` — auth (owner) — update — `RightsHolder`
- `DELETE /:id` — auth (owner) — delete — `{ success }`

### 12. `models.ts` → mount `/models`
- `GET /` — public — list models — `Model[]`
- `GET /:id` — public — model detail + its versions — `{ model, versions }`
- `POST /` — auth — create model — `Model`
- `PUT /:id` — auth (owner) — update — `Model`
- `DELETE /:id` — auth (owner) — delete — `{ success }`

### 13. `model-versions.ts` → mount `/model-versions`
- `GET /` — public — list versions (filter model_id) — `ModelVersion[]`
- `GET /:id` — public — version + bound sources + readiness + impacts — `{ version, bindings, readiness, impacts }`
- `POST /` — auth — create version (computes manifest_hash from bindings) — `ModelVersion`
- `PUT /:id` — auth (owner) — update — `ModelVersion`
- `GET /:id/readiness` — public — release readiness report — `{ ready, blockers }`
- `POST /:id/release` — auth — sign off release (records released_by, ledger entry) — `ModelVersion`

### 14. `lineage.ts` → mount `/lineage`
- `GET /` — public — list bindings (filter model_version_id or source_id) — `LineageBinding[]`
- `GET /source/:sourceId/models` — public — reverse lookup: model versions a source touched — `ModelVersion[]`
- `POST /` — auth — bind source to model version — `LineageBinding`
- `DELETE /:id` — auth (owner) — unbind — `{ success }`

### 15. `clearance.ts` → mount `/clearance`
- `GET /requirements` — public — workspace clearance requirements — `ClearanceRequirement[]`
- `PUT /requirements` — auth (admin) — set required checks — `ClearanceRequirement[]`
- `GET /` — public — list clearances (filter status) — `Clearance[]`
- `GET /source/:sourceId` — public — clearance for a source — `Clearance`
- `POST /evaluate/:sourceId` — auth — evaluate gate; returns pass/fail + unmet requirements; upserts clearance — `{ status, unmet_requirements }`
- `POST /approve/:sourceId` — auth (legal) — approver sign-off → cleared, issues certificate (hash), ledger entry — `{ clearance, certificate }`
- `POST /override/:sourceId` — auth (admin) — override-block with justification, ledger entry — `Clearance`
- `GET /certificates` — public — list certificates (filter source_id) — `ClearanceCertificate[]`

### 16. `claims.ts` → mount `/claims`
- `GET /` — public — list claims (filter status, claim_type) — `Claim[]`
- `GET /:id` — public — claim + impacts + affected model versions (via lineage of source) — `{ claim, impacts, affectedVersions }`
- `POST /` — auth — intake claim (auto-derives claim_impacts from source lineage) — `Claim`
- `PUT /:id` — auth (owner) — update status/severity/legal_hold/resolution — `Claim`
- `POST /:id/impacts` — auth — add/update an impact row (model_version_id, impact) — `ClaimImpact`
- `PUT /:id/impacts/:impactId` — auth — resolve/update an impact — `ClaimImpact`

### 17. `ledger.ts` → mount `/ledger`
- `GET /` — public — list ledger entries (filter entity_type, entity_id) ordered by seq — `LedgerEntry[]`
- `GET /verify` — public — verify the hash chain is unbroken — `{ valid, brokenAt, count }`
- `GET /entity/:entityType/:entityId` — public — all entries for an entity — `LedgerEntry[]`

### 18. `approvals.ts` → mount `/approvals`
- `GET /` — public — list approval requests (filter status) — `ApprovalRequest[]`
- `GET /mine` — auth — requests with a step assigned to me and pending — `ApprovalRequest[]`
- `GET /:id` — public — request + steps — `{ request, steps }`
- `POST /` — auth — create approval request with steps — `ApprovalRequest`
- `POST /:id/decide` — auth — record a step decision (approve/reject/request-changes); advances request status — `{ request, steps }`

### 19. `policies.ts` → mount `/policies`
- `GET /` — public — list policies — `Policy[]`
- `POST /` — auth — create policy — `Policy`
- `PUT /:id` — auth (owner) — update / toggle active — `Policy`
- `DELETE /:id` — auth (owner) — delete — `{ success }`
- `POST /evaluate/:sourceId` — auth — evaluate source against active policies; writes policy_violations — `{ violations }`
- `GET /violations` — public — list violations (filter source_id, resolved) — `PolicyViolation[]`

### 20. `risk.ts` → mount `/risk`
- `GET /` — public — list risk scores — `RiskScore[]`
- `GET /source/:sourceId` — public — risk score for a source — `RiskScore`
- `POST /recompute/:sourceId` — auth — recompute composite risk from license/copyright/pii/optout signals; updates source.risk_score — `RiskScore`
- `GET /dashboard` — public — portfolio rollup: counts by status, top risks, blocked, expiring licenses — `{ statusCounts, topRisks, blocked, expiring }`

### 21. `activity.ts` → mount `/activity`
- `GET /` — public — activity feed (filter actor_id, entity_type, entity_id; paginated) — `ActivityLog[]`
- `GET /entity/:entityType/:entityId` — public — per-entity timeline — `ActivityLog[]`

### 22. `notifications.ts` → mount `/notifications`
- `GET /` — auth — current user's notifications — `Notification[]`
- `POST /:id/read` — auth — mark read — `Notification`
- `POST /read-all` — auth — mark all read — `{ success }`

### 23. `tasks.ts` → mount `/tasks`
- `GET /` — auth — current user's tasks (filter status) — `Task[]`
- `POST /` — auth — create task — `Task`
- `PUT /:id` — auth — update status/assignee — `Task`

### 24. `documentation-packs.ts` → mount `/documentation-packs`
- `GET /` — public — list packs (filter subject_type, subject_id) — `DocumentationPack[]`
- `GET /:id` — public — pack detail (rendered content) — `DocumentationPack`
- `POST /generate` — auth — generate a pack (pack_type, subject_type, subject_id); assembles content + content_hash — `DocumentationPack`

### 25. `reports.ts` → mount `/reports`
- `GET /clearance-throughput` — public — sources cleared per period, backlog, avg time-to-clear — `{ throughput, backlog, avgDays }`
- `GET /coverage` — public — % of model-bound sources fully cleared, per model — `{ overall, byModel }`
- `GET /claims-summary` — public — claim volume + resolution time by type/status — `{ byType, byStatus, avgResolutionDays }`

### 26. `seed.ts` → mount `/seed`
- `POST /demo` — auth — provision a realistic demo workspace (sources, licenses, screenings, optouts, models, versions, lineage, claims, ledger) for the current user — `{ workspaceId, counts }`
- `POST /reset` — auth — clear the current user's demo workspace data — `{ success }`

### 27. `billing.ts` → mount `/billing`
- `GET /plan` — auth — current subscription + plan + stripeEnabled — `{ subscription, plan, stripeEnabled }`
- `POST /checkout` — auth — Stripe checkout session or 503 — `{ url }`
- `POST /portal` — auth — Stripe billing portal or 503 — `{ url }`
- `POST /webhook` — public (Stripe-signed) — handle subscription events or 503 — `{ received }`

Index.ts mounts all 27 under `/api/v1` via the child `api` Hono router; `GET /health` at root. `index.ts` calls `migrate()` then `seedIfEmpty()` (seeds plans free/pro) before `serve()`.

---

## (c) `web/lib/api.ts` methods (method → relative path → verb)

Workspace/members:
- `listWorkspaces()` → `/api/proxy/workspaces` GET
- `getCurrentWorkspace()` → `/api/proxy/workspaces/current` GET
- `createWorkspace(body)` → `/api/proxy/workspaces` POST
- `getWorkspace(id)` → `/api/proxy/workspaces/${id}` GET
- `updateWorkspace(id, body)` → `/api/proxy/workspaces/${id}` PUT
- `listMembers()` → `/api/proxy/members` GET
- `addMember(body)` → `/api/proxy/members` POST
- `updateMember(id, body)` → `/api/proxy/members/${id}` PUT
- `removeMember(id)` → `/api/proxy/members/${id}` DELETE

Sources:
- `listSources(params?)` → `/api/proxy/sources` GET
- `getSource(id)` → `/api/proxy/sources/${id}` GET
- `getSourceFull(id)` → `/api/proxy/sources/${id}/full` GET
- `createSource(body)` → `/api/proxy/sources` POST
- `updateSource(id, body)` → `/api/proxy/sources/${id}` PUT
- `deleteSource(id)` → `/api/proxy/sources/${id}` DELETE
- `getProvenance(id)` → `/api/proxy/sources/${id}/provenance` GET
- `addProvenance(id, body)` → `/api/proxy/sources/${id}/provenance` POST
- `getCustody(id)` → `/api/proxy/sources/${id}/custody` GET
- `addCustody(id, body)` → `/api/proxy/sources/${id}/custody` POST

Evidence:
- `listEvidence(params?)` → `/api/proxy/evidence` GET
- `addEvidence(body)` → `/api/proxy/evidence` POST
- `deleteEvidence(id)` → `/api/proxy/evidence/${id}` DELETE

Licenses:
- `listLicenses(params?)` → `/api/proxy/licenses` GET
- `getLicenseConflicts()` → `/api/proxy/licenses/conflicts` GET
- `getExpiringLicenses()` → `/api/proxy/licenses/expiring` GET
- `getLicense(id)` → `/api/proxy/licenses/${id}` GET
- `createLicense(body)` → `/api/proxy/licenses` POST
- `updateLicense(id, body)` → `/api/proxy/licenses/${id}` PUT
- `deleteLicense(id)` → `/api/proxy/licenses/${id}` DELETE
- `listLicenseTemplates()` → `/api/proxy/license-templates` GET
- `createLicenseTemplate(body)` → `/api/proxy/license-templates` POST
- `deleteLicenseTemplate(id)` → `/api/proxy/license-templates/${id}` DELETE

Copyright screening:
- `listCopyrightScreenings(params?)` → `/api/proxy/copyright-screenings` GET
- `getCopyrightScreening(id)` → `/api/proxy/copyright-screenings/${id}` GET
- `createCopyrightScreening(body)` → `/api/proxy/copyright-screenings` POST
- `updateCopyrightScreening(id, body)` → `/api/proxy/copyright-screenings/${id}` PUT

PII screening:
- `listPiiScreenings(params?)` → `/api/proxy/pii-screenings` GET
- `getPiiScreening(id)` → `/api/proxy/pii-screenings/${id}` GET
- `createPiiScreening(body)` → `/api/proxy/pii-screenings` POST
- `updatePiiScreening(id, body)` → `/api/proxy/pii-screenings/${id}` PUT

Opt-outs & signals:
- `listOptouts(params?)` → `/api/proxy/optouts` GET
- `createOptout(body)` → `/api/proxy/optouts` POST
- `applyOptout(id)` → `/api/proxy/optouts/${id}/apply` POST
- `rejectOptout(id, body)` → `/api/proxy/optouts/${id}/reject` POST
- `listPreferenceSignals(params?)` → `/api/proxy/preference-signals` GET
- `createPreferenceSignal(body)` → `/api/proxy/preference-signals` POST
- `deletePreferenceSignal(id)` → `/api/proxy/preference-signals/${id}` DELETE

Rights-holders:
- `listRightsHolders()` → `/api/proxy/rights-holders` GET
- `getRightsHolder(id)` → `/api/proxy/rights-holders/${id}` GET
- `createRightsHolder(body)` → `/api/proxy/rights-holders` POST
- `updateRightsHolder(id, body)` → `/api/proxy/rights-holders/${id}` PUT
- `deleteRightsHolder(id)` → `/api/proxy/rights-holders/${id}` DELETE

Models & versions:
- `listModels()` → `/api/proxy/models` GET
- `getModel(id)` → `/api/proxy/models/${id}` GET
- `createModel(body)` → `/api/proxy/models` POST
- `updateModel(id, body)` → `/api/proxy/models/${id}` PUT
- `deleteModel(id)` → `/api/proxy/models/${id}` DELETE
- `listModelVersions(params?)` → `/api/proxy/model-versions` GET
- `getModelVersion(id)` → `/api/proxy/model-versions/${id}` GET
- `createModelVersion(body)` → `/api/proxy/model-versions` POST
- `updateModelVersion(id, body)` → `/api/proxy/model-versions/${id}` PUT
- `getReadiness(id)` → `/api/proxy/model-versions/${id}/readiness` GET
- `releaseModelVersion(id, body)` → `/api/proxy/model-versions/${id}/release` POST

Lineage:
- `listLineage(params?)` → `/api/proxy/lineage` GET
- `getSourceModels(sourceId)` → `/api/proxy/lineage/source/${sourceId}/models` GET
- `createLineageBinding(body)` → `/api/proxy/lineage` POST
- `deleteLineageBinding(id)` → `/api/proxy/lineage/${id}` DELETE

Clearance:
- `getClearanceRequirements()` → `/api/proxy/clearance/requirements` GET
- `setClearanceRequirements(body)` → `/api/proxy/clearance/requirements` PUT
- `listClearances(params?)` → `/api/proxy/clearance` GET
- `getSourceClearance(sourceId)` → `/api/proxy/clearance/source/${sourceId}` GET
- `evaluateClearance(sourceId)` → `/api/proxy/clearance/evaluate/${sourceId}` POST
- `approveClearance(sourceId, body)` → `/api/proxy/clearance/approve/${sourceId}` POST
- `overrideClearance(sourceId, body)` → `/api/proxy/clearance/override/${sourceId}` POST
- `listCertificates(params?)` → `/api/proxy/clearance/certificates` GET

Claims:
- `listClaims(params?)` → `/api/proxy/claims` GET
- `getClaim(id)` → `/api/proxy/claims/${id}` GET
- `createClaim(body)` → `/api/proxy/claims` POST
- `updateClaim(id, body)` → `/api/proxy/claims/${id}` PUT
- `addClaimImpact(id, body)` → `/api/proxy/claims/${id}/impacts` POST
- `updateClaimImpact(id, impactId, body)` → `/api/proxy/claims/${id}/impacts/${impactId}` PUT

Ledger:
- `listLedger(params?)` → `/api/proxy/ledger` GET
- `verifyLedger()` → `/api/proxy/ledger/verify` GET
- `getEntityLedger(entityType, entityId)` → `/api/proxy/ledger/entity/${entityType}/${entityId}` GET

Approvals:
- `listApprovals(params?)` → `/api/proxy/approvals` GET
- `getMyApprovals()` → `/api/proxy/approvals/mine` GET
- `getApproval(id)` → `/api/proxy/approvals/${id}` GET
- `createApproval(body)` → `/api/proxy/approvals` POST
- `decideApproval(id, body)` → `/api/proxy/approvals/${id}/decide` POST

Policies:
- `listPolicies()` → `/api/proxy/policies` GET
- `createPolicy(body)` → `/api/proxy/policies` POST
- `updatePolicy(id, body)` → `/api/proxy/policies/${id}` PUT
- `deletePolicy(id)` → `/api/proxy/policies/${id}` DELETE
- `evaluatePolicies(sourceId)` → `/api/proxy/policies/evaluate/${sourceId}` POST
- `listPolicyViolations(params?)` → `/api/proxy/policies/violations` GET

Risk:
- `listRiskScores()` → `/api/proxy/risk` GET
- `getSourceRisk(sourceId)` → `/api/proxy/risk/source/${sourceId}` GET
- `recomputeRisk(sourceId)` → `/api/proxy/risk/recompute/${sourceId}` POST
- `getRiskDashboard()` → `/api/proxy/risk/dashboard` GET

Activity:
- `listActivity(params?)` → `/api/proxy/activity` GET
- `getEntityActivity(entityType, entityId)` → `/api/proxy/activity/entity/${entityType}/${entityId}` GET

Notifications & tasks:
- `listNotifications()` → `/api/proxy/notifications` GET
- `markNotificationRead(id)` → `/api/proxy/notifications/${id}/read` POST
- `markAllNotificationsRead()` → `/api/proxy/notifications/read-all` POST
- `listTasks(params?)` → `/api/proxy/tasks` GET
- `createTask(body)` → `/api/proxy/tasks` POST
- `updateTask(id, body)` → `/api/proxy/tasks/${id}` PUT

Documentation packs:
- `listDocumentationPacks(params?)` → `/api/proxy/documentation-packs` GET
- `getDocumentationPack(id)` → `/api/proxy/documentation-packs/${id}` GET
- `generateDocumentationPack(body)` → `/api/proxy/documentation-packs/generate` POST

Reports:
- `getClearanceThroughput()` → `/api/proxy/reports/clearance-throughput` GET
- `getCoverage()` → `/api/proxy/reports/coverage` GET
- `getClaimsSummary()` → `/api/proxy/reports/claims-summary` GET

Seed:
- `seedDemo()` → `/api/proxy/seed/demo` POST
- `resetDemo()` → `/api/proxy/seed/reset` POST

Billing:
- `getBillingPlan()` → `/api/proxy/billing/plan` GET
- `startCheckout()` → `/api/proxy/billing/checkout` POST
- `openPortal()` → `/api/proxy/billing/portal` POST

---

## (d) Pages (URL → file → kind → api methods → renders)

Public:
1. `/` → `web/app/page.tsx` — public — none (static) — landing: hero, feature grid, CTAs to sign-up
2. `/auth/sign-in` → `web/app/auth/sign-in/page.tsx` — public — authClient.signIn — sign-in form
3. `/auth/sign-up` → `web/app/auth/sign-up/page.tsx` — public — authClient.signUp — sign-up form
4. `/pricing` → `web/app/pricing/page.tsx` — public — getBillingPlan — Free/Pro plan cards (static-ish, plan via api after mount)

Dashboard (wrapped by `web/app/dashboard/layout.tsx` → `DashboardLayout`):
5. `/dashboard` → `web/app/dashboard/page.tsx` — dashboard — getRiskDashboard, getClearanceThroughput, listNotifications, getCurrentWorkspace — KPI cards (sources by status, blocked, expiring licenses, open claims), risk summary, recent activity
6. `/dashboard/sources` → `web/app/dashboard/sources/page.tsx` — dashboard — listSources — filterable source register table with status/risk badges
7. `/dashboard/sources/new` → `web/app/dashboard/sources/new/page.tsx` — dashboard — createSource, listLicenseTemplates — new-source form
8. `/dashboard/sources/[id]` → `web/app/dashboard/sources/[id]/page.tsx` — dashboard — getSourceFull, updateSource, getProvenance, addProvenance, getCustody, addCustody, createLicense, createCopyrightScreening, createPiiScreening, listPreferenceSignals, createPreferenceSignal, evaluateClearance, getEntityLedger, recomputeRisk — full source detail with tabs (overview, provenance, license, screenings, opt-outs/signals, lineage, clearance, ledger)
9. `/dashboard/licenses` → `web/app/dashboard/licenses/page.tsx` — dashboard — listLicenses, getLicenseConflicts, getExpiringLicenses, createLicense, updateLicense, deleteLicense — license tracker with conflicts and expiry tabs
10. `/dashboard/license-templates` → `web/app/dashboard/license-templates/page.tsx` — dashboard — listLicenseTemplates, createLicenseTemplate, deleteLicenseTemplate — template library
11. `/dashboard/copyright` → `web/app/dashboard/copyright/page.tsx` — dashboard — listCopyrightScreenings, createCopyrightScreening, updateCopyrightScreening, listSources — copyright screening queue with status updates
12. `/dashboard/pii` → `web/app/dashboard/pii/page.tsx` — dashboard — listPiiScreenings, createPiiScreening, updatePiiScreening, listSources — PII screening queue
13. `/dashboard/optouts` → `web/app/dashboard/optouts/page.tsx` — dashboard — listOptouts, createOptout, applyOptout, rejectOptout, listPreferenceSignals, createPreferenceSignal, listSources — opt-out register + preference signals
14. `/dashboard/rights-holders` → `web/app/dashboard/rights-holders/page.tsx` — dashboard — listRightsHolders, getRightsHolder, createRightsHolder, updateRightsHolder, deleteRightsHolder — rights-holder registry with linked-items drawer
15. `/dashboard/models` → `web/app/dashboard/models/page.tsx` — dashboard — listModels, createModel, listModelVersions, createModelVersion — models and versions list
16. `/dashboard/models/[id]` → `web/app/dashboard/models/[id]/page.tsx` — dashboard — getModelVersion, getReadiness, listLineage, createLineageBinding, deleteLineageBinding, listSources, releaseModelVersion, getEntityLedger — model version lineage editor + release readiness
17. `/dashboard/clearance` → `web/app/dashboard/clearance/page.tsx` — dashboard — listClearances, getClearanceRequirements, setClearanceRequirements, evaluateClearance, approveClearance, overrideClearance, listCertificates, listSources — clearance gate console
18. `/dashboard/claims` → `web/app/dashboard/claims/page.tsx` — dashboard — listClaims, createClaim, listSources — takedown/dispute board
19. `/dashboard/claims/[id]` → `web/app/dashboard/claims/[id]/page.tsx` — dashboard — getClaim, updateClaim, addClaimImpact, updateClaimImpact — claim detail with impact assessment and affected model versions
20. `/dashboard/approvals` → `web/app/dashboard/approvals/page.tsx` — dashboard — listApprovals, getMyApprovals, getApproval, createApproval, decideApproval — approval queue + my-pending
21. `/dashboard/policies` → `web/app/dashboard/policies/page.tsx` — dashboard — listPolicies, createPolicy, updatePolicy, deletePolicy, evaluatePolicies, listPolicyViolations, listSources — policy engine editor + violations
22. `/dashboard/ledger` → `web/app/dashboard/ledger/page.tsx` — dashboard — listLedger, verifyLedger — evidence ledger with chain-verify banner
23. `/dashboard/risk` → `web/app/dashboard/risk/page.tsx` — dashboard — getRiskDashboard, listRiskScores, recomputeRisk — portfolio risk dashboard
24. `/dashboard/activity` → `web/app/dashboard/activity/page.tsx` — dashboard — listActivity — audit trail feed
25. `/dashboard/documentation` → `web/app/dashboard/documentation/page.tsx` — dashboard — listDocumentationPacks, getDocumentationPack, generateDocumentationPack, listModelVersions, listSources — documentation packs generator + viewer
26. `/dashboard/reports` → `web/app/dashboard/reports/page.tsx` — dashboard — getClearanceThroughput, getCoverage, getClaimsSummary — reports & analytics
27. `/dashboard/notifications` → `web/app/dashboard/notifications/page.tsx` — dashboard — listNotifications, markNotificationRead, markAllNotificationsRead, listTasks, createTask, updateTask — notifications + task list
28. `/dashboard/settings` → `web/app/dashboard/settings/page.tsx` — dashboard — getCurrentWorkspace, updateWorkspace, listMembers, addMember, updateMember, removeMember, getClearanceRequirements, setClearanceRequirements, getBillingPlan, startCheckout, openPortal, seedDemo, resetDemo — workspace/team/clearance-config/billing/demo-data

Route handlers (not pages): `web/app/api/auth/[...path]/route.ts`, `web/app/api/proxy/[...path]/route.ts`.

---

## (e) DashboardLayout sidebar nav sections

`web/components/DashboardLayout.tsx` — `'use client'`, `<aside>` with sectioned NavLinks, active via `usePathname()`, mobile drawer, sign-out via `authClient`.

- **Overview**: Dashboard (`/dashboard`), Risk (`/dashboard/risk`), Reports (`/dashboard/reports`)
- **Data Sources**: Sources (`/dashboard/sources`), Rights Holders (`/dashboard/rights-holders`)
- **Rights & Licensing**: Licenses (`/dashboard/licenses`), License Templates (`/dashboard/license-templates`), Opt-Outs (`/dashboard/optouts`)
- **Screening**: Copyright (`/dashboard/copyright`), PII (`/dashboard/pii`)
- **Clearance**: Clearance Gate (`/dashboard/clearance`), Policies (`/dashboard/policies`), Approvals (`/dashboard/approvals`)
- **Models**: Models (`/dashboard/models`)
- **Claims**: Claims & Disputes (`/dashboard/claims`)
- **Evidence**: Ledger (`/dashboard/ledger`), Activity (`/dashboard/activity`), Documentation (`/dashboard/documentation`)
- **Account**: Notifications (`/dashboard/notifications`), Settings (`/dashboard/settings`)

Detail pages (`/dashboard/sources/[id]`, `/dashboard/sources/new`, `/dashboard/models/[id]`, `/dashboard/claims/[id]`) are reached by navigation from their list pages and are not separate nav items.
