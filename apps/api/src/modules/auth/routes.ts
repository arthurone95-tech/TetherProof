import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { authRateLimiter, codeVerificationRateLimiter, confirmationRateLimiter } from '../../middleware/rate-limit.js';
import { validateBody } from '../../middleware/validate.js';
import { confirm, getProfile, login, register, requestConfirmation } from './service.js';
import { confirmRequestSchema, confirmSchema, loginSchema, registerSchema } from './schemas.js';

export const authRouter = Router();

/**
 * Credentials live in Supabase Auth. This router creates accounts and signs
 * sessions in on the server so the service-role key is never exposed to the
 * browser, and so role claims are always written server-side.
 *
 * A new account is unconfirmed until it proves ownership of its phone number or
 * email address with a one-time code, so no administrator has to confirm members
 * by hand.
 */

authRouter.post('/register', authRateLimiter, validateBody(registerSchema), async (req, res, next) => {
  try {
    const result = await register(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Sends or re-sends a one-time sign-in code.
 *
 * Answers `202` whether or not the account exists, so the endpoint cannot be
 * used to discover which phone numbers or addresses are registered.
 */
authRouter.post(
  '/confirm/request',
  confirmationRateLimiter,
  validateBody(confirmRequestSchema),
  async (req, res, next) => {
    try {
      const challenge = await requestConfirmation(req.body);
      res.status(202).json(challenge);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Exchanges a one-time code for a session and confirms the account.
 *
 * Accepts either form of credential Supabase issues: a short numeric code, or
 * the token from a magic-link email.
 */
authRouter.post('/confirm', codeVerificationRateLimiter, validateBody(confirmSchema), async (req, res, next) => {
  try {
    const result = await confirm(req.body);
    res.status(200).json(result);
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
