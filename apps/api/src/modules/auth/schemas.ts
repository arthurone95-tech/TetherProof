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
