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
  /**
   * A random identifier the recipient's browser generated, so the same client
   * answering several proofs can be recognised without anyone typing a number.
   *
   * Read from a header rather than the body, which keeps it out of request logs
   * and out of any body a caller might persist. Normalised by
   * `lib/verifier-key.ts`; a malformed value is simply treated as absent rather
   * than refusing the whole answer, because the decision being recorded matters
   * more than the pseudonym.
   */
  verifierKey: z.string().optional(),
});

export type ConfirmInput = z.infer<typeof confirmSchema>;
