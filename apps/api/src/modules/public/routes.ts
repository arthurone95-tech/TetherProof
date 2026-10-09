import { Router } from 'express';
import { getPublicCapabilityProfile } from '../proofs/service.js';
import { publicReadRateLimiter } from '../../middleware/rate-limit.js';

export const publicRouter = Router();

/**
 * Public, read-only capability profiles behind a worker's shareable link.
 *
 * No authentication: the page is the point of the feature. The gate is the
 * unguessable slug plus the worker's own `public_profile` flag, and everything
 * the endpoint returns is an aggregate (see `getPublicCapabilityProfile`).
 * `no-store` is set because these pages are shareable and cheap, and a cache
 * could serve a page the worker has since turned off.
 */
publicRouter.get(
  '/profiles/:slug',
  publicReadRateLimiter,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await getPublicCapabilityProfile(req.params.slug ?? ''));
    } catch (error) {
      next(error);
    }
  },
);