import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { listNotifications, markNotificationsRead } from './service.js';

export const notificationsRouter = Router();

/**
 * Worker notification feed.
 *
 * Worker-authorized: this phase's moments (offers, verifications, expiry) all
 * belong to workers, so opening the surface to other roles would be an empty
 * promise. The feed endpoint is read-heavy and cheap; no limiter beyond the
 * global one applies.
 */
notificationsRouter.get(
  '/',
  authenticate,
  authorize('worker'),
  async (req, res, next) => {
    try {
      res.json(await listNotifications(req.auth!.userId));
    } catch (error) {
      next(error);
    }
  },
);

notificationsRouter.post(
  '/read',
  authenticate,
  authorize('worker'),
  async (req, res, next) => {
    try {
      res.json(await markNotificationsRead(req.auth!.userId));
    } catch (error) {
      next(error);
    }
  },
);