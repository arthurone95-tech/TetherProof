import { and, eq } from 'drizzle-orm';
import { ERROR_CODES } from '@tetherproof/shared';
import { db } from '../../db/client.js';
import { capabilityBlocks, verifications, workProofLogs } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { hashVerificationToken } from '../../lib/token.js';
import type { ConfirmInput } from './schemas.js';

/**
 * Everything a client sees from an SMS/WhatsApp link.
 *
 * Deliberately excludes worker identity, verifier phone number, GPS telemetry,
 * fraud score, and media URLs, which would leak PII or let a link holder probe
 * the anti-fraud system.
 */
export interface VerificationSummary {
  skillTag: string | null;
  taskSummary: string;
  status: 'awaiting_response' | 'confirmed' | 'rejected';
  expiresAt: string;
  respondedAt: string | null;
}

async function loadByTokenHash(tokenHash: string) {
  const rows = await db
    .select({
      id: verifications.id,
      response: verifications.response,
      expiresAt: verifications.expiresAt,
      completedAt: verifications.completedAt,
      workProofId: workProofLogs.id,
      description: workProofLogs.description,
      workerId: workProofLogs.workerId,
      skillTag: capabilityBlocks.skillTag,
    })
    .from(verifications)
    .innerJoin(workProofLogs, eq(verifications.workProofId, workProofLogs.id))
    .leftJoin(capabilityBlocks, eq(workProofLogs.capabilityBlockId, capabilityBlocks.id))
    .where(eq(verifications.tokenHash, tokenHash))
    .limit(1);

  return rows[0];
}

type LoadedVerification = Awaited<ReturnType<typeof loadByTokenHash>>;

function assertUsable(record: LoadedVerification): asserts record is NonNullable<LoadedVerification> {
  if (!record) {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_INVALID,
      message: 'This verification link is not valid.',
      status: 404,
    });
  }

  if (record.response !== 'none') {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_CONSUMED,
      message: 'This verification link has already been used.',
      status: 409,
    });
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_EXPIRED,
      message: 'This verification link has expired. Ask the worker to send a new one.',
      status: 410,
    });
  }
}

function toSummary(record: NonNullable<LoadedVerification>): VerificationSummary {
  return {
    skillTag: record.skillTag,
    taskSummary: record.description,
    status: record.response === 'none' ? 'awaiting_response' : record.response,
    expiresAt: record.expiresAt.toISOString(),
    respondedAt: record.completedAt ? record.completedAt.toISOString() : null,
  };
}

/** Public read of a verification link. Safe to call without authentication. */
export async function getVerificationSummary(rawToken: string): Promise<VerificationSummary> {
  const record = await loadByTokenHash(hashVerificationToken(rawToken));
  if (!record) {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_INVALID,
      message: 'This verification link is not valid.',
      status: 404,
    });
  }
  return toSummary(record);
}

/**
 * Records the client's answer.
 *
 * The transition from `none` to a terminal response happens inside a single
 * conditional UPDATE, so two simultaneous taps cannot both be accepted.
 */
export async function submitVerification(
  rawToken: string,
  input: ConfirmInput,
): Promise<{ status: 'confirmed' | 'rejected'; skillTag: string | null }> {
  const tokenHash = hashVerificationToken(rawToken);
  const record = await loadByTokenHash(tokenHash);
  assertUsable(record);

  const completedAt = new Date();
  const updated = await db
    .update(verifications)
    .set({
      response: input.response,
      verifierGps: input.verifierGps ?? null,
      completedAt,
    })
    .where(and(eq(verifications.tokenHash, tokenHash), eq(verifications.response, 'none')))
    .returning({ id: verifications.id });

  if (updated.length === 0) {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_CONSUMED,
      message: 'This verification link has already been used.',
      status: 409,
    });
  }

  await db
    .update(workProofLogs)
    .set({ verificationStatus: input.response === 'confirmed' ? 'verified' : 'rejected' })
    .where(eq(workProofLogs.id, record.workProofId));

  return { status: input.response, skillTag: record.skillTag };
}
