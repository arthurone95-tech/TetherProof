'use client';

import { useActionState, useEffect, useState } from 'react';
import type { UserRole } from '@tetherproof/shared';
import { Pencil } from 'lucide-react';
import { saveProfile } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { locateMessage, useGeolocation } from '@/lib/use-geolocation';
import { ProfileAvatar } from '@/components/shell/ProfileAvatar';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { AvatarEditor } from './AvatarEditor';

/**
 * The member's own details: their photo, name, organisation, and the point
 * distances are measured from.
 *
 * The page opens showing what the account says rather than a form to change it —
 * the read-only view is the answer to "who am I", and editing starts only when
 * the person asks for it. That keeps an ordinary visit from looking like a form
 * was dropped on them, and means a glance at the page is a statement about the
 * account instead of a list of empty boxes.
 *
 * One form for both roles rather than two that write the same row, because the
 * differences are about which fields exist and not about how any of them are
 * saved. An employer gets the organisation name because that is what a worker
 * reads on an invitation; a worker does not, because there is nothing for it to
 * hold.
 *
 * The photo is changed by tapping the photo. That opens `AvatarEditor`, one
 * sheet with the picture, a pencil and a trash button, and Save and Cancel —
 * the upload and remove actions it runs are the only writers of the photo (the
 * API is the only writer of the column: there is no client-supplied avatar URL
 * anywhere). The signed URL the API returns expires, so the page refetches it
 * with every navigation rather than caching a picture that can no longer be
 * opened.
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
  avatarUrl,
}: {
  role: UserRole;
  fullName: string | null;
  organizationName: string | null;
  locationGps: string | null;
  avatarUrl: string | null;
}) {
  const [state, action] = useActionState(saveProfile, EMPTY_FORM as FormState);
  const { state: locateState, locate } = useGeolocation();

  const [editing, setEditing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  // A saved form returns to the read-only view, so the page shows what it now holds.
  useEffect(() => {
    if (state.done === true) setEditing(false);
  }, [state.done]);

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

  // Tapping the photo is how a photo is changed, in view mode or edit mode; in
  // view mode it also moves into the edit screen so saving has a form to land in.
  function changePhoto(): void {
    if (!editing) setEditing(true);
    setEditorOpen(true);
  }

  if (!editing) {
    return (
      <div className="mt-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={changePhoto}
            aria-label="Change your profile photo"
            className="group relative shrink-0 rounded-full"
          >
            <ProfileAvatar avatarUrl={avatarUrl} size="md" alt="Your profile photo" />
            <EditBadge />
          </button>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-ink-900">{fullName ?? '—'}</p>
            {isEmployer && organizationName ? (
              <p className="truncate text-sm text-ink-600">{organizationName}</p>
            ) : null}
            <p className="truncate text-sm text-ink-600">
              {locationGps ? describeLocation(locationGps) : 'No location set.'}
            </p>
          </div>
        </div>

        {state.done === true ? (
          <FormSuccess when>Your details are saved.</FormSuccess>
        ) : null}

        <div className="mt-4">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit profile
          </Button>
        </div>

        {editorOpen ? <AvatarEditor avatarUrl={avatarUrl} onClose={() => setEditorOpen(false)} /> : null}
      </div>
    );
  }

  return (
    <>
      <fieldset className="mt-4 rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">Profile photo</legend>

        <div className="flex flex-col items-center gap-2 py-1">
          <button
            type="button"
            onClick={changePhoto}
            aria-label="Change your profile photo"
            className="group relative rounded-full"
          >
            <ProfileAvatar avatarUrl={avatarUrl} size="md" alt="Your profile photo" />
            <EditBadge />
          </button>
          <p className="text-xs text-ink-500">Tap the photo to change it.</p>
        </div>
      </fieldset>

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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <SubmitButton pendingLabel="Saving…" className="sm:w-auto">
            Save
          </SubmitButton>
          <Button variant="secondary" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>

      {editorOpen ? <AvatarEditor avatarUrl={avatarUrl} onClose={() => setEditorOpen(false)} /> : null}
    </>
  );
}

/**
 * The small pencil pinned to the avatar's corner, saying the photo is not a
 * picture but a button. Decorative: the tap target is the avatar itself.
 */
function EditBadge() {
  return (
    <span
      aria-hidden="true"
      className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white ring-2 ring-white"
    >
      <Pencil className="h-3.5 w-3.5" strokeWidth={ICON_STROKE_WIDTH} />
    </span>
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