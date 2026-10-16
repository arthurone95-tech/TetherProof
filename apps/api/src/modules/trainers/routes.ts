import { Router, type Request, type RequestHandler } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { readParam, validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import type {
  CredentialListResponse,
  DemandInsightsResponse,
  EnrolmentCodeResponse,
  IssuedCredential,
  RosterResponse,
  StudentCredentialsResponse,
  TrainerEnrolmentResponse,
  TrainerOverviewResponse,
} from '@tetherproof/shared';
import {
  createEnrolmentCode,
  getDemandInsights,
  getRoster,
  getTrainerOverview,
  issueCredential,
  listIssuedCredentials,
  listStudentCredentials,
  redeemEnrolmentCode,
  removeStudent,
  respondToCredential,
} from './service.js';
import {
  credentialIdParamSchema,
  demandQuerySchema,
  enrolmentIdParamSchema,
  issueCredentialSchema,
  redeemEnrolmentSchema,
  respondCredentialSchema,
  type DemandQuery,
} from './schemas.js';

/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 *
 * Express 4 does not do this itself: a throw inside an async handler becomes an
 * unhandled rejection and the request hangs until it times out, so a thrown
 * AppError would surface to the caller as a hung connection instead of the 403 or
 * 404 it describes.
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
// Training provider
// ---------------------------------------------------------------------------

export const trainerRouter = Router();

/**
 * The training provider's workspace.
 *
 * Mounted at `/trainers`, so the full paths are `/api/v1/trainers/roster` and
 * friends. Authenticated and training-provider-only, enforced at the mount so the
 * rule is a property of the route group rather than something each handler can
 * forget to repeat.
 *
 * `doc/08` §2 restricts this role to "institutional milestone issuance and demand
 * analytics", and this router is exactly that and nothing else. A worker reaching it
 * is a 403 at the mount; a training provider reaching `/employers/search` gets the
 * same refusal the other way.
 */
trainerRouter.use(authenticate, authorize('training_provider'));

/**
 * The institute's dashboard summary.
 *
 * One read so the tiles and the list beneath them cannot disagree, which is the
 * failure mode of a dashboard assembled from several independent requests.
 */
trainerRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const overview: TrainerOverviewResponse = await getTrainerOverview(auth.userId);
    res.json(overview);
  }),
);

trainerRouter.get(
  '/roster',
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const roster: RosterResponse = await getRoster(auth.userId);
    res.json(roster);
  }),
);

/**
 * Creates or rotates the enrolment code.
 *
 * A POST rather than a PATCH because the effect is a new value, and because the
 * response carries the raw code, which must not be reachable by a GET — a value
 * that is only ever returned when it is created is the reason only its digest is
 * stored.
 */
trainerRouter.post(
  '/roster/code',
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const created: EnrolmentCodeResponse = await createEnrolmentCode(auth.userId);
    res.status(201).json(created);
  }),
);

/**
 * Removes a student from the roster.
 *
 * Credentials the student already holds are kept; leaving a course does not un-take
 * a practical somebody sat. See `removeStudent`.
 */
trainerRouter.delete(
  '/roster/:enrolmentId',
  validateParams(enrolmentIdParamSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    await removeStudent(auth.userId, readParam(req, 'enrolmentId'));
    res.status(204).end();
  }),
);

trainerRouter.get(
  '/credentials',
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const issued: CredentialListResponse = await listIssuedCredentials(auth.userId);
    res.json(issued);
  }),
);

/**
 * Signs off on a practical.
 *
 * Answers 201 with an `awaiting_student` credential. It is deliberately not a
 * finished credential and there is no parameter that makes it one: the second
 * signature is the student's, and this endpoint cannot supply it.
 */
trainerRouter.post(
  '/credentials',
  validateBody(issueCredentialSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const issued: IssuedCredential = await issueCredential(auth.userId, req.body);
    res.status(201).json(issued);
  }),
);

/**
 * The demand dashboard.
 *
 * Unapproved institutes are welcome here, unlike sending an invitation. Reading
 * aggregate skill demand harms nobody and teaches an institute what the network
 * needs; a bootcamp with no students yet is precisely who should see it.
 */
trainerRouter.get(
  '/demand',
  validateQuery(demandQuerySchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const { limit } = req.query as unknown as DemandQuery;
    const insights: DemandInsightsResponse = await getDemandInsights(auth.userId, limit);
    res.json(insights);
  }),
);

// ---------------------------------------------------------------------------
// The student's side
// ---------------------------------------------------------------------------

export const studentCredentialRouter = Router();

/**
 * A worker's own micro-credentials.
 *
 * Mounted under `/workers` so it inherits the same ownership scoping as the rest of
 * the worker's surface, and because the authenticated party here is a worker: a
 * student is a worker whose institute has recorded something about them.
 *
 * Worker-only. An institute cannot reach this router at all, which is what stops a
 * compromised training-provider account from answering on a student's behalf — the
 * second signature is worthless if the first party can supply both.
 */
studentCredentialRouter.use(authenticate, authorize('worker'));

/**
 * Redeems an institute's enrolment code.
 *
 * Idempotent, so a double tap is one enrolment. The response names the institute
 * that was joined, which is the one thing a student is told about it beyond their
 * own roster entry.
 */
studentCredentialRouter.post(
  '/enrolment',
  validateBody(redeemEnrolmentSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const result: TrainerEnrolmentResponse = await redeemEnrolmentCode(auth.userId, req.body.code);
    res.json(result);
  }),
);

studentCredentialRouter.get(
  '/credentials',
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const credentials: StudentCredentialsResponse = await listStudentCredentials(auth.userId);
    res.json(credentials);
  }),
);

/**
 * Accepts or declines a credential.
 *
 * One answer, and it is final — a second attempt is a 409 rather than an overwrite,
 * because an institute acts on what it is told. A credential belonging to somebody
 * else is a 404, not a 403: confirming that an id exists would confirm the record
 * exists.
 */
studentCredentialRouter.post(
  '/credentials/:credentialId',
  validateParams(credentialIdParamSchema),
  validateBody(respondCredentialSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    await respondToCredential(
      auth.userId,
      readParam(req, 'credentialId'),
      req.body.response,
    );
    res.status(204).end();
  }),
);
