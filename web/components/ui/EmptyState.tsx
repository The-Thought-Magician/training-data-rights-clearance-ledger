import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, icon, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/30 px-6 py-14 text-center ${className}`}>
      {icon != null && <div className="mb-3 text-3xl opacity-70">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {description != null && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action != null && <div className="mt-5">{action}</div>}
    </div>
  )
}

export default EmptyState
