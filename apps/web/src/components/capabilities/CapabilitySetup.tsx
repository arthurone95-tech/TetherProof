'use client';

import { useActionState } from 'react';
import type { ReactNode } from 'react';
import type { UserCapability } from '@tetherproof/shared';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { activateCapability, createBusiness } from '@/lib/actions';
import { EMPTY_BUSINESS, EMPTY_CAPABILITY } from '@/lib/form-state';

/**
 * The setup action for one capability.
 *
 * Shared by `/setup/[capability]` and the settings list, because the two must not be able
 * to disagree about what setting a capability up involves. A page that offered its own
 * version would be a second answer to one question, and the copy is where people look when
 * something is refusing.
 *
 * ## Two shapes, and the difference is not cosmetic
 *
 * A self-service capability offers a button. One that needs somebody else's approval offers
 * the route instead, **with no button at all** — a button that leads to a refusal teaches
 * the person the app disagrees with itself, and they will go looking for somewhere less
 * safe to try.
 *
 * The employer case opens the business form inline rather than linking away, because setting
 * up a business is how a person *earns* the employer capability and the two are one action
 * to them even though they are two writes.
 */
export function CapabilitySetup({
  capability,
  howToActivate,
  icon,
}: {
  capability: UserCapability;
  /** One line saying what this capability is for, from the server. */
  howToActivate: string;
  icon: ReactNode;
}) {
  // Both hooks are called unconditionally. The component's identity is decided by the
  // props, and swapping hooks on a prop change would leave a form whose state belonged to
  // the other one.
  const [activated, activate] = useActionState(activateCapability, EMPTY_CAPABILITY);
  const [business, createBusinessAction] = useActionState(createBusiness, EMPTY_BUSINESS);

  if (capability === 'employer') {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            {icon}
          </span>
          <p className="min-w-0 text-sm text-ink-600">{howToActivate}</p>
        </div>

        <form action={createBusinessAction} className="flex flex-col gap-2">
          <label htmlFor="business-name" className="text-xs font-semibold text-ink-800">
            Business name
          </label>
          <input
            id="business-name"
            name="name"
            required
            minLength={2}
            maxLength={200}
            placeholder="Kojo Electrical Services"
            className="min-h-12 w-full rounded-xl border border-brand-100 bg-white px-4 text-base text-ink-900"
          />
          <SubmitButton pendingLabel="Creating…" variant="secondary">
            Set up business
          </SubmitButton>
          {business.error ? (
            <p role="alert" className="text-sm font-semibold text-red-800">
              {business.error}
            </p>
          ) : null}
          {business.done ? (
            <FormSuccess when>
              Business created and waiting for review. You can keep working while it is
              reviewed — hiring opens once it is approved.
            </FormSuccess>
          ) : null}
        </form>
      </div>
    );
  }

  if (capability === 'trainee') {
    // No button, and deliberately so: there is nothing to press until an institute issues a
    // code. Offering an "Activate" button here would create a capability the server refuses,
    // which is the refusal the two-shape rule above exists to avoid.
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm text-ink-600">{howToActivate}</p>
          <p className="mt-2 text-xs text-ink-500">
            Ask your institute for an enrolment code, then enter it on your credentials page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form
      action={activate}
      className="flex flex-col gap-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-5 shadow-sm"
    >
      <input type="hidden" name="capability" value={capability} />
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm">
          {icon}
        </span>
        <p className="min-w-0 text-sm text-ink-600">{howToActivate}</p>
      </div>

      <SubmitButton pendingLabel="Setting up…">
        {capability === 'worker' ? 'Activate work profile' : 'Register as training provider'}
      </SubmitButton>
      {activated.error ? (
        <p role="alert" className="text-sm font-semibold text-red-800">
          {activated.error}
        </p>
      ) : null}
    </form>
  );
}