import { Router } from 'express';
import { authRouter } from './modules/auth/routes.js';
import {
  employerAdminRouter,
  employerRouter,
  inviteRouter,
} from './modules/employers/routes.js';
import { healthRouter } from './modules/health/routes.js';
import { locationRouter } from './modules/locations/routes.js';
import { proofRouter } from './modules/proofs/routes.js';
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

// Employer discovery and matching, per the API documentation: specs and search at
// `/employers`, invitations the employer sent at `/employers/offers`.
apiRouter.use('/employers', employerRouter);

// Invitations addressed to the worker. Mounted at `/invites` rather than under
// `/employers`, because the authenticated party is a worker and the path should
// not imply otherwise.
apiRouter.use('/invites', inviteRouter);

// Admin-only employer approvals. Mounted at the API root under `/admin` to keep
// the elevated surface on one identifiable prefix.
apiRouter.use('/admin', employerAdminRouter);
