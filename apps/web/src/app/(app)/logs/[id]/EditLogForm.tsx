'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { ProofDetail } from '@tetherproof/shared';
import { updateProof } from '@/lib/actions';
import { EMPTY_PROOF_EDIT, type ProofEditState } from '@/lib/form-state';
import { SKILL_LEVELS } from '@/lib/capabilities';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';

/**
 * The correction form for a log that has not been sent out for confirmation.
 *
 * Media cannot change — it was scrubbed and stored once — so the editable parts
 * are the words, the skill, and the location, matching what the API accepts on
 * a PATCH. The location boxes are seeded from the stored pair, so leaving both
 * empty is a deliberate removal and is sent as `submissionGps: null`.
 */
export function EditLogForm({ proof }: { proof: ProofDetail }) {
  const [state, formAction] = useActionState(updateProof, EMPTY_PROOF_EDIT as ProofEditState);
  const [existingLat = '', existingLng = ''] = proof.submissionGps?.split(',') ?? ['', ''];

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="proofId" value={proof.id} />

      <Field
        name="description"
        label="What you did"
        multiline
        rows={4}
        required
        maxLength={2000}
        defaultValue={proof.description}
        error={state.field === 'description' ? state.error : undefined}
        hint="At least 10 characters. The person confirming it reads this."
      />

      <Field
        name="skillTag"
        label="Skill this proves"
        required
        maxLength={160}
        defaultValue={proof.skillTag}
        error={state.field === 'skillTag' ? state.error : undefined}
        hint="One skill per job. Changing it moves this log to that skill's block."
      />

      <fieldset className="min-w-0 rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">Skill level</legend>
        <p className="mb-3 text-sm text-ink-600">
          The tier this skill sits at on your record. Levels accompany verified counts; they never
          replace them.
        </p>
        <div className="flex flex-col gap-3">
          {SKILL_LEVELS.map((entry) => (
            <label key={entry.level} className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="skillLevel"
                value={entry.level}
                defaultChecked={proof.skillLevel === entry.level}
                className="mt-1 h-4 w-4 border-brand-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-900">{entry.label}</span>
                <span className="block text-sm text-ink-600">{entry.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="min-w-0 rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">Where it happened</legend>
        <p className="mb-3 text-sm text-ink-600">
          Leave both boxes empty to remove the location from this log.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-900">
            Latitude
            <input
              type="text"
              name="lat"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={existingLat}
              placeholder="5.6037"
              aria-invalid={state.field === 'submissionGps' ? true : undefined}
              className="min-h-11 rounded-xl border border-brand-100 bg-white px-3 text-base text-ink-900 placeholder:text-ink-600/60"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-900">
            Longitude
            <input
              type="text"
              name="lng"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={existingLng}
              placeholder="-0.1870"
              aria-invalid={state.field === 'submissionGps' ? true : undefined}
              className="min-h-11 rounded-xl border border-brand-100 bg-white px-3 text-base text-ink-900 placeholder:text-ink-600/60"
            />
          </label>
        </div>
        {state.field === 'submissionGps' ? (
          <p role="alert" className="mt-2 text-sm font-medium text-red-800">
            {state.error}
          </p>
        ) : null}
      </fieldset>

      {state.error && !state.field ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
        <Link
          href={`/logs/${proof.id}`}
          className="inline-flex min-h-11 items-center rounded-xl border border-brand-100 px-4 text-sm font-semibold text-ink-600 transition-colors hover:border-brand-600 hover:text-brand-700"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}