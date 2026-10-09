import { Router } from 'express';
import type { ConnectionProvider } from '@tetherproof/shared';
import { CONNECTION_PROVIDERS } from '@tetherproof/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { exchangeGithubCode, verifyOAuthState } from '../../lib/github-oauth.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { locationRateLimiter } from '../../middleware/rate-limit.js';
import {
  completeGithubConnection,
  listConnections,
  revokeConnection,
  startGithubConnection,
} from './service.js';

export const connectionsRouter = Router();

/**
 * The worker's connected work-capture sources.
 *
 * Mounted at `/workers/connections`; the callback path below is where GitHub
 * returns the browser, so every segment of that route is load-bearing.
 */
connectionsRouter.get(
  '/',
  authenticate,
  authorize('worker'),
  async (req, res, next) => {
    try {
      res.json(await listConnections(req.auth!.userId));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Starts the GitHub OAuth dance.
 *
 * Answers the authorize URL only when the deployment is actually configured;
 * otherwise it refuses with a service-unavailable error whose message the web
 * client can show as-is.
 */
connectionsRouter.post(
  '/github/start',
  authenticate,
  authorize('worker'),
  locationRateLimiter,
  async (req, res, next) => {
    try {
      const result = await startGithubConnection(req.auth!.userId);
      if (!result.available) {
        throw AppError.serviceUnavailable(
          'GitHub connection is not configured on this deployment yet.',
        );
      }
      res.json({ authorizeUrl: result.authorizeUrl });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The redirect target GitHub sends the browser to after the worker approves.
 *
 * Public by necessity: GitHub cannot authenticate to this API. The `state` is
 * the worker's own signed identity — verified before anything is exchanged, so
 * a tampered or replayed state cannot attach someone else's username to a
 * worker's account — and the code is then exchanged for the profile name.
 * Whoever it says the account belongs to is recorded as-is, because OAuth is
 * the identity here.
 */
connectionsRouter.get(
  '/github/callback',
  async (req, res, next) => {
    try {
      const state = typeof req.query.state === 'string' ? req.query.state : null;
      const code = typeof req.query.code === 'string' ? req.query.code : null;

      const origin = env.WEB_BASE_URL || `${req.protocol}://${req.get('host') ?? 'localhost'}`;
      const backTo = `${origin.replace(/\/$/, '')}/profile`;

      const userId = state ? verifyOAuthState(state) : null;
      if (!userId || !code) {
        res.redirect(`${backTo}?connected=error`);
        return;
      }

      const endorsement = await exchangeGithubCode(code);
      await completeGithubConnection(userId, endorsement.username);

      res.redirect(`${backTo}?connected=github`);
    } catch (error) {
      next(error);
    }
  },
);

/** Disconnects one source. */
connectionsRouter.delete(
  '/:provider',
  authenticate,
  authorize('worker'),
  async (req, res, next) => {
    try {
      const provider = req.params.provider ?? '';
      if (!(CONNECTION_PROVIDERS as readonly string[]).includes(provider)) {
        throw AppError.notFound('That connection was not found.');
      }
      await revokeConnection(req.auth!.userId, provider as ConnectionProvider);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);