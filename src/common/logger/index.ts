import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
  base: {
    service: process.env.SERVICE_NAME ?? 'payment-platform',
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  redact: {
    paths: ['*.apiKey', '*.password', '*.secret', '*.authorization'],
    censor: '[REDACTED]',
  },
});

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

export type Logger = typeof logger;
