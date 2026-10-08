/**
 * The last email address typed into this browser, and nothing else.
 *
 * A person signing in on a phone is usually signing in as themselves, and typing
 * an address on a phone keyboard is the slowest part of the form. Remembering the
 * address across visits is the behaviour every ordinary website has, and its
 * absence is read as broken rather than as privacy.
 *
 * **The password is never stored, here or anywhere else.** Not in this module, not
 * in a cookie, not in `localStorage`, not in a hidden field. Two reasons, and the
 * second is the one that decides it:
 *
 * 1. Anything this application writes to the browser survives on a shared or
 *    stolen device, and a remembered password turns that device into a signed-in
 *    account. An email address is a fraction of that risk and is needed for the
 *    convenience to be worth anything.
 * 2. The browser and the operating system already do this properly. The fields
 *    carry `autoComplete="current-password"` and `autoComplete="email"`, so a
 *    password manager can offer the matching password for the address this module
 *    remembered, and fill both in without the page ever seeing the secret. Doing
 *    it again here would mean handling a secret in application code to replace a
 *    capability the platform already provides, in exchange for a worse version of
 *    it.
 *
 * Every access is guarded: the module is imported by a client component but also
 * rendered on the server, where `localStorage` does not exist, and a browser can
 * refuse storage outright (private mode, disabled cookies, quota). A failure to
 * remember is a missing convenience, never a broken sign-in.
 */

const STORAGE_KEY = 'tetherproof.lastEmail';

/** Longest plausible address, so a corrupt value cannot be rendered into a box. */
const MAX_LENGTH = 254;

/**
 * Only an address this application would have sent to the API.
 *
 * Stored before the API is asked, so the shape is checked here: the value is
 * rendered into an input, and the only thing that will ever be stored is what the
 * person typed into a field marked `type="email"` and required.
 */
function isUsable(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/** The remembered address, or an empty string. Never throws. */
export function readRememberedEmail(): string {
  if (typeof window === 'undefined') return '';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && isUsable(stored) ? stored.trim() : '';
  } catch {
    return '';
  }
}

/** Remembers an address for this device, or forgets it when given nothing worth keeping. */
export function rememberEmail(email: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (isUsable(email)) {
      window.localStorage.setItem(STORAGE_KEY, email.trim());
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage refused the write. Nothing to do and nothing to report: the sign-in
    // still works, the address just has to be typed again next time.
  }
}

/** Erases the remembered address — what unticking "remember me" does. */
export function forgetRememberedEmail(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // As above: nothing was stored, so nothing needs removing.
  }
}