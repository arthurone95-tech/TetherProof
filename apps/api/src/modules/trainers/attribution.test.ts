/**
 * Attribution: who stands behind a micro-credential.
 *
 * These cases exist because the first implementation read the two profile columns
 * directly and produced credentials that named nobody. Both regressions below are the
 * original defect, restated as assertions so removing the fallback fails here.
 */
import { describe, expect, it } from 'vitest';
import { hasAttribution, institutionFor, resolveIssuer, UNNAMED_INSTITUTION } from './attribution.js';

describe('resolveIssuer', () => {
  it('uses the organization name when the provider recorded one', () => {
    expect(
      resolveIssuer({
        organizationName: 'Accra Technical Institute',
        fullName: 'Kwesi Boateng',
        authFullName: 'Kwesi Boateng',
      }),
    ).toEqual({
      organizationName: 'Accra Technical Institute',
      instructorName: 'Kwesi Boateng',
    });
  });

  /**
   * The original defect. `organization_name` is optional on a profile, so a provider
   * who never filled it in produced a credential naming no institution at all — the
   * unattributed endorsement the design forbids, reached without doing anything wrong.
   */
  it('falls back to the issuer account name when no organization name was recorded', () => {
    const issuer = resolveIssuer({
      organizationName: null,
      fullName: 'Accra Technical Institute',
      authFullName: 'Accra Technical Institute',
    });

    expect(issuer.organizationName).toBe('Accra Technical Institute');
    expect(issuer.instructorName).toBe('Accra Technical Institute');
  });

  /**
   * The defect that actually failed in production, and the reason the fallback chain
   * has three tiers rather than two.
   *
   * `profiles` rows are created only by `/auth/register`. An account provisioned any
   * other way — an administrator, a service-role `createUser`, the live suite's
   * fixture path — has a name in `auth.users` and **no profile row at all**, so both
   * profile columns arrive null. Falling back only to `fullName` therefore reproduced
   * the very null it was meant to remove.
   */
  it('falls back to the account name in auth when the provider has no profile row', () => {
    const issuer = resolveIssuer({
      organizationName: null,
      fullName: null,
      authFullName: 'Smoke Test Institute',
    });

    expect(issuer.organizationName).toBe('Smoke Test Institute');
    expect(issuer.instructorName).toBe('Smoke Test Institute');
    expect(hasAttribution({ ...issuer })).toBe(true);
  });

  it('prefers the profile name over the auth one when both are present', () => {
    // A renamed account: the profile is the later statement of the name, so it wins.
    const issuer = resolveIssuer({
      organizationName: null,
      fullName: 'Current Name',
      authFullName: 'Name At Signup',
    });

    expect(issuer.instructorName).toBe('Current Name');
  });

  /**
   * `profiles` rows are only created by `/auth/register`. An account provisioned by an
   * administrator or a service-role `createUser` has no profile row, so the outer join
   * produced nulls for a reason that had nothing to do with the provider's choices.
   */
  it('reports nothing rather than inventing a name when no tier has one', () => {
    // Nulls on every side is what both a genuinely nameless account and a missing
    // `auth.users` join look like.
    const issuer = resolveIssuer({ organizationName: null, fullName: null, authFullName: null });

    // Nothing can be resolved, and it says so rather than inventing an institution.
    expect(issuer.organizationName).toBeNull();
    expect(issuer.instructorName).toBeNull();
    // The point of the assertion: this is an honest null, distinguishable from a
    // missed join, and the UI can say the account has no name rather than that it
    // "is no longer on the platform".
    expect(hasAttribution({ ...issuer })).toBe(false);
  });

  it('treats a blank or whitespace-only name as absent', () => {
    expect(
      resolveIssuer({ organizationName: '   ', fullName: '', authFullName: '' }).organizationName,
    ).toBeNull();
    expect(
      resolveIssuer({ organizationName: '', fullName: '\t\n', authFullName: ' ' }).instructorName,
    ).toBeNull();
  });

  it('skips a blank profile name and uses the auth name beneath it', () => {
    const issuer = resolveIssuer({
      organizationName: '  ',
      fullName: '',
      authFullName: 'Kwesi Boateng',
    });

    expect(issuer.organizationName).toBe('Kwesi Boateng');
  });

  it('trims surrounding whitespace from a name that is present', () => {
    expect(
      resolveIssuer({
        organizationName: '  Accra Technical Institute  ',
        fullName: ' Kwesi Boateng ',
        authFullName: 'Kwesi Boateng',
      }),
    ).toEqual({ organizationName: 'Accra Technical Institute', instructorName: 'Kwesi Boateng' });
  });

  /**
   * Distinguishes the two very different reasons a name can be missing: the account
   * exists but never set one, versus the account is gone. Collapsing them would tell a
   * student an instructor had left the platform when they had simply not named
   * themselves.
   */
  it('does not treat an unnamed account as a deleted one', () => {
    const anonymous = resolveIssuer({ organizationName: null, fullName: null, authFullName: null });

    expect(anonymous.instructorName).toBeNull();
    // No wording is manufactured here; the caller decides which of the two it is.
    expect(anonymous.organizationName).not.toBe(UNNAMED_INSTITUTION);
  });

  it('prefers the organization name even when the signatory is someone else', () => {
    // An administrator signing on an institute's behalf must not replace the
    // institution with their own name.
    const issuer = resolveIssuer({
      organizationName: 'Accra Technical Institute',
      fullName: 'Admin',
      authFullName: 'Admin',
    });

    expect(issuer.organizationName).toBe('Accra Technical Institute');
    expect(issuer.instructorName).toBe('Admin');
  });
});

describe('institutionFor', () => {
  it('prefers the organization name', () => {
    expect(
      institutionFor({ organizationName: 'Nana Institute', fullName: 'Nana', authFullName: 'Nana' }),
    ).toBe('Nana Institute');
  });

  it('falls back to the profile name', () => {
    expect(
      institutionFor({ organizationName: null, fullName: 'Nana Institute', authFullName: 'Nana' }),
    ).toBe('Nana Institute');
  });

  it('falls back to the auth account name last', () => {
    expect(
      institutionFor({ organizationName: null, fullName: null, authFullName: 'Nana Institute' }),
    ).toBe('Nana Institute');
  });

  it('is null only when nothing identifies the account', () => {
    expect(institutionFor({ organizationName: null, fullName: null, authFullName: null })).toBeNull();
  });
});

describe('hasAttribution', () => {
  it('is true when both the institution and the signatory are named', () => {
    expect(
      hasAttribution({ organizationName: 'Accra Technical', instructorName: 'Kwesi' }),
    ).toBe(true);
  });

  /**
   * The regression assertion. If the fallback chain were removed and the service went
   * back to reading the profile columns directly, this is the check that fails — and it
   * fails in the unit suite, not only in the live one.
   */
  it('is false when the institution is missing even though a signatory is named', () => {
    expect(hasAttribution({ organizationName: null, instructorName: 'Kwesi' })).toBe(false);
  });

  it('is false when the signatory is missing even though an institution is named', () => {
    expect(hasAttribution({ organizationName: 'Accra Technical', instructorName: null })).toBe(false);
  });
});
