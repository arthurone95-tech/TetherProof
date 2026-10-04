import { z } from 'zod';
import { USER_ROLES } from '@tetherproof/shared';

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
    role: z.enum(USER_ROLES).default('worker'),
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
