import type { HealthResponse } from '@tetherproof/shared';
import { Router } from 'express';
import { env } from '../../config/env.js';
import { checkDatabaseConnection } from '../../db/client.js';

export const healthRouter = Router();

/**
 * Liveness and dependency probe.
 *
 * Returns 200 when every dependency answers, 503 when the database is
 * unreachable, so a platform can drain the instance automatically.
 */
healthRouter.get('/health', async (_req, res) => {
  const databaseUp = await checkDatabaseConnection();
  const body: HealthResponse = {
    status: databaseUp ? 'ok' : 'degraded',
    product: env.PRODUCT_NAME,
    database: databaseUp ? 'up' : 'down',
    timestamp: new Date().toISOString(),
  };
  res.status(databaseUp ? 200 : 503).json(body);
});
