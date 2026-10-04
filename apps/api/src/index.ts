import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabase } from './db/client.js';

const app = createApp();
const server = createServer(app);

server.listen(env.API_PORT, env.API_HOST, () => {
  logger.info('API server listening', {
    product: env.PRODUCT_NAME,
    url: `http://${env.API_HOST}:${env.API_PORT}`,
    environment: env.NODE_ENV,
  });
});

async function shutdown(signal: string): Promise<void> {
  logger.info('Shutting down', { signal });

  const forcedExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  server.close(async () => {
    await closeDatabase();
    clearTimeout(forcedExit);
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
