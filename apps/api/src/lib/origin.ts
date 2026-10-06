/**
 * Addresses that name the machine the browser is running on, or the network it
 * is sitting in: loopback, plus the private ranges a developer reaches a local
 * server through from another device on the same desk.
 *
 * Accepted only outside production, and only where the code has already
 * decided that "bring this back to the developer's own network" is a real
 * answer — confirmation links (`redirect.ts`) and the browser's own origin in
 * the CORS policy (`app.ts`). In production it is not a real answer: a private
 * address sends a confirmation link to whatever happens to be listening on the
 * reader's own interface, and lets any page on the desk read API responses, so
 * the only correct answer there is the one the deployment named.
 *
 * Deliberately matched as an address rather than as a name. `my-machine.local`
 * and `DESKTOP-CH0MRBT` resolve to this same network but are not written down
 * anywhere, and deciding which hostnames are "local" would mean resolving them
 * inside a validation path. A developer reaching the server by its own name
 * configures that name explicitly instead — `NEXT_PUBLIC_SITE_URL` for
 * confirmation links, `CORS_ORIGINS` for the browser's origin.
 *
 * One definition on purpose. Two copies of this rule would be two chances for
 * them to disagree about what "local" means.
 */
export function isLocalAddress(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true;

  const parts = hostname.split('.');
  if (parts.length !== 4) return false;

  // Every part must be a decimal octet; `parts` is known to hold four by now,
  // so the first two below are as validated as the rest.
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return false;
  }

  const first = Number(parts[0]);
  const second = Number(parts[1]);

  if (first === 127) return true; // loopback, the whole 127.0.0.0/8 of it
  if (first === 10) return true; // 10.0.0.0/8
  if (first === 192 && second === 168) return true; // 192.168.0.0/16
  if (first === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12
  return false;
}
