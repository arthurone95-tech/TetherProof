/**
 * Accepts a single proof media file from a multipart submission.
 *
 * Memory storage is used deliberately. The file has to be re-encoded to strip
 * its metadata before anything is written, which cannot be done as a stream, and
 * the size is capped by the parser itself so an oversized body is refused while
 * it is still arriving rather than after it has been buffered.
 *
 * Only one file field is named, so a caller cannot smuggle additional files past
 * the allow-list under another field name; anything unexpected is simply ignored
 * and never reaches storage.
 */
import multer from 'multer';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

/** The shape the scrubber and the storage layer accept. */
export interface UploadedMedia {
  buffer: Buffer;
  contentType: string;
  size: number;
}

/** Single-file parser for the `media_file` field. Sets `req.file`. */
export const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.STORAGE_MAX_UPLOAD_BYTES,
    files: 1,
    // Fields are few and short; an unbounded count is a memory-exhaustion route.
    fields: 12,
    parts: 16,
  },
}).single('media_file');

/**
 * Single-file parser for the `avatar_file` field on the profile-image route.
 *
 * Profile images are small, so their own size cap is applied here, before a byte
 * is buffered, exactly as the proof upload applies its own.
 */
export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.STORAGE_MAX_AVATAR_BYTES,
    files: 1,
    fields: 4,
    parts: 8,
  },
}).single('avatar_file');

/**
 * Adapts multer's callback middleware to Express error propagation.
 *
 * Multer signals its own failures, such as a body over the size cap, through a
 * callback rather than by throwing. Without this wrapper those failures would be
 * swallowed and the request would hang until the client timed out, so they are
 * translated into the project's error envelope here.
 */
function acceptUpload(
  parse: RequestHandler,
  sizeMessage: string,
): (req: unknown, res: unknown, next: (error?: unknown) => void) => void {
  return (req, res, next) => {
    parse(req as never, res as never, (error: unknown) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          next(AppError.badRequest(sizeMessage));
          return;
        }

        next(AppError.badRequest('The upload could not be read. Please try again.'));
        return;
      }

      next(error);
    });
  };
}

export const acceptProofMedia = acceptUpload(
  proofUpload,
  `Files must be smaller than ${Math.floor(env.STORAGE_MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
);

export const acceptAvatarMedia = acceptUpload(
  avatarUpload,
  `Profile images must be smaller than ${Math.floor(env.STORAGE_MAX_AVATAR_BYTES / (1024 * 1024))} MB.`,
);