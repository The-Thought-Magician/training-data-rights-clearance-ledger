// ---------------------------------------------------------------------------
// cron.ts — deterministic scheduling engine (pure functions, no external I/O)
//
// Supports three schedule "kinds":
//   - 'cron'   : a standard 5/6-field cron expression, evaluated in a timezone
//   - 'rate'   : a human "every N minutes|hours|days" expression, arithmetic
//   - 'oneoff' : a single ISO instant
//
// Everything is computed from the inputs only; there are no timers, no network
// calls, and no global mutable state. All returned instants are ISO-8601 UTC
// strings (e.g. "2026-06-30T14:00:00.000Z").
// ---------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface CronJob {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string
}

export interface Collision {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export type DstTrapType = 'double_fire' | 'skip' | 'ambiguous'

export interface DstTrap {
  type: DstTrapType
  atLocal: string
  atUtc: string
}

export interface CoverageWindow {
  start: string // ISO UTC
  end: string // ISO UTC
}

export interface CoverageGap {
  start: string
  end: string
  durationMinutes: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// Rate-expression parsing: "every N minutes|hours|days"
// ---------------------------------------------------------------------------

interface ParsedRate {
  n: number
  unitMs: number
  unit: 'minute' | 'hour' | 'day'
}

function parseRate(expr: string): ParsedRate | null {
  const m = expr
    .trim()
    .toLowerCase()
    .match(/^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days|min|mins|hr|hrs)$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const rawUnit = m[2]
  if (rawUnit.startsWith('min')) return { n, unitMs: MINUTE_MS, unit: 'minute' }
  if (rawUnit.startsWith('hour') || rawUnit.startsWith('hr')) return { n, unitMs: HOUR_MS, unit: 'hour' }
  return { n, unitMs: DAY_MS, unit: 'day' }
}

function toIso(d: Date): string {
  return d.toISOString()
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (!expr || !expr.trim()) return { valid: false, error: 'Expression is empty' }
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(expr)
      return { valid: true }
    } catch (e: unknown) {
      return { valid: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (kind === 'rate') {
    const parsed = parseRate(expr)
    if (!parsed) return { valid: false, error: 'Expected "every N minutes|hours|days"' }
    return { valid: true }
  }
  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return { valid: false, error: 'Not a valid ISO instant' }
    return { valid: true }
  }
  return { valid: false, error: `Unknown kind: ${kind}` }
}

// ---------------------------------------------------------------------------
// describeExpression
// ---------------------------------------------------------------------------

export function describeExpression(kind: ScheduleKind, expr: string, timezone = 'UTC'): string {
  const v = validateExpression(kind, expr)
  if (!v.valid) return `Invalid schedule: ${v.error}`
  if (kind === 'rate') {
    const p = parseRate(expr)!
    const plural = p.n === 1 ? p.unit : `${p.unit}s`
    return p.n === 1 ? `Every ${p.unit} (${timezone})` : `Every ${p.n} ${plural} (${timezone})`
  }
  if (kind === 'oneoff') {
    return `Once at ${toIso(new Date(Date.parse(expr)))}`
  }
  // cron
  const parts = expr.trim().split(/\s+/)
  const [min, hour, dom, mon, dow] = parts
  const segs: string[] = []
  if (min === '*' && hour === '*') segs.push('every minute')
  else if (min !== '*' && hour === '*') segs.push(`at minute ${min} of every hour`)
  else if (min === '0' && hour !== '*') segs.push(`at ${hour}:00`)
  else segs.push(`at ${hour}:${min}`)
  if (dom && dom !== '*') segs.push(`on day-of-month ${dom}`)
  if (mon && mon !== '*') segs.push(`in month ${mon}`)
  if (dow && dow !== '*') segs.push(`on weekday ${dow}`)
  return `Runs ${segs.join(', ')} (${timezone})`
}

// ---------------------------------------------------------------------------
// nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  count = 5,
): string[] {
  const from = fromISO ? new Date(Date.parse(fromISO)) : new Date()
  if (Number.isNaN(from.getTime())) return []
  const n = Math.max(0, Math.min(count, 1000))
  if (n === 0) return []

  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return []
    return t > from.getTime() ? [toIso(new Date(t))] : []
  }

  if (kind === 'rate') {
    const p = parseRate(expr)
    if (!p) return []
    const out: string[] = []
    let cursor = from.getTime() + p.unitMs * p.n
    for (let i = 0; i < n; i++) {
      out.push(toIso(new Date(cursor)))
      cursor += p.unitMs * p.n
    }
    return out
  }

  // cron
  try {
    const it = CronExpressionParser.parse(expr, { tz: timezone, currentDate: from })
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      const next = it.next()
      out.push(toIso(next.toDate()))
    }
    return out
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// computeCollisions
// ---------------------------------------------------------------------------

function minuteBucketKey(iso: string): string {
  // truncate to the minute
  return iso.slice(0, 16) // "YYYY-MM-DDTHH:MM"
}

function severityFor(concurrency: number, threshold: number): Collision['severity'] {
  if (concurrency >= threshold * 2) return 'high'
  if (concurrency >= threshold) return 'medium'
  return 'low'
}

export function computeCollisions(
  jobs: CronJob[],
  opts: { horizonDays?: number; threshold?: number } = {},
): Collision[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = Math.max(1, opts.threshold ?? 2)
  const fromMs = Date.now()
  const fromISO = toIso(new Date(fromMs))
  const horizonMs = fromMs + horizonDays * DAY_MS

  // bucketKey -> { jobIds:Set, resources: Map<resourceId, Set<jobId>> }
  const buckets = new Map<
    string,
    { jobIds: Set<string>; resources: Map<string, Set<string>> }
  >()

  for (const job of jobs) {
    // pull enough firings to cover the horizon; cap to avoid runaway expansion
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 1000)
    for (const f of firings) {
      const ms = Date.parse(f)
      if (Number.isNaN(ms) || ms > horizonMs) break
      const key = minuteBucketKey(f)
      let b = buckets.get(key)
      if (!b) {
        b = { jobIds: new Set(), resources: new Map() }
        buckets.set(key, b)
      }
      b.jobIds.add(job.id)
      if (job.resourceId) {
        let rset = b.resources.get(job.resourceId)
        if (!rset) {
          rset = new Set()
          b.resources.set(job.resourceId, rset)
        }
        rset.add(job.id)
      }
    }
  }

  const collisions: Collision[] = []
  const sortedKeys = [...buckets.keys()].sort()
  for (const key of sortedKeys) {
    const b = buckets.get(key)!
    const windowStart = `${key}:00.000Z`
    const windowEnd = toIso(new Date(Date.parse(windowStart) + MINUTE_MS))
    const concurrency = b.jobIds.size

    // resource-sharing collision: >=2 jobs hitting the same resource in the minute
    let resourceHit: string | undefined
    for (const [resId, set] of b.resources) {
      if (set.size >= 2) {
        resourceHit = resId
        break
      }
    }

    if (concurrency >= threshold || resourceHit) {
      collisions.push({
        windowStart,
        windowEnd,
        jobIds: [...b.jobIds].sort(),
        severity: severityFor(concurrency, threshold),
        resourceId: resourceHit,
      })
    }
  }
  return collisions
}

// ---------------------------------------------------------------------------
// loadHeatmap — firings per hour bucket across the horizon
// ---------------------------------------------------------------------------

export function loadHeatmap(
  jobs: CronJob[],
  opts: { horizonDays?: number } = {},
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromMs = Date.now()
  const fromISO = toIso(new Date(fromMs))
  const horizonMs = fromMs + horizonDays * DAY_MS

  const counts = new Map<string, number>()
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 1000)
    for (const f of firings) {
      const ms = Date.parse(f)
      if (Number.isNaN(ms) || ms > horizonMs) break
      const bucket = `${f.slice(0, 13)}:00` // "YYYY-MM-DDTHH:00" hour bucket
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([bucket, count]) => ({ bucket, count }))
}

// ---------------------------------------------------------------------------
// dstTraps — detect daylight-saving transitions in the window
// ---------------------------------------------------------------------------

function offsetMinutes(timezone: string, atMs: number): number {
  // Compute the timezone's UTC offset (minutes) at a given instant by formatting
  // the instant in the target zone and diffing against the same wall-clock read
  // as UTC.
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(new Date(atMs))
    const map: Record<string, number> = {}
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
    }
    const asUtc = Date.UTC(
      map.year,
      (map.month ?? 1) - 1,
      map.day ?? 1,
      map.hour === 24 ? 0 : map.hour ?? 0,
      map.minute ?? 0,
      map.second ?? 0,
    )
    return Math.round((asUtc - atMs) / MINUTE_MS)
  } catch {
    return 0
  }
}

function localLabel(timezone: string, atMs: number): string {
  try {
    const dtf = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    return dtf.format(new Date(atMs)).replace(' ', 'T')
  } catch {
    return toIso(new Date(atMs))
  }
}

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  days = 30,
): DstTrap[] {
  const fromMs = fromISO ? Date.parse(fromISO) : Date.now()
  if (Number.isNaN(fromMs)) return []
  const endMs = fromMs + days * DAY_MS
  const traps: DstTrap[] = []

  // Walk hour by hour, watching for offset changes (transitions).
  let prevOffset = offsetMinutes(timezone, fromMs)
  for (let ms = fromMs + HOUR_MS; ms <= endMs; ms += HOUR_MS) {
    const off = offsetMinutes(timezone, ms)
    if (off !== prevOffset) {
      const forward = off > prevOffset // clocks moved forward -> spring forward -> skip
      const type: DstTrapType = forward ? 'skip' : 'double_fire'
      // pin to the transition hour
      const atMs = ms
      traps.push({
        type,
        atLocal: localLabel(timezone, atMs),
        atUtc: toIso(new Date(atMs)),
      })
      // a fall-back also produces an ambiguous local hour
      if (!forward) {
        traps.push({
          type: 'ambiguous',
          atLocal: localLabel(timezone, atMs - HOUR_MS),
          atUtc: toIso(new Date(atMs - HOUR_MS)),
        })
      }
      prevOffset = off
    }
  }

  // If a concrete schedule is supplied, keep only traps that the schedule could
  // actually hit (a firing within the transition hour). Empty schedule -> report
  // all transitions in the window.
  if (kind && expr && validateExpression(kind, expr).valid) {
    const firings = nextFirings(kind, expr, timezone, toIso(new Date(fromMs)), 1000)
      .map((f) => Date.parse(f))
      .filter((t) => !Number.isNaN(t) && t <= endMs)
    if (firings.length > 0) {
      return traps.filter((trap) => {
        const tMs = Date.parse(trap.atUtc)
        return firings.some((f) => Math.abs(f - tMs) < HOUR_MS)
      })
    }
  }

  return traps
}

// ---------------------------------------------------------------------------
// coverageGaps — gaps between desired coverage windows not covered by any firing
// ---------------------------------------------------------------------------

export function coverageGaps(
  windows: CoverageWindow[],
  jobs: CronJob[],
  opts: { horizonDays?: number } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromMs = Date.now()
  const fromISO = toIso(new Date(fromMs))
  const horizonMs = fromMs + horizonDays * DAY_MS

  // collect all firing instants in horizon, sorted
  const firings: number[] = []
  for (const job of jobs) {
    for (const f of nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 1000)) {
      const ms = Date.parse(f)
      if (Number.isNaN(ms) || ms > horizonMs) break
      firings.push(ms)
    }
  }
  firings.sort((a, b) => a - b)

  const gaps: CoverageGap[] = []
  for (const w of windows) {
    const ws = Date.parse(w.start)
    const we = Date.parse(w.end)
    if (Number.isNaN(ws) || Number.isNaN(we) || we <= ws) continue
    const inWindow = firings.filter((f) => f >= ws && f <= we)
    if (inWindow.length === 0) {
      gaps.push({ start: w.start, end: w.end, durationMinutes: Math.round((we - ws) / MINUTE_MS) })
      continue
    }
    // gap from window start to first firing
    if (inWindow[0] - ws > MINUTE_MS) {
      gaps.push({
        start: toIso(new Date(ws)),
        end: toIso(new Date(inWindow[0])),
        durationMinutes: Math.round((inWindow[0] - ws) / MINUTE_MS),
      })
    }
    // gaps between consecutive firings (none expected within a covered window,
    // but report any interval larger than a day as a coverage hole)
    for (let i = 1; i < inWindow.length; i++) {
      const delta = inWindow[i] - inWindow[i - 1]
      if (delta > DAY_MS) {
        gaps.push({
          start: toIso(new Date(inWindow[i - 1])),
          end: toIso(new Date(inWindow[i])),
          durationMinutes: Math.round(delta / MINUTE_MS),
        })
      }
    }
    // gap from last firing to window end
    if (we - inWindow[inWindow.length - 1] > DAY_MS) {
      gaps.push({
        start: toIso(new Date(inWindow[inWindow.length - 1])),
        end: toIso(new Date(we)),
        durationMinutes: Math.round((we - inWindow[inWindow.length - 1]) / MINUTE_MS),
      })
    }
  }
  return gaps
}

// ---------------------------------------------------------------------------
// autoSpread — suggest staggered expressions for jobs that pile up
// ---------------------------------------------------------------------------

export function autoSpread(
  jobs: CronJob[],
  opts: { threshold?: number } = {},
): SpreadSuggestion[] {
  const threshold = Math.max(1, opts.threshold ?? 2)
  const collisions = computeCollisions(jobs, { threshold })
  const suggestions: SpreadSuggestion[] = []
  const seen = new Set<string>()

  for (const col of collisions) {
    // keep the first job in the window, stagger the rest by one minute each
    const [, ...rest] = col.jobIds
    let offset = 1
    for (const jobId of rest) {
      if (seen.has(jobId)) continue
      const job = jobs.find((j) => j.id === jobId)
      if (!job) continue
      seen.add(jobId)
      let suggestedExpr = job.expr
      let reason = `Collides with ${col.jobIds.length} jobs at ${col.windowStart}`
      if (job.kind === 'cron') {
        const parts = job.expr.trim().split(/\s+/)
        if (parts.length >= 5 && /^\d+$/.test(parts[0])) {
          const newMin = (parseInt(parts[0], 10) + offset) % 60
          parts[0] = String(newMin)
          suggestedExpr = parts.join(' ')
          reason = `Shift minute by +${offset} to clear collision at ${col.windowStart}`
        } else if (parts.length >= 5 && parts[0] === '*') {
          parts[0] = String(offset)
          suggestedExpr = parts.join(' ')
          reason = `Pin to minute ${offset} to spread load away from ${col.windowStart}`
        }
      } else if (job.kind === 'rate') {
        const p = parseRate(job.expr)
        if (p) {
          reason = `Rate job overlaps at ${col.windowStart}; offset start or increase interval`
        }
      }
      suggestions.push({ jobId, suggestedExpr, reason })
      offset++
    }
  }
  return suggestions
}
