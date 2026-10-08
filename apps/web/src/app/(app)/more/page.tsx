import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { moreFor } from '@/lib/navigation';
import { currentProfile } from '@/lib/server/api';

export const metadata: Metadata = {
  title: 'More — TetherProof',
};

/**
 * The list of everything less than daily.
 *
 * The page is the list and nothing else: no heading, no subtitle, no line
 * explaining what "More" means. The header already says where you are, the six
 * options say what is here, and any sentence on top of that would be the page
 * talking over its own contents. Profile sits first because it is the account
 * itself; the rest follow in the order a member is most likely to need them.
 */
export default async function MorePage() {
  const user = await currentProfile();
  if (!user) redirect('/login');

  const items = moreFor();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <ul className="divide-y divide-brand-100">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex items-center justify-between gap-4 px-1 py-4 text-ink-900 transition hover:text-brand-700"
              >
                <span className="font-medium">{item.label}</span>
                <ChevronRight
                  aria-hidden="true"
                  className="h-4 w-4 text-ink-400 transition group-hover:text-brand-600"
                  strokeWidth={ICON_STROKE_WIDTH}
                />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
