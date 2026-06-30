# Training Data Rights Clearance Ledger

Training Data Rights Clearance Ledger (TDRCL) is a governance system of record that lets a company prove every dataset feeding its AI models is legally cleared for AI use. It tracks the provenance of each data source, the license terms governing it, copyright and PII screening status, rights-holder opt-outs and AI-preference signals, and the exact binding between each model version and the cleared datasets that trained it.

TDRCL enforces a rights-clearance gate that blocks any dataset from being used until all required checks pass and a named approver signs off, and it runs a takedown/dispute workflow so that when a rights-holder files a claim, the company can immediately see which models are affected and respond. Every consequential action is written to an append-only, hash-chained evidence ledger so the company can produce a tamper-evident chain of custody for its training data in litigation or an EU AI Act audit.

See `docs/idea.md` for the full product specification.

## Features

- Dataset Source Register, the canonical inventory of every source feeding any model.
- Provenance Record and Chain of Custody with evidence artifacts and SHA-256 hashes.
- License Tracker covering AI-training, commercial, derivative, attribution, and share-alike terms, with conflict detection.
- Copyright Screening with status, method, flagged works, remediation, and risk scoring.
- PII Screening with categories, lawful basis, anonymization status, and remediation.
- Opt-Out and AI-Preference Register for robots.txt, ai.txt, TDM-Reservation, noai signals, and individual opt-out requests.
- Per-Model Lineage Binding tying each model version to the exact cleared source snapshots that trained it, with immutable hashed manifests.
- Rights-Clearance Gate that blocks dataset use until checks pass and a named approver signs off, issuing signed clearance certificates.
- Takedown / Dispute Workflow linking claims to affected sources and model versions.
- Evidence Ledger, an append-only hash-chained record with a verification endpoint.

## Stack

- **Backend:** Hono (Node) + drizzle-orm over Neon Postgres (`@neondatabase/serverless`). TypeScript, run with `tsx`. Mounts under `/api/v1`, health at `/health`.
- **Frontend:** Next.js 16 (App Router) + React 19 + Tailwind 4, TypeScript strict.
- **Auth:** Neon Auth (`@neondatabase/auth`). The frontend resolves the session server-side and proxies API calls through `/api/proxy/*`, injecting an `X-User-Id` header the backend trusts.
- **Package manager:** pnpm.

## Local Development

Prerequisites: Node 22+, pnpm, and a Neon Postgres database (or any Postgres). The app does not create its own tables; provision the schema out-of-band (drizzle-kit push or the Neon console) before first boot.

### Backend

```bash
cd backend
pnpm install
cp .env.example .env   # then fill in DATABASE_URL, FRONTEND_URL
pnpm dev               # node --import tsx/esm src/index.ts, serves on :3001
```

### Frontend

```bash
cd web
pnpm install
cp .env.example .env.local   # then fill in the NEON_AUTH_* and NEXT_PUBLIC_API_URL vars
pnpm dev                     # next dev, serves on :3000
```

### Docker

```bash
docker compose up --build
```

Brings the backend up on `:3001` and the web app on `:3000`.

## Environment Variables

### Backend

| Variable | Description |
|----------|-------------|
| `PORT` | Port to listen on. Local default `3001`; Render injects `10000`. |
| `DATABASE_URL` | Neon/Postgres connection string (`?sslmode=require`). |
| `FRONTEND_URL` | Allowed CORS origin for the web app. |
| `ADMIN_USER_IDS` | Optional comma-separated list of admin user IDs. |

### Frontend (`web/.env.local`)

| Variable | Description |
|----------|-------------|
| `NEON_AUTH_BASE_URL` | Neon Auth endpoint base URL (server-only). |
| `NEON_AUTH_COOKIE_SECRET` | Random 32-byte hex cookie secret (server-only). |
| `NEXT_PUBLIC_API_URL` | Backend base URL, baked into the bundle at build time and read by the proxy route. |

## Pricing

All features are free for signed-in users. There is no paid tier or metering. Sign in, register your sources, run clearance, and bind models without restriction.
