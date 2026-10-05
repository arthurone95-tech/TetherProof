import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { currentProfile } from '@/lib/server/api';

const modules = [
  {
    title: 'Worker',
    body: 'Log completed work by voice or photo, and build a capability profile that travels with you.',
    available: true,
  },
  {
    title: 'Employer',
    body: 'Define capability specs and search verified proof instead of reading résumés.',
    available: true,
  },
  {
    title: 'Training Provider',
    body: 'Sign off practical milestones and see which skills the market actually needs.',
    available: false,
  },
];

/** Where a signed-in member of each role should go. */
function destinationFor(role: string): string {
  if (role === 'employer') return '/employer';
  if (role === 'worker') return '/invites';
  return '/pending';
}

export default async function HomePage() {
  const user = await currentProfile();

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

      {user ? (
        <div className="rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-ink-900">
            Signed in as {user.fullName ?? user.role}
          </h2>
          <p className="mt-2 text-sm text-ink-600">
            {user.role === 'employer'
              ? 'Search verified proof, save the filters you reuse, and invite the workers you want to talk to.'
              : user.role === 'worker'
                ? 'Answer invitations from employers, and keep logging work that builds your proof.'
                : 'Your account is active. The tools for your role are not built yet.'}
          </p>
          <Link
            href={destinationFor(user.role)}
            className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-6 font-semibold text-white hover:bg-brand-700"
          >
            Go to your dashboard
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-ink-900">Sign in or create an account</h2>
          <p className="mt-2 text-sm text-ink-600">
            Workers and employers can both get started. It takes an email address and a password.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-6 font-semibold text-white hover:bg-brand-700"
          >
            Sign in
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {modules.map((module) => (
          <Card key={module.title} title={module.title}>
            <p className="text-sm text-ink-600">{module.body}</p>
            <p
              className={`mt-3 text-xs font-semibold tracking-wide uppercase ${
                module.available ? 'text-brand-600' : 'text-ink-600'
              }`}
            >
              {module.available ? 'Working now' : 'Not built yet'}
            </p>
          </Card>
        ))}
      </div>
    </main>
  );
}
