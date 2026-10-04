import { z } from 'zod';
import { VERIFICATION_RESPONSES } from '@tetherproof/shared';
import { gpsSchema } from '../../lib/geo.js';

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
  /**
   * Where the client was when they tapped.
   *
   * Uses the same validator as the submission endpoint. It previously had its own
   * copy that checked only the `lat,lon` shape, so `999,999` was accepted here
   * while being rejected on submission. One laxer endpoint is enough to poison
   * the proximity calculation this value feeds.
   */
  verifierGps: gpsSchema.optional(),
});

export type ConfirmInput = z.infer<typeof confirmSchema>;
