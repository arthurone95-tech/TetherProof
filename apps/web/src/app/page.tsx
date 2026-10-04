import { Card } from '@/components/ui/Card';

const modules = [
  {
    title: 'Worker',
    body: 'Log completed work by voice or photo, and build a capability profile that travels with you.',
    status: 'Phase 2',
  },
  {
    title: 'Employer',
    body: 'Define capability specs and search verified proof instead of reading résumés.',
    status: 'Phase 4',
  },
  {
    title: 'Training Provider',
    body: 'Sign off practical milestones and see which skills the market actually needs.',
    status: 'Phase 4',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-12">
      <header className="space-y-3">
        <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">TetherProof</p>
        <h1 className="text-3xl font-bold text-ink-900 sm:text-4xl">Proof of work, not promises.</h1>
        <p className="text-lg text-ink-600">
          TetherProof turns completed jobs into verified capability. Employers hire on what was actually
          done, and workers keep proof that cannot be edited or exaggerated.
        </p>
      </header>

      <Card title="Foundation is in place">
        <p className="text-ink-600">
          The API server, database schema, and authentication scaffolding are built. Worker, Employer,
          and Training Provider tools arrive in later phases.
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {modules.map((module) => (
          <Card key={module.title} title={module.title}>
            <p className="text-sm text-ink-600">{module.body}</p>
            <p className="mt-3 text-xs font-semibold tracking-wide text-brand-600 uppercase">
              {module.status}
            </p>
          </Card>
        ))}
      </div>
    </main>
  );
}
