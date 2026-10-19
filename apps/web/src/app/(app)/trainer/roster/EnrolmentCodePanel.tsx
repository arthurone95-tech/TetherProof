'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { generateEnrolmentCode } from '@/lib/actions';
import { EMPTY_MILESTONE } from '@/lib/form-state';

/**
 * The institute's enrolment code.
 *
 * Only a digest of the code is kept, so the raw value exists in exactly one place:
 * this panel, immediately after it is generated. That is why the code is shown in
 * large type with a copy control rather than quietly filed away, and why losing it
 * is not a problem worth a support request — generating another is the whole remedy.
 *
 * Rotating invalidates the previous code. It does not remove anybody already
 * enrolled, because enrolment is a row that already exists rather than a property of
 * the code, so a director can rotate on a schedule without invalidating a link they
 * are about to hand out.
 */
export function EnrolmentCodePanel({
  hasActiveCode,
  organizationName,
}: {
  hasActiveCode: boolean;
  organizationName: string | null;
}) {
  const [state, formAction] = useActionState(generateEnrolmentCode, EMPTY_MILESTONE);
  const [copied, setCopied] = useState(false);

  const code = state.enrolmentCode;

  function copy(): void {
    if (!code) return;
    void navigator.clipboard?.writeText(code);
    setCopied(true);
  }

  return (
    <section
      aria-labelledby="enrolment-code-heading"
      className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm">
          <KeyRound aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="enrolment-code-heading" className="text-sm font-bold text-ink-900">
            Enrolment code
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">
            {/* One line. The previous version explained what the digest means, when to
                regenerate, and how a student redeems it — none of which a person needs
                standing in front of a button whose label already says what it does. */}
            {organizationName
              ? `Share this with your students at ${organizationName}.`
              : 'Share this with your students.'}
          </p>

          {code ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="rounded-xl border border-brand-200 bg-white px-4 py-3 font-mono text-lg font-bold tracking-[0.2em] text-ink-900">
                {code}
              </code>
              <button
                type="button"
                onClick={copy}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-brand-200 bg-white px-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
              >
                {copied ? (
                  <Check aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
                ) : (
                  <Copy aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
                )}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <form action={formAction} className="mt-3">
              <SubmitButton pendingLabel="Generating…" variant="secondary">
                {hasActiveCode ? 'Generate a new code' : 'Create an enrolment code'}
              </SubmitButton>
            </form>
          )}

          {state.error ? (
            <p role="alert" className="mt-2 text-xs font-semibold text-red-800">
              {state.error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
