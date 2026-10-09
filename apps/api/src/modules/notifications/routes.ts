import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { listNotifications, markNotificationsRead } from './service.js';

export const notificationsRouter = Router();

/**
 * The member's notification feed.
 *
 * Open to workers and employers. Both sides of the loop now produce moments
 * worth surfacing: a worker sees an invitation arrive and a verification come
 * back, and an employer sees their invitation answered. The feed endpoint is
 * read-heavy and cheap; no limiter beyond the global one applies.
 */
notificationsRouter.get(
  '/',
  authenticate,
  authorize('worker', 'employer'),
  async (req, res, next) => {
    try {
      res.json(await listNotifications(req.auth!.userId, req.auth!.role));
    } catch (error) {
      next(error);
    }
  },
);

notificationsRouter.post(
  '/read',
  authenticate,
  authorize('worker', 'employer'),
  async (req, res, next) => {
    try {
      res.json(await markNotificationsRead(req.auth!.userId));
    } catch (error) {
      next(error);
    }
  },
);
