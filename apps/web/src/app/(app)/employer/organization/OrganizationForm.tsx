'use client';

import { useActionState, useEffect, useState } from 'react';
import { saveProfile } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { locateMessage, useGeolocation } from '@/lib/use-geolocation';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';

/**
 * The employer's public identity and the point their searches measure from.
 *
 * The page opens as a statement about the organization — its name and its
 * search location — rather than a form, and editing starts on request. Both
 * fields are one profile row, so they save together; neither is the person's
 * own name, which is why this is not part of Profile.
 *
 * The location is optional and says so plainly: with nothing set, searches are
 * not filtered by distance rather than silently measured from a stale point.
 */
export function OrganizationForm({
  organizationName,
  locationGps,
}: {
  organizationName: string | null;
  locationGps: string | null;
}) {
  const [state, action] = useActionState(saveProfile, EMPTY_FORM as FormState);
  const { state: locateState, locate } = useGeolocation();

  const [editing, setEditing] = useState(false);
  const [prefill, setPrefill] = useState(() => splitGps(locationGps));
  // Bumped when a device fix arrives so the inputs remount on the new value.
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    if (state.done === true) setEditing(false);
  }, [state.done]);

  async function fillFromDevice(): Promise<void> {
    const fix = await locate();
    if (!fix) return;
    setPrefill([fix.latitude.toFixed(6), fix.longitude.toFixed(6)]);
    setSeed((n) => n + 1);
  }

  if (!editing) {
    return (
      <div className="mt-3">
        <dl className="flex flex-col gap-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Organization name
            </dt>
            <dd className="mt-1 text-base text-ink-900">
              {organizationName?.trim() || <span className="text-ink-500">Not set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Search location
            </dt>
            <dd className="mt-1 text-base text-ink-900">
              {locationGps ? (
                describeLocation(locationGps)
              ) : (
                <span className="text-ink-500">
                  Not set — searches are not filtered by distance.
                </span>
              )}
            </dd>
          </div>
        </dl>

        <FormSuccess when={state.done === true}>Organization details saved.</FormSuccess>

        <div className="mt-4">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit organization
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="mt-3 flex flex-col gap-4">
      <Field
        name="organizationName"
        label="Organization name"
        defaultValue={organizationName ?? ''}
        maxLength={200}
        placeholder="Acme Solar Ltd"
        required
        error={state.field === 'organizationName' ? state.error : undefined}
        hint="Workers see this on an invitation. Without it they see only your account name."
      />

      <fieldset className="rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">Search location</legend>
        <p className="mb-4 text-sm text-ink-600">
          Distances in search results are measured from here.{' '}
          {locationGps
            ? 'Currently set. Clear both fields below to turn it off.'
            : 'Nothing is set yet, so distance is not part of any search.'}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            key={`latitude-${seed}`}
            name="latitude"
            label="Latitude"
            inputMode="decimal"
            defaultValue={prefill[0]}
            step="any"
            error={state.field === 'latitude' ? state.error : undefined}
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
      <FormSuccess when={state.done === true}>Organization details saved.</FormSuccess>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <SubmitButton pendingLabel="Saving…" className="sm:w-auto">
          Save
        </SubmitButton>
        <Button variant="secondary" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function describeLocation(gps: string): string {
  const [latitude, longitude] = gps.split(',');
  return `${latitude?.trim() ?? ''}, ${longitude?.trim() ?? ''}`;
}

function splitGps(value: string | null): [string, string] {
  if (!value) return ['', ''];
  const [latitude, longitude] = value.split(',');
  return [latitude ?? '', longitude ?? ''];
}
