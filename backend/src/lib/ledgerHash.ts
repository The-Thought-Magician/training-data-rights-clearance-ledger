import { createHash } from 'node:crypto'

// Canonical hash-chain sentinel used as prev_hash for the first entry in a
// workspace's ledger. Shared by every writer (seed + all runtime appenders)
// and by the /verify reader so the chain is internally consistent.
export const GENESIS_HASH = '0'.repeat(64)

export interface LedgerHashInput {
  workspace_id: string
  seq: number
  entity_type: string
  entity_id: string
  action: string
  payload: unknown
  actor_id: string | null
  prev_hash: string
}

// Postgres jsonb does not preserve object key order across a write/read
// round-trip, so a payload authored as {claimant, type} can come back from
// the database as {type, claimant}. Sorting keys deterministically before
// stringifying makes the hash immune to that reordering at both write time
// (payload is the literal JS object) and verify time (payload came back from
// jsonb, possibly reordered).
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

// Single canonical hash formula for every ledger entry, used identically at
// write time (seed + all appendLedger() implementations) and at verify time.
// Deliberately excludes created_at (non-deterministic timing / Date
// serialization is not meaningful evidence).
export function computeEntryHash(input: LedgerHashInput): string {
  const canonical = JSON.stringify({
    workspace_id: input.workspace_id,
    seq: input.seq,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    action: input.action,
    payload: canonicalize(input.payload ?? {}),
    actor_id: input.actor_id,
    prev_hash: input.prev_hash,
  })
  return createHash('sha256').update(canonical).digest('hex')
}
