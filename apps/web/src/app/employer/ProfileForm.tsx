'use client';

import { useActionState } from 'react';
import { saveProfile } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { Field } from '@/components/ui/Field';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';

/**
 * The employer's organization name and the point their searches measure from.
 *
 * Both live on one profile row, so they are saved together. The location is optional
 * and clearly described as such: leaving it blank means searches run without a
 * distance filter rather than silently measuring from a stale point.
 */
export function ProfileForm({
  organizationName,
  locationGps,
}: {
  organizationName: string | null;
  locationGps: string | null;
}) {
  const [state, action] = useActionState(saveProfile, EMPTY_FORM as FormState);
  const [latitude, longitude] = splitGps(locationGps);

  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      <Field
        name="organizationName"
        label="Organization name"
        defaultValue={organizationName ?? ''}
        maxLength={200}
        placeholder="Acme Solar Ltd"
        error={state.field === 'organizationName' ? state.error : undefined}
        hint="Workers see this on an invitation. Without it they see only your account name."
      />

      <fieldset className="rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">Search location</legend>
        <p className="mb-4 text-sm text-ink-600">
          Distances in search results are measured from here.{' '}
          {locationGps
            ? 'Currently set. Clear both fields below to turn distance filtering off.'
            : 'Nothing is set yet, so results are not filtered by distance.'}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="latitude" label="Latitude" inputMode="decimal" defaultValue={latitude} step="any" />
          <Field name="longitude" label="Longitude" inputMode="decimal" defaultValue={longitude} step="any" />
        </div>
        <p className="mt-3 text-sm text-ink-600">
          Decimal degrees, for example 5.6037 and -0.1870. Clear both to turn distance filtering off.
        </p>
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