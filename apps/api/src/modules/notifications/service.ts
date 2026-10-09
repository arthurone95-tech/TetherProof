import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { NotificationItem, NotificationsResponse, UserRole } from '@tetherproof/shared';
import { db } from '../../db/client.js';
import { notifications } from '../../db/schema.js';
import { workerExpiringLinks } from '../proofs/service.js';

/**
 * A member's notification feed.
 *
 * The feed is two parts with different lifetimes. The written rows are the
 * moments that actually happened — an invitation arrived or was answered, a
 * verification came back, a link ran out — and stay until the account goes. The
 * `expiring` part is a worker's own outstanding confirmation links that run out
 * within a few days, synthesized at read time and never stored, so a link that
 * crosses the boundary while the page is open is never missed and never stale
 * (see `workerExpiringLinks` in the proofs module). It is worker-only: an
 * employer has no confirmation links, and synthesizing an empty list for them
 * keeps the response shape the same for every reader.
 */
export async function listNotifications(
  userId: string,
  role: UserRole,
): Promise<NotificationsResponse> {
  const [rows, [unread]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);

  const items: NotificationItem[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    notifications: items,
    unreadCount: unread?.count ?? 0,
    expiring: role === 'worker' ? await workerExpiringLinks(userId) : [],
  };
}

/**
 * Marks every unread row as read.
 *
 * Reading the feed is the read action; an invitation badge elsewhere keeps its
 * own count from the offers endpoint, so marking the feed read does not touch
 * that count.
 */
export async function markNotificationsRead(userId: string): Promise<{ marked: number }> {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });

  return { marked: updated.length };
}
