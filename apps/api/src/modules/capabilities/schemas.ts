import { z } from 'zod';
import { USER_CAPABILITIES } from '@tetherproof/shared';

/**
 * Request shapes for capabilities and businesses.
 *
 * `activateCapabilitySchema` is a `z.enum` over the capability list rather than a free
 * string, so an unknown value — `admin`, most importantly — is rejected at the edge
 * before it can reach the service. `admin` is not a member of that list, so no amount of
 * crafting gets it through this door; it is only readable from the server-controlled claim.
 */
export const capabilitySchema = z.enum(USER_CAPABILITIES, {
  errorMap: () => ({ message: 'That is not a capability this account can hold.' }),
});

export const activateCapabilitySchema = z.object({
  capability: capabilitySchema,
});

export const businessIdParamSchema = z.object({
  businessId: z.string().uuid('That business is not valid.'),
});

export const createBusinessSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Give the business a name of at least 2 characters.')
    .max(200, 'Keep the name under 200 characters.'),
});

export const businessDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected', 'pending']),
  note: z.string().trim().max(200, 'Keep the note under 200 characters.').optional(),
});

/**
 * Adding a member to a business.
 *
 * A user id, supplied by the business owner. It is the only identifier in the request and
 * it is one the owner must already hold — nothing here can reach a person who has not
 * agreed to be a member, and adding them grants the employer capability, so this is the
 * one place in the module where an identifier crosses a trust boundary.
 */
export const businessMemberSchema = z.object({
  userId: z.string().uuid('That account is not valid.'),
});

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type BusinessDecisionInput = z.infer<typeof businessDecisionSchema>;
