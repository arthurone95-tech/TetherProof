import { z } from 'zod';
import { gpsSchema } from '../../lib/geo.js';

/**
 * A proficiency tier, 1 (entry) to 3 (advanced).
 *
 * The two roads to this field deliver it differently: a multipart submission
 * can only carry text, so the log form sends "2", while the JSON edit path sends
 * the number 2. Both mean the same tier, so the coercion lives here rather than
 * being left to whichever caller remembered to convert — the submission schema
 * reading the string as-is is what rejected every logged level with "Invalid
 * input". An empty field is treated as absent so the default (or the update
 * path's "leave it alone") applies.
 */
const skillLevelSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : Number(trimmed);
  },
  z.union([z.literal(1), z.literal(2), z.literal(3)]),
);

export const proofSubmissionSchema = z.object({
  /** Free-text summary of the work, shown to the client confirming it. */
  description: z
    .string()
    .trim()
    .min(10, 'Describe the work in at least 10 characters.')
    .max(2000, 'Keep the description under 2000 characters.'),

  /** Skill this proof supports. A capability block is created if none exists. */
  skillTag: z.string().trim().min(2, 'Enter the skill this work belongs to.').max(160),

  /**
   * The worker's own proficiency tier for this skill, 1 (entry) to 3 (advanced).
   *
   * Stored on the capability block the proof hangs under, not on the proof
   * itself, so one skill has one level and the profile renders a per-skill
   * level rather than a per-proof one. Defaults to 1, the open position: new
   * work claims entry level until the worker says otherwise.
   */
  skillLevel: skillLevelSchema.default(1),

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

/**
 * What an existing log may change.
 *
 * Everything is optional, and at least one field must actually be supplied —
 * a PATCH that changes nothing is a request error, not a successful no-op.
 * `submissionGps` accepts null explicitly, which clears the stored location;
 * omitting it leaves the stored value untouched.
 */
export const proofUpdateSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(10, 'Describe the work in at least 10 characters.')
      .max(2000, 'Keep the description under 2000 characters.')
      .optional(),
    skillTag: z.string().trim().min(2, 'Enter the skill this work belongs to.').max(160).optional(),
    skillLevel: skillLevelSchema.optional(),
    submissionGps: gpsSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.description !== undefined ||
      value.skillTag !== undefined ||
      value.skillLevel !== undefined ||
      value.submissionGps !== undefined,
    { message: 'Nothing to change was supplied.' },
  );

export type ProofUpdateInput = z.infer<typeof proofUpdateSchema>;