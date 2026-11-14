import { Router } from 'express';
import { authRouter } from './modules/auth/routes.js';
import {
  businessAdminRouter,
  businessRouter,
  capabilityRouter,
} from './modules/capabilities/routes.js';
import { connectionsRouter } from './modules/connections/routes.js';
import { workerLinksRouter } from './modules/links/routes.js';
import {
  employerAdminRouter,
  employerRouter,
  inviteRouter,
} from './modules/employers/routes.js';
import { healthRouter } from './modules/health/routes.js';
import { locationRouter } from './modules/locations/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { proofRouter } from './modules/proofs/routes.js';
import { publicRouter } from './modules/public/routes.js';
import { adminReviewRouter, reviewRouter } from './modules/review/routes.js';
import {
  demandRouter,
  studentCredentialRouter,
  studentEnrolmentRouter,
  trainerRouter,
} from './modules/trainers/routes.js';
import { verificationRouter } from './modules/verifications/routes.js';

export const apiRouter = Router();

// `healthRouter` already declares the `/health` path, so it mounts at the API
// root to serve `/api/v1/health` as required by the deployment documentation.
apiRouter.use('/', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/verifications', verificationRouter);

// Turns the browser's GPS fixes into place names. Public and rate limited; see
// the module for why it does not sit with the signed-in routes.
apiRouter.use('/locations', locationRouter);

// Mounted at `/workers` so the full path is `/api/v1/workers/proofs`, matching
// the API documentation. A proof is owned by the worker who performed the work.
apiRouter.use('/workers', proofRouter);

// A worker's own appeal against a record the trust engine withheld. Mounted under
// `/workers` so the appeal path reads as the mirror of the submission that
// produced it, and so it inherits the same ownership scoping.
apiRouter.use('/workers', reviewRouter);

// Employer discovery and matching, per the API documentation: specs and search at
// `/employers`, invitations the employer sent at `/employers/offers`.
apiRouter.use('/employers', employerRouter);

// Invitations addressed to the worker. Mounted at `/invites` rather than under
// `/employers`, because the authenticated party is a worker and the path should
// not imply otherwise.
apiRouter.use('/invites', inviteRouter);

// The worker's notification feed.
apiRouter.use('/notifications', notificationsRouter);

// Telemetry connections (GitHub scaffold). Mounted under `/workers` so the
// module owns its whole surface: list, start, callback, revoke.
apiRouter.use('/workers/connections', connectionsRouter);

// Addresses a worker attached to their account on Connect. Stored only: no
// credential, no API call, nothing read from the source.
apiRouter.use('/workers/links', workerLinksRouter);

// A worker's own micro-credentials and enrolment. Under `/workers` for the same
// reason as the proofs above it: the authenticated party is a worker, and the
// scoping is inherited rather than re-decided.
// Enrolment is mounted FIRST and separately, on uthenticate alone: redeeming a code is
// what grants 	rainee, so gating it on 	rainee would make it unusable. Order matters —
// studentEnrolmentRouter must be matched before studentCredentialRouter, which would
// otherwise swallow /enrolment under a worker/	rainee guard and refuse a new student.
apiRouter.use('/workers', studentEnrolmentRouter);
apiRouter.use('/workers', studentCredentialRouter);

// The training provider's workspace: roster, milestone issuer, demand insights.
// Its own prefix so the elevated surface stays identifiable, and so a role check
// is one mount rather than something each handler repeats.
apiRouter.use('/trainers', trainerRouter);

// The same aggregate demand read, for every signed-in account that is not a training
// provider. Keeps the analytics behind a single service function while letting a
// student read "what employers are searching for" without a training-provider role.
apiRouter.use('/demand', demandRouter);

// Public capability profiles behind shareable links. Json, read-only, and
// gated by the worker's own flag plus an unguessable slug.
apiRouter.use('/public', publicRouter);

// Capabilities and businesses (migration 0012). Reachable by any signed-in
// account, because activating a capability *is* the thing a person does for
// themselves — requiring a capability to reach the page that grants capabilities
// would be a catch-22. The rules about which are self-service live in the
// service, so they hold however these routes are reached.
apiRouter.use('/auth/capabilities', capabilityRouter);
apiRouter.use('/businesses', businessRouter);

// Admin-only employer approvals. Mounted at the API root under `/admin` to keep
// the elevated surface on one identifiable prefix.
apiRouter.use('/admin', employerAdminRouter);

// Admin-only business approvals, on the same prefix. Admin is read from the
// server-controlled claim rather than granted as a capability, so there is no
// row anybody could insert to reach it.
apiRouter.use('/admin', businessAdminRouter);

// The queue for records the trust engine withheld, and the only path to
// `fraud_blocked` or back to `verified`. Admin-only at the mount, alongside the
// employer approvals, because it is the same kind of decision: a person acting on
// the platform's authority rather than their own account's.
apiRouter.use('/admin', adminReviewRouter);
