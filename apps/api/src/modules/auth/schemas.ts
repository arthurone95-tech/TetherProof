import { z } from 'zod';
import { SELF_REGISTER_ROLES } from '@tetherproof/shared';
import { gpsSchema } from '../../lib/geo.js';

const phoneSchema = z
  .string()
  .trim()
  .min(7, 'Phone number is too short.')
  .max(32)
  .regex(/^\+?[0-9\s()-]+$/, 'Phone number contains unsupported characters.');

export const registerSchema = z
  .object({
    phoneNumber: phoneSchema.optional(),
    email: z.string().trim().email('A valid email address is required.').max(320).optional(),
    password: z
      .string()
      .min(12, 'Password must be at least 12 characters.')
      .max(200)
      .regex(/[a-z]/, 'Password must include a lowercase letter.')
      .regex(/[A-Z]/, 'Password must include an uppercase letter.')
      .regex(/[0-9]/, 'Password must include a number.'),
    /**
     * The role to create the account with.
     *
     * Constrained to `SELF_REGISTER_ROLES`, which excludes `admin`. Accepting the
     * full `USER_ROLES` list here let anyone self-declare an administrator: the
     * endpoint writes the claim server-side, so the account then satisfied
     * `authorize('admin')` and could call the employer approval endpoint to approve
     * any employer, defeating the control that stops unsolicited contact with
     * workers. Rejecting it here is the boundary; provisioning an admin by writing
     * the claim against the auth account requires a credential that already has
     * elevated access.
     */
    role: z.enum(SELF_REGISTER_ROLES).default('worker'),
    fullName: z.string().trim().min(1).max(160).optional(),
  })
  .refine((value) => Boolean(value.phoneNumber ?? value.email), {
    message: 'A phone number or an email address is required.',
    path: ['phoneNumber'],
  });

export const loginSchema = z
  .object({
    phoneNumber: phoneSchema.optional(),
    email: z.string().trim().email().max(320).optional(),
    password: z.string().min(1, 'Password is required.').max(200),
  })
  .refine((value) => Boolean(value.phoneNumber ?? value.email), {
    message: 'A phone number or an email address is required.',
    path: ['phoneNumber'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Identifies the account proving ownership of a channel.
 *
 * Shared by the "send me a code" and "here is my code" endpoints so both
 * accept exactly the same set of identifiers.
 */
const confirmationTargetSchema = z.object({
  phoneNumber: phoneSchema.optional(),
  email: z.string().trim().email('A valid email address is required.').max(320).optional(),
});

const hasTarget = (value: { phoneNumber?: string; email?: string }): boolean =>
  Boolean(value.phoneNumber ?? value.email);

const targetRequired = {
  message: 'A phone number or an email address is required.',
  path: ['phoneNumber'],
};

export const confirmRequestSchema = confirmationTargetSchema.refine(hasTarget, targetRequired);

/**
 * Self-service updates to the signed-in account's own profile.
 *
 * These fields exist on `profiles` and were unreachable until this endpoint: they
 * were insert-only at registration, where they are always null, so a worker's
 * location and an employer's organization name had no way to ever be set. Two
 * Phase 4 features depend on them — an employer's search measures distance from a
 * worker's stated location, and a worker is shown who invited them — so leaving
 * them permanently null would have made both features non-functional while
 * looking finished.
 *
 * Every field is optional and at least one must be present. An explicit `null` on
 * `locationGps` clears it, which matters because declining to share a location has
 * to be a state a worker can return to.
 *
 * `avatarUrl` is deliberately not updatable here. It has no consumer anywhere, and
 * accepting a caller-supplied URL would eventually mean rendering or fetching an
 * arbitrary third-party address on the strength of this field.
 */
export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Enter your name.').max(160).optional(),
    locationGps: gpsSchema.nullable().optional(),
    organizationName: z.string().trim().min(1).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * Accepts a 6-digit one-time code and also the longer token from a magic-link
 * email, because either template may be enabled in Supabase Auth.
 */
export const confirmSchema = confirmationTargetSchema
  .extend({
    token: z.string().trim().min(6, 'Enter the code you received.').max(200),
  })
  .refine(hasTarget, targetRequired);

export type ConfirmRequestInput = z.infer<typeof confirmRequestSchema>;
export type ConfirmInput = z.infer<typeof confirmSchema>;
