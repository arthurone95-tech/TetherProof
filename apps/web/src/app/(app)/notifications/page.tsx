import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Award,
  BadgeCheck,
  Briefcase,
  CircleX,
  Clock3,
  Hourglass,
  UserCheck,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import type {
  NotificationItem,
  NotificationsResponse,
  ProofExpiryNotice,
} from '@tetherproof/shared';
import type { NotificationKind } from '@tetherproof/shared';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { markNotificationsRead, openNotification } from '@/lib/actions';
import { currentProfile } from '@/lib/server/api';
import { getNotifications } from '@/lib/server/shell-data';

export const metadata: Metadata = {
  title: 'Notifications — TetherProof',
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The member's feed: verification verdicts, offer arrivals and answers, and the
 * expiry notices that keep an outstanding confirmation link from quietly dying.
 *
 * Workers and employers both have a feed now. The `expiring` list is worker-only
 * and simply comes back empty for an employer, so the page renders the same shape
 * for both. The page stays up when the feed cannot be fetched, exactly like the
 * dashboard: a missing list beats a screen that will not render.
 *
 * The expiring list is drawn apart from the write-ahead feed because it is not
 * a history row but a live state: a link that is about to stop working needs an
 * action next to it, not a place in a list. Each entry opens the log it
 * belongs to, where a fresh link can be raised once the old one has gone.
 */
export default async function NotificationsPage() {
  const profile = await currentProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'worker' && profile.role !== 'employer') redirect('/pending');

  let feed: NotificationsResponse | null = null;
  try {
    feed = await getNotifications();
  } catch {
    feed = null;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {feed ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-600">
              {feed.unreadCount > 0
                ? `${feed.unreadCount} unread`
                : 'All caught up.'}
            </p>
            {feed.unreadCount > 0 ? (
              <form action={markNotificationsRead}>
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center rounded-xl border border-brand-600 px-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
                >
                  Mark all as read
                </button>
              </form>
            ) : null}
          </div>

          {feed.expiring.length > 0 ? (
            <section className="rounded-2xl border border-amber-200/70 bg-amber-50 p-4">
              <h2 className="font-semibold text-amber-900">Confirmation links expiring soon</h2>
              <p className="mt-1 text-sm text-amber-800">
                A link that runs out unanswered cannot be verified. Once it expires, raise a fresh
                one and share it again.
              </p>
              <ul className="mt-3 flex flex-col gap-3">
                {feed.expiring.map((notice) => (
                  <ExpiringRow key={notice.proofId} notice={notice} />
                ))}
              </ul>
            </section>
          ) : null}

          {feed.notifications.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {feed.notifications.map((item) => (
                <li key={item.id}>
                  <NotificationRow item={item} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-brand-200 bg-white p-8 text-center">
              <p className="text-lg font-semibold text-ink-900">Nothing here yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">
                Verification results, invitations, and their answers appear here as they happen.
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-ink-600">Notifications could not be loaded right now.</p>
      )}
    </div>
  );
}

/** One expiring confirmation link: the skill, when it dies, and where to act. */
function ExpiringRow({ notice }: { notice: ProofExpiryNotice }) {
  return (
    <li className="rounded-xl border border-amber-200/70 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink-900">{notice.skillTag}</p>
          <p className="text-sm text-ink-600">
            {expiresHint(notice.expiresAt)} · {DATE_FORMATTER.format(new Date(notice.expiresAt))}
          </p>
        </div>
        <Link
          href={`/logs/${notice.proofId}`}
          className="inline-flex min-h-10 items-center rounded-xl border border-brand-600 px-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
        >
          Open log
        </Link>
      </div>
      <p className="mt-2 text-sm text-amber-800">
        Still live — the person confirming your work can answer using the link they were sent.
        Once it expires, this page will offer a fresh one.
      </p>
    </li>
  );
}

/** One written notification: a tinted icon carries the kind, the dot marks unread. */
function NotificationRow({ item }: { item: NotificationItem }) {
  const presentation = PRESENTATION_FOR_KIND[item.kind];
  const Icon = presentation.icon;

  return (
    <article className="flex gap-3 rounded-2xl border border-brand-100 bg-white p-4">
      <span
        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${presentation.chip}`}
      >
        <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-ink-900">{item.title}</p>
          {!item.readAt ? (
            <span
              aria-label="Unread"
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600"
            />
          ) : null}
        </div>
        <p className="mt-0.5 text-sm text-ink-600">{item.body}</p>
        <p className="mt-2 text-xs text-ink-500">
          {DATE_FORMATTER.format(new Date(item.createdAt))}
        </p>
        {item.link ? (
          /*
            A form rather than a link, because opening the notification is also what
            marks it read. A plain link would navigate without touching `readAt`,
            which is exactly the bug this replaced: the reader arrived at the log
            and the count never moved. The endpoint is idempotent, so tapping an
            already-read notification costs one write that changes nothing.
          */
          <form action={openNotification} className="mt-2">
            <input type="hidden" name="notificationId" value={item.id} />
            <input type="hidden" name="link" value={item.link} />
            <button
              type="submit"
              className="text-sm font-semibold text-brand-700 hover:text-brand-800"
            >
              View
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function expiresHint(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'expiring today';
  if (days === 1) return 'expires tomorrow';
  return `expires in ${days} days`;
}

/**
 * One tint and icon per notification kind. The colour echoes the dashboard's
 * language — emerald for confirmed, red for refused, amber for time pressure,
 * blue for an offer waiting.
 */
const PRESENTATION_FOR_KIND: Record<
  NotificationKind,
  { icon: LucideIcon; chip: string }
> = {
  offer_received: { icon: Briefcase, chip: 'bg-blue-50 text-blue-700' },
  offer_accepted: { icon: UserCheck, chip: 'bg-emerald-50 text-emerald-700' },
  offer_declined: { icon: UserX, chip: 'bg-neutral-100 text-neutral-700' },
  verification_confirmed: { icon: BadgeCheck, chip: 'bg-emerald-50 text-emerald-700' },
  verification_rejected: { icon: CircleX, chip: 'bg-red-50 text-red-800' },
  // Amber like the other "waiting on you" kinds, and a distinct glyph from a
  // verification: this is an institute asking whether a student will hold a
  // credential, which is a different decision from a customer confirming work.
  credential_issued: { icon: Award, chip: 'bg-amber-50 text-amber-700' },
  link_expired: { icon: Clock3, chip: 'bg-amber-50 text-amber-700' },
  link_expiring: { icon: Hourglass, chip: 'bg-amber-50 text-amber-700' },
};