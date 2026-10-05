import { Router, type Request, type RequestHandler } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import {
  readParam,
  validateBody,
  validateParams,
  validateQuery,
} from '../../middleware/validate.js';
import type {
  CapabilitySpec,
  CandidateCard,
  EmployerVerificationStatus,
  OfferSendingStatus,
  ReceivedOffer,
  SentOffer,
} from '@tetherproof/shared';
import {
  approvalDecisionSchema,
  createOfferSchema,
  createSpecSchema,
  employerIdParamSchema,
  offerIdParamSchema,
  respondOfferSchema,
  searchSchema,
  specIdParamSchema,
  updateSpecSchema,
} from './schemas.js';
import {
  countPendingOffers,
  createOffer,
  createSpec,
  deleteSpec,
  getOfferSendingStatus,
  getOwnApproval,
  listReceivedOffers,
  listSentOffers,
  listSpecs,
  respondToOffer,
  searchCandidates,
  setApprovalStatus,
  updateSpec,
} from './service.js';

/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 *
 * Express 4 does not do this itself: a throw inside an async handler becomes an
 * unhandled rejection and the request hangs until it times out, so a thrown
 * AppError would surface to the caller as a hung connection instead of the 403 or
 * 404 it describes. The other modules wrap each handler by hand for the same
 * reason; this does it once.
 */
function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req: Request, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Reads the authenticated account.
 *
 * Every route here runs behind `authenticate`, which is the only thing that sets
 * `req.auth`. The check is a type narrowing, not a second authorization step.
 */
function account(req: Request): { userId: string } {
  const auth = req.auth;
  if (!auth) throw new Error('authenticate must run first');
  return auth;
}

// ---------------------------------------------------------------------------
// Employer routes
// ---------------------------------------------------------------------------

export const employerRouter = Router();

/**
 * Employer discovery and matching.
 *
 * Mounted at `/employers`, so the full paths are `/api/v1/employers/specs` and
 * friends as the API documentation specifies.
 *
 * Authenticated and employer-only. An employer writes specs and sends
 * invitations; a worker receives them. Neither may act as the other, so the role
 * requirement is enforced per router rather than left to each handler.
 */
employerRouter.use(authenticate, authorize('employer'));

/**
 * The employer's own approval state.
 *
 * Exists so the dashboard can explain a disabled send button rather than leaving
 * an employer guessing. It deliberately does not expose who reviewed the account,
 * only that a decision was made and what it was.
 */
employerRouter.get(
  '/approval',
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const record = await getOwnApproval(auth.userId);
    const sending: OfferSendingStatus = await getOfferSendingStatus(auth.userId);

    res.json({
      status: record.status as EmployerVerificationStatus,
      record,
      sending,
    });
  }),
);

/**
 * Zero-knowledge talent search.
 *
 * Open to unapproved employers. Searching returns aggregated proof metrics and no
 * worker identity, so it is not the action that needs a human to have looked at
 * the account first. Sending is, and that gate lives in the service.
 */
employerRouter.get(
  '/search',
  validateQuery(searchSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const input = req.query as unknown as Parameters<typeof searchCandidates>[1];
    const candidates: CandidateCard[] = await searchCandidates(auth.userId, input);
    res.json({ candidates });
  }),
);

employerRouter.get(
  '/specs',
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const specs: CapabilitySpec[] = await listSpecs(auth.userId);
    res.json({ specs });
  }),
);

employerRouter.post(
  '/specs',
  validateBody(createSpecSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    res.status(201).json(await createSpec(auth.userId, req.body));
  }),
);

employerRouter.patch(
  '/specs/:specId',
  validateParams(specIdParamSchema),
  validateBody(updateSpecSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    res.json(await updateSpec(readParam(req, 'specId'), auth.userId, req.body));
  }),
);

/**
 * Deletes a spec.
 *
 * Offers keep a null reference to the spec they came from rather than cascading
 * away, so an employer cannot erase their own history of who they contacted by
 * deleting the filter that found them.
 */
employerRouter.delete(
  '/specs/:specId',
  validateParams(specIdParamSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    await deleteSpec(readParam(req, 'specId'), auth.userId);
    res.status(204).end();
  }),
);

/**
 * Sends an invitation to a masked candidate card.
 *
 * Addressed by handle only. The request schema has no field for a worker id, so a
 * caller who obtained one cannot act on it here even by accident.
 *
 * The approval gate runs inside the service rather than as middleware, so the rule
 * holds however this route is reached.
 */
employerRouter.post(
  '/offers',
  validateBody(createOfferSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    res.status(201).json(await createOffer(auth.userId, req.body, null));
  }),
);

/** Invitations this employer sent, with the workers they were addressed to. */
employerRouter.get(
  '/offers',
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const offers: SentOffer[] = await listSentOffers(auth.userId);
    res.json({ offers });
  }),
);

// ---------------------------------------------------------------------------
// Worker-side invitation handling
// ---------------------------------------------------------------------------

/**
 * Invitations addressed to the signed-in worker.
 *
 * A separate router so the role requirement is `worker`. An employer cannot answer
 * an invitation addressed to them, because that is not a thing that can happen.
 */
export const inviteRouter = Router();

inviteRouter.use(authenticate, authorize('worker'));

inviteRouter.get(
  '/offers',
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const offers: ReceivedOffer[] = await listReceivedOffers(auth.userId);
    res.json({ offers, pendingCount: await countPendingOffers(auth.userId) });
  }),
);

/**
 * Records the worker's answer.
 *
 * Answering an already-answered invitation is refused rather than overwriting, so
 * a decision that was recorded cannot be silently retracted. Changing one's mind is
 * done by a new invitation instead.
 */
inviteRouter.post(
  '/offers/:offerId/respond',
  validateParams(offerIdParamSchema),
  validateBody(respondOfferSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    res.json(await respondToOffer(auth.userId, readParam(req, 'offerId'), req.body.response));
  }),
);

// ---------------------------------------------------------------------------
// Admin approval
// ---------------------------------------------------------------------------

/**
 * Employer account approvals.
 *
 * Admin-only, and the reason employers self-register but cannot yet send. Kept on
 * its own router so the admin role check is a mount-time property rather than
 * something each handler repeats.
 */
export const employerAdminRouter = Router();

employerAdminRouter.use(authenticate, authorize('admin'));

/**
 * Records an approval decision.
 *
 * `pending` is accepted as a reset so a mistaken approval can be undone, and the
 * reviewer's identity and timestamp are stored rather than inferred. An approval
 * that cannot be audited is not a control worth having.
 */
employerAdminRouter.post(
  '/employers/:employerId/approval',
  validateParams(employerIdParamSchema),
  validateBody(approvalDecisionSchema),
  asyncHandler(async (req, res) => {
    const admin = account(req);
    const status = await setApprovalStatus(readParam(req, 'employerId'), req.body, admin.userId);
    res.json({ employerId: readParam(req, 'employerId'), status });
  }),
);