import { redirect } from 'next/navigation';

/**
 * The old address for capability management.
 *
 * The page moved to `/roles`, because which parts of TetherProof an account may use is a
 * property of the account rather than a settings preference, and it is deliberately kept out
 * of account settings so that "my details" and "what I can do here" stay separate things.
 * This redirect exists so a link already in someone's history, a bookmark, or a message
 * from before the move still lands somewhere real.
 */
export default function CapabilitiesRedirect() {
  redirect('/roles');
}