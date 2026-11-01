import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validateBody, validateParams, readParam } from '../../middleware/validate.js';
import { createWorkerLinkSchema, workerLinkIdParamSchema } from './schemas.js';
import { createWorkerLink, deleteWorkerLink, listWorkerLinks } from './service.js';

export const workerLinksRouter = Router();

/**
 * The addresses a worker attached to their account on Connect.
 *
 * Mounted at `/workers/links`. Stored only: no credential, no API call, and
 * nothing read from the source. The worker vouches for the address by pasting
 * it, the same way they vouch for anything else they write on their profile.
 */
workerLinksRouter.get(
  '/',
  authenticate,
  authorize('worker'),
  async (req, res, next) => {
    try {
      res.json(await listWorkerLinks(req.auth!.userId));
    } catch (error) {
      next(error);
    }
  },
);

workerLinksRouter.post(
  '/',
  authenticate,
  authorize('worker'),
  validateBody(createWorkerLinkSchema),
  async (req, res, next) => {
    try {
      const { name, url } = req.body as { name: string; url: string };
      res.status(201).json(await createWorkerLink(req.auth!.userId, name, url));
    } catch (error) {
      next(error);
    }
  },
);

workerLinksRouter.delete(
  '/:id',
  authenticate,
  authorize('worker'),
  validateParams(workerLinkIdParamSchema),
  async (req, res, next) => {
    try {
      await deleteWorkerLink(req.auth!.userId, readParam(req, 'id'));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
