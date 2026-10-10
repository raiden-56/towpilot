import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, parseBody } from '../../lib/http.js';
import { conflict, notFound } from '../../lib/errors.js';
import { withTx } from '../../lib/tx.js';
import { principal, requireAuth, requirePermission } from '../../middleware/auth.js';
import { createMembershipInvoice } from '../billing/service.js';

export const membershipsRouter = Router();

membershipsRouter.get('/plans', async (_req, res) => {
  ok(res, await prisma.membership.findMany({ where: { active: true, forFleet: false }, orderBy: { price: 'asc' } }));
});

membershipsRouter.use(requireAuth, requirePermission('customer:self'));

membershipsRouter.get('/mine', async (req, res) => {
  const p = principal(req);
  ok(
    res,
    await prisma.membershipSubscription.findMany({
      where: { userId: p.userId },
      orderBy: { createdAt: 'desc' },
      include: { membership: true, invoice: { select: { id: true, number: true, total: true, outstanding: true, paymentStatus: true } }, usages: { include: { booking: { select: { code: true } } } } },
    }),
  );
});

/** Subscribing creates a pending subscription and a membership invoice. It activates only once paid. */
membershipsRouter.post('/subscribe', async (req, res) => {
  const p = principal(req);
  const { membershipId } = parseBody(z.object({ membershipId: z.string() }), req);
  const plan = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!plan || !plan.active || plan.forFleet) throw notFound('Plan');
  const active = await prisma.membershipSubscription.findFirst({ where: { userId: p.userId, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } });
  if (active) throw conflict(active.status === 'ACTIVE' ? 'You already have an active membership' : 'You have a membership awaiting payment', { subscriptionId: active.id });
  const result = await withTx(async (tx) => {
    const sub = await tx.membershipSubscription.create({
      data: {
        membershipId: plan.id,
        userId: p.userId,
        status: 'PENDING_PAYMENT',
        planSnapshot: { name: plan.name, price: plan.price, durationMonths: plan.durationMonths, includedServices: plan.includedServices, includedKmPerService: plan.includedKmPerService, discountBps: plan.discountBps, coveredCategoryKeys: plan.coveredCategoryKeys, exclusions: plan.exclusions, renewalTerms: plan.renewalTerms },
      },
    });
    const invoice = await createMembershipInvoice(tx, sub, plan);
    return { subscription: sub, invoice };
  });
  created(res, result);
});

membershipsRouter.post('/:id/cancel', async (req, res) => {
  const p = principal(req);
  const sub = await prisma.membershipSubscription.findFirst({ where: { id: idParam(req), userId: p.userId } });
  if (!sub) throw notFound('Membership');
  if (sub.status === 'PENDING_PAYMENT') {
    await withTx(async (tx) => {
      await tx.membershipSubscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
      const inv = await tx.invoice.findUnique({ where: { subscriptionId: sub.id } });
      if (inv && inv.amountPaid === 0) await tx.invoice.update({ where: { id: inv.id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: 'Membership cancelled before payment', outstanding: 0 } });
    });
  } else if (sub.status === 'ACTIVE') {
    // Active memberships run to the end of the paid term (no auto-renewal); cancellation stops future renewals only.
    await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { cancelledAt: new Date() } });
  } else throw conflict('Membership is not active');
  ok(res, { cancelled: true });
});
