import { z } from 'zod';

/**
 * Validates a `latitude,longitude` pair.
 *
 * The format check alone would accept `999,999`, which would later poison the
 * proximity checks that compare a worker's submission against a client's tap.
 * Both components are therefore range-checked here, at the boundary, so an
 * out-of-range coordinate never reaches the database.
 */
const gpsSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/, 'Location coordinates are malformed.')
  .refine((value) => {
    const [latitude, longitude] = value.split(',').map(Number);
    return (
      latitude !== undefined &&
      longitude !== undefined &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    );
  }, 'Location coordinates are out of range.');

export const proofSubmissionSchema = z.object({
  /** Free-text summary of the work, shown to the client confirming it. */
  description: z
    .string()
    .trim()
    .min(10, 'Describe the work in at least 10 characters.')
    .max(2000, 'Keep the description under 2000 characters.'),

  /** Skill this proof supports. A capability block is created if none exists. */
  skillTag: z.string().trim().min(2, 'Enter the skill this work belongs to.').max(160),

  /** Attach the proof to an existing capability block instead of naming a skill. */
  capabilityBlockId: z.string().uuid('That capability reference is not valid.').optional(),

  /**
   * Where the worker says the work happened.
   *
   * This is the only trusted location for a proof. The file's own metadata is
   * stripped before storage precisely so that it cannot contradict or stand in
   * for this value.
   */
  submissionGps: gpsSchema.optional(),

  /** Phone number the confirmation link will be sent to. Dispatch is not wired up yet. */
  verifierPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, 'Enter a phone number with country code, such as +233241234567.')
    .optional(),
});

export type ProofSubmissionInput = z.infer<typeof proofSubmissionSchema>;