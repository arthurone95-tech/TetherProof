/**
 * Capability rules that are decided in code rather than by a query.
 *
 * The security-relevant parts of this module live in SQL — the self-service gate, the
 * backfill, the trigger — and the live suite exercises those against a real database.
 * What is here is the part that would be duplicated into a client or a second service if
 * it were not stated once: the vocabulary itself, and the rule that administrator is not
 * a member of it.
 */
import { describe, expect, it } from 'vitest';
import { SELF_REGISTER_ROLES, USER_CAPABILITIES, USER_ROLES, type UserCapability } from '@tetherproof/shared';

describe('the capability vocabulary', () => {
  it('is exactly the four agreed capabilities', () => {
    expect([...USER_CAPABILITIES]).toEqual(['worker', 'employer', 'training_provider', 'trainee']);
  });

  /**
   * The single most important property of the whole change, asserted where it can be read
   * rather than inferred from a comment.
   *
   * If `admin` ever became a capability, it would be grantable: there would be a row
   * somebody could insert, a request body that could name it, and a `grant` call with no
   * branch preventing it. `doc/13` E-024 is what happens when an administrator is
   * self-assigned — the whole employer approval gate becomes bypassable by one
   * unauthenticated request.
   */
  it('does not contain admin, and never can', () => {
    expect(USER_CAPABILITIES).not.toContain('admin' as UserCapability);
    expect([...USER_CAPABILITIES].includes('admin' as never)).toBe(false);
  });

  it('still describes the platform roles, which is a different question', () => {
    // `USER_ROLES` survives because the administrator claim and the historical
    // migrations reference it. Its existence is not permission for it to be a capability.
    //
    // The two lists are the same length and different sets, which is the point: swapping
    // one for the other would not look like a mistake to a reader skimming the imports.
    // Asserted as a set difference rather than a length, because equal lengths are exactly
    // what would have hidden the swap.
    expect([...USER_ROLES]).toContain('admin');
    expect([...USER_CAPABILITIES]).not.toContain('admin' as UserCapability);

    const roles = new Set<string>(USER_ROLES);
    const capabilities = new Set<string>(USER_CAPABILITIES);
    const onlyInRoles = [...roles].filter((role) => !capabilities.has(role));
    const onlyInCapabilities = [...capabilities].filter((c) => !roles.has(c));

    expect(onlyInRoles).toEqual(['admin']);
    expect(onlyInCapabilities).toEqual(['trainee']);
  });

  it('lets a signup declare nothing at all', () => {
    // Registration asks for no role. The old list was `['worker','employer',
    // 'training_provider']`, and an empty one is the shape that says "not a question the
    // form asks" rather than "a question with no valid answers".
    expect([...SELF_REGISTER_ROLES]).toEqual([]);
  });
});

describe('capability names', () => {
  it('are the values the database enum and the API both use', () => {
    // A typo in either place would compile and then fail at runtime on a grant. Pinning
    // the exact strings is cheaper than finding that out from a 500.
    const expected = ['worker', 'employer', 'training_provider', 'trainee'];
    for (const capability of USER_CAPABILITIES) {
      expect(expected).toContain(capability);
    }
  });

  it('cover a person who works, studies, teaches and hires', () => {
    // The Kojo case from the agreed design: all four at once must be expressible, and the
    // type has no constraint that would prevent it.
    const kojo: UserCapability[] = ['worker', 'trainee', 'training_provider', 'employer'];
    expect(kojo).toHaveLength(4);
    for (const capability of kojo) {
      expect(USER_CAPABILITIES).toContain(capability);
    }
  });
});
