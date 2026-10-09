import { and, desc, eq } from 'drizzle-orm';
import type { ConnectionInfo, ConnectionProvider, ConnectionsResponse } from '@tetherproof/shared';
import { db } from '../../db/client.js';
import { telemetryConnections } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import {
  buildOAuthState,
  githubAuthorizeUrl,
  githubConfigured,
} from '../../lib/github-oauth.js';

/**
 * Telemetry connectors: the scaffold for capturing work from where it
 * actually happens (a GitHub account, and later other sources).
 *
 * The scaffold records the connection — which source, whose account, when it
 * was linked, when it last synced — and nothing else. The OAuth access token is
 * used once, at exchange time, to learn the user name, and is never stored; a
 * later phase that ingests commits will make its own, separately-reviewed
 * decision about holding credentials. Until then a revoked connection is simply
 * a status flip, which is exactly what the absence of a token makes safe.
 */
function toInfo(row: typeof telemetryConnections.$inferSelect): ConnectionInfo {
  return {
    provider: row.provider,
    externalUsername: row.externalUsername,
    status: row.status,
    connectedAt: row.connectedAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
  };
}

export async function listConnections(userId: string): Promise<ConnectionsResponse> {
  const rows = await db
    .select()
    .from(telemetryConnections)
    .where(eq(telemetryConnections.userId, userId))
    .orderBy(desc(telemetryConnections.connectedAt));

  return { connections: rows.map(toInfo) };
}

/**
 * Starts a GitHub connection for the caller.
 *
 * When the deployment has no GitHub application configured, this answers
 * `available: false` and the web client says so plainly rather than dead-ending
 * into an authorize URL the provider would refuse.
 */
export async function startGithubConnection(
  userId: string,
): Promise<{ authorizeUrl: string | null; available: boolean }> {
  if (!githubConfigured()) {
    return { authorizeUrl: null, available: false };
  }
  return { authorizeUrl: githubAuthorizeUrl(buildOAuthState(userId)), available: true };
}

/** Records a completed connection after the provider's callback. */
export async function completeGithubConnection(
  userId: string,
  externalUsername: string,
): Promise<void> {
  await db
    .insert(telemetryConnections)
    .values({ userId, provider: 'github', externalUsername })
    .onConflictDoUpdate({
      target: [telemetryConnections.userId, telemetryConnections.provider],
      set: {
        externalUsername,
        status: 'connected',
        // Reconnecting is a fresh connection: a stale last-sync stamp from the
        // previous incarnation would be a lie about when this one last synced.
        lastSyncedAt: null,
        connectedAt: new Date(),
      },
    });
}

/** Disconnects a source by marking the connection revoked. */
export async function revokeConnection(userId: string, provider: ConnectionProvider): Promise<void> {
  const updated = await db
    .update(telemetryConnections)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(telemetryConnections.userId, userId),
        eq(telemetryConnections.provider, provider),
      ),
    )
    .returning({ id: telemetryConnections.id });

  if (updated.length === 0) {
    throw AppError.notFound('That connection was not found.');
  }
}