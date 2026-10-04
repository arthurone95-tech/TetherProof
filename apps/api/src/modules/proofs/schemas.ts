import { z } from 'zod';
import { gpsSchema } from '../../lib/geo.js';

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

  /**
   * Phone number the confirmation link will be sent to.
   *
   * Only a salted hash is stored, and the number itself is never written down.
   * Optional: with no number the worker receives the link in the API response and
   * shares it themselves, which is the same outcome as a dispatch failure.
   */
  verifierPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, 'Enter a phone number with country code, such as +233241234567.')
    .optional(),
});

export type ProofSubmissionInput = z.infer<typeof proofSubmissionSchema>;