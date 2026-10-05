import Link from 'next/link';
import { Banner } from '@/components/ui/Banner';
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

/**
 * The signed-out landing page, and where a member lands after deleting their account.
 *
 * The deletion flags come from the API's own counts rather than from a generic
 * "done". A deletion that left files in storage says so here, because the honest
 * outcome is worth more than a clean-sounding one, and the member has just given up
 * an account that can no longer show them anything.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; pending?: string }>;
}) {
  const user = await currentProfile();
  const { deleted, pending } = await searchParams;

  const justDeleted = deleted === '1';
  // Parsed defensively: the query string is caller-controlled, and `Number('x')` is
  // NaN rather than an error. A NaN would render as "NaN of your uploaded files".
  const parsedPending = Number(pending ?? '0');
  const pendingMedia = Number.isFinite(parsedPending) && parsedPending > 0 ? parsedPending : 0;

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
          <Link
            href="/settings/account"
            className="mt-3 block text-sm text-ink-600 underline hover:text-ink-900"
          >
            Delete your account
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
          {justDeleted ? (
            <Banner tone="success" title="Your account has been deleted">
              {pendingMedia > 0
                ? `We still have ${pendingMedia} of your uploaded file${pendingMedia === 1 ? '' : 's'} to remove from storage. It is recorded and on its way out, and nothing in it can be reached through your account.`
                : 'Your profile and everything that identified you has been removed. The work you logged stays on the platform without your name attached, because proof counts are shared and one person leaving should not quietly change everyone else’s totals.'}
            </Banner>
          ) : (
            <>
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
            </>
          )}
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
