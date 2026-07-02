import Link from 'next/link'

const capabilities = [
  {
    title: 'Dataset Source Register',
    body: 'A canonical inventory of every data source feeding any model, recording origin, acquisition method, modality, and lifecycle status from draft through review, clearance, or blocking.',
  },
  {
    title: 'Provenance & Chain of Custody',
    body: 'A documented history for each source: acquisition, transformation, and derivation events; upstream and downstream links; custody handoffs; and hashed evidentiary artifacts.',
  },
  {
    title: 'AI-Training License Determination',
    body: 'Per-source recording of whether the governing license permits AI training, commercial use, and derivative works, with automated detection of conflicts and expirations.',
  },
  {
    title: 'Copyright and PII Screening Record',
    body: 'A record of screening status, method, and reviewer for each source, including flagged third-party works, detected PII categories, lawful basis, and remediation status.',
  },
  {
    title: 'Opt-Out and AI-Preference Register',
    body: 'A register of robots.txt, ai.txt, TDM-reservation, and no-AI signals, retained with snapshot evidence, to ensure individual and rights-holder opt-outs are observed.',
  },
  {
    title: 'Per-Model Rights Lineage',
    body: 'A binding between each model version and the specific cleared datasets used in its training, including proportions, preprocessing steps, and an immutable manifest hash.',
  },
  {
    title: 'Rights-Clearance Gate',
    body: 'A configurable approval control that withholds a dataset from use in training until all required checks are satisfied and a named approver has authorized its use.',
  },
  {
    title: 'Takedown and Dispute Handling',
    body: 'A process for intake of rights-holder claims, association with affected sources and, through lineage, affected model versions, with tracked response and resolution.',
  },
  {
    title: 'Tamper-Evident Evidence Ledger',
    body: 'A hash-chained record of every consequential action, with a verification function that establishes the ledger has not been altered, for use in audit or litigation.',
  },
  {
    title: 'Risk Assessment',
    body: 'A composite risk determination per source, derived from license, copyright, PII, and opt-out findings, presented as a portfolio view of blocked sources and expiring licenses.',
  },
  {
    title: 'Compliance Documentation',
    body: 'Structured exports supporting EU AI Act general-purpose AI documentation duties, source clearance dossiers, and litigation response packs.',
  },
  {
    title: 'Model Release Readiness Determination',
    body: 'A determination of whether a model version may be released, based on clearance status of all bound sources, completed approvals, and absence of unresolved high-severity claims.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <span className="flex items-center gap-2 font-bold text-fuchsia-500">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-fuchsia-600 text-sm font-black text-white">T</span>
          <span className="text-base tracking-tight">Training Data Rights Clearance Ledger</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-slate-300 hover:text-white text-sm">Pricing</Link>
          <Link href="/auth/sign-in" className="text-slate-300 hover:text-white text-sm">Sign In</Link>
          <Link href="/auth/sign-up" className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white px-4 py-2 rounded-lg text-sm font-medium">Request Access</Link>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs text-slate-400">
          For legal, compliance, and AI-governance functions
        </span>
        <h1 className="mt-6 text-4xl sm:text-5xl font-black tracking-tight text-white">
          A system of record for <span className="text-fuchsia-500">training-data rights clearance</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          This system documents whether each dataset used to train or fine-tune a model has been cleared for that purpose. It records
          provenance, license terms, copyright and PII screening outcomes, opt-out signals, and per-model lineage, enforces an
          approval-gated clearance process, and maintains a tamper-evident evidence ledger for audit and litigation defense.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white px-6 py-3 rounded-lg font-semibold">Request Access</Link>
          <Link href="/auth/sign-in" className="border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 px-6 py-3 rounded-lg font-semibold">Sign In</Link>
        </div>
      </section>

      <section className="border-t border-slate-800 bg-slate-900/30">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-white">The compliance problem</h2>
          <p className="mt-4 max-w-3xl text-slate-400">
            Evidence of dataset rights typically exists across disconnected records: license documents in file storage,
            acquisition correspondence in email, scraping scripts in version control, robots.txt snapshots that were not
            retained, opt-out requests logged in a support system, and training manifests maintained in MLOps tooling with
            no reference to legal status. When a demand letter or regulatory audit arrives, legal and compliance teams must
            reconstruct, often under time pressure, which data trained which model and on what legal basis. This system
            maintains that record continuously, so it does not need to be reconstructed after the fact.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-white">Capabilities</h2>
        <p className="mt-3 text-center text-slate-400">Coverage from source intake through an auditable evidence chain.</p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
              <h3 className="text-base font-semibold text-fuchsia-300">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-800 bg-slate-900/30">
        <div className="max-w-3xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-bold text-white">Prepared for audit.</h2>
          <p className="mt-4 text-slate-400">
            Every clearance decision, screening result, approval, and change is recorded as a hash-chained entry in the
            evidence ledger. The chain of custody can be produced on request for regulatory review or legal proceedings.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/auth/sign-up" className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white px-6 py-3 rounded-lg font-semibold">Request Access</Link>
            <Link href="/pricing" className="border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 px-6 py-3 rounded-lg font-semibold">View Pricing</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-slate-600 text-sm">
        <p>Training Data Rights Clearance Ledger — a governance system of record for AI training-data rights.</p>
      </footer>
    </main>
  )
}
