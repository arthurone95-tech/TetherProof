import { Router, type Request, type RequestHandler, type Response } from 'express';
import { PROOF_REVIEW_OUTCOMES } from '@tetherproof/shared';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { readParam, validateBody } from '../../middleware/validate.js';
import { account, requireProofId } from '../proofs/guards.js';
import { appealProof, reviewProof, reviewQueue } from './service.js';

/**
 * Forwards a rejected handler to Express's error middleware.
 *
 * An async handler that throws does not reach `next` on its own, so an unguarded
 * rejection becomes a hung request rather than the project's error envelope.
 */
function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export const reviewRouter = Router();

// Driven from the shared constant rather than written out, so the admin UI, this
// validator, and the database enum cannot drift into disagreeing about what a
// decision even is.
const reviewDecisionSchema = z.object({
  outcome: z.enum(PROOF_REVIEW_OUTCOMES),
});

/**
 * A worker's own appeal, and the reviewer's queue and decision.
 *
 * Split across two routers below rather than one, because the two sides of this
 * feature have opposite risk profiles. The appeal is a self-service action on the
 * caller's own record and changes nothing about the outcome. The review is the
 * only path to `fraud_blocked` in the entire system and the only path back to
 * `verified`, so it is admin-only at the mount.
 */

/** The queue, and the two decisions an admin may take. */
export const adminReviewRouter = Router();

adminReviewRouter.use(authenticate, authorize('admin'));

adminReviewRouter.get(
  '/proof-review',
  asyncHandler(async (_req, res) => {
    res.json({ items: await reviewQueue() });
  }),
);

adminReviewRouter.post(
  '/proof-review/:proofId',
  validateBody(reviewDecisionSchema),
  asyncHandler(async (req, res) => {
    const admin = account(req);
    // The reviewer's id comes from the session, never the body, so a decision
    // cannot be attributed to somebody who did not make it.
    const result = await reviewProof(requireProofId(readParam(req, 'proofId')), req.body.outcome, admin.userId);
    res.json(result);
  }),
);

/** The caller's own appeal. Worker-scoped, like the rest of the proof routes. */
reviewRouter.post(
  '/proofs/:proofId/appeal',
  authenticate,
  authorize('worker'),
  asyncHandler(async (req, res) => {
    const worker = account(req);
    res.json(await appealProof(worker.userId, requireProofId(readParam(req, 'proofId'))));
  }),
);
