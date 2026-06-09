import { buildGatewayApp } from './app.js';
import { logger } from '../../common/logger/index.js';

const PORT = parseInt(process.env.GATEWAY_PORT ?? '3001', 10);
const HOST = process.env.GATEWAY_HOST ?? '0.0.0.0';

async function main() {
  try {
    const app = buildGatewayApp();
    await app.listen({ port: PORT, host: HOST });
    logger.info({ port: PORT, host: HOST }, 'Gateway simulator started');

    process.on('SIGTERM', async () => {
      await app.close();
      process.exit(0);
    });
    process.on('SIGINT', async () => {
      await app.close();
      process.exit(0);
    });
  } catch (err) {
    logger.error({ err }, 'Failed to start gateway simulator');
    process.exit(1);
  }
}

main();
