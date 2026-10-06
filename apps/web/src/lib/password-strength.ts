import { passwordProblems } from '@tetherproof/shared';

/**
 * How strong a password looks while it is being typed.
 *
 * `empty` exists so a meter can render nothing rather than announcing Weak at a
 * person who has not started yet; every other level is a judgement worth showing.
 */
export type PasswordStrength = 'empty' | 'weak' | 'medium' | 'strong';

/** The words shown for each level, so the label cannot drift from the bar. */
export const PASSWORD_STRENGTH_LABEL: Record<Exclude<PasswordStrength, 'empty'>, string> = {
  weak: 'Weak',
  medium: 'Medium',
  strong: 'Strong',
};

/**
 * Grades a password against the policy the API actually enforces.
 *
 * The ladder is deliberately short, and each rung is a real threshold rather than
 * an estimate:
 *
 * - **Weak** — `passwordProblems()` still reports something, so the password would
 *   be refused. Calling that Weak rather than Invalid is a choice: a person who has
 *   typed `Sunrise2026` needs to know it is not yet acceptable, and "Weak" says so
 *   without implying the format itself is wrong.
 * - **Medium** — the policy is satisfied. It works; it is not long.
 * - **Strong** — satisfied and at least sixteen characters, which is where length
 *   starts to matter more than composition.
 *
 * There is no scoring of dictionaries, repeated characters, or keyboard runs,
 * because that needs a wordlist and this package is imported by a browser bundle
 * and a server alike with no dependencies. Length and composition are the two
 * things both halves can agree on, so they are the two things measured.
 */
export function passwordStrength(value: string): PasswordStrength {
  if (value.length === 0) return 'empty';
  if (passwordProblems(value).length > 0) return 'weak';
  if (value.length >= 16) return 'strong';
  return 'medium';
}
