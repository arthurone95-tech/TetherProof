'use client';

import { useActionState, useState } from 'react';
import type { UserRole } from '@tetherproof/shared';
import { saveProfile } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { locateMessage, useGeolocation } from '@/lib/use-geolocation';
import { Field } from '@/components/ui/Field';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';

/**
 * The member's own details: their name, their organisation if they have one, and
 * the point distances are measured from.
 *
 * One form for both roles rather than two that write the same row, because the
 * differences are about which fields exist and not about how any of them are
 * saved. An employer gets the organisation name because that is what a worker
 * reads on an invitation; a worker does not, because there is nothing for it to
 * hold.
 *
 * The location is optional and says so in as many words: leaving it blank means
 * searches run without a distance filter rather than silently measuring from a
 * stale point.
 */
export function ProfileForm({
  role,
  fullName,
  organizationName,
  locationGps,
}: {
  role: UserRole;
  fullName: string | null;
  organizationName: string | null;
  locationGps: string | null;
}) {
  const [state, action] = useActionState(saveProfile, EMPTY_FORM as FormState);
  const { state: locateState, locate } = useGeolocation();

  const [prefill, setPrefill] = useState(() => splitGps(locationGps));
  // Bumped when a device fix arrives so the inputs remount on the new value.
  // They are uncontrolled — a form that has been submitted keeps whatever the
  // person typed — so there is no state to write the value into directly.
  const [seed, setSeed] = useState(0);

  const isEmployer = role === 'employer';

  async function fillFromDevice(): Promise<void> {
    const fix = await locate();
    if (!fix) return;
    setPrefill([fix.latitude.toFixed(6), fix.longitude.toFixed(6)]);
    setSeed((n) => n + 1);
  }

  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      <Field
        name="fullName"
        label="Your name"
        defaultValue={fullName ?? ''}
        maxLength={160}
        autoComplete="name"
        placeholder="Ama Mensah"
        required
        error={state.field === 'fullName' ? state.error : undefined}
      />

      {isEmployer ? (
        <Field
          name="organizationName"
          label="Organization name"
          defaultValue={organizationName ?? ''}
          maxLength={200}
          placeholder="Acme Solar Ltd"
          error={state.field === 'organizationName' ? state.error : undefined}
          hint="Workers see this on an invitation. Without it they see only your account name."
        />
      ) : null}

      <fieldset className="rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">
          {isEmployer ? 'Search location' : 'Your location'}
        </legend>
        <p className="mb-4 text-sm text-ink-600">
          {isEmployer
            ? 'Distances in search results are measured from here.'
            : 'Employers can narrow a search by distance, and yours is measured from this point.'}{' '}
          {locationGps
            ? 'Currently set. Clear both fields below to turn it off.'
            : 'Nothing is set yet, so you are not filtered by distance.'}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            key={`latitude-${seed}`}
            name="latitude"
            label="Latitude"
            inputMode="decimal"
            defaultValue={prefill[0]}
            step="any"
          />
          <Field
            key={`longitude-${seed}`}
            name="longitude"
            label="Longitude"
            inputMode="decimal"
            defaultValue={prefill[1]}
            step="any"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={fillFromDevice}
            disabled={locateState === 'locating'}
            className="inline-flex min-h-11 items-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {locateState === 'locating' ? 'Finding you…' : 'Use my location'}
          </button>
          <p className="text-sm text-ink-600">
            Decimal degrees, for example 5.6037 and -0.1870. Clear both to remove it.
          </p>
        </div>

        {locateMessage(locateState) ? (
          <p role="status" className="mt-2 text-sm text-ink-600">
            {locateMessage(locateState)}
          </p>
        ) : null}
      </fieldset>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}
      <FormSuccess when={state.done === true}>Your details are saved.</FormSuccess>
      <SubmitButton pendingLabel="Saving…" className="sm:w-auto">
        Save
      </SubmitButton>
    </form>
  );
}

function splitGps(value: string | null): [string, string] {
  if (!value) return ['', ''];
  const [latitude, longitude] = value.split(',');
  return [latitude ?? '', longitude ?? ''];
}
