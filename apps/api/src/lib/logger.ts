import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.otp',
      '*.code',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.pickupOtp',
      '*.handoverOtp',
    ],
    censor: '[redacted]',
  },
  transport: !env.isProd && !env.isTest ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } : undefined,
});

/**
 * Error-reporting boundary. When ERROR_REPORTING_DSN is configured, plug a provider
 * (Sentry, Datadog, etc.) in here. Until then errors are only logged.
 */
export function reportError(err: unknown, context?: Record<string, unknown>) {
  if (process.env.DEBUG_ERRORS === 'true') console.error(err);
  logger.error({ err, ...context }, 'unhandled error');
}
