import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { homeFor, navFor } from '@/lib/navigation';
import { currentProfile } from '@/lib/server/api';

/**
 * The frame around every signed-in screen.
 *
 * Authentication lives here rather than being repeated by each page, so a new
 * route cannot be added without a session check by simply forgetting one — the
 * layout already redirects. Pages keep their own role checks, because those turn
 * a mismatch into a sentence rather than into an error screen, and a page is the
 * only place that knows which roles it is for.
 *
 * This is a layout rather than a repeated component on purpose: navigation is
 * then rendered once per navigation instead of once per page, and a link to a
 * screen not built yet has nowhere to be forgotten.
 */
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const profile = await currentProfile();
  if (!profile) redirect('/login');

  return (
    <AppShell home={homeFor(profile.role)} avatarUrl={profile.avatarUrl} items={navFor(profile.role)}>
      {children}
    </AppShell>
  );
}