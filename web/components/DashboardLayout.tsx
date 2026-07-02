'use client'
import { useEffect, useRef, useState } from 'react'
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

function sectionActive(pathname: string, section: NavSection): boolean {
  return section.items.some((i) => isActive(pathname, i.href))
}

function NavDropdown({ section, pathname }: { section: NavSection; pathname: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = sectionActive(pathname, section)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          active ? 'text-fuchsia-300' : 'text-slate-400 hover:text-slate-100'
        }`}
        aria-expanded={open}
      >
        {section.title}
        <span className="text-[10px] opacity-70">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-lg border border-slate-800 bg-slate-900 p-1.5 shadow-xl">
          {section.items.map((item) => {
            const itemActive = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                  itemActive
                    ? 'bg-fuchsia-600/15 font-medium text-fuchsia-300'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
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
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-fuchsia-500" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-950">
      <header className="sticky top-0 z-30 w-full border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="flex items-center justify-between gap-4 px-4 py-3 lg:px-8">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-fuchsia-600 text-sm font-black text-white">T</span>
              <span className="hidden text-sm font-bold tracking-tight text-slate-100 sm:inline">Training Data Rights Clearance Ledger</span>
            </Link>
            <nav className="hidden items-center gap-1 lg:flex">
              {NAV.map((section) => (
                <NavDropdown key={section.title} section={section} pathname={pathname} />
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 md:inline">
              Workspace: <span className="font-medium text-slate-300">{workspace}</span>
            </span>
            <Link href="/dashboard/notifications" className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Notifications">
              🔔
            </Link>
            <button
              onClick={signOut}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-700"
            >
              Sign out
            </button>
            <button
              className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Open menu"
            >
              ☰
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="border-t border-slate-800 px-4 py-3 lg:hidden">
            {NAV.map((section) => (
              <div key={section.title} className="mb-3">
                <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">{section.title}</div>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = isActive(pathname, item.href)
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                            active
                              ? 'bg-fuchsia-600/15 font-medium text-fuchsia-300'
                              : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
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
        )}
      </header>

      <main className="w-full flex-1 px-4 py-6 lg:px-8">{children}</main>
    </div>
  )
}
