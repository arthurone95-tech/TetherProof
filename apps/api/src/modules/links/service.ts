import { and, desc, eq } from 'drizzle-orm';
import type { WorkerLink, WorkerLinksResponse } from '@tetherproof/shared';
import { db } from '../../db/client.js';
import { workerLinks } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';

function toLink(row: typeof workerLinks.$inferSelect): WorkerLink {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listWorkerLinks(userId: string): Promise<WorkerLinksResponse> {
  const rows = await db
    .select()
    .from(workerLinks)
    .where(eq(workerLinks.userId, userId))
    .orderBy(desc(workerLinks.createdAt));

  return { links: rows.map(toLink) };
}

export async function createWorkerLink(userId: string, name: string, url: string): Promise<WorkerLink> {
  const [row] = await db
    .insert(workerLinks)
    .values({ userId, name, url })
    .returning();

  if (!row) {
    throw AppError.internal('That link could not be saved. Please try again.');
  }
  return toLink(row);
}

export async function deleteWorkerLink(userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(workerLinks)
    .where(and(eq(workerLinks.userId, userId), eq(workerLinks.id, id)))
    .returning({ id: workerLinks.id });

  if (deleted.length === 0) {
    throw AppError.notFound('That link was not found.');
  }
}
