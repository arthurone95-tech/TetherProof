import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { listNotifications, markNotificationRead, markNotificationsRead } from './service.js';

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

/**
 * Marks one notification as read, so opening it clears the unread count.
 *
 * A separate route rather than a parameter on the bulk one, because the two do
 * different things and a caller that wants one must not be able to get the other
 * by passing an id. The write is scoped to the caller inside the service, so this
 * route never receives a notification belonging to somebody else and reports
 * `marked: false` rather than a 404 — the id is not the reader's to confirm.
 *
 * Not rate-limited beyond the global limiter: it is one indexed write against a
 * row the caller already owns, and it is only reached by a tap.
 */
notificationsRouter.post(
  '/:notificationId/read',
  authenticate,
  authorize('worker', 'employer'),
  async (req, res, next) => {
    try {
      const notificationId = z.string().uuid().safeParse(req.params.notificationId);
      if (!notificationId.success) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'That notification id is not valid.', status: 400 },
        });
        return;
      }

      res.json(await markNotificationRead(req.auth!.userId, notificationId.data));
    } catch (error) {
      next(error);
    }
  },
);
