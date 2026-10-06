import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabase } from './db/client.js';
import { getMessageProvider } from './lib/messaging/index.js';

// Resolved before the socket opens, so a deployment that asked for Twilio and
// did not supply credentials refuses to start instead of answering `/health`
// with `ok` and quietly never sending a link (`doc/09` §4.1). Constructing the
// provider performs no I/O — it stores configuration and validates that it is
// present — so this costs nothing at boot and buys a failure at the one moment
// a bad configuration can still be blamed on the deployment.
getMessageProvider();

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
