import { z } from 'zod';
import { OFFER_RESPONSES } from '@tetherproof/shared';

/**
 * Bounds on hiring criteria.
 *
 * The minimum proof threshold is capped rather than merely validated as a positive
 * integer because a threshold above the number of proofs anyone could realistically
 * accumulate will never match, and an employer who saved one would have built a
 * spec that silently returns nothing forever. Failing at creation is kinder than a
 * filter that quietly never fires.
 */
const MIN_VERIFIED_PROOFS_MAX = 500;
const MAX_DISTANCE_KM_MAX = 20_000;

export const skillTagSchema = z
  .string()
  .trim()
  .min(2, 'Enter a skill of at least 2 characters.')
  .max(160, 'Keep the skill under 160 characters.');

export const specIdParamSchema = z.object({
  specId: z.string().uuid('That capability spec is not valid.'),
});

/**
 * Saving a worker.
 *
 * Carries a candidate handle, never a worker id. The client is never given the
 * id, so it cannot put one here even by accident or by tampering — the only way
 * to name a worker is with a handle this employer was issued.
 */
export const saveWorkerSchema = z.object({
  candidateHandle: z.string().min(20, 'That candidate could not be read.'),
  skillTag: skillTagSchema,
});

export const savedWorkerIdParamSchema = z.object({
  savedId: z.string().uuid('That saved worker is not valid.'),
});

export const createSpecSchema = z.object({
  requiredSkill: skillTagSchema,
  minProofThreshold: z
    .number()
    .int('The proof threshold must be a whole number.')
    .min(1, 'Require at least one verified proof.')
    .max(MIN_VERIFIED_PROOFS_MAX, 'That threshold is higher than any worker could reach.')
    .default(1),
  maxDistanceKm: z
    .number()
    .int('The distance must be a whole number of kilometres.')
    .min(1, 'Set a distance of at least 1 km.')
    .max(MAX_DISTANCE_KM_MAX, 'That distance is larger than the planet.')
    .default(25),
});

export const updateSpecSchema = z
  .object({
    requiredSkill: skillTagSchema.optional(),
    minProofThreshold: z
      .number()
      .int('The proof threshold must be a whole number.')
      .min(1, 'Require at least one verified proof.')
      .max(MIN_VERIFIED_PROOFS_MAX, 'That threshold is higher than any worker could reach.')
      .optional(),
    maxDistanceKm: z
      .number()
      .int('The distance must be a whole number of kilometres.')
      .min(1, 'Set a distance of at least 1 km.')
      .max(MAX_DISTANCE_KM_MAX, 'That distance is larger than the planet.')
      .optional(),
    /**
     * Deactivating rather than deleting is the normal way to stop a spec matching.
     * Deletion stays available for specs that were a mistake, and offers keep a
     * null reference to the spec they came from rather than cascading away.
     */
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * Search parameters.
 *
 * `referenceGps` is the point distances are measured from, supplied by the
 * employer rather than inferred. Inferred would mean guessing which of several
 * stored locations is the one they meant.
 */
export const searchSchema = z.object({
  specId: z.string().uuid('That capability spec is not valid.').optional(),
  requiredSkill: skillTagSchema.optional(),
  minProofThreshold: z.coerce
    .number()
    .int('The proof threshold must be a whole number.')
    .min(1)
    .max(MIN_VERIFIED_PROOFS_MAX)
    .default(1),
  maxDistanceKm: z.coerce
    .number()
    .int('The distance must be a whole number of kilometres.')
    .min(1)
    .max(MAX_DISTANCE_KM_MAX)
    .default(25),
  referenceGps: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const offerIdParamSchema = z.object({
  offerId: z.string().uuid('That invitation is not valid.'),
});

/**
 * Creating an invitation.
 *
 * Addressed by `candidateHandle`, never by worker id. A caller who somehow obtains
 * a real worker id must not be able to act on it here, so the request shape itself
 * refuses to accept one.
 */
export const createOfferSchema = z.object({
  candidateHandle: z
    .string()
    .trim()
    .min(16, 'That candidate link is not valid.')
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'That candidate link is not valid.'),
  note: z
    .string()
    .trim()
    .max(500, 'Keep the message under 500 characters.')
    .optional(),
});

export const respondOfferSchema = z.object({
  response: z.enum(OFFER_RESPONSES),
});

/** An admin's decision on an employer account. */
export const approvalDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected', 'pending']),
  note: z.string().trim().max(200, 'Keep the note under 200 characters.').optional(),
});

export const employerIdParamSchema = z.object({
  employerId: z.string().uuid('That employer account is not valid.'),
});

export type CreateSpecInput = z.infer<typeof createSpecSchema>;
export type UpdateSpecInput = z.infer<typeof updateSpecSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;