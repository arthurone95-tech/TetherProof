import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { AppError } from '../lib/errors.js';

function formatIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** Parses and replaces `req.body`, rejecting anything the schema disallows. */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(AppError.badRequest('Request body failed validation.', formatIssues(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Parses `req.params`, rejecting malformed identifiers such as bad UUIDs. */
export function validateParams<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(AppError.badRequest('Request parameters failed validation.', formatIssues(result.error)));
      return;
    }
    req.params = result.data as typeof req.params;
    next();
  };
}

/** Parses `req.query`, rejecting unexpected or malformed filter values. */
export function validateQuery<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(AppError.badRequest('Query parameters failed validation.', formatIssues(result.error)));
      return;
    }
    req.query = result.data as typeof req.query;
    next();
  };
}

/**
 * Reads a route parameter that a `validateParams` middleware has already
 * checked, narrowing away the `undefined` that `noUncheckedIndexedAccess`
 * introduces on `req.params`.
 */
export function readParam(req: Request, key: string): string {
  const value = req.params[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw AppError.badRequest(`Missing request parameter: ${key}.`);
  }
  return value;
}

