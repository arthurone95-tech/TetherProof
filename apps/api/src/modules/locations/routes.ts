import { Router } from 'express';
import { locationRateLimiter } from '../../middleware/rate-limit.js';
import { validateQuery } from '../../middleware/validate.js';
import { reverseGeocodeQuerySchema } from './schemas.js';
import { reverseGeocode } from './service.js';

export const locationRouter = Router();

/**
 * Place names for the browser's GPS fixes.
 *
 * Public, like the health probe: the request carries no per-account data and
 * naming a coordinate pair is not something to authorize people against. The
 * CORS allow-list and the rate limiter keep the surface honest.
 */
locationRouter.get(
  '/reverse',
  locationRateLimiter,
  validateQuery(reverseGeocodeQuerySchema),
  async (req, res, next) => {
    try {
      const { lat, lon } = req.query as unknown as { lat: number; lon: number };
      res.json(await reverseGeocode(lat, lon));
    } catch (error) {
      next(error);
    }
  },
);