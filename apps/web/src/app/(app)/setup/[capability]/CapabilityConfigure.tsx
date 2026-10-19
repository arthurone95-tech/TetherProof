'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import type { UserCapability } from '@tetherproof/shared';
import { Field } from '@/components/ui/Field';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { activateCapability, saveProfile } from '@/lib/actions';
import { locateMessage, useGeolocation } from '@/lib/use-geolocation';

import { EMPTY_CAPABILITY, EMPTY_FORM } from '@/lib/form-state';

/**
 * The **configuration** step: the first-time setup for a capability someone has just
 * activated.
 *
 * ## Why this is a separate step from activation
 *
 * The account is one thing you create. Activating a capability is one click that grants
 * it. Neither of those is the same as *setting the capability up*, and collapsing them
 * means the first thing a new worker sees is an empty dashboard — a screen that reports
 * nothing and looks broken, for a person who believes they just finished signing up.
 *
 * So the three stay distinct:
 *
 * | | what it is | how many times |
 * |---|---|---|
 * | **Account** | your identity: sign-in details, name, photo | once, at registration |
 * | **Activation** | switching a capability on or off | once per capability, then any time |
 * | **Configuration** | filling in what that capability needs to actually work | once per capability |
 *
 * Configuration is the one that needs you. It is also the one that can be left half-done
 * and picked up later — the workspace stays reachable, and this page is where you finish.
 *
 * ## What each capability needs
 *
 * Only what the capability genuinely cannot work without. A worker's name and rough
 * location, because a portfolio with neither cannot be found by proximity search; a
 * training provider's institute name, because it is what appears on every credential they
 * sign. Employer and trainee are configured by the thing that activates them — a business
 * and an enrolment code — so they have no separate form here.
 */
export function CapabilityConfigure({
  capability,
  fullName,
  organizationName,
  latitude,
  longitude,
}: {
  capability: UserCapability;
  fullName: string | null;
  organizationName: string | null;
  latitude: string;
  longitude: string;
}) {
  const [state, formAction] = useActionState(saveProfile, EMPTY_FORM);
  const needsName = capability === 'worker' || capability === 'trainee';
  const needsInstitute = capability === 'training_provider';

  /*
   * The location is held as a pair of strings rather than two visible inputs, and is seeded
   * from whatever the profile already had — so somebody returning to finish setup does not
   * lose the point they set earlier, and somebody new starts empty.
   */
  const [coords, setCoords] = useState<string[]>(
    latitude && longitude ? [latitude, longitude] : ['', ''],
  );
  const { state: locateState, locate } = useGeolocation();

  async function fillFromDevice(): Promise<void> {
    const fix = await locate();
    if (!fix) return;
    setCoords([fix.latitude.toFixed(6), fix.longitude.toFixed(6)]);
  }

  if (!needsName && !needsInstitute) return null;

  /*
   * The action goes straight to the form rather than being wrapped, so nothing has to
   * navigate. `saveProfile` revalidates, this page re-renders, `configured` becomes true,
   * and the page redirects into the workspace on the server. That is one mechanism doing
   * the work instead of two — and it means "finished" is decided by the state the data is
   * actually in, not by a client flag that could disagree with it.
   */
  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-2xl border border-brand-200 bg-white p-5 shadow-sm"
    >
      {needsName ? (
        <Field
          name="fullName"
          label="Your name"
          defaultValue={fullName ?? ''}
          placeholder="Kojo Mensah"
          maxLength={160}
          error={state.field === 'fullName' ? state.error : undefined}
          hint="This is what an employer or institute sees. It is on your account already — change it here if you want it shown differently."
          required
        />
      ) : null}

      {needsInstitute ? (
        <Field
          name="organizationName"
          label="Institute name"
          defaultValue={organizationName ?? ''}
          placeholder="Accra Technical Institute"
          maxLength={160}
          error={state.field === 'organizationName' ? state.error : undefined}
          hint="This is the name that appears on every credential you sign."
          required
        />
      ) : null}

      {/*
        No coordinate inputs, for the same reason as everywhere else in the app: the
        location the person accepts is retrieved, not typed. "Use my location" sets the
        value that is submitted underneath.
      */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-900">Where you work</span>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={fillFromDevice}
            disabled={locateState === 'locating'}
            className="inline-flex min-h-11 items-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {locateState === 'locating' ? 'Finding you…' : 'Use my location'}
          </button>
          <p className="text-xs text-ink-600">
            Employers search by distance, so a rough point is enough. Not sharing is fine.
          </p>
        </div>
      </div>

      <input type="hidden" name="latitude" value={coords[0]} readOnly />
      <input type="hidden" name="longitude" value={coords[1]} readOnly />

      {locateState !== 'locating' && locateMessage(locateState) ? (
        <p role="status" className="text-xs text-ink-600">
          {locateMessage(locateState)}
        </p>
      ) : null}

      {state.field === 'latitude' && state.error ? (
        <p role="alert" className="text-sm font-semibold text-red-800">
          {state.error}
        </p>
      ) : null}

      {state.error && !state.field ? (
        <p role="alert" className="text-sm font-semibold text-red-800">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingLabel="Saving…">Save and continue</SubmitButton>
        {/* A link, not a button calling router.back(): it works without JavaScript, and
            "skip" here means "go and look around", which is a destination rather than a
            dismissal. The workspace is reachable either way — a capability with no name
            yet shows an empty state, which is an honest locked door and not a fault. */}
        <Link
          href={capability === 'training_provider' ? '/trainer' : '/dashboard'}
          className="inline-flex min-h-12 items-center rounded-xl border border-brand-100 bg-white px-5 text-sm font-semibold text-ink-700 transition-colors hover:bg-brand-50"
        >
          Skip for now
        </Link>
      </div>

      {state.done ? <FormSuccess when>Saved.</FormSuccess> : null}
    </form>
  );
}

/**
 * The **activation** step: the one click that grants the capability.
 *
 * Kept deliberately thin. Everything this capability will need is asked for in the
 * configuration step that follows, so putting a form here would mean asking twice — and a
 * person who has just committed to something should be told what happens next before they
 * are asked to fill in anything.
 */
export function CapabilityActivate({ capability }: { capability: UserCapability }) {
  const [state, formAction] = useActionState(activateCapability, EMPTY_CAPABILITY);

  if (capability === 'employer' || capability === 'trainee') return null;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-5 shadow-sm"
    >
      <input type="hidden" name="capability" value={capability} />
      <p className="text-sm text-ink-700">
        Turn this on, then fill in a few details so it is ready to use.
      </p>
      <SubmitButton pendingLabel="Turning on…">
        {capability === 'worker' ? 'Activate work profile' : 'Register as training provider'}
      </SubmitButton>
      {state.error ? (
        <p role="alert" className="text-sm font-semibold text-red-800">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}