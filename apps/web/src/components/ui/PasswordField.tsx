'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Field } from './Field';

interface PasswordFieldProps {
  name: string;
  label: string;
  /** Present only when this field is the one the server rejected. */
  error?: string;
  hint?: ReactNode;
  autoComplete?: string;
  required?: boolean;
  /** Notified with the password on every keystroke, for a strength meter. */
  onChange?: (value: string) => void;
  /** Id of a hint rendered outside the field — see `Field`. */
  linkedHintId?: string;
}

/**
 * A password input with a button that reveals what was typed.
 *
 * Hidden by default and revealed only on request, which is the point of the
 * control: dots let a person confirm they are in the right box without showing
 * the password to whoever is standing behind them, and the toggle lets them
 * check what they actually typed when they are not.
 *
 * The label reads as an instruction rather than as an icon, because "Show
 * password" is what a screen reader should announce and an unlabelled eye means
 * nothing to anyone. `aria-pressed` reports the current state, so the button
 * says whether it is on rather than only that it was clicked.
 *
 * This lives outside `Field` because `Field` is also rendered by server
 * components, and holding reveal state needs a client component. `Field` renders
 * the button it is handed; the state stays here.
 */
export function PasswordField({
  name,
  label,
  error,
  hint,
  autoComplete,
  required,
  onChange,
  linkedHintId,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const instruction = label.toLowerCase();

  return (
    <Field
      name={name}
      label={label}
      type={visible ? 'text' : 'password'}
      error={error}
      hint={hint}
      autoComplete={autoComplete}
      required={required}
      onChange={onChange}
      linkedHintId={linkedHintId}
      inputSuffix={
        <button
          type="button"
          onClick={() => setVisible((was) => !was)}
          aria-pressed={visible}
          aria-label={`${visible ? 'Hide' : 'Show'} ${instruction}`}
          className="flex h-12 items-center px-3 text-ink-600 transition-colors hover:text-ink-900"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      }
    />
  );
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}
