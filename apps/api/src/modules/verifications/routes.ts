import { Router } from 'express';
import { verificationRateLimiter } from '../../middleware/rate-limit.js';
import { readParam, validateBody, validateParams } from '../../middleware/validate.js';
import { VERIFIER_KEY_HEADER, normalizeVerifierKey } from '../../lib/verifier-key.js';
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
      // The recipient's self-generated pseudonym rides in a header rather than
      // the body, so it never reaches a body logger. It is read here and passed
      // through explicitly; `normalizeVerifierKey` rejects anything malformed,
      // which makes a bad header equivalent to no header rather than a refusal.
      //
      // The body's own `verifierKey` is removed first: the header is the only
      // supported source, so a caller cannot bypass normalisation by putting the
      // value in the JSON.
      const { verifierKey: _ignored, ...body } = req.body;

      const result = await submitVerification(readParam(req, 'token'), {
        ...body,
        verifierKey: normalizeVerifierKey(req.get(VERIFIER_KEY_HEADER)),
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);
