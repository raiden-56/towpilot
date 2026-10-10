import http from 'node:http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { createApp } from './app.js';
import { closeRealtime, initRealtime } from './realtime/socket.js';
import { startWorker, stopWorker } from './jobs/queue.js';
import { registerSchedules } from './jobs/schedule.js';
import { gateway } from './integrations/payments.js';
import { syncCatalogue, syncRoles } from './lib/reference.js';

// Roles/permissions and the base service catalogue are code-defined; sync them idempotently at boot.
await syncRoles(prisma);
await syncCatalogue(prisma);

const app = createApp();
const server = http.createServer(app);
initRealtime(server);

if (env.RUN_WORKER) {
  startWorker();
  registerSchedules();
}

server.listen(env.PORT, () => {
  logger.info(`TowPilot API listening on http://localhost:${env.PORT} (docs at /api/docs)`);
  const sandboxes = [
    env.SMS_PROVIDER === 'sandbox' && 'SMS',
    env.EMAIL_PROVIDER === 'sandbox' && 'email',
    gateway.isSandbox && 'payments',
    env.MAPS_PROVIDER === 'sandbox' && 'maps',
    env.STORAGE_PROVIDER === 'local' && 'storage (local disk)',
  ].filter(Boolean);
  if (sandboxes.length) logger.warn(`Sandbox integrations active: ${sandboxes.join(', ')}. Nothing is sent to real providers for these.`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  stopWorker();
  await closeRealtime();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
