/**
 * Who stands behind a micro-credential.
 *
 * `doc/08` §3 requires that an endorsement be attributable, and `lib/verifier-key.ts`
 * exists to stop the platform collapsing two different people into one. Those two
 * commitments meet here: a credential that cannot be traced to a named issuer is the
 * unattributable claim this platform exists to make attributable, so resolving the
 * issuer is not cosmetic and a `null` has to mean something specific.
 *
 * ## The defect this module was written to fix
 *
 * Attribution was read from `profiles.organization_name` and `profiles.full_name`, both
 * of which are **optional** on a profile. A training provider who registered and never
 * filled in an organization name therefore produced a credential that named nobody —
 * precisely the failure the design forbids, reached by doing nothing wrong.
 *
 * Worse, `profiles` rows are only created by `/auth/register`. An account provisioned
 * outside registration (an administrator, a service-role `createUser`) has no profile
 * row at all, so the same null appeared for a reason that had nothing to do with the
 * provider's choices.
 *
 * The fix is a fallback chain that ends in the issuer's own name rather than in `null`.
 * A provider who named themselves is identified; only an account with genuinely no
 * name anywhere is unattributable, and that is a real absence rather than a missed join.
 *
 * ## The second defect, found after the first was fixed
 *
 * Falling back to the issuer's `full_name` was not enough, because `full_name` lives on
 * `profiles`, and **`profiles` rows are only ever created by `/auth/register`.** An
 * account provisioned any other way — an administrator writing the role claim, a
 * service-role `createUser`, the fixture path the live suite uses — has a name in
 * `auth.users` and no profile row at all. Reading only `profiles` therefore produced
 * exactly the null it was meant to prevent, for a reason that had nothing to do with
 * the provider's choices.
 *
 * So the final tier is the account's own name in `auth.users`, which is where identity
 * data lives by design (`doc/06` §2) and where every account has one. This is a *read*
 * of the authoritative source, not a duplication of it into a second table, and it is
 * no less trustworthy than `profiles.full_name`: both are display names the account
 * holder may edit, and neither carries an authorization decision — the role that
 * decides what this account may do is read from the server-controlled
 * `app_metadata.role` claim, never from a name.
 *
 * ## What this deliberately does not do
 *
 * It does not invent an institution. There is no fallback to the skill name, the
 * milestone title, or anything derived from the credential itself — a plausible-looking
 * institution name is worse than an honest "a training provider", because it would be
 * indistinguishable from a real one.
 *
 * Read time rather than issuance time, which is a real limitation: a provider who
 * renames themselves re-labels every credential they have ever issued. Snapshotting the
 * issuer onto the row at signing time is the correct fix and needs a migration; it is
 * recorded as such rather than quietly assumed. See `doc/13`.
 */

/** The name fields a `profiles` row can carry. Both are optional. */
export interface IssuerNameFields {
  organizationName: string | null;
  fullName: string | null;
  /**
   * The account's own name in `auth.users`, absent when a profile row was never
   * created. The last tier, and the one that makes attribution work for every account
   * rather than only for those that arrived through the registration form.
   */
  authFullName: string | null;
}

export interface ResolvedIssuer {
  /**
   * The institution, as it should be shown to the student.
   *
   * Falls back to the issuer's own name, because an institute whose account is named
   * "Accra Technical Institute" *is* identifiable even when no separate organization
   * field was filled in. Null only when the account carries no name at all.
   */
  organizationName: string | null;
  /**
   * The person who signed it off, or null when that account no longer exists or never
   * had a name. Distinct from the institution: one account can be both, and a student
   * is entitled to know they are the same entity rather than being shown two names.
   */
  instructorName: string | null;
}

function tidy(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveIssuer(fields: IssuerNameFields): ResolvedIssuer {
  const instructorName = tidy(fields.fullName) ?? tidy(fields.authFullName);
  const organizationName = tidy(fields.organizationName) ?? instructorName;
  return { organizationName, instructorName };
}

/**
 * The institution, falling back through the issuer's own names.
 *
 * The first non-empty of the three, in that order. Never null when any is present, so
 * a provider is identified wherever they were provisioned from.
 */
export function institutionFor(fields: IssuerNameFields): string | null {
  return (
    tidy(fields.organizationName) ?? tidy(fields.fullName) ?? tidy(fields.authFullName)
  );
}

/**
 * The wording the student's page shows when neither field is populated.
 *
 * Deliberately generic and honest. "A training provider" says who signed it and claims
 * nothing about which one, which is all the stored data supports.
 */
export const UNNAMED_INSTITUTION = 'A training provider';

/**
 * The sentence fragment shown when the signatory's account has gone.
 *
 * Says the account is gone rather than that the name is blank, because the two are
 * different absences and only the first is a real event. A provider who deleted their
 * account is a fact; a provider who never set a name is not.
 */
export const ATTRIBUTION_MISSING =
  'the instructor who recorded this is no longer on the platform';

/** The two names a credential carries, as the API returns them. */
export interface CredentialAttribution {
  organizationName: string | null;
  instructorName: string | null;
}

/**
 * Whether a credential carries usable attribution.
 *
 * Used by the unit and live suites as the assertion that fails if the fallback chain is
 * removed, since a null here means an endorsement nobody can be traced to.
 */
export function hasAttribution(credential: CredentialAttribution): boolean {
  return tidy(credential.organizationName) !== null && tidy(credential.instructorName) !== null;
}
