import type { NotificationKind } from '@tetherproof/shared';
import { db } from '../db/client.js';
import { notifications } from '../db/schema.js';

/**
 * Writes one row to a worker's notification feed.
 *
 * Kept as a bare leaf function in `lib/` rather than inside the notifications
 * module because it is called from the modules whose events are worth notifying
 * about (proofs, verifications, employers). Pulling it into any one of them
 * would make the others import it sideways; a leaf with no imports of its own
 * cannot create an import cycle.
 *
 * Rows are small and bounded (titles and bodies are capped by the schema), and
 * the feed page reads the latest fifty, so there is no pruning here: the row for
 * a deleted account disappears with the account, and everything else is a
 * moment the member may still want to come back to.
 */
export async function createNotification(
  userId: string,
  kind: NotificationKind,
  title: string,
  body: string,
  link?: string,
): Promise<void> {
  await db.insert(notifications).values({
    userId,
    kind,
    title,
    body,
    link: link ?? null,
  });
}