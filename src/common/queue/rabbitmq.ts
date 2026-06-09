import amqplib from 'amqplib';
import type { Channel, ConsumeMessage } from 'amqplib';
import { logger } from '../logger/index.js';
import { QUEUES, EXCHANGES, DELAY_QUEUES } from './types.js';

// Re-export for consumers so they only import from one place
export { QUEUES, EXCHANGES, DELAY_QUEUES } from './types.js';

// Use the actual return type of amqplib.connect to avoid version mismatch
type AmqpConnection = Awaited<ReturnType<typeof amqplib.connect>>;

let connection: AmqpConnection | null = null;
let channel: Channel | null = null;
let isConnecting = false;

const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];

export async function connectRabbitMQ(): Promise<void> {
  if (isConnecting) return;
  isConnecting = true;

  const url = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
  let attempts = 0;

  while (attempts < 10) {
    try {
      connection = await amqplib.connect(url);

      connection.on('error', (err: Error) => {
        logger.error({ err }, 'RabbitMQ connection error');
      });
      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed, reconnecting...');
        connection = null;
        channel = null;
        setTimeout(() => {
          isConnecting = false;
          connectRabbitMQ();
        }, 2000);
      });

      channel = await connection.createChannel();
      const prefetch = parseInt(process.env.RABBITMQ_PREFETCH ?? '10', 10);
      await channel.prefetch(prefetch);

      await setupTopology(channel);
      logger.info('RabbitMQ connected and topology configured');
      isConnecting = false;
      return;
    } catch (err) {
      attempts++;
      const delay = Math.min(attempts * 1000, 10000);
      logger.warn({ err, attempts, delay }, 'RabbitMQ connect failed, retrying...');
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  isConnecting = false;
  throw new Error('Failed to connect to RabbitMQ after 10 attempts');
}

async function setupTopology(ch: Channel): Promise<void> {
  // Dead-letter exchange
  await ch.assertExchange(EXCHANGES.PAYMENTS_DLX, 'direct', { durable: true });

  // Main exchange
  await ch.assertExchange(EXCHANGES.PAYMENTS, 'direct', { durable: true });

  // Dead-letter queue
  await ch.assertQueue(QUEUES.PAYMENT_DEADLETTER, {
    durable: true,
    arguments: { 'x-queue-type': 'classic' },
  });
  await ch.bindQueue(QUEUES.PAYMENT_DEADLETTER, EXCHANGES.PAYMENTS_DLX, QUEUES.PAYMENT_DEADLETTER);

  // Main payment process queue (with DLX pointing to dead-letter queue)
  await ch.assertQueue(QUEUES.PAYMENT_PROCESS, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': EXCHANGES.PAYMENTS_DLX,
      'x-dead-letter-routing-key': QUEUES.PAYMENT_DEADLETTER,
    },
  });
  await ch.bindQueue(QUEUES.PAYMENT_PROCESS, EXCHANGES.PAYMENTS, QUEUES.PAYMENT_PROCESS);

  // Delay queues (for exponential backoff retries)
  for (const [ttlMs, queueName] of Object.entries(DELAY_QUEUES)) {
    await ch.assertQueue(queueName, {
      durable: true,
      arguments: {
        'x-message-ttl': parseInt(ttlMs, 10),
        'x-dead-letter-exchange': EXCHANGES.PAYMENTS,
        'x-dead-letter-routing-key': QUEUES.PAYMENT_PROCESS,
      },
    });
  }

  // Refund queue
  await ch.assertQueue(QUEUES.REFUND_PROCESS, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': EXCHANGES.PAYMENTS_DLX,
      'x-dead-letter-routing-key': QUEUES.PAYMENT_DEADLETTER,
    },
  });
  await ch.bindQueue(QUEUES.REFUND_PROCESS, EXCHANGES.PAYMENTS, QUEUES.REFUND_PROCESS);
}

export function getChannel(): Channel {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized. Call connectRabbitMQ() first.');
  }
  return channel;
}

export async function publishToQueue(
  queue: string,
  payload: unknown,
  options: amqplib.Options.Publish = {},
): Promise<boolean> {
  const ch = getChannel();
  const content = Buffer.from(JSON.stringify(payload));
  return ch.sendToQueue(queue, content, {
    persistent: true,
    contentType: 'application/json',
    ...options,
  });
}

export async function publishToDelayQueue(
  payload: unknown,
  retryCount: number,
): Promise<boolean> {
  const delayMs = RETRY_DELAYS[retryCount] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
  const delayQueue = DELAY_QUEUES[delayMs] ?? DELAY_QUEUES[16000];
  return publishToQueue(delayQueue, payload);
}

export async function consume(
  queue: string,
  handler: (msg: ConsumeMessage, channel: Channel) => Promise<void>,
): Promise<void> {
  const ch = getChannel();

  await ch.consume(queue, async (msg: ConsumeMessage | null) => {
    if (!msg) return;
    try {
      await handler(msg, ch);
    } catch (err) {
      logger.error({ err, queue }, 'Unhandled error in message handler');
      ch.nack(msg, false, false);
    }
  });

  logger.info({ queue }, 'Consumer registered');
}

export async function disconnectRabbitMQ(): Promise<void> {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
    logger.info('RabbitMQ disconnected');
  } catch (err) {
    logger.error({ err }, 'Error disconnecting RabbitMQ');
  }
}

export async function checkRabbitMQHealth(): Promise<boolean> {
  try {
    return connection !== null && channel !== null;
  } catch {
    return false;
  }
}
