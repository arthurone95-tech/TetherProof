import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { mediaUploadRateLimiter } from '../../middleware/rate-limit.js';
import { acceptProofMedia } from '../../middleware/upload.js';
import { validateBody } from '../../middleware/validate.js';
import { AppError } from '../../lib/errors.js';
import { proofSubmissionSchema } from './schemas.js';
import { submitProof } from './service.js';

export const proofRouter = Router();

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