import { z } from 'zod';

/**
 * Creating a link stores a name and an address and nothing else. The address must
 * be a real web address, so a mistyped or non-web value is refused here rather
 * than stored and rendered as a broken link later.
 */
export const createWorkerLinkSchema = z.object({
  name: z.string().trim().min(1, 'Give the link a name.').max(120, 'That name is too long.'),
  url: z
    .string()
    .trim()
    .min(1, 'Enter an address.')
    .max(300, 'That address is too long.')
    .url('That does not look like an address.')
    .refine(
      (value) => {
        try {
          const parsed = new URL(value);
          return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.includes('.');
        } catch {
          return false;
        }
      },
      'Only http and https addresses with a website in them can be linked.',
    ),
});

export type CreateWorkerLinkInput = z.infer<typeof createWorkerLinkSchema>;

export const workerLinkIdParamSchema = z.object({
  id: z.string().uuid('That link could not be found.'),
});
