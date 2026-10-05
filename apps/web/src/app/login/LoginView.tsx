'use client';

import { useActionState, useState } from 'react';
import { confirmWithCode, registerAccount, requestCode, signIn } from '@/lib/actions';
import { EMPTY_FORM } from '@/lib/form-state';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';

type Panel = 'sign-in' | 'register' | 'confirm';

const PANELS: Record<Panel, { heading: string; blurb: string }> = {
  'sign-in': {
    heading: 'Sign in',
    blurb: 'Use the email address and password you registered with.',
  },
  register: {
    heading: 'Create an account',
    blurb: 'Workers record proof of work. Employers search it.',
  },
  confirm: {
    heading: 'Confirm your account',
    blurb: 'Enter the code we sent you. It confirms that this address belongs to you.',
  },
};

/**
 * Sign-in, registration, and code confirmation.
 *
 * All three run as server actions so the API's access token never reaches the
 * browser; the only client state here is which panel is showing. The API's messages
 * are written to be shown as-is, so an error is rendered directly rather than
 * replaced with something vaguer.
 */
export function LoginView() {
  const [panel, setPanel] = useState<Panel>('sign-in');

  const [signInState, signInAction] = useActionState(signIn, EMPTY_FORM);
  const [registerState, registerAction] = useActionState(registerAccount, EMPTY_FORM);
  const [requestState, requestAction] = useActionState(requestCode, EMPTY_FORM);
  const [confirmState, confirmAction] = useActionState(confirmWithCode, EMPTY_FORM);

  const copy = PANELS[panel];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <Card>
        <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">TetherProof</p>
        <h1 className="mt-2 text-2xl font-bold text-ink-900">{copy.heading}</h1>
        <p className="mt-2 text-ink-600">{copy.blurb}</p>

        {panel === 'sign-in' ? (
          <form action={signInAction} className="mt-6 flex flex-col gap-4">
            <Field
              name="email"
              label="Email address"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              error={signInState.field === 'email' ? signInState.error : undefined}
            />
            <Field
              name="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              error={signInState.field === 'password' ? signInState.error : undefined}
            />
            {signInState.error && !signInState.field ? <FormError message={signInState.error} /> : null}
            <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
            <PanelSwitch
              onSignIn={() => setPanel('register')}
              onConfirm={() => setPanel('confirm')}
            />
          </form>
        ) : null}

        {panel === 'register' ? (
          <form action={registerAction} className="mt-6 flex flex-col gap-4">
            <Field
              name="fullName"
              label="Your name"
              autoComplete="name"
              required
              error={registerState.field === 'fullName' ? registerState.error : undefined}
            />
            <Field
              name="email"
              label="Email address"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              error={registerState.field === 'email' ? registerState.error : undefined}
            />
            <Field
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              required
              hint="At least 12 characters, with an uppercase letter, a lowercase letter, and a number."
              error={registerState.field === 'password' ? registerState.error : undefined}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="role" className="text-sm font-medium text-ink-900">
                I am signing up as
              </label>
              <select
                id="role"
                name="role"
                defaultValue="worker"
                className="min-h-12 w-full rounded-xl border border-brand-100 bg-white px-4 text-base text-ink-900"
              >
                <option value="worker">A worker</option>
                <option value="employer">An employer</option>
                <option value="training_provider">A training provider</option>
              </select>
            </div>
            {registerState.error ? <FormError message={registerState.error} /> : null}
            <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
            {registerState.sentTo ? (
              <div role="status" aria-live="polite" className="rounded-xl bg-brand-50 p-4 text-sm text-ink-900">
                <p className="font-semibold">Check {registerState.sentTo}</p>
                <p className="mt-1 text-ink-600">
                  We sent a sign-in code. Enter it below to finish setting up your account.
                </p>
                <button
                  type="button"
                  onClick={() => setPanel('confirm')}
                  className="mt-3 text-sm font-semibold text-brand-700 underline"
                >
                  Enter the code
                </button>
              </div>
            ) : null}
            <PanelSwitch
              onSignIn={() => setPanel('sign-in')}
              onConfirm={() => setPanel('confirm')}
              signInLabel="I already have an account"
            />
          </form>
        ) : null}

        {panel === 'confirm' ? (
          <div className="mt-6 flex flex-col gap-6">
            <form action={requestAction} className="flex flex-col gap-4">
              <Field
                name="email"
                label="Email address"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                error={requestState.field === 'email' ? requestState.error : undefined}
              />
              <SubmitButton variant="secondary" pendingLabel="Sending…">
                Send me a code
              </SubmitButton>
              {requestState.error ? <FormError message={requestState.error} /> : null}
              {requestState.sentTo ? (
                <p role="status" aria-live="polite" className="text-sm text-ink-600">
                  If that address has an account, a code is on its way to {requestState.sentTo}. Enter it
                  below.
                </p>
              ) : null}
            </form>

            <form action={confirmAction} className="flex flex-col gap-4 border-t border-brand-100 pt-6">
              <Field
                name="email"
                label="Email address"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                error={confirmState.field === 'email' ? confirmState.error : undefined}
              />
              <Field
                name="code"
                label="Code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                error={confirmState.field === 'code' ? confirmState.error : undefined}
              />
              {confirmState.error ? <FormError message={confirmState.error} /> : null}
              <SubmitButton pendingLabel="Checking…">Confirm and sign in</SubmitButton>
            </form>

            <button
              type="button"
              onClick={() => setPanel('sign-in')}
              className="self-start text-sm font-semibold text-brand-700 underline"
            >
              Back to sign in
            </button>
          </div>
        ) : null}
      </Card>
    </main>
  );
}

function PanelSwitch({
  onSignIn,
  onConfirm,
  signInLabel = 'I already have an account',
}: {
  onSignIn: () => void;
  onConfirm: () => void;
  signInLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-brand-100 pt-4 text-sm">
      <button type="button" onClick={onSignIn} className="font-semibold text-brand-700 underline">
        {signInLabel}
      </button>
      <button type="button" onClick={onConfirm} className="font-semibold text-brand-700 underline">
        I have a sign-in code
      </button>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
      {message}
    </p>
  );
}