'use client';

import { useFormStatus } from 'react-dom';
import { Button } from './Button';

interface SubmitButtonProps {
  /** Text shown while the request is in flight. */
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  /**
   * Submitted with the form when this button is the one clicked.
   *
   * This is how one form offers two choices without a hidden input that could
   * disagree with which button was pressed.
   */
  name?: string;
  value?: string;
}

/**
 * A submit button that reports its own pending state.
 *
 * `useFormStatus` reads the enclosing `<form>`'s status, so this works for every
 * server action in the app without each one threading a loading flag through its own
 * state. Without it a slow request leaves a button that looks idle and invites a
 * second, duplicate submission.
 *
 * Success is reported by the form as a message rather than by disabling this button.
 * Disabling on success leaves a form that can never be submitted again, which turns a
 * first save into a form that appears to be finished for good.
 */
export function SubmitButton({
  pendingLabel,
  variant = 'primary',
  className,
  name,
  value,
  children,
}: SubmitButtonProps & { children: React.ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      className={className}
      disabled={pending}
      name={name}
      value={value}
    >
      {pending ? (pendingLabel ?? 'Working…') : children}
    </Button>
  );
}