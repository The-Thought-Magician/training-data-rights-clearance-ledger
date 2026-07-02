import type { HTMLAttributes } from 'react'

type Tone = 'zinc' | 'rose' | 'green' | 'amber' | 'red' | 'blue' | 'purple'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  zinc: 'bg-slate-800 text-slate-300 border-slate-700',
  rose: 'bg-fuchsia-950/50 text-fuchsia-300 border-fuchsia-800/60',
  green: 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60',
  amber: 'bg-amber-950/50 text-amber-300 border-amber-800/60',
  red: 'bg-red-950/50 text-red-300 border-red-800/60',
  blue: 'bg-sky-950/50 text-sky-300 border-sky-800/60',
  purple: 'bg-purple-950/50 text-purple-300 border-purple-800/60',
}

// Maps common domain statuses to a tone so pages can drop in raw status strings.
const statusTone: Record<string, Tone> = {
  cleared: 'green', passed: 'green', applied: 'green', valid: 'green', resolved: 'green', released: 'green', ready: 'green', approved: 'green', done: 'green', active: 'green',
  blocked: 'red', failed: 'red', rejected: 'red', critical: 'red', quarantined: 'red', escalated: 'red', invalid: 'red',
  flagged: 'amber', pending: 'amber', review: 'amber', 'in-progress': 'amber', 'in_progress': 'amber', investigating: 'amber', high: 'amber', 'changes-requested': 'amber', remediating: 'amber', 'under review': 'amber',
  draft: 'zinc', 'not-started': 'zinc', retired: 'zinc', none: 'zinc', low: 'zinc', open: 'blue', received: 'blue', medium: 'blue', overridden: 'purple',
}

export function Badge({ tone, className = '', children, ...props }: BadgeProps) {
  const key = typeof children === 'string' ? children.toLowerCase().trim() : ''
  const resolved = tone ?? statusTone[key] ?? 'zinc'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium ${tones[resolved]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
