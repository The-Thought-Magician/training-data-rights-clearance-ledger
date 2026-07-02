import type { Metadata } from 'next'
import { Manrope } from 'next/font/google'
import './globals.css'

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Training Data Rights Clearance Ledger',
  description: 'A governance system of record for documenting AI-training-data rights: dataset provenance, license terms, copyright and PII screening status, opt-out registers, and per-model rights lineage, evidenced in a tamper-evident ledger.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
