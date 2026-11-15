import Link from 'next/link';
import type { UserCapability } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { homeFor } from '@/lib/navigation';
import { currentProfile } from '@/lib/server/api';

const steps = [
  {
    title: 'Log the job',
    body: 'Record finished work with a photo or a voice note. It takes a minute.',
  },
  {
    title: 'Your customer confirms',
    body: 'They get a link by text message. No app, no account.',
  },
  {
    title: 'Employers find you',
    body: 'Verified proof builds your profile. Employers search it by skill.',
  },
];

const audiences = [
  {
    title: 'Workers',
    body: 'Build a verified work history that travels with you from job to job.',
  },
  {
    title: 'Employers',
    body: 'Search proven skills instead of reading résumés, then invite who you want.',
  },
  {
    title: 'Training providers',
    body: 'Sign off practical milestones and see which skills the market needs.',
  },
  {
    title: 'Students',
    body: 'Keep the milestones your institute signs off, separate from customer-verified work.',
  },
];

const sampleProofs = ['Rooftop panel mounting', 'Inverter and battery wiring', 'System commissioning'];

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
    <div className="min-h-screen bg-surface">
      {/* Top bar: wordmark on the left, one action on the right. */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <span className="text-lg font-bold tracking-tight text-brand-700">TetherProof</span>
        <Link
          href={user ? homeFor(user) : '/login'}
          className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-ink-800 hover:bg-brand-50"
        >
          {user ? 'Your workspace' : 'Sign in'}
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {justDeleted ? (
          <div className="mt-4">
            <Banner tone="success" title="Your account has been deleted">
              {pendingMedia > 0
                ? `We still have ${pendingMedia} of your uploaded file${pendingMedia === 1 ? '' : 's'} to remove from storage. It is recorded and on its way out, and nothing in it can be reached through your account.`
                : 'Your profile and everything that identified you has been removed. The work you logged stays on the platform without your name attached, because proof counts are shared and one person leaving should not quietly change everyone else’s totals.'}
            </Banner>
          </div>
        ) : null}

        {/* Hero: text first on a phone, text left and sample profile right on a laptop. */}
        <section className="grid gap-10 py-12 sm:py-16 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-24">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl lg:text-6xl">
              Proof of work, not promises.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink-600 sm:text-xl">
              Workers log finished jobs and customers confirm them. Employers hire on what was
              actually done.
            </p>

            {user ? (
              <div className="mt-8 max-w-xl rounded-2xl border border-brand-100 bg-white p-5">
                <p className="font-semibold text-ink-900">Welcome back, {user.fullName ?? 'friend'}</p>
                <p className="mt-1 text-ink-600">{summaryFor(user.capabilities)}</p>
                <Link
                  href={homeFor(user)}
                  className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-600 px-6 font-semibold text-white hover:bg-brand-700 sm:w-auto"
                >
                  {user.capabilities.length === 0 ? 'What brings you here?' : 'Go to your workspace'}
                </Link>
              </div>
            ) : (
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/login?tab=register"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-600 px-6 font-semibold text-white hover:bg-brand-700"
                >
                  Create account
                </Link>
                <Link
                  href="/login"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-brand-600 bg-white px-6 font-semibold text-brand-700 hover:bg-brand-50"
                >
                  Sign in
                </Link>
              </div>
            )}
            {!user ? (
              <p className="mt-3 text-sm text-ink-500">
                One account for work, hiring, training and learning.
              </p>
            ) : null}
          </div>

          {/* The one memorable element: what a verified skill looks like. */}
          <div className="rounded-3xl border border-brand-100 bg-white p-5 shadow-sm sm:p-7">
            <p className="text-sm text-ink-500">Sample profile, not a real person</p>
            <div className="mt-3 flex items-start justify-between gap-4">
              <h2 className="text-xl font-bold text-ink-900 sm:text-2xl">Solar installation</h2>
              <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
                4 verified proofs
              </span>
            </div>
            <ul className="mt-5 divide-y divide-brand-100 border-t border-brand-100">
              {sampleProofs.map((proof) => (
                <li key={proof} className="flex items-center justify-between gap-3 py-3">
                  <span className="text-ink-800">{proof}</span>
                  <span className="shrink-0 text-sm font-medium text-brand-600">
                    Customer confirmed
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works: a real sequence, so numbered. */}
        <section aria-labelledby="how-it-works" className="border-t border-brand-100 py-12 sm:py-16">
          <h2 id="how-it-works" className="text-2xl font-bold text-ink-900 sm:text-3xl">
            How it works
          </h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-6 lg:gap-10">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-4 sm:block">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold text-white"
                >
                  {index + 1}
                </span>
                <div className="sm:mt-4">
                  <h3 className="text-lg font-semibold text-ink-900">{step.title}</h3>
                  <p className="mt-1 text-ink-600">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Who it is for: four short entries, no card chrome. */}
        <section aria-labelledby="who-for" className="border-t border-brand-100 py-12 sm:py-16">
          <h2 id="who-for" className="text-2xl font-bold text-ink-900 sm:text-3xl">
            Who it is for
          </h2>
          <div className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {audiences.map((audience) => (
              <div key={audience.title} className="border-l-4 border-brand-300 pl-4">
                <h3 className="text-lg font-semibold text-ink-900">{audience.title}</h3>
                <p className="mt-1 text-ink-600">{audience.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Closing call to action, only for people who are not signed in yet. */}
        {!user && !justDeleted ? (
          <section className="mb-12 rounded-3xl bg-brand-700 px-6 py-10 text-center sm:mb-16 sm:px-10 sm:py-14">
            <h2 className="text-2xl font-bold text-white sm:text-3xl">Start building proof today.</h2>
            <p className="mx-auto mt-3 max-w-md text-brand-100">
              It takes an email address and a password.
            </p>
            <Link
              href="/login?tab=register"
              className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-white px-6 font-semibold text-brand-700 hover:bg-brand-50 sm:w-auto"
            >
              Create account
            </Link>
          </section>
        ) : null}
      </main>

      <footer className="border-t border-brand-100">
        <nav
          aria-label="Legal and support pages"
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-sm text-ink-600 sm:px-6 lg:px-8"
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
    </div>
  );
}
