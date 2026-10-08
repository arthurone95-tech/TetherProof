import type { ReactNode } from 'react';
import { currentProfile } from '@/lib/server/api';

/**
 * The body shared by the public pages: About, Help, Terms, Privacy.
 *
 * The page's own heading is shown only to a signed-out reader. A signed-in
 * member sees the page's name in the back header instead — repeating it as a
 * large heading in the body would put the same words twice on one screen — while
 * a signed-out reader, whose header carries the brand rather than the page,
 * still gets a proper `<h1>` telling them which page they are on.
 *
 * `currentProfile` is request-cached, so this costs one profile read for the
 * layout and every page under it, not one each.
 */
export async function InfoPage({ title, children }: { title: string; children: ReactNode }) {
  const profile = await currentProfile();

  if (profile) return <>{children}</>;

  return (
    <>
      <header>
        <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">{title}</h1>
      </header>
      {children}
    </>
  );
}
