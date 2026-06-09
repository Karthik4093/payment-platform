import { buildApp } from './app.js';
import { connectDB } from '../../common/db/prisma.js';
import { getRedisClient } from '../../common/redis/client.js';
import { connectRabbitMQ } from '../../common/queue/rabbitmq.js';
import { logger } from '../../common/logger/index.js';

const PORT = parseInt(process.env.API_PORT ?? '3000', 10);
const HOST = process.env.API_HOST ?? '0.0.0.0';

async function main() {
  // PostgreSQL is mandatory — fail fast if unavailable
  await connectDB();

  // Redis: initialize client (reconnects automatically in background)
  getRedisClient();

  // RabbitMQ: attempt connection but don't crash on failure at startup;
  // the worker retry loop handles reconnects, and the API can still serve
  // read-only requests while MQ reconnects.
  connectRabbitMQ().catch((err) => {
    logger.error({ err }, 'RabbitMQ initial connection failed — will retry in background');
  });

  const app = buildApp();
  await app.listen({ port: PORT, host: HOST });

  logger.info({ port: PORT, host: HOST }, 'API service started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down API service...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
