import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { mediaUploadRateLimiter } from '../../middleware/rate-limit.js';
import { acceptProofMedia } from '../../middleware/upload.js';
import { validateBody } from '../../middleware/validate.js';
import { AppError } from '../../lib/errors.js';
import { proofSubmissionSchema, proofUpdateSchema } from './schemas.js';
import {
  getWorkerProof,
  listWorkerProofs,
  resendVerificationLink,
  submitProof,
  updateWorkerProof,
  workerCapabilities,
  workerOverview,
} from './service.js';

export const proofRouter = Router();

/**
 * Rejects a route parameter that cannot be a proof id.
 *
 * The expression layer would answer a non-UUID with a Postgres syntax error
 * (a 500 that leaks nothing but tells a caller nothing either); refusing it
 * here turns the same request into the same 404 an unknown id gets.
 */
function requireProofId(value: string | undefined): string {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw AppError.notFound('That log entry was not found.');
  }
  return value;
}

/**
 * Worker proof submission.
 *
 * The only route that writes media to storage. It is mounted behind worker
 * authorization because a proof belongs to the worker who performed the work, so
 * an employer or training provider submitting on someone's behalf would break
 * the ownership chain the verification flow depends on.
 *
 * Order is load-bearing: the upload is parsed before the body is validated,
 * because in a multipart request the text fields and the file arrive together and
 * the fields cannot be read until the body has been consumed.
 *
 * `req.file` is typed by the `@types/multer` global augmentation, so no local
 * declaration of the media shape is needed here.
 */
proofRouter.post(
  '/proofs',
  authenticate,
  authorize('worker'),
  mediaUploadRateLimiter,
  acceptProofMedia,
  validateBody(proofSubmissionSchema),
  async (req, res, next) => {
    try {
      const file = req.file;

      if (!file) {
        throw AppError.badRequest('Attach a photo or recording of the work you completed.');
      }

      // multer reports the type the client declared. The scrubber confirms the
      // bytes actually match, so this selects the scrubber rather than being
      // trusted as fact.
      const result = await submitProof(req.auth!.userId, req.body, {
        buffer: file.buffer,
        contentType: file.mimetype,
        size: file.size,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The caller's own logbook, newest first.
 *
 * Everything returned is derived from the caller's rows and a signed media URL
 * minted for them at read time, so the list cannot leak another worker's
 * record even if a session were misused.
 */
proofRouter.get(
  '/proofs',
  authenticate,
  authorize('worker'),
  async (req, res, next) => {
    try {
      res.json(await listWorkerProofs(req.auth!.userId));
    } catch (error) {
      next(error);
    }
  },
);

/** The numbers the dashboard leads with, plus the latest entries. */
proofRouter.get(
  '/overview',
  authenticate,
  authorize('worker'),
  async (req, res, next) => {
    try {
      res.json(await workerOverview(req.auth!.userId));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The caller's per-skill capability profile: tiers and verified counts.
 *
 * Rendered on the worker's own profile page and reduced further on the public
 * shareable page; both aggregate from the records, never from editable fields
 * on the worker.
 */
proofRouter.get(
  '/capabilities',
  authenticate,
  authorize('worker'),
  async (req, res, next) => {
    try {
      res.json(await workerCapabilities(req.auth!.userId));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Issues a fresh confirmation link for a log whose earlier link expired or was
 * never handed over. See `resendVerificationLink` for the freeze and privacy
 * rules that bound it.
 */
proofRouter.post(
  '/proofs/:id/verification/resend',
  authenticate,
  authorize('worker'),
  async (req, res, next) => {
    try {
      res.json(await resendVerificationLink(req.auth!.userId, requireProofId(req.params.id)));
    } catch (error) {
      next(error);
    }
  },
);

/** One log entry, with its freeze state and outstanding-link expiry. */
proofRouter.get(
  '/proofs/:id',
  authenticate,
  authorize('worker'),
  async (req, res, next) => {
    try {
      res.json(await getWorkerProof(req.auth!.userId, requireProofId(req.params.id)));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Applies an allowed edit to one of the caller's log entries.
 *
 * The write re-checks the freeze rule (see `updateWorkerProof`), so a link
 * sent between page load and save refuses the save rather than confirming
 * different text than was sent.
 */
proofRouter.patch(
  '/proofs/:id',
  authenticate,
  authorize('worker'),
  validateBody(proofUpdateSchema),
  async (req, res, next) => {
    try {
      res.json(await updateWorkerProof(req.auth!.userId, requireProofId(req.params.id), req.body));
    } catch (error) {
      next(error);
    }
  },
);