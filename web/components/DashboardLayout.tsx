'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

interface NavItem {
  label: string
  href: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Risk', href: '/dashboard/risk' },
      { label: 'Reports', href: '/dashboard/reports' },
    ],
  },
  {
    title: 'Data Sources',
    items: [
      { label: 'Sources', href: '/dashboard/sources' },
      { label: 'Rights Holders', href: '/dashboard/rights-holders' },
    ],
  },
  {
    title: 'Rights & Licensing',
    items: [
      { label: 'Licenses', href: '/dashboard/licenses' },
      { label: 'License Templates', href: '/dashboard/license-templates' },
      { label: 'Opt-Outs', href: '/dashboard/optouts' },
    ],
  },
  {
    title: 'Screening',
    items: [
      { label: 'Copyright', href: '/dashboard/copyright' },
      { label: 'PII', href: '/dashboard/pii' },
    ],
  },
  {
    title: 'Clearance',
    items: [
      { label: 'Clearance Gate', href: '/dashboard/clearance' },
      { label: 'Policies', href: '/dashboard/policies' },
      { label: 'Approvals', href: '/dashboard/approvals' },
    ],
  },
  {
    title: 'Models',
    items: [{ label: 'Models', href: '/dashboard/models' }],
  },
  {
    title: 'Claims',
    items: [{ label: 'Claims & Disputes', href: '/dashboard/claims' }],
  },
  {
    title: 'Evidence',
    items: [
      { label: 'Ledger', href: '/dashboard/ledger' },
      { label: 'Activity', href: '/dashboard/activity' },
      { label: 'Documentation', href: '/dashboard/documentation' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)
  const [workspace, setWorkspace] = useState<string>('Workspace')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await authClient.getSession()
      if (cancelled) return
      if (!s?.data?.user) {
        router.push('/auth/sign-in')
        return
      }
      const name = (s.data.user as any)?.name || (s.data.user as any)?.email || 'Workspace'
      setWorkspace(name)
      setChecking(false)
    })()
    return () => { cancelled = true }
  }, [router])

  useEffect(() => { setMobileOpen(false) }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-600 text-sm font-black text-white">T</span>
        <span className="text-sm font-bold tracking-tight text-zinc-100">TrainingDataRightsClearanceLedger</span>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{section.title}</div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-rose-600/15 font-medium text-rose-300'
                          : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-zinc-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-zinc-800 bg-zinc-900/40 lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-zinc-800 bg-zinc-900">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              ☰
            </button>
            <span className="text-sm text-zinc-500">
              Workspace: <span className="font-medium text-zinc-300">{workspace}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/notifications" className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" aria-label="Notifications">
              🔔
            </Link>
            <button
              onClick={signOut}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
