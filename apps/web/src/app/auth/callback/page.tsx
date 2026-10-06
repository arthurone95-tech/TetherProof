import type { Metadata } from 'next';
import { CallbackFinisher } from './CallbackFinisher';

export const metadata: Metadata = {
  title: 'Signing you in — TetherProof',
};

/**
 * Where a confirmation link brings the person who taps it.
 *
 * Supabase Auth redirects here after verifying the token in the email, passing
 * the resulting session in one of two shapes: a `?code=` query parameter when
 * the exchange is PKCE, or a `#access_token=...` fragment otherwise. A server
 * route can only ever see the first — fragments are never transmitted — so the
 * work is done by a client component that can read `window.location` and hand
 * what it finds to a server action.
 *
 * The route exists because the alternative was no route at all: the link used to
 * return to whatever origin the Supabase dashboard named, which was a fixed port
 * the application was not listening on. See `doc/13` E-031.
 */
export default function AuthCallbackPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <CallbackFinisher />
    </main>
  );
}
