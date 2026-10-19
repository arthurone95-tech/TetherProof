/**
 * How the active role is resolved.
 *
 * Every one of these rules was previously implicit in two places that did not agree with
 * each other: the header worked it out from the address, and the tab row assumed "the first
 * capability held". The symptoms — no role active on `/profile`, a refresh losing your
 * place, the wrong role ticked — all came from that disagreement, so the rules are pinned
 * here rather than left to be rediscovered.
 */
import { describe, expect, it } from 'vitest';
import { resolveActiveRole, workspaceForPath, isUserCapability } from './active-role';

const WORKER = ['worker'] as const;
const BOTH = ['worker', 'employer'] as const;

describe('workspaceForPath', () => {
  it('recognises each workspace home', () => {
    expect(workspaceForPath('/dashboard')).toBe('worker');
    expect(workspaceForPath('/employer')).toBe('employer');
    expect(workspaceForPath('/trainer')).toBe('training_provider');
    expect(workspaceForPath('/credentials')).toBe('trainee');
  });

  it('recognises a page nested inside a workspace', () => {
    // `/employer/search` must read as Hiring, not as nothing. The tab row and the header
    // used to disagree about exactly this.
    expect(workspaceForPath('/employer/search')).toBe('employer');
    expect(workspaceForPath('/trainer/roster')).toBe('training_provider');
    expect(workspaceForPath('/logs/abc-123')).toBeNull();
  });

  it('returns null for pages that belong to no workspace', () => {
    // These are the pages that used to leave nothing active. Returning null is what makes
    // "no role active here" expressible, rather than guessing one.
    for (const path of ['/profile', '/settings', '/roles', '/notifications', '/setup/worker', '/capabilities']) {
      expect(workspaceForPath(path)).toBeNull();
    }
  });

  it('does not match a workspace by a partial path segment', () => {
    // `/employers-archive` must not read as `/employer`.
    expect(workspaceForPath('/employers-archive')).toBeNull();
    expect(workspaceForPath('/dashboardish')).toBeNull();
  });
});

describe('resolveActiveRole', () => {
  it('follows the address when it names a workspace', () => {
    // Following a link or a notification must land where it says, and must not be overruled
    // by a remembered preference.
    expect(resolveActiveRole({ pathname: '/employer', capabilities: BOTH, stored: 'worker' })).toBe('employer');
    expect(resolveActiveRole({ pathname: '/dashboard', capabilities: BOTH, stored: 'employer' })).toBe('worker');
  });

  it('falls back to the remembered role on a neutral page', () => {
    // This is the refresh-and-sign-in case that had no answer before.
    expect(resolveActiveRole({ pathname: '/settings', capabilities: BOTH, stored: 'employer' })).toBe('employer');
    expect(resolveActiveRole({ pathname: '/profile', capabilities: WORKER, stored: 'worker' })).toBe('worker');
  });

  it('ignores a remembered role the account no longer holds', () => {
    // The cookie is never authority. It can at worst choose which of your own workspaces
    // opens first; it cannot grant anything.
    expect(resolveActiveRole({ pathname: '/profile', capabilities: WORKER, stored: 'employer' })).toBe('worker');
    expect(resolveActiveRole({ pathname: '/roles', capabilities: BOTH, stored: 'training_provider' })).toBe('worker');
  });

  it('ignores an address naming a workspace the account does not hold', () => {
    // Pasting /employer as a worker must not mark Hiring active.
    expect(resolveActiveRole({ pathname: '/employer', capabilities: WORKER, stored: null })).toBe('worker');
  });

  it('opens the first held role when nothing is remembered', () => {
    expect(resolveActiveRole({ pathname: '/profile', capabilities: BOTH, stored: null })).toBe('worker');
  });

  it('is deterministic regardless of the order capabilities arrive in', () => {
    // The old fallback read this list in database order, which is undefined. Two accounts
    // with the same two roles could open on different ones.
    const forward = resolveActiveRole({ pathname: '/profile', capabilities: ['worker', 'employer'], stored: null });
    const reversed = resolveActiveRole({ pathname: '/profile', capabilities: ['employer', 'worker'], stored: null });
    expect(forward).toBe(reversed);
  });

  it('returns null for an account holding nothing', () => {
    expect(resolveActiveRole({ pathname: '/dashboard', capabilities: [], stored: 'worker' })).toBeNull();
  });
});

describe('isUserCapability', () => {
  it('accepts the four capabilities and nothing else', () => {
    for (const good of ['worker', 'employer', 'training_provider', 'trainee']) {
      expect(isUserCapability(good)).toBe(true);
    }
    for (const bad of ['admin', '', 'Worker', 'toString', '__proto__', null, undefined, 7]) {
      expect(isUserCapability(bad)).toBe(false);
    }
  });

  it('does not accept admin, so it can never be recorded as a role', () => {
    // The cookie is a UI preference, not a permission, so this is not a security control on
    // its own — but `admin` is not a capability and must never appear here.
    expect(isUserCapability('admin')).toBe(false);
  });
});