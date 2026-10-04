import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client that reads the session from cookies.
 *
 * Never uses the service-role key: server components must keep the same Row
 * Level Security boundary as the browser.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const setAll: SetAllCookies = (cookiesToSet) => {
    try {
      cookiesToSet.forEach(({ name, value, options }) => {
        cookieStore.set(name, value, options);
      });
    } catch {
      // Invoked from a Server Component, where cookies are read-only. The
      // Next.js middleware is responsible for refreshing the session.
    }
  };

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll,
      },
    },
  );
}
