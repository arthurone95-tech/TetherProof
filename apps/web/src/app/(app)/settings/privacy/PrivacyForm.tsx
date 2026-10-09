'use client';

import { useActionState, useState } from 'react';
import type { InvitationPreference } from '@tetherproof/shared';
import { Check, Copy } from 'lucide-react';
import { savePrivacySetting } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { SubmitButton } from '@/components/ui/SubmitButton';

interface PrivacyFormProps {
  discoverable: boolean;
  publicProfile: boolean;
  publicSlug: string | null;
  invitationPreference: InvitationPreference;
}

const INVITATION_OPTIONS: Array<{
  value: InvitationPreference;
  label: string;
  description: string;
}> = [
  {
    value: 'all',
    label: 'Any approved employer',
    description: 'Any employer whose account is allowed to send invitations can reach you.',
  },
  {
    value: 'approved_only',
    label: 'Only reviewed employers',
    description:
      'Only employers whose account has been reviewed and approved can reach you. The stronger setting.',
  },
];

/**
 * The worker's three privacy choices, saved in one form.
 *
 * A checkbox submits "on" or nothing at all, so the two visibility toggles are
 * read as "present means true" — which is also why each keeps its `defaultChecked`
 * from the API rather than doing anything clever: the form always says what the
 * account already holds until the member changes it. The invitation preference
 * is radio-empty-proof, so it is the only control whose absence is checked
 * before the whole form is refused with "nothing to change".
 *
 * Enabling the public page shows its address right away, built the same way the
 * profile card builds it — from the browser's own origin, because the server
 * cannot know which alias the deployment was reached through.
 */
export function PrivacyForm({
  discoverable,
  publicProfile,
  publicSlug,
  invitationPreference,
}: PrivacyFormProps) {
  const [state, action] = useActionState(savePrivacySetting, EMPTY_FORM as FormState);
  const [copied, setCopied] = useState(false);
  const href = publicProfile && publicSlug ? `/share/${publicSlug}` : null;

  async function copyLink(): Promise<void> {
    if (!href) return;
    const url = `${window.location.origin}${href}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the address is still on screen.
    }
  }

  return (
    <form action={action} className="mt-4 flex flex-col gap-6">
      <fieldset className="rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">Found in searches</legend>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="discoverable"
            defaultChecked={discoverable}
            className="mt-1 h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="min-w-0">
            <span className="block font-medium text-ink-900">Let employers find me</span>
            <span className="mt-0.5 block text-sm text-ink-600">
              When on, you appear in employer search results and can match their specs. Turning it
              off stops new matches — invitations and offers already sent stay where they are.
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">Who may invite you</legend>
        <div className="flex flex-col gap-3">
          {INVITATION_OPTIONS.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="invitationPreference"
                value={option.value}
                defaultChecked={invitationPreference === option.value}
                className="mt-1 h-4 w-4 border-brand-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="min-w-0">
                <span className="block font-medium text-ink-900">{option.label}</span>
                <span className="mt-0.5 block text-sm text-ink-600">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">Public capability page</legend>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="publicProfile"
            defaultChecked={publicProfile}
            className="mt-1 h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="min-w-0">
            <span className="block font-medium text-ink-900">Let anyone with the link see my verified skills</span>
            <span className="mt-0.5 block text-sm text-ink-600">
              Creates a page at a private address showing only your skills and verified counts —
              never your media, location, or contact details. The address cannot be searched for;
              only people you share it with can open it. Turning the page off takes it down.
            </span>
          </span>
        </label>

        {href ? (
          <div className="mt-3 rounded-xl border border-emerald-200/70 bg-emerald-50 p-3">
            <p className="text-sm text-emerald-900">Your capability page</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 text-sm text-ink-800">
                {href}
              </code>
              <button
                type="button"
                onClick={copyLink}
                aria-label="Copy the link to your capability page"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700"
              >
                {copied ? (
                  <Check aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
                ) : (
                  <Copy aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
                )}
              </button>
            </div>
          </div>
        ) : null}
      </fieldset>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}
      <FormSuccess when={state.done === true}>Privacy choices saved.</FormSuccess>
      <div>
        <SubmitButton pendingLabel="Saving…" className="sm:w-auto">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}