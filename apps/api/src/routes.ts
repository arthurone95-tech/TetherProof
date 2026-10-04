import { Router } from 'express';
import { authRouter } from './modules/auth/routes.js';
import { healthRouter } from './modules/health/routes.js';
import { verificationRouter } from './modules/verifications/routes.js';

export const apiRouter = Router();

// `healthRouter` already declares the `/health` path, so it mounts at the API
// root to serve `/api/v1/health` as required by the deployment documentation.
apiRouter.use('/', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/verifications', verificationRouter);
