import { z } from 'zod';
import { VERIFICATION_RESPONSES } from '@tetherproof/shared';

export const tokenParamSchema = z.object({
  token: z
    .string()
    .min(32, 'Verification link is not valid.')
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, 'Verification link is not valid.'),
});

export const confirmSchema = z.object({
  response: z.enum(VERIFICATION_RESPONSES).refine((value) => value !== 'none', {
    message: 'Response must be either confirmed or rejected.',
  }),
  verifierGps: z
    .string()
    .trim()
    .regex(/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/, 'Location coordinates are malformed.')
    .optional(),
});

export type ConfirmInput = z.infer<typeof confirmSchema>;
