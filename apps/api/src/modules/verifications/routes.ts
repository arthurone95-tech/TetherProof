import { Router } from 'express';
import { verificationRateLimiter } from '../../middleware/rate-limit.js';
import { readParam, validateBody, validateParams } from '../../middleware/validate.js';
import { getVerificationSummary, submitVerification } from './service.js';
import { confirmSchema, tokenParamSchema } from './schemas.js';

export const verificationRouter = Router();

/**
 * Public endpoints reached from an SMS/WhatsApp link.
 *
 * No authentication is required, so responses are limited to a task summary
 * and never include worker identity or anti-fraud telemetry. The raw token is
 * read from the URL path and is never written to a log.
 */

verificationRouter.get(
  '/:token',
  verificationRateLimiter,
  validateParams(tokenParamSchema),
  async (req, res, next) => {
    try {
      const summary = await getVerificationSummary(readParam(req, 'token'));
      res.status(200).json(summary);
    } catch (error) {
      next(error);
    }
  },
);

verificationRouter.post(
  '/:token',
  verificationRateLimiter,
  validateParams(tokenParamSchema),
  validateBody(confirmSchema),
  async (req, res, next) => {
    try {
      const result = await submitVerification(readParam(req, 'token'), req.body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);
