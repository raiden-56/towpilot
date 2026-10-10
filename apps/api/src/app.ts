import express, { Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { requireAuth } from './middleware/auth.js';
import { authRouter } from './modules/auth/routes.js';
import { profileRouter } from './modules/profile/routes.js';
import { vehiclesRouter } from './modules/vehicles/routes.js';
import { catalogRouter, locationsRouter } from './modules/catalog/routes.js';
import { bookingsRouter } from './modules/bookings/routes.js';
import { fieldRouter } from './modules/field/routes.js';
import { dispatchRouter } from './modules/dispatch/routes.js';
import { invoicesRouter, paymentsRouter, webhooksRouter } from './modules/billing/routes.js';
import { membershipsRouter } from './modules/memberships/routes.js';
import { supportRouter } from './modules/support/routes.js';
import { publicRouter } from './modules/public/routes.js';
import { employeesRouter } from './modules/admin/employees.js';
import { customersRouter, fleetAccountsRouter } from './modules/admin/customers.js';
import { fleetRouter } from './modules/admin/fleet.js';
import { pricingRouter } from './modules/admin/pricing.js';
import { financeRouter } from './modules/admin/finance.js';
import { reportsRouter } from './modules/admin/reports.js';
import { systemRouter } from './modules/admin/system.js';
import { buildOpenApi } from './openapi.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
    }),
  );
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));

  // Health endpoints (no auth, no rate limit).
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
  app.get('/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready', db: 'ok' });
    } catch {
      res.status(503).json({ status: 'not_ready', db: 'unreachable' });
    }
  });

  const v1 = Router();
  // Webhooks need the raw body for signature verification, so they are mounted before JSON parsing.
  v1.use('/webhooks/payments', webhooksRouter);
  v1.use(express.json({ limit: '1mb' }));
  v1.use(cookieParser());
  v1.use(apiLimiter);

  v1.use('/auth', authRouter);
  v1.use('/public', publicRouter);
  v1.use('/catalog', catalogRouter);
  v1.use('/locations', locationsRouter);
  v1.use('/me', profileRouter);
  v1.use('/vehicles', vehiclesRouter);
  v1.use('/bookings', bookingsRouter);
  v1.use('/invoices', invoicesRouter);
  v1.use('/payments', paymentsRouter);
  v1.use('/memberships', membershipsRouter);
  v1.use('/support', supportRouter);
  v1.use('/driver', fieldRouter);
  v1.use('/dispatch', dispatchRouter);

  const admin = Router();
  admin.use(requireAuth);
  admin.use('/employees', employeesRouter);
  admin.use('/customers', customersRouter);
  admin.use('/fleet-accounts', fleetAccountsRouter);
  admin.use('/fleet', fleetRouter);
  admin.use('/pricing', pricingRouter);
  admin.use('/finance', financeRouter);
  admin.use('/reports', reportsRouter);
  admin.use('/system', systemRouter);
  v1.use('/admin', admin);

  const spec = buildOpenApi([
    ['/auth', authRouter],
    ['/public', publicRouter],
    ['/catalog', catalogRouter],
    ['/locations', locationsRouter],
    ['/me', profileRouter],
    ['/vehicles', vehiclesRouter],
    ['/bookings', bookingsRouter],
    ['/invoices', invoicesRouter],
    ['/payments', paymentsRouter],
    ['/webhooks/payments', webhooksRouter],
    ['/memberships', membershipsRouter],
    ['/support', supportRouter],
    ['/driver', fieldRouter],
    ['/dispatch', dispatchRouter],
    ['/admin/employees', employeesRouter],
    ['/admin/customers', customersRouter],
    ['/admin/fleet-accounts', fleetAccountsRouter],
    ['/admin/fleet', fleetRouter],
    ['/admin/pricing', pricingRouter],
    ['/admin/finance', financeRouter],
    ['/admin/reports', reportsRouter],
    ['/admin/system', systemRouter],
  ]);
  v1.get('/openapi.json', (_req, res) => res.json(spec));
  app.use('/api/v1', v1);
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'TowPilot API' }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
