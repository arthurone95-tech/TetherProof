import { type NextRequest, type NextResponse, NextResponse as nextResponse } from 'next/server';
import { type SetAllCookies, createServerClient } from '@supabase/ssr';

/**
 * Refreshes the Supabase session cookie on every matched request so the
 * browser and server stay in sync.
 *
 * Uses the anon key, never the service-role key, so Row Level Security applies
 * here exactly as it does in the browser.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = nextResponse.next({ request });

  const setAll: SetAllCookies = (cookiesToSet) => {
    // Mirror the refreshed cookies onto the request so Server Components in
    // this same render observe the new session.
    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
    response = nextResponse.next({ request });
    cookiesToSet.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll,
      },
    },
  );

  // If there are no Supabase auth cookies, there is no session to validate or
  // refresh, so skip the network round-trip to `getUser()`. This covers signed-out
  // visitors and public-page navigations, which are the majority of route
  // transitions on a marketing-heavy site.
  const hasAuthCookie = request.cookies.getAll().some((cookie) =>
    cookie.name.startsWith('sb-'),
  );

  if (hasAuthCookie) {
    // Reading the user validates the token and refreshes it when it is close to
    // expiry. The result is intentionally unused.
    await supabase.auth.getUser();
  }

  return response;
}
