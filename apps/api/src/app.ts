import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { globalRateLimiter, rateLimitConfig } from './middleware/rate-limit.js';
import { isLocalAddress } from './lib/origin.js';
import { apiRouter } from './routes.js';

/**
 * Which browser origins may read an API response.
 *
 * `CORS_ORIGINS` is the whole answer in production: a deployment names the site
 * that may call it, and every other origin is refused without being guessed at.
 *
 * Outside production that list is not enough on its own, because a development
 * server takes whichever port is free. `next dev` fell from 3000 to 3001 here
 * the day another project claimed 3000, so an allow-list written down once
 * stopped matching the address the page is actually served from. The casualty
 * was not cosmetic: the public verification page is the one screen that calls
 * the API from the browser, and its verifier was told *"this request could not
 * be opened"* instead of being shown the work they were asked to confirm. This
 * is the same failure E-031 fixed for confirmation links, where it had already
 * cost the same port drift — hence the same rule and the same helper
 * (`lib/origin.ts`), so there is one definition of "this machine or this
 * network" rather than two that can drift apart again.
 *
 * A request with no `Origin` at all — curl, the smoke suite, anything
 * server-to-server — is not a browser reading a response across origins. It is
 * left exactly as it was.
 */
function browserOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
): void {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (env.corsOrigins.includes(origin)) {
    callback(null, true);
    return;
  }

  if (!env.isProduction) {
    try {
      if (isLocalAddress(new URL(origin).hostname)) {
        callback(null, true);
        return;
      }
    } catch {
      // A malformed Origin — the literal `null` a sandboxed frame sends, say —
      // names no machine, so it falls through to the refusal below.
    }
  }

  callback(null, false);
}

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', rateLimitConfig.trustProxy ? 1 : false);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: browserOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(globalRateLimiter);

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
