import { randomBytes } from 'node:crypto';

/**
 * The unguessable address of a worker's public capability profile.
 *
 * Generated once when the page is first enabled and used as-is until the worker
 * asks for a new one. It must be hard to guess (it is the page's only gate — the
 * alternative, a slug of the worker's name, would make "hidden" profiles
 * enumerable) but easy to read aloud and type, so it is lowercase
 * alphanumeric only, no ambiguous characters, letters and digits mixed.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 14;

export function generatePublicSlug(): string {
  const chars: string[] = [];

  // Rejection sampling keeps the draw uniform: 36 does not divide 256, so a
  // bare modulo would favour the first few characters. Bytes 252-255 are
  // rejected and the rest fold cleanly onto the alphabet (7 * 36 = 252).
  while (chars.length < SLUG_LENGTH) {
    const bytes = randomBytes(16);
    for (const byte of bytes) {
      if (byte >= 252) continue;
      const char = ALPHABET[byte % ALPHABET.length];
      if (char) chars.push(char);
      if (chars.length >= SLUG_LENGTH) break;
    }
  }

  return chars.join('');
}