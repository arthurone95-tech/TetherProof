import Link from 'next/link';
import type { UserCapability } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { homeFor } from '@/lib/navigation';
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
    available: true,
  },
  {
    title: 'Student',
    body: 'Hold the milestones your institute signs off, separate from customer-verified work.',
    available: true,
  },
];

/**
 * The signed-in summary, said in terms of what the person can actually do.
 *
 * Capability-based rather than role-based, so a Kojo who is an electrician, a student and
 * a business owner is told what all three of those can do rather than being described by
 * whichever one happened to be checked first.
 */
function summaryFor(capabilities: readonly UserCapability[]): string {
  if (capabilities.length === 0) {
    return 'Choose how you want to use TetherProof and your workspace opens.';
  }
  if (capabilities.includes('worker') && capabilities.includes('employer')) {
    return 'Log the work you have done, and hire the proof you need for your business.';
  }
  if (capabilities.includes('worker')) {
    return 'Log completed jobs, and keep the proof a customer can confirm.';
  }
  if (capabilities.includes('employer')) {
    return 'Search verified proof, save the filters you reuse, and invite the workers you want to talk to.';
  }
  if (capabilities.includes('training_provider')) {
    return 'Manage your students, sign off their practicals, and see what the market is short of.';
  }
  return 'Review the milestones your institute has recorded, and decide what to keep.';
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
        <p className="text-sm font-semibold tracking-wide text-brand-600">TetherProof</p>
        <h1 className="text-3xl font-bold text-ink-900 sm:text-4xl">Proof of work, not promises.</h1>
        <p className="text-lg text-ink-600">
          TetherProof turns completed jobs into verified capability. Employers hire on what was actually
          done, and workers keep proof that cannot be edited or exaggerated.
        </p>
      </header>

      <div className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Example</p>
        <p className="mt-2 text-sm font-semibold text-ink-900">Solar installation — 4 verified proofs</p>
        <p className="mt-1 text-xs text-ink-600">
          A sample of what a verified skill looks like on a worker&apos;s profile. Not a real person.
        </p>
      </div>

      {user ? (
        <div className="rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-ink-900">
            Signed in as {user.fullName ?? 'you'}
          </h2>
          <p className="mt-2 text-sm text-ink-600">{summaryFor(user.capabilities)}</p>
          <Link
            href={homeFor(user)}
            className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-6 font-semibold text-white hover:bg-brand-700"
          >
            {user.capabilities.length === 0 ? 'What brings you here?' : 'Go to your workspace'}
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
                One account for work, hiring, training and learning. It takes an email address and a
                password.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href="/login"
                  className="inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-6 font-semibold text-white hover:bg-brand-700"
                >
                  Sign in
                </Link>
                <Link
                  href="/login?tab=register"
                  className="inline-flex min-h-12 items-center rounded-xl border border-brand-600 bg-white px-6 font-semibold text-brand-700 hover:bg-brand-50"
                >
                  Create account
                </Link>
              </div>
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

      <section className="grid gap-4 sm:grid-cols-3">
        <Link
          href="/login?tab=register"
          className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm transition-colors hover:border-brand-300"
        >
          <p className="text-sm font-semibold text-ink-900">I do the work</p>
          <p className="mt-1 text-xs text-ink-600">
            Log jobs, collect proof, and build a verified capability profile.
          </p>
        </Link>
        <Link
          href="/login?tab=register"
          className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm transition-colors hover:border-brand-300"
        >
          <p className="text-sm font-semibold text-ink-900">I hire</p>
          <p className="mt-1 text-xs text-ink-600">
            Search verified proof and invite the workers you want.
          </p>
        </Link>
        <Link
          href="/login?tab=register"
          className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm transition-colors hover:border-brand-300"
        >
          <p className="text-sm font-semibold text-ink-900">I train</p>
          <p className="mt-1 text-xs text-ink-600">
            Sign off practical milestones and see what the market needs.
          </p>
        </Link>
      </section>

      <section className="rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-ink-900">How it works</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm font-semibold text-ink-900">For workers</p>
            <ol className="mt-2 list-decimal pl-5 text-xs text-ink-600">
              <li>Log a job with a photo or voice note.</li>
              <li>Your customer confirms it.</li>
              <li>Your verified skill profile grows.</li>
            </ol>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-900">For employers</p>
            <ol className="mt-2 list-decimal pl-5 text-xs text-ink-600">
              <li>Set up a business and get approved.</li>
              <li>Search by proven skill.</li>
              <li>Invite the workers you want.</li>
            </ol>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-900">For institutes</p>
            <ol className="mt-2 list-decimal pl-5 text-xs text-ink-600">
              <li>Register and get approved.</li>
              <li>Issue milestones to students.</li>
              <li>See which skills the market needs.</li>
            </ol>
          </div>
        </div>
      </section>

      <footer className="border-t border-brand-100 pt-6">
        <nav
          aria-label="Legal and support pages"
          className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-600"
        >
          <Link href="/about" className="hover:text-ink-900">
            About
          </Link>
          <Link href="/help" className="hover:text-ink-900">
            Help
          </Link>
          <Link href="/terms" className="hover:text-ink-900">
            Terms &amp; Conditions
          </Link>
          <Link href="/privacy" className="hover:text-ink-900">
            Privacy Policy
          </Link>
        </nav>
      </footer>
    </main>
  );
}
