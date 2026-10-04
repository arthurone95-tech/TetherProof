import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { authRateLimiter } from '../../middleware/rate-limit.js';
import { validateBody } from '../../middleware/validate.js';
import { getProfile, login, register } from './service.js';
import { loginSchema, registerSchema } from './schemas.js';

export const authRouter = Router();

/**
 * Credentials live in Supabase Auth. This router creates accounts and signs
 * sessions in on the server so the service-role key is never exposed to the
 * browser, and so role claims are always written server-side.
 */

authRouter.post('/register', authRateLimiter, validateBody(registerSchema), async (req, res, next) => {
  try {
    const result = await register(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', authRateLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await login(req.body);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const profile = await getProfile(req.auth!.userId);
    res.status(200).json(profile);
  } catch (error) {
    next(error);
  }
});
