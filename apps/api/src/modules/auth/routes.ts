import { Router } from 'express';
import { AppError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/auth.js';
import {
  authRateLimiter,
  codeVerificationRateLimiter,
  confirmationRateLimiter,
  mediaUploadRateLimiter,
} from '../../middleware/rate-limit.js';
import { acceptAvatarMedia } from '../../middleware/upload.js';
import { validateBody } from '../../middleware/validate.js';
import {
  confirm,
  deleteAccount,
  getProfile,
  login,
  register,
  removeAvatar,
  requestConfirmation,
  updateAvatar,
  updateProfile,
} from './service.js';
import {
  confirmRequestSchema,
  confirmSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from './schemas.js';

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

/**
 * Updates the caller's own profile.
 *
 * Any authenticated role may call it, because the fields belong to different roles
 * for different reasons: a worker's location lets an employer measure distance,
 * and an employer's organization name is what a worker reads before deciding
 * whether to accept an invitation. The route cannot be narrowed to one role, so
 * it is mounted on the account router rather than on either role's router.
 *
 * Scoped to the caller's own row, so there is nothing to authorize beyond having a
 * session.
 */
authRouter.patch('/profile', authenticate, validateBody(updateProfileSchema), async (req, res, next) => {
  try {
    const updated = await updateProfile(req.auth!.userId, req.body);
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * Uploads or replaces the caller's profile image.
 *
 * A multipart body carrying a single `avatar_file` field. The image is scrubbed
 * of location metadata and stored as a random-UUID object only this endpoint may
 * write — the profile update schema deliberately accepts no `avatarUrl`, so a
 * caller-supplied URL can never be rendered.
 *
 * Rate-limited like proof media, because re-encoding an image is the same
 * class of work.
 */
authRouter.post(
  '/avatar',
  authenticate,
  mediaUploadRateLimiter,
  acceptAvatarMedia,
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        throw AppError.badRequest('Choose a photo to upload.');
      }
      const result = await updateAvatar(req.auth!.userId, {
        buffer: file.buffer,
        contentType: file.mimetype,
        size: file.size,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Removes the caller's profile image.
 *
 * Idempotent — an account with no photo still answers success, with `null`,
 * exactly as account deletion does for media that is already gone.
 */
authRouter.delete('/avatar', authenticate, async (req, res, next) => {
  try {
    res.status(200).json(await removeAvatar(req.auth!.userId));
  } catch (error) {
    next(error);
  }
});

/**
 * Deletes the caller's own account.
 *
 * `DELETE` rather than a `POST` to some action path, because the effect is the
 * account's non-existence and a verb that describes it makes the semantics
 * legible to anyone reading a log.
 *
 * Scoped to `req.auth.userId` and to no id in the body. A deletion endpoint that
 * accepts a target would be an account-takeover primitive the moment one
 * identifier were guessed, and there is no self-service variant that needs one.
 *
 * Open to any authenticated role: a worker, an employer, and an administrator all
 * hold records worth releasing.
 *
 * The response reports what was actually removed rather than a bare success, so a
 * caller is never told the account and its media are gone when only the account
 * is. `201` is not used: the account existed and now does not, which is not the
 * creation of a resource.
 */
authRouter.delete('/account', authenticate, async (req, res, next) => {
  try {
    const result = await deleteAccount(req.auth!.userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});
