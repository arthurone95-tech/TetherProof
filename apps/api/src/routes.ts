import { Router } from 'express';
import { authRouter } from './modules/auth/routes.js';
import { healthRouter } from './modules/health/routes.js';
import { proofRouter } from './modules/proofs/routes.js';
import { verificationRouter } from './modules/verifications/routes.js';

export const apiRouter = Router();

// `healthRouter` already declares the `/health` path, so it mounts at the API
// root to serve `/api/v1/health` as required by the deployment documentation.
apiRouter.use('/', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/verifications', verificationRouter);

// Mounted at `/workers` so the full path is `/api/v1/workers/proofs`, matching
// the API documentation. A proof is owned by the worker who performed the work.
apiRouter.use('/workers', proofRouter);
