'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const included = [
  'Dataset source register & provenance',
  'AI-training license tracker + conflict & expiry monitoring',
  'Copyright & PII screening workflows',
  'Opt-out & AI-preference register',
  'Per-model lineage binding & release readiness',
  'Rights-clearance gate with hashed certificates',
  'Takedown / dispute workflow',
  'Tamper-evident hash-chained evidence ledger',
  'Risk scoring & portfolio dashboard',
  'Policy engine, approvals & roles',
  'Compliance documentation packs',
  'Reports, activity log, notifications & tasks',
]

export default function Pricing() {
  const [planName, setPlanName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.getBillingPlan()
        if (cancelled) return
        setPlanName(res?.plan?.name ?? null)
      } catch {
        // public visitors are not signed in — that is fine
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-rose-500">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-600 text-sm font-black text-white">T</span>
          <span className="text-base tracking-tight">TrainingDataRightsClearanceLedger</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-zinc-300 hover:text-white text-sm">Sign In</Link>
          <Link href="/auth/sign-up" className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg text-sm font-medium">Get Started</Link>
        </div>
      </nav>

      <section className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight text-white">Simple pricing</h1>
        <p className="mt-4 text-lg text-zinc-400">
          Every feature is free. The whole rights-clearance ledger — sources, licenses, screening, the clearance gate,
          lineage, claims, and the tamper-evident ledger — at no cost.
        </p>

        <div className="mt-12 rounded-2xl border border-rose-800/60 bg-zinc-900/60 p-8 text-left">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-xl font-bold text-rose-300">Free</h2>
              <p className="text-sm text-zinc-500">Everything, for every team.</p>
            </div>
            <div className="text-right">
              <span className="text-4xl font-black text-white">$0</span>
              <span className="text-sm text-zinc-500">/mo</span>
            </div>
          </div>

          {planName && (
            <p className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-400">
              Your current plan: <span className="font-medium text-zinc-200">{planName}</span>
            </p>
          )}

          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {included.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-zinc-300">
                <span className="mt-0.5 text-rose-400">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/auth/sign-up"
            className="mt-8 block w-full rounded-lg bg-rose-600 hover:bg-rose-500 py-3 text-center font-semibold text-white"
          >
            Get Started Free
          </Link>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-zinc-600 text-sm">
        <p>TrainingDataRightsClearanceLedger — AI training-data rights clearance and evidence ledger.</p>
      </footer>
    </main>
  )
}
