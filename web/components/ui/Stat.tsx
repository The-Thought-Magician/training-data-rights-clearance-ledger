import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'rose' | 'green' | 'amber' | 'red'
  className?: string
}

const toneText: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-zinc-100',
  rose: 'text-rose-400',
  green: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
}

export function Stat({ label, value, hint, tone = 'default', className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${toneText[tone]}`}>{value}</div>
      {hint != null && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  )
}

export default Stat
