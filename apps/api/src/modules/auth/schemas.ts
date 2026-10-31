import { z } from 'zod';
import { passwordProblems } from '@tetherproof/shared';
import { gpsSchema } from '../../lib/geo.js';
import { redirectOriginSchema } from '../../lib/redirect.js';

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
    /**
     * Validated by `passwordProblems` from `@tetherproof/shared` rather than by a
     * chain of `.min()` and `.regex()` here.
     *
     * The rules and their messages are the same ones the registration action checks
     * before it sends anything, so the two cannot disagree about what is acceptable.
     * They previously could, and did: every refusal reached the browser as the bare
     * `Request body failed validation.` because this schema's precise issue was
     * dropped on the way out. See `doc/13` E-030.
     *
     * `.superRefine` rather than `.refine`, so a password failing three rules reports
     * all three instead of only the first — which is what the previous chain of
     * checks did, and what someone fixing their password needs.
     */
    password: z.string().superRefine((value, ctx) => {
      for (const message of passwordProblems(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }
    }),
    /**
     * Accepted for compatibility with clients built before migration `0012`, and
     * **ignored**.
     *
     * Registration used to ask a new account to pick a role and accept anything in
     * `SELF_REGISTER_ROLES`. That list is now empty, and asking at all is the first fork
     * the capability model exists to remove: whichever role was chosen would be the only
     * one the account could have, and the other three would need a second account. The
     * field is tolerated rather than rejected so an older deployed client does not break
     * mid-rollout, but no value of it reaches `auth_metadata`, so it cannot grant anything.
     *
     * `admin` was never in that list, and the boundary that excluded it is now stronger
     * than a list: an administrator is read from the server-controlled claim and is not a
     * capability, so there is no row anybody could insert. See `doc/13` E-024.
     */
    role: z.unknown().optional(),
    fullName: z.string().trim().min(1).max(160).optional(),
    /**
     * Where a confirmation link may return the person who taps it.
     *
     * Supplied by the web client, which knows the origin the request actually
     * arrived on, because the API is called server-to-server and sees only its
     * own address. Absent for callers that talk to the API directly, which then
     * fall back to the configured origin, and finally to Supabase's own Site URL.
     *
     * Validated as a destination rather than trusted: see `lib/redirect.ts` for
     * why an unchecked value here would turn every confirmation email into an
     * open redirect carrying a session.
     */
    redirectOrigin: redirectOriginSchema.optional(),
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

export const confirmRequestSchema = confirmationTargetSchema
  // Only on the request, not on `confirmSchema`: a code is redeemed by an API
  // call that never sends anything, so a return address there would be dead
  // configuration with no reason to be validated.
  .extend({ redirectOrigin: redirectOriginSchema.optional() })
  .refine(hasTarget, targetRequired);

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
    /**
     * Worker privacy choices. They are accepted for any role but only the
     * surfaces that exist for workers (search, the shareable page, invitations)
     * consume them; an employer's row holding them changes nothing, because no
     * consumer reads an employer's `discoverable`.
     */
    discoverable: z.boolean().optional(),
    showNameOnVerificationLink: z.boolean().optional(),
    publicProfile: z.boolean().optional(),
    invitationPreference: z.enum(['all', 'approved_only']).optional(),
    showLinksOnProfile: z.boolean().optional(),
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
