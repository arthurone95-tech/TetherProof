/**
 * Client-side verifier pseudonyms.
 *
 * ## The gap this fills
 *
 * The collusion filter needs to recognise the *same verifier* across several
 * proofs. It used to key on a salted hash of the client's phone number, which
 * worked and which the work-logging form used to ask for. That field is gone: a
 * worker no longer types anyone's number, so `verifierPhoneHash` is always null,
 * the endorsement graph cannot be built, and the filter is permanently neutral.
 *
 * That is the right trade — a mandatory phone field in a form a worker fills in
 * on a job site is a privacy cost paid by the person least able to refuse it —
 * but it leaves the network unable to see a closed ring at all.
 *
 * ## What replaces it
 *
 * The recipient's own browser generates a random identifier, stores it locally,
 * and sends it with the answer. The server hashes it with the same
 * environment-provided salt used for phone numbers and stores only the digest.
 *
 * What this buys and what it costs, stated plainly:
 *
 * * **No personal data is collected.** The identifier is random, generated on the
 *   recipient's device, and never transmitted in a form the server can reverse.
 *   There is no name, no number, no account, and no cross-site tracking value —
 *   it is scoped to this one origin.
 * * **It recognises a browser, not a person.** The same supervisor answering from
 *   their work phone is recognised across proofs. A ring that switches devices,
 *   or a shared office computer used by several clients, defeats it. That is a
 *   genuine limitation and the filter is weighted as weak evidence for it.
 * * **It is voluntary and silent.** A recipient who declines, or whose browser
 *   blocks storage, simply produces no key, and the engine reads that as "no
 *   information" rather than as suspicious — the same neutral rule that governs
 *   every other missing signal.
 * * **It cannot be used to identify anyone.** A salted digest of a random string
 *   carries no information about the person holding the device, and rotating the
 *   salt makes historical rows unlinkable without altering the schema.
 *
 * The engine already treats an unidentifiable verifier as neutral, so this
 * improves what can be *seen* without ever making the absence of a key count
 * against a worker.
 */

/** Header the verification page sends its pseudonym in. */
export const VERIFIER_KEY_HEADER = 'x-tetherproof-verifier-key';

/**
 * A recipient-supplied pseudonym, normalised before it is hashed.
 *
 * Truncated to 64 characters because the column is `varchar(64)`, and lowercased
 * so two spellings of the same token cannot become two verifiers. Anything
 * containing characters outside the unreserved URL-safe set is refused rather
 * than stripped: silently deleting characters would let two distinct keys collide
 * into one verifier, which is precisely the confusion the filter must not have.
 */
export function normalizeVerifierKey(raw: string | undefined | null): string | null {
  if (!raw) return null;

  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 16 || trimmed.length > 64) return null;
  if (!/^[a-z0-9_-]+$/.test(trimmed)) return null;

  return trimmed;
}
