/**
 * The password policy, defined once.
 *
 * This lives in the shared package rather than in either app because of what
 * happened when it did not: `registerSchema` in the API enforced these rules with
 * a chain of `.min()` and `.regex()` calls, and the registration action in the web
 * app enforced none of them. A person whose password fell short was refused by the
 * API with a precise reason, and the web client threw that reason away and showed
 * only `Request body failed validation.` — which says which field failed about as
 * helpfully as saying the request failed.
 *
 * Two hand-written copies of a rule set always drift apart, and they drift in the
 * direction nobody tests: the copy with fewer rules. One function that both sides
 * call cannot drift, so the API validates with it and the web app checks with it
 * before spending a network round trip — and a registration attempt, of which
 * there are only ten per fifteen minutes.
 *
 * Plain TypeScript with no dependency, because `@tetherproof/shared` is imported by
 * both a browser bundle and an Express server and neither needs a validation
 * library to run a regular expression.
 */

/** Minimum length, so the number and its message cannot disagree. */
export const PASSWORD_MIN_LENGTH = 12;

/** Maximum length, matching the cap Supabase Auth accepts comfortably. */
export const PASSWORD_MAX_LENGTH = 200;

/**
 * One password requirement.
 *
 * `message` is shown verbatim, so it is written as a sentence addressed to the
 * person rather than as a rule name for a log.
 */
export interface PasswordRule {
  message: string;
  test: (value: string) => boolean;
}

/**
 * Every requirement a password must meet, in the order they are reported.
 *
 * Order matters only for presentation: a password failing three rules shows the
 * first, and reading top to bottom, length before composition, matches how the
 * hint on the registration form is worded.
 */
export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    test: (value) => value.length >= PASSWORD_MIN_LENGTH,
  },
  {
    message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    test: (value) => value.length <= PASSWORD_MAX_LENGTH,
  },
  { message: 'Password must include a lowercase letter.', test: (value) => /[a-z]/.test(value) },
  { message: 'Password must include an uppercase letter.', test: (value) => /[A-Z]/.test(value) },
  { message: 'Password must include a number.', test: (value) => /[0-9]/.test(value) },
];

/**
 * Every reason this password is unacceptable, in `PASSWORD_RULES` order.
 *
 * Returns an empty array for a valid password, so callers can test `length` and
 * never have to interpret `null`. The same list is the source of both the API's
 * field-level error details and the message the registration form shows.
 */
export function passwordProblems(value: string): string[] {
  return PASSWORD_RULES.filter((rule) => !rule.test(value)).map((rule) => rule.message);
}
