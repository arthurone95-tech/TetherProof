/**
 * Result of a form submission.
 *
 * Errors are returned rather than thrown because a thrown error in a server action
 * renders Next.js's own error screen and discards what the user typed. `field` lets a
 * form point at the input at fault, so a message lands next to the field instead of at
 * the top of a long form.
 *
 * This lives outside `lib/actions.ts` because a `'use server'` module may only export
 * async functions, and the initial state is a plain object.
 */
export interface FormState {
  error?: string;
  field?: 'email' | 'password' | 'fullName' | 'organizationName' | 'code' | 'requiredSkill';
  /**
   * True once an action has completed successfully.
   *
   * Success is an explicit flag rather than the absence of an error, because a form
   * that has not been submitted yet also has no error and would otherwise report
   * itself as already saved.
   */
  done?: boolean;
  /** Masked destination a sign-in code was sent to, when one was just requested. */
  sentTo?: string;
}

/** The state of a form that has not been submitted yet. */
export const EMPTY_FORM: FormState = {};