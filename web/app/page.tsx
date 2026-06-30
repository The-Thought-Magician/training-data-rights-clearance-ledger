import Link from 'next/link'

const features = [
  {
    title: 'Dataset Source Register',
    body: 'A canonical inventory of every data source feeding any model — origin, acquisition method, modality, and a draft → review → cleared → blocked lifecycle.',
  },
  {
    title: 'Provenance & Chain of Custody',
    body: 'Evidence-backed history per source: acquired-from / transformed / derived-from events, upstream links, custody handoffs, and SHA-256-hashed artifacts.',
  },
  {
    title: 'AI-Training License Tracker',
    body: 'Records whether each license permits AI training, commercial use, derivatives, and attribution — with automatic conflict and expiry detection.',
  },
  {
    title: 'Copyright & PII Screening',
    body: 'Track screening status, method, reviewer, flagged works and PII categories, lawful basis, and remediation per source.',
  },
  {
    title: 'Opt-Out & AI-Preference Register',
    body: 'Capture robots.txt / ai.txt / TDM-reservation / noai signals with snapshot evidence, and honor individual and rights-holder opt-outs.',
  },
  {
    title: 'Per-Model Lineage Binding',
    body: 'Bind each model version to the exact cleared datasets that trained it, with proportions, preprocessing, and an immutable manifest hash.',
  },
  {
    title: 'Rights-Clearance Gate',
    body: 'A configurable approval gate that blocks dataset use until every required check passes and a named approver signs off, issuing a hashed clearance certificate.',
  },
  {
    title: 'Takedown / Dispute Workflow',
    body: 'Intake claims, link them to affected sources and — via lineage — the affected model versions, and track impact, response, and resolution.',
  },
  {
    title: 'Tamper-Evident Evidence Ledger',
    body: 'Every consequential action is written as a hash-chained entry, with a verification endpoint that proves the chain is unbroken for litigation and audit.',
  },
  {
    title: 'Risk Scoring & Dashboard',
    body: 'Per-source composite risk from license, copyright, PII, and opt-out signals, rolled up into a portfolio view of blocked sources and expiring licenses.',
  },
  {
    title: 'Compliance Documentation Packs',
    body: 'Generate EU AI Act GPAI-style training-data summaries, source clearance dossiers, and litigation packs as structured exports.',
  },
  {
    title: 'Model Release Readiness',
    body: 'Compute whether a model version is releasable — all bound sources cleared, approvals signed, no open high-severity claims — with a blockers report.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <span className="flex items-center gap-2 font-bold text-rose-500">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-600 text-sm font-black text-white">T</span>
          <span className="text-base tracking-tight">TrainingDataRightsClearanceLedger</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-zinc-300 hover:text-white text-sm">Pricing</Link>
          <Link href="/auth/sign-in" className="text-zinc-300 hover:text-white text-sm">Sign In</Link>
          <Link href="/auth/sign-up" className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg text-sm font-medium">Get Started</Link>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-400">
          Built for AI-copyright litigation defense and EU AI Act GPAI documentation
        </span>
        <h1 className="mt-6 text-4xl sm:text-5xl font-black tracking-tight text-white">
          Prove every dataset is <span className="text-rose-500">cleared for AI training</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
          A governance system of record that tracks provenance, licenses, copyright and PII screening, opt-outs, and per-model lineage,
          enforces a rights-clearance gate, and records every decision in a tamper-evident, hash-chained evidence ledger.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="bg-rose-600 hover:bg-rose-500 text-white px-6 py-3 rounded-lg font-semibold">Start clearing data</Link>
          <Link href="/auth/sign-in" className="border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 px-6 py-3 rounded-lg font-semibold">Sign In</Link>
        </div>
      </section>

      <section className="border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-white">The evidence lives nowhere coherent</h2>
          <p className="mt-4 max-w-3xl text-zinc-400">
            License PDFs in a shared drive, acquisition emails in inboxes, scraping scripts in Git, robots.txt snapshots nobody saved,
            opt-out requests in a support queue, and training manifests in MLOps tools that never reference legal status. When a demand
            letter or audit arrives, legal teams scramble for weeks to reconstruct what data trained which model — and whether the
            company had the right to use it. The downside dwarfs the cost of any tool, and the pain recurs with every dataset and model version.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-white">One legal-defense system of record</h2>
        <p className="mt-3 text-center text-zinc-400">Everything from source intake to a litigation-ready evidence chain.</p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h3 className="text-base font-semibold text-rose-300">{f.title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-3xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-bold text-white">Defensible by design.</h2>
          <p className="mt-4 text-zinc-400">
            Every clearance decision, screening result, approval, and change is captured in an immutable, hash-chained ledger —
            so you can produce a tamper-evident chain of custody on demand.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/auth/sign-up" className="bg-rose-600 hover:bg-rose-500 text-white px-6 py-3 rounded-lg font-semibold">Get Started Free</Link>
            <Link href="/pricing" className="border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 px-6 py-3 rounded-lg font-semibold">See Pricing</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-zinc-600 text-sm">
        <p>TrainingDataRightsClearanceLedger — AI training-data rights clearance and evidence ledger.</p>
      </footer>
    </main>
  )
}
