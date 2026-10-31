'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
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
 * The person behind the account: their photo, their name, and — for a worker —
 * the point a distance is measured from.
 *
 * The page opens showing what the account says rather than a form to change it —
 * the read-only view answers "who am I", and editing starts only when asked. A
 * glance at the page is then a statement about the account instead of a list of
 * empty boxes.
 *
 * The employer's company identity does not live here: the organization name and
 * the search location are what candidates and an administrator see, and they
 * must not be a second, drifting copy of the Organization page. So for an
 * employer this form edits personal details only and points at Organization for
 * the rest, while a worker keeps their own location, which is personal to them.
 *
 * The photo is changed by tapping it. `AvatarEditor` is the one sheet that
 * uploads or removes it, so there is no second place that decides what a photo
 * is — the API is the only writer of the column.
 */
export function ProfileForm({
  showOrganizationName,
  fullName,
  locationGps,
  avatarUrl,
}: {
  /**
   * Whether the organisation field is shown.
   *
   * Decided by the page from the capability set rather than by the form, so the rule about
   * who has an organisation lives in one place. It used to be `role === 'employer'`, which
   * meant a trainer could not see the institute they were signing credentials for.
   */
  showOrganizationName: boolean;
  fullName: string | null;
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
  // Bumped when a device fix arrives so the hidden inputs remount on the new value.
  // The `seed` itself is not read: it exists only to force a remount, because the inputs
  // are uncontrolled and a form that has been submitted keeps whatever it held.
  const [, setSeed] = useState(0);

  // Whether the organisation field is shown, decided by the page from the capability set.
  // The form does not decide for itself, so the rule lives in one place.

  async function fillFromDevice(): Promise<void> {
    const fix = await locate();
    if (!fix) return;
    setPrefill([fix.latitude.toFixed(6), fix.longitude.toFixed(6)]);
    setSeed((n) => n + 1);
  }

  /**
   * Removes the stored location.
   *
   * Kept as an explicit action because "no location" is a real choice — searches then run
   * without a distance filter — and it is now the only way to express it, since the
   * coordinates can no longer be typed.
   */
  function clearLocation(): void {
    setPrefill(['', '']);
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
            <p className="truncate text-sm text-ink-600">
              {showOrganizationName ? 'Your personal account' : 'Your account'}
            </p>
            {!showOrganizationName ? (
              <p className="truncate text-sm text-ink-600">
                {locationGps ? describeLocation(locationGps) : 'No location set.'}
              </p>
            ) : null}
          </div>
        </div>

        <FormSuccess when={state.done === true}>Your details are saved.</FormSuccess>

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
          hint={
            showOrganizationName
              ? 'Your personal name. Candidates see the organization name on their invitation.'
              : undefined
          }
        />

        {showOrganizationName ? (
          <p className="rounded-xl bg-brand-50 p-3 text-sm text-ink-700">
            Company details and the search location are on the{' '}
            <Link href="/employer/organization" className="font-semibold text-brand-700 underline">
              Organization page
            </Link>
            .
          </p>
        ) : (
          <fieldset className="rounded-xl border border-brand-100 p-4">
            <legend className="px-1 text-sm font-medium text-ink-900">Your location</legend>
            <p className="mb-4 text-sm text-ink-600">
              Employers can narrow a search by distance, and yours is measured from this
              point. {locationGps ? 'Currently set.' : 'Nothing is set yet, so you are not filtered by distance.'}
            </p>

            {/*
              The latitude and longitude inputs were removed. Nothing else changed: the
              coordinates are still stored, still validated by the API and still used for
              proximity search — they are just no longer typed by hand. "Use my location"
              below sets the same value, and "Clear" removes it, which is the only reason a
              person ever needed to enter a number here: to say "no location".

              Typing them invited a class of error with no upside. A mistyped pair is silently
              a wrong place, which is worse than no place, and nothing in the old layout
              signalled which of two six-digit numbers had been got wrong.
            */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button
                type="button"
                onClick={fillFromDevice}
                disabled={locateState === 'locating'}
                className="inline-flex min-h-11 items-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {locateState === 'locating' ? 'Finding you…' : 'Use my location'}
              </button>
              {locationGps ? (
                <button
                  type="button"
                  onClick={clearLocation}
                  className="min-h-11 rounded-xl px-3 text-sm font-semibold text-ink-600 transition-colors hover:text-ink-900"
                >
                  Clear
                </button>
              ) : null}
              <p className="text-sm text-ink-600">Not sharing is fine.</p>
            </div>

            {/* Keeps the same form fields the action reads, so the location the person just
                accepted is submitted without the inputs ever being on screen. */}
            <input type="hidden" name="latitude" value={prefill[0]} readOnly />
            <input type="hidden" name="longitude" value={prefill[1]} readOnly />

            {locateMessage(locateState) ? (
              <p role="status" className="mt-2 text-sm text-ink-600">
                {locateMessage(locateState)}
              </p>
            ) : null}
          </fieldset>
        )}

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
