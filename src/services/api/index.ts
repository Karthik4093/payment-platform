import { buildApp } from './app.js';
import { connectDB } from '../../common/db/prisma.js';
import { getRedisClient } from '../../common/redis/client.js';
import { connectRabbitMQ } from '../../common/queue/rabbitmq.js';
import { logger } from '../../common/logger/index.js';

const PORT = parseInt(process.env.API_PORT ?? '3000', 10);
const HOST = process.env.API_HOST ?? '0.0.0.0';

async function main() {
  try {
    // Connect to all infrastructure
    await connectDB();
    getRedisClient(); // Initialize Redis connection
    await connectRabbitMQ();

    const app = buildApp();
    await app.listen({ port: PORT, host: HOST });

    logger.info({ port: PORT, host: HOST }, 'API service started');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down API service...');
      await app.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error({ err }, 'Failed to start API service');
    process.exit(1);
  }
}

main();
