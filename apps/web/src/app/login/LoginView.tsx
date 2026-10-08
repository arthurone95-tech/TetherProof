'use client';

import { useEffect, useActionState, useState } from 'react';
import { ArrowLeft, CircleAlert, Mail, ShieldCheck } from 'lucide-react';
import { confirmWithCode, registerAccount, requestCode, signIn } from '@/lib/actions';
import { EMPTY_FORM } from '@/lib/form-state';
import { PASSWORD_STRENGTH_LABEL, passwordStrength } from '@/lib/password-strength';
import { forgetRememberedEmail, readRememberedEmail, rememberEmail } from '@/lib/remembered-email';
import { Field } from '@/components/ui/Field';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { PasswordField } from '@/components/ui/PasswordField';
import { SubmitButton } from '@/components/ui/SubmitButton';

type Panel = 'sign-in' | 'register' | 'confirm';

const PANELS: Record<Panel, { heading: string; blurb?: string }> = {
  'sign-in': {
    heading: 'Welcome back',
    blurb: 'Sign in with the email and password you registered with.',
  },
  // No blurb: the tabs and role picker already say what this screen is for, and
  // a form that pushes past the bottom of a laptop screen is worse than a
  // missing sentence.
  register: {
    heading: 'Create your account',
  },
  confirm: {
    heading: 'Check your email',
    blurb: 'Enter the code we sent. It confirms that this address belongs to you.',
  },
};

const ROLES = [
  { value: 'worker', label: 'Worker' },
  { value: 'employer', label: 'Employer' },
  { value: 'training_provider', label: 'Training provider' },
] as const;

/**
 * Sign-in, registration, and code confirmation.
 *
 * All three run as server actions so the API's access token never reaches the
 * browser; the only client state here is which panel is showing and what has
 * been typed into the register panel. The API's messages are written to be shown
 * as-is, so an error is rendered directly rather than replaced with something
 * vaguer.
 */
export function LoginView() {
  const [panel, setPanel] = useState<Panel>('sign-in');

  // Typed on the register panel and carried to the confirm panel, because the
  // API only ever answers with a masked address. It is the reader's own address.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  /**
   * The sign-in panel's own two fields, kept apart from the register panel's.
   *
   * Controlled rather than left to the browser, because React resets an
   * uncontrolled form once its action finishes — whether it succeeded or failed.
   * A refused sign-in therefore used to come back to two empty boxes, which is the
   * worst possible moment to make somebody type a long password again. Holding
   * them here means a wrong letter is corrected rather than the whole field
   * retyped, and the password is still never written anywhere.
   */
  const [signInPassword, setSignInPassword] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);

  /**
   * Offer last time's address back, the way every ordinary site does.
   *
   * Read after mount rather than during the first render, because the value lives
   * in this browser's storage and the first render also happens on the server,
   * where there is no storage to read. A remembered address arriving a moment
   * after the box appears beats making the person type it again.
   */
  useEffect(() => {
    const remembered = readRememberedEmail();
    if (remembered) setEmail(remembered);
  }, []);

  const [signInState, signInAction] = useActionState(signIn, EMPTY_FORM);
  const [registerState, registerAction] = useActionState(registerAccount, EMPTY_FORM);
  const [requestState, requestAction] = useActionState(requestCode, EMPTY_FORM);
  const [confirmState, confirmAction] = useActionState(confirmWithCode, EMPTY_FORM);

  // Registration is followed by verification, so the flow moves there itself.
  // Keyed on the whole state, not `sentTo`: every attempt returns a fresh
  // object, so registering twice switches screens twice even when the masked
  // address comes back identical.
  useEffect(() => {
    if (registerState.sentTo) setPanel('confirm');
  }, [registerState]);

  // Live mismatch with the server's answer as the backstop. Shown only once the
  // second box has something in it.
  const mismatch =
    confirmPassword.length > 0 && confirmPassword !== password
      ? 'Those passwords do not match.'
      : undefined;
  const confirmError =
    mismatch ?? (registerState.field === 'confirmPassword' ? registerState.error : undefined);

  const copy = PANELS[panel];
  const showTabs = panel !== 'confirm';

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-50 px-4 py-10">
      {/* Two soft blurred shapes behind the card; purely atmospheric. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-brand-100 opacity-70 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -bottom-32 h-96 w-96 rounded-full bg-brand-100 opacity-50 blur-3xl"
      />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
            <ShieldIcon />
          </span>
          <span className="text-xl font-bold tracking-tight text-ink-900">TetherProof</span>
        </div>

        <div className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-xl shadow-brand-700/10 ring-1 ring-brand-100 backdrop-blur sm:p-8">
          {showTabs ? <Tabs panel={panel} onChange={setPanel} /> : <MailBadge />}

          <h1
            className={`text-2xl font-bold tracking-tight text-ink-900 ${showTabs ? 'mt-6' : 'mt-4 text-center'}`}
          >
            {copy.heading}
          </h1>
          {copy.blurb ? (
            <p className={`mt-1.5 text-ink-600 ${showTabs ? '' : 'text-center'}`}>{copy.blurb}</p>
          ) : null}

          {panel === 'sign-in' ? (
            <form
              action={signInAction}
              className="mt-6 flex flex-col gap-4"
              /*
                Saves the address at the moment a sign-in is attempted, which is
                when a browser normally would — and never the password, which
                `lib/remembered-email.ts` explains in full. Unticking the box
                erases what was saved, so the choice is the reader's rather than
                the application's.
              */
              onSubmit={() => {
                if (remember) rememberEmail(email);
                else forgetRememberedEmail();
              }}
            >
              <Field
                name="email"
                label="Email address"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                required
                error={signInState.field === 'email' ? signInState.error : undefined}
              />
              <PasswordField
                name="password"
                label="Password"
                autoComplete="current-password"
                value={signInPassword}
                onChange={setSignInPassword}
                required
                error={signInState.field === 'password' ? signInState.error : undefined}
              />
              <label className="-mt-1 flex w-fit cursor-pointer items-center gap-2 text-sm text-ink-600">
                <input
                  type="checkbox"
                  name="rememberEmail"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="h-4 w-4 rounded border-brand-100 accent-brand-600"
                />
                Remember my email on this device
              </label>
              {signInState.error && !signInState.field ? (
                <FormError message={signInState.error} />
              ) : null}
              <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
              <CodeLink onConfirm={() => setPanel('confirm')} />
            </form>
          ) : null}

          {/* Two fields to a row from 640px up; below that the pairs stack. */}
          {panel === 'register' ? (
            <form action={registerAction} className="mt-6 flex flex-col gap-3.5">
              <div className="grid gap-3.5 sm:grid-cols-2">
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
                  value={email}
                  onChange={setEmail}
                  required
                  error={registerState.field === 'email' ? registerState.error : undefined}
                />
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <PasswordField
                  name="password"
                  label="Password"
                  autoComplete="new-password"
                  required
                  linkedHintId="password-hint"
                  onChange={setPassword}
                  error={registerState.field === 'password' ? registerState.error : undefined}
                />
                {/*
                  The rules run across both columns rather than sitting inside the
                  left one, where the sentence stopped at the middle of the card.
                  Second in the DOM so that on a phone they land directly under the
                  box they describe; `sm:order-1` moves them below the pair once
                  there is a wider card to put them on.
                */}
                <p id="password-hint" className="text-sm text-ink-600 sm:order-1 sm:col-span-2">
                  12+ characters: upper, lower and a number.
                </p>
                {/* The meter grades the first box but sits under the second, where
                    the person has just stopped typing. */}
                <div className="flex flex-col gap-1.5">
                  <PasswordField
                    name="confirmPassword"
                    label="Confirm password"
                    autoComplete="new-password"
                    required
                    onChange={setConfirmPassword}
                    error={confirmError}
                  />
                  <PasswordStrengthMeter value={password} />
                </div>
              </div>

              <RolePicker />

              {registerState.error && !registerState.field ? (
                <FormError message={registerState.error} />
              ) : null}
              <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
              <CodeLink onConfirm={() => setPanel('confirm')} />
            </form>
          ) : null}

          {panel === 'confirm' ? (
            <div className="mt-6 flex flex-col gap-6">
              {registerState.sentTo ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-2xl bg-brand-50 p-4 text-center ring-1 ring-brand-100"
                >
                  <p className="text-sm text-ink-600">Code sent to</p>
                  <p className="mt-0.5 text-base font-semibold break-all text-ink-900">
                    {registerState.sentTo}
                  </p>
                </div>
              ) : null}

              <form action={confirmAction} className="flex flex-col gap-4">
                <Field
                  name="email"
                  label="Email address"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={setEmail}
                  required
                  error={confirmState.field === 'email' ? confirmState.error : undefined}
                />
                <Field
                  name="code"
                  label="Code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={setCode}
                  required
                  error={confirmState.field === 'code' ? confirmState.error : undefined}
                />
                {confirmState.error && !confirmState.field ? (
                  <FormError message={confirmState.error} />
                ) : null}
                <SubmitButton pendingLabel="Checking…">Confirm and sign in</SubmitButton>
              </form>

              <form
                action={requestAction}
                className="flex flex-col gap-3 border-t border-brand-100 pt-5"
              >
                <p className="text-sm text-ink-600">Didn’t get a code, or it expired?</p>
                {/*
                  Exactly one email carrier: a hidden one when registration carried
                  an address over, a visible box when it did not. Rendering the
                  hidden input unconditionally would put an empty value first under
                  this name, and `formData.get('email')` reads the first one — so
                  "Send a new code" would always refuse to send.
                */}
                {email ? <input type="hidden" name="email" value={email} /> : null}
                {email ? null : (
                  <Field
                    name="email"
                    label="Email address"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={setEmail}
                    required
                    error={requestState.field === 'email' ? requestState.error : undefined}
                  />
                )}
                <SubmitButton variant="secondary" pendingLabel="Sending…">
                  Send a new code
                </SubmitButton>
                {requestState.error ? <FormError message={requestState.error} /> : null}
                {requestState.sentTo ? (
                  <p role="status" aria-live="polite" className="text-sm text-ink-600">
                    If that address has an account, a code is on its way to {requestState.sentTo}.
                  </p>
                ) : null}
              </form>

              <button
                type="button"
                onClick={() => setPanel('sign-in')}
                className="inline-flex items-center gap-1.5 self-center rounded-lg px-2 py-1 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <ArrowLeftIcon />
                Back to sign in
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

/** Sliding two-way switch between sign-in and register. */
function Tabs({ panel, onChange }: { panel: Panel; onChange: (panel: Panel) => void }) {
  const items: { id: Exclude<Panel, 'confirm'>; label: string }[] = [
    { id: 'sign-in', label: 'Sign in' },
    { id: 'register', label: 'Create account' },
  ];

  return (
    <div role="tablist" aria-label="Account" className="relative grid grid-cols-2 rounded-2xl bg-brand-50 p-1">
      <span
        aria-hidden="true"
        className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl bg-white shadow-sm ring-1 ring-brand-100 transition-transform duration-200 ease-out motion-reduce:transition-none ${
          panel === 'register' ? 'translate-x-full' : 'translate-x-0'
        }`}
      />
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={panel === item.id}
          onClick={() => onChange(item.id)}
          className={`relative z-10 min-h-11 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
            panel === item.id ? 'text-ink-900' : 'text-ink-600 hover:text-ink-900'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Role as three side-by-side choices instead of a dropdown, so every option is
 * visible without a click. They are real radio inputs, so the group is keyboard
 * and screen-reader operable and posts as `role` exactly as the select did.
 */
function RolePicker() {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-ink-900">I am signing up as</legend>
      <div className="grid grid-cols-3 gap-2">
        {ROLES.map((role) => (
          <label key={role.value} className="cursor-pointer">
            <input
              type="radio"
              name="role"
              value={role.value}
              defaultChecked={role.value === 'worker'}
              className="peer sr-only"
            />
            <span className="flex min-h-12 items-center justify-center rounded-xl border border-brand-100 bg-white px-2 text-center text-sm leading-tight font-medium text-ink-600 transition-colors hover:border-brand-500 peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-checked:font-semibold peer-checked:text-brand-700 peer-checked:ring-1 peer-checked:ring-brand-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600">
              {role.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CodeLink({ onConfirm }: { onConfirm: () => void }) {
  return (
    <button
      type="button"
      onClick={onConfirm}
      className="self-center rounded-lg px-2 py-1 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      I have a sign-in code
    </button>
  );
}

/** How filled each rung of the bar is, so Weak shows one segment of three. */
const STRENGTH_FILLED = { weak: 1, medium: 2, strong: 3 } as const;

const STRENGTH_TONE = {
  weak: { bar: 'bg-red-600', text: 'text-red-800' },
  medium: { bar: 'bg-amber-500', text: 'text-amber-700' },
  strong: { bar: 'bg-brand-500', text: 'text-brand-700' },
} as const;

/**
 * Three segments and a word. The word carries the meaning; colour alone would
 * be unreadable to some people. Nothing is announced as it changes, so a live
 * region does not talk over the person typing.
 */
function PasswordStrengthMeter({ value }: { value: string }) {
  const level = passwordStrength(value);
  if (level === 'empty') return null;

  const tone = STRENGTH_TONE[level];

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {([0, 1, 2] as const).map((index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${index < STRENGTH_FILLED[level] ? tone.bar : 'bg-brand-100'}`}
          />
        ))}
      </div>
      <p className={`shrink-0 text-sm ${tone.text}`}>
        <span className="sr-only">Password strength: </span>
        <span className="font-semibold">{PASSWORD_STRENGTH_LABEL[level]}</span>
      </p>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800 ring-1 ring-red-100"
    >
      <AlertIcon />
      <span>{message}</span>
    </p>
  );
}

function MailBadge() {
  return (
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
      <Mail aria-hidden="true" className="h-[26px] w-[26px]" strokeWidth={ICON_STROKE_WIDTH} />
    </div>
  );
}

function ShieldIcon() {
  return (
    <ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
  );
}

function ArrowLeftIcon() {
  return <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />;
}

function AlertIcon() {
  return (
    <CircleAlert
      aria-hidden="true"
      className="mt-0.5 shrink-0 h-4 w-4"
      strokeWidth={ICON_STROKE_WIDTH}
    />
  );
}