import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@tetherproof/shared';
import { ERROR_CODES } from '@tetherproof/shared';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`No route matches ${req.method} ${req.path}.`));
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response<ApiErrorBody>,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Request failed validation.',
        status: 400,
      },
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error('Request failed', { code: error.code, message: error.message });
    }
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.expose ? error.message : 'An unexpected error occurred. Please try again.',
        status: error.status,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  logger.error('Unhandled error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    environment: env.NODE_ENV,
  });

  res.status(500).json({
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred. Please try again.',
      status: 500,
    },
  });
}
