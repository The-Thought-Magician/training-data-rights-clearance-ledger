import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TrainingDataRightsClearanceLedger',
  description: 'Prove every dataset feeding your AI models is legally cleared for training — provenance, licenses, screening, clearance gate, and a tamper-evident evidence ledger.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
