import { z } from 'zod';
import { CREDENTIAL_RESPONSES } from '@tetherproof/shared';

/**
 * Request shapes for the training provider module (doc/02 Module 4).
 *
 * These are the only place a trainer-supplied value is defined, so a field that
 * appears on no screen is a field no handler reads. The notable absence is any way
 * to name a student: enrolment is by code, and issuing addresses somebody on the
 * institute's own roster by the enrolment id the institute was given. Neither
 * endpoint accepts a worker id, an email address, or a name, because none of those
 * is something an institute needs and all three would turn it into a directory of
 * people who never asked to be in one.
 */

/** A skill, bounded exactly as the employer spec builder bounds it. */
export const trainerSkillTagSchema = z
  .string()
  .trim()
  .min(2, 'Enter a skill of at least 2 characters.')
  .max(160, 'Keep the skill under 160 characters.');

/**
 * A milestone an instructor signs off.
 *
 * `enrolmentId` rather than a student id: the institute can only ever address a
 * student it has already enrolled, and the enrolment id is the value it was given
 * on the roster. There is no shape of this request that could name somebody who is
 * not already on the roster.
 *
 * `note` is the instructor's own words and is capped, and is always rendered as
 * text rather than markup — the same rule every other user-authored string on the
 * platform follows.
 */
export const issueCredentialSchema = z.object({
  enrolmentId: z.string().uuid('That student is not on your roster.'),
  skillTag: trainerSkillTagSchema,
  skillLevel: z.coerce
    .number()
    .int('The level must be a whole number.')
    .min(1, 'The lowest level is 1.')
    .max(3, 'The highest level is 3.')
    .default(1),
  milestoneTitle: z
    .string()
    .trim()
    .min(3, 'Give the practical a name of at least 3 characters.')
    .max(200, 'Keep the title under 200 characters.'),
  note: z
    .string()
    .trim()
    .max(1000, 'Keep the note under 1000 characters.')
    .optional(),
});

export const enrolmentIdParamSchema = z.object({
  enrolmentId: z.string().uuid('That enrolment is not valid.'),
});

export const credentialIdParamSchema = z.object({
  credentialId: z.string().uuid('That credential is not valid.'),
});

/**
 * Redeeming an institute's enrolment code.
 *
 * Normalised before hashing so that a code typed with a trailing space, in the
 * wrong case, or without its dashes still works. The stored digest is of the
 * normalised form, which is the only form that is ever accepted.
 */
export const redeemEnrolmentSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, 'That enrolment code is not valid.')
    .max(64, 'That enrolment code is not valid.'),
});

/**
 * The student's answer to an issued credential.
 *
 * A single answer, and it is final: the row moves to `accepted` or `declined` and
 * is never asked twice. A second answer is a conflict rather than a silent
 * overwrite, because two taps on a phone should not be able to rewrite a decision
 * the institute has already acted on.
 *
 * The verb is `accepted`, not `confirmed`: the student is agreeing to hold the
 * credential, not vouching for the skill. Nothing in this request can be read as
 * a claim that the work was independently verified.
 */
export const respondCredentialSchema = z.object({
  response: z.enum(CREDENTIAL_RESPONSES),
});

/**
 * How many rows the roster and the demand dashboard read.
 *
 * Bounded for the same reason `searchSchema` bounds its limit: an unbounded list
 * from an endpoint the dashboard polls is a denial of service on ourselves.
 */
export const demandQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export type IssueCredentialInput = z.infer<typeof issueCredentialSchema>;
export type RedeemEnrolmentInput = z.infer<typeof redeemEnrolmentSchema>;
export type RespondCredentialInput = z.infer<typeof respondCredentialSchema>;
export type DemandQuery = z.infer<typeof demandQuerySchema>;
