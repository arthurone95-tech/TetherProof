'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Field } from './Field';
import { ICON_STROKE_WIDTH } from './icon';

interface PasswordFieldProps {
  name: string;
  label: string;
  /** Present only when this field is the one the server rejected. */
  error?: string;
  hint?: ReactNode;
  autoComplete?: string;
  required?: boolean;
  /**
   * Controlled value, so a refused sign-in does not empty the box.
   *
   * A password is the one field worth going to the trouble for: it is the longest
   * thing anybody types into this form, it is the one they cannot read off the
   * screen, and wiping it after a failed attempt is the single most annoying
   * thing a sign-in form can do. It lives in the form's state and nowhere else —
   * it is never written to storage, and see `lib/remembered-email.ts` for why.
   */
  value?: string;
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
  value,
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
      value={value}
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
  return <Eye aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />;
}

function EyeOffIcon() {
  return <EyeOff aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />;
}
