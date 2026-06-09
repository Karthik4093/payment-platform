import { connectDB } from '../../common/db/prisma.js';
import { getRedisClient } from '../../common/redis/client.js';
import { connectRabbitMQ, consume, QUEUES } from '../../common/queue/rabbitmq.js';
import { logger } from '../../common/logger/index.js';
import { handlePaymentMessage } from '../../workers/payment.worker.js';
import { handleRefundMessage } from '../../workers/refund.worker.js';

async function main() {
  try {
    logger.info('Starting worker service...');

    await connectDB();
    getRedisClient();
    await connectRabbitMQ();

    // Register consumers
    await consume(QUEUES.PAYMENT_PROCESS, handlePaymentMessage);
    await consume(QUEUES.REFUND_PROCESS, handleRefundMessage);

    logger.info('Worker service started — consuming from payment.process and refund.process');

    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down worker service...');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error({ err }, 'Failed to start worker service');
    process.exit(1);
  }
}

main();
