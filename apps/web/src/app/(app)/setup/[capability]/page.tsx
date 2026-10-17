import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CircleCheck,
  GraduationCap,
  Hammer,
  type LucideIcon,
} from 'lucide-react';
import type { BusinessSummary, CapabilitiesResponse, UserCapability } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { apiServer, currentProfile } from '@/lib/server/api';
import { WORKSPACES } from '@/lib/navigation';
import { CapabilityActivate, CapabilityConfigure } from './CapabilityConfigure';

export const metadata: Metadata = {
  title: 'Set up — TetherProof',
};

const ICONS: Record<UserCapability, LucideIcon> = {
  worker: Hammer,
  trainee: GraduationCap,
  training_provider: BadgeCheck,
  employer: Building2,
};

/**
 * Setting up one capability, in two steps.
 *
 * ## The three things this page keeps apart
 *
 * | | what it is | when |
 * |---|---|---|
 * | **Your account** | who you are: sign-in details, name, photo | once, at registration |
 * | **Activation** | switching a capability on | once per capability |
 * | **Configuration** | the details that make it work | once per capability |
 *
 * Activation alone is not setup. Turning on "worker" takes one click and costs the person
 * nothing, but a worker's profile with no name and no location cannot be found by proximity
 * search — so the next step asks for the two things that capability genuinely cannot work
 * without, and nothing more.
 *
 * ## The sequence, and why it is enforced here rather than in each step
 *
 * ```
 * not held            -> activate            (the one click)
 * held, not configured -> configure          (the part that needs you)
 * held and configured -> redirect to workspace
 * ```
 *
 * Each state decides for itself what to show, so the page cannot be entered at the wrong
 * step and cannot skip the step that matters. Configuration is always skippable: a person
 * who wants to look around first can, and comes back. The workspace stays reachable either
 * way, because a half-configured capability showing an empty state is honest — it is a
 * locked door, not a broken one.
 *
 * ## Employer and trainee are different
 *
 * Neither can be configured here, because the thing that configures them **is** what
 * activates them: a business somebody approved, and an enrolment code an institute issued.
 * There is no second form to fill in after submitting one, which is exactly why activation
 * and configuration are the same click for those two and two steps for the other two.
 */
export default async function SetupPage({ params }: { params: Promise<{ capability: string }> }) {
  const { capability } = await params;
  const user = await currentProfile();
  if (!user) redirect('/login');

  if (!Object.prototype.hasOwnProperty.call(WORKSPACES, capability)) notFound();

  const id = capability as UserCapability;
  const workspace = WORKSPACES[id];
  const Icon = ICONS[id];
  const held = user.capabilities.includes(id);

  const described = await apiServer<CapabilitiesResponse>('/auth/capabilities');
  const entry = described.capabilities.find((item) => item.capability === id);

  /*
   * "Configured" is read from real data rather than remembered in a flag, because a flag
   * would drift the moment somebody edited their profile from somewhere else. Each
   * capability names the minimum it cannot work without.
   */
  const business =
    id === 'employer'
      ? await apiServer<{ businesses: BusinessSummary[] }>('/businesses').catch(() => ({ businesses: [] }))
      : null;

  const configured =
    id === 'worker' || id === 'trainee'
      ? Boolean(user.fullName?.trim())
      : id === 'training_provider'
        ? Boolean(user.organizationName?.trim())
        : id === 'employer'
          ? (business?.businesses ?? []).some((b) => b.status === 'approved')
          : true; // trainee: enrolment is the configuration

  // Done. Into the workspace.
  if (held && configured) redirect(workspace.href);

  // Employer with a business waiting: that is the whole of its setup, so say so rather
  // than showing a form that does not exist.
  if (id === 'employer' && held && business) {
    const pending = (business.businesses ?? []).find((b) => b.status !== 'approved');
    if (pending) {
      return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
          <BackLink />
          <Header id={id} Icon={Icon} title="Business in review" blurb={workspace.blurb} />
          <Banner tone="info" title={`${pending.name} is waiting`}>
            An administrator is checking your business. You can keep working while it is
            reviewed — hiring opens once it is approved.
          </Banner>
          <Card title="While you wait">
            <p className="text-sm text-ink-600">
              Your other workspaces are unaffected, and you can come back to this at any time.
            </p>
            <Link href="/employer" className="mt-3 inline-block text-sm font-semibold text-brand-700">
              Go to the hiring workspace →
            </Link>
          </Card>
        </div>
      );
    }
  }

  const step = held ? 'configure' : 'activate';

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <BackLink />

      <Header id={id} Icon={Icon} title={`Set up ${workspace.label.toLowerCase()}`} blurb={workspace.blurb} />

      {held ? (
        <Banner tone="info" title="On — one step left">
          {id === 'employer'
            ? 'Your business is not approved yet, so hiring is not open.'
            : id === 'trainee'
              ? 'Enter your enrolment code to finish.'
              : 'A couple of details and this is ready to use.'}
        </Banner>
      ) : (
        <Banner tone="info" title="Not set up yet">
          Turning this on does not affect anything else on your account — the parts you
          already have stay exactly where they are.
        </Banner>
      )}

      {!held ? <CapabilityActivate capability={id} /> : null}

      {held ? (
        <>
          {id === 'trainee' ? (
            <Card title="Enter your enrolment code">
              <p className="text-sm text-ink-600">
                Your institute gave you a code. Enter it on your credentials page to finish
                setting this up.
              </p>
              <Link
                href="/credentials"
                className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:text-brand-800"
              >
                Go to my credentials →
              </Link>
            </Card>
          ) : (
            <CapabilityConfigure
              capability={id}
              fullName={user.fullName}
              organizationName={user.organizationName}
              latitude={user.locationGps ? user.locationGps.split(',')[0] ?? '' : ''}
              longitude={user.locationGps ? user.locationGps.split(',')[1] ?? '' : ''}
            />
          )}
        </>
      ) : null}

      {entry && !entry.selfService && !held ? (
        <p className="text-sm text-ink-600">{entry.howToActivate}</p>
      ) : null}

      <p className="text-xs text-ink-600">
        You can also do this later from{' '}
        <Link href="/roles" className="font-semibold text-brand-700 hover:text-brand-800">
          Roles and profiles
        </Link>
        .
      </p>

      {/* Visible only to make the sequence explicit to a person reading the page; the
          steps above are what actually enforce it. */}
      <p className="sr-only">
        Step {step === 'activate' ? '1' : '2'} of 2: {step}.
      </p>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/roles"
      className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-900"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
      Back
    </Link>
  );
}

function Header({
  id,
  Icon,
  title,
  blurb,
}: {
  id: UserCapability;
  Icon: LucideIcon;
  title: string;
  blurb: string;
}) {
  return (
    <header className="flex flex-col gap-3">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white">
        <Icon aria-hidden="true" className="h-7 w-7" strokeWidth={ICON_STROKE_WIDTH} />
      </span>
      <div>
        <h1 className="text-2xl font-bold text-ink-900">{title}</h1>
        <p className="mt-1 text-sm text-ink-600">{blurb}</p>
      </div>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-500">
        <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={ICON_STROKE_WIDTH} />
        {id === 'employer' ? '2 steps' : 'Your account is already created'}
      </p>
    </header>
  );
}