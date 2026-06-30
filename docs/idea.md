# Training Data Rights Clearance Ledger

## Overview

Training Data Rights Clearance Ledger (TDRCL) is a governance system of record that lets a company prove every dataset feeding its AI models is legally cleared for AI use. It tracks the provenance of each data source, the license terms governing it, copyright and PII screening status, rights-holder opt-outs and AI-preference signals, and the exact binding between each model version and the cleared datasets that trained it. It enforces a rights-clearance gate that blocks any dataset from being used until all required checks pass and a named approver signs off, and it runs a takedown/dispute workflow so that when a rights-holder files a claim, the company can immediately see which models are affected and respond.

The product is built for legal defensibility. Every clearance decision, screening result, approval, and change is captured in an immutable, hash-chained evidence ledger so that, in litigation or an EU AI Act audit, the company can produce a tamper-evident chain of custody for its training data.

## Problem

AI-copyright litigation (authors, artists, news publishers, music labels suing model trainers) and the EU AI Act's general-purpose AI (GPAI) documentation duties have made "prove every dataset is cleared for AI use" a board-level concern. But the information needed to answer that question lives nowhere coherent: license PDFs in a shared drive, data-acquisition emails in inboxes, scraping scripts in Git, robots.txt snapshots nobody saved, opt-out requests in a support queue, and model-training manifests in MLOps tools that never reference the legal status of their inputs. When a demand letter or audit arrives, legal teams scramble for weeks to reconstruct what data trained which model and whether the company had the right to use it. The downside (court judgments, statutory damages, regulatory fines, forced model retraining, injunctions) dwarfs the cost of any tool, and the pain recurs with every new dataset and every model version.

## Target Users

- General Counsel and legal/compliance teams who must certify AI-training-data rights and respond to demand letters and audits.
- Heads of AI/ML who own model release decisions and need a gate that prevents legally tainted data from entering training.
- DataOps and ML-governance leads who maintain the dataset inventory, run screening, and operate the day-to-day clearance workflow.
- Risk and audit functions who need tamper-evident evidence and exportable documentation packs.

## Buyer

GC, Head of AI/ML, or ML-governance lead at a company that trains or fine-tunes its own models, holding legal/compliance budget and AI-risk sign-off authority. Demand is triggered by AI-copyright suits, rights-holder demand letters, takedown notices, and EU AI Act GPAI documentation obligations. Willingness to pay is high because the downside is existential and the pain recurs with every dataset and model version.

## Why this is NOT an existing project

TDRCL governs the **legal right to use data for AI training**. That is distinct from each of its near-neighbors:

- **license-compliance-scanner** scans open-source code dependencies (SPDX, package manifests) for OSS license obligations. It is about code licenses, not the rights to use *data* to *train models*. TDRCL tracks dataset licenses, AI-training permission specifically, copyright/PII status, opt-outs, and model lineage, none of which a code-license scanner addresses.
- **pii-discovery** scans databases and files to find personal data. It answers "where is PII," not "are we legally cleared to train on this dataset." TDRCL consumes PII-screening status as one input among many (license, copyright, opt-out) into a clearance decision and an approval gate, and binds that to model versions.
- **data-lineage-tracker** traces column-level data flow through pipelines (which table feeds which dashboard). It is about *technical* lineage of values, not *legal* lineage of rights. TDRCL traces the rights-and-clearance lineage from a source's acquisition through its license and screening to the model versions it trained.
- **transitive-trust-tracer** (nearest base) traces dependency authorship/trust transitively. TDRCL is a rights/clearance ledger for training data, not a dependency trust graph.
- **model-card-attestation-registry** (nearest sibling) *publishes* transparency cards about models for external consumption. TDRCL faces the other direction: it *gates and proves* the training-data rights that would feed such a card, for internal legal defense. The model-card registry asks "what do we tell the public about this model"; TDRCL asks "can we legally defend having trained this model on this data, and can we prove it."

No existing project combines a dataset source register, an AI-training-specific license tracker, copyright/PII screening status, an opt-out/AI-preference register, per-model rights lineage, an approval-gated clearance workflow, a takedown/dispute workflow, and a tamper-evident evidence ledger into one legal-defense-oriented system of record.

## Major Features

### 1. Dataset Source Register
The canonical inventory of every data source feeding any model.
- Register a source with name, description, type (web-scrape, licensed corpus, purchased dataset, user-generated, synthetic, public-domain, internal).
- Capture origin: original URL/domain, vendor, repository, or upstream dataset.
- Acquisition method and date: scraped, downloaded, purchased, licensed, generated, contributed.
- Record acquirer (who obtained it) and the business justification.
- Source size, format, record count, and content modality (text, image, audio, video, code, tabular).
- Tag sources, group into collections, and search/filter by any attribute.
- Source status lifecycle: draft, under review, cleared, blocked, retired.

### 2. Provenance Record & Chain of Custody
A documented, evidence-backed history for each source.
- Provenance events: acquired-from, transformed, merged, split, derived-from, re-licensed.
- Upstream/downstream links between sources (derived datasets reference their parents).
- Attach evidence artifacts (contracts, invoices, robots.txt snapshots, screenshots, email exports) with file metadata and SHA-256 hashes.
- Custody handoffs recording who held the data when.
- Full provenance graph view from raw acquisition to training-ready dataset.

### 3. License Tracker
The legal terms governing each source and whether they permit AI training.
- Record license name/type (CC-BY, CC-BY-NC, proprietary EULA, public domain, custom contract, none/unknown).
- Explicit flags: permits AI training? permits commercial use? permits derivative works? requires attribution? has share-alike? territorial restrictions? time-limited?
- License source document upload and effective/expiry dates.
- Conflict detection: flags sources whose license forbids AI training or commercial use, or where derived datasets violate a parent's share-alike/NC terms.
- License templates library for common licenses with pre-filled permission flags.
- Per-source license history (renewals, renegotiations, terminations).

### 4. Copyright Screening
Tracking whether a source contains third-party copyrighted material.
- Screening status per source: not started, in progress, passed, flagged, failed.
- Record screening method (manual review, automated detection, vendor report) and reviewer.
- Flag specific copyrighted works or rights-holders detected.
- Remediation tracking: required action, owner, due date, resolution.
- Risk scoring for copyright exposure per source.

### 5. PII Screening
Tracking personal-data presence and lawful basis.
- PII screening status, method, and reviewer per source.
- PII categories detected (names, emails, biometric, health, financial, location, special-category).
- Lawful basis recorded (consent, legitimate interest, contract, not applicable).
- Anonymization/pseudonymization status and technique.
- Remediation tracking for PII findings.

### 6. Opt-Out & AI-Preference Register
Honoring rights-holder and individual opt-out signals.
- Record robots.txt / ai.txt / TDM-Reservation / noai signals captured at acquisition time, with snapshot evidence.
- Individual and rights-holder opt-out requests with subject identity, scope, channel, and date received.
- Match opt-outs to affected sources and records.
- Honor status: pending, applied (records removed/excluded), rejected with reason.
- Re-crawl/re-check scheduling for preference signals.

### 7. Per-Model Lineage Binding
Binding each model version to the exact cleared datasets that trained it.
- Register models and model versions (name, version, base model, training date, purpose).
- Bind a model version to the specific source versions/snapshots used in training/fine-tuning.
- Capture the dataset composition (which sources, what proportion/weights, preprocessing).
- Immutable training manifest per model version with a content hash.
- Reverse lookup: given a source, list every model version it touched.

### 8. Rights-Clearance Gate
An approval gate that blocks dataset use until checks pass.
- Define clearance requirements (license-OK, copyright-passed, PII-passed, opt-outs-applied, approver-signed).
- A source cannot be marked "cleared for training" until all required checks pass.
- Named-approver sign-off with role, decision, rationale, and timestamp.
- Gate evaluation API that returns pass/fail with the list of unmet requirements.
- Block reasons surfaced to requesters; override path with elevated approval and justification.
- Clearance certificates (signed, hashed) issued on pass.

### 9. Takedown / Dispute Workflow
Tracking rights-holder claims and the models they affect.
- Intake a claim/dispute (claimant, type: copyright, privacy, contract, takedown; description; evidence).
- Link the claim to the affected sources and, via lineage, the affected model versions.
- Workflow states: received, investigating, valid, invalid, remediating, resolved, escalated.
- Impact assessment: which models must be retrained, quarantined, or re-released.
- Response tracking (response letters, deadlines, legal hold).
- Resolution record with outcome and actions taken.

### 10. Evidence Ledger (Tamper-Evident)
An append-only, hash-chained record of every consequential action.
- Every clearance decision, screening result, approval, license change, opt-out application, and lineage binding is written as a ledger entry.
- Each entry carries a SHA-256 hash of its payload plus the previous entry's hash (hash chain).
- Ledger verification endpoint that confirms the chain is unbroken.
- Per-entity ledger view (all events for a source/model/claim).
- Entries are immutable; corrections are new entries, never edits.

### 11. Approval Workflows & Roles
Configurable multi-step approvals.
- Approval requests with type, subject entity, requested-by, assigned approver(s).
- Sequential or parallel approval steps with required roles.
- Decision capture (approve/reject/request-changes) with comments.
- Pending-approvals queue per user.
- Delegation and reassignment.

### 12. Policy Engine & Rules
Configurable clearance policies.
- Define policy rules (e.g., "block any source whose license forbids AI training," "require PII review for any source with personal data," "require legal sign-off for licensed corpora").
- Rule conditions over source attributes, license flags, and screening status.
- Evaluate a source against all active policies and produce violations.
- Enable/disable and version policies.

### 13. Risk Scoring & Dashboard
Quantified rights risk across the portfolio.
- Per-source composite risk score from license, copyright, PII, and opt-out signals.
- Portfolio risk dashboard: counts by status, top risks, blocked sources, expiring licenses.
- Per-model rollup risk (max/aggregate risk of its bound sources).
- Trend over time.

### 14. Audit Trail & Activity Log
Human-readable history complementing the ledger.
- Chronological activity feed across all entities, filterable by actor, entity, and action.
- Per-entity activity timelines.
- Exportable audit log.

### 15. Compliance Documentation Packs
Audit-ready export bundles.
- Generate an EU AI Act GPAI-style training-data summary for a model version.
- Export a clearance dossier for a source (register entry, license, screenings, opt-outs, ledger, approvals).
- Export a litigation pack for a model version (full lineage, all bound sources' dossiers, ledger proofs).
- Downloadable as structured JSON / printable HTML.

### 16. Data Source Connectors & Import
Bring sources in at scale.
- Bulk CSV/JSON import of source inventories.
- Manifest import for model training runs (sources + weights).
- Sample-data seeder that provisions a realistic demo org (sources, licenses, screenings, models, claims) for demoability.

### 17. License Conflict & Expiry Monitoring
Proactive license risk.
- Detect license conflicts between a derived source and its parents (NC, share-alike, attribution).
- Track license effective and expiry dates; flag expiring/expired licenses.
- Alert on sources used in active models whose license has lapsed.

### 18. Rights-Holder Registry
Track the entities that hold rights.
- Register rights-holders (individuals, publishers, vendors, collecting societies) with contact and jurisdiction.
- Link rights-holders to sources, licenses, opt-outs, and claims.
- Rights-holder view: everything we hold from or owe to them.

### 19. Model Release Readiness
Pre-release gating for models.
- Compute release readiness for a model version: are all bound sources cleared, all approvals signed, no open high-severity claims?
- Readiness report with blockers.
- Release sign-off record with approver.

### 20. Notifications & Tasks
Operational follow-through.
- Notifications for pending approvals, expiring licenses, new claims, failed screenings, and applied opt-outs.
- Per-user task list of assigned remediations and approvals.
- Mark-read and resolve.

### 21. Reports & Analytics
Management reporting.
- Clearance throughput (sources cleared per period), backlog, average time-to-clear.
- Coverage report (percentage of model-bound sources fully cleared).
- Claim/dispute volume and resolution time.

### 22. Settings, Workspace & Team
Organization configuration.
- Workspace profile, default policies, required clearance checks.
- Team/members with roles (admin, legal, ml-lead, dataops, viewer).
- License template management.
- Billing plan view.

## Data Model (tables)

- workspaces
- members
- data_sources
- provenance_events
- evidence_artifacts
- custody_handoffs
- licenses
- license_templates
- copyright_screenings
- pii_screenings
- optouts
- preference_signals
- rights_holders
- models
- model_versions
- lineage_bindings
- clearance_requirements
- clearances
- clearance_certificates
- claims
- claim_impacts
- ledger_entries
- approval_requests
- approval_steps
- policies
- policy_violations
- risk_scores
- activity_log
- notifications
- tasks
- documentation_packs
- plans
- subscriptions

## API Surface (mounts under /api/v1)

- /workspaces, /members
- /sources (data source register), /sources/:id/provenance, /sources/:id/custody
- /evidence
- /licenses, /license-templates
- /copyright-screenings, /pii-screenings
- /optouts, /preference-signals
- /rights-holders
- /models, /model-versions, /lineage
- /clearance (requirements, evaluate, certificates)
- /claims
- /ledger (entries, verify)
- /approvals
- /policies
- /risk
- /activity
- /notifications, /tasks
- /documentation-packs
- /reports
- /seed
- /billing

## Frontend Pages (~24)

Public:
1. `/` — landing (static marketing)
2. `/auth/sign-in`
3. `/auth/sign-up`
4. `/pricing`

Dashboard:
5. `/dashboard` — overview KPIs and risk summary
6. `/dashboard/sources` — source register list
7. `/dashboard/sources/[id]` — source detail (provenance, license, screenings, optouts, lineage, ledger)
8. `/dashboard/sources/new` — register source
9. `/dashboard/licenses` — license tracker + conflicts/expiry
10. `/dashboard/license-templates` — template library
11. `/dashboard/copyright` — copyright screening queue
12. `/dashboard/pii` — PII screening queue
13. `/dashboard/optouts` — opt-out & preference register
14. `/dashboard/rights-holders` — rights-holder registry
15. `/dashboard/models` — models & versions
16. `/dashboard/models/[id]` — model version lineage + release readiness
17. `/dashboard/clearance` — clearance gate / evaluate
18. `/dashboard/claims` — takedown/dispute workflow
19. `/dashboard/claims/[id]` — claim detail + impact
20. `/dashboard/approvals` — approval queue
21. `/dashboard/policies` — policy engine
22. `/dashboard/ledger` — evidence ledger + verify
23. `/dashboard/risk` — risk dashboard
24. `/dashboard/activity` — audit trail
25. `/dashboard/documentation` — documentation packs
26. `/dashboard/reports` — reports & analytics
27. `/dashboard/notifications` — notifications & tasks
28. `/dashboard/settings` — workspace/team/billing
