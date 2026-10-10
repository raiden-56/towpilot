import express, { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery, rupeesToPaise } from '../../lib/http.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { principal, requireAuth } from '../../middleware/auth.js';
import { publicLimiter } from '../../middleware/rateLimit.js';
import { nextDocumentNumber } from '../../lib/numbering.js';
import { razorpayGateway, sandboxGateway } from '../../integrations/payments.js';
import { checkoutCallback, createPaymentOrder, invoiceForViewer, processWebhook, renderInvoicePdf, requestRefund, setInvoiceDispute, simulateSandboxPayment } from './service.js';
import { diffAgainstApproved, type PriceBreakdown } from '../../domain/pricing.js';
import { withTx } from '../../lib/tx.js';

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

invoicesRouter.get('/', async (req, res) => {
  const p = principal(req);
  const q = parseQuery(paginationSchema.extend({ status: z.string().optional() }), req);
  const where = { customerUserId: p.userId, ...(q.status ? { paymentStatus: { in: q.status.split(',') as never } } : {}) };
  const [items, total] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: { issuedAt: 'desc' }, ...pageArgs(q), include: { booking: { select: { code: true } } }, omit: { pricingSnapshot: true } }),
    prisma.invoice.count({ where }),
  ]);
  ok(res, items, pageMeta(q, total));
});

invoicesRouter.get('/:id', async (req, res) => {
  const inv0 = await invoiceForViewer(principal(req), idParam(req));
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: inv0.id },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      payments: { orderBy: { createdAt: 'desc' }, select: { id: true, method: true, provider: true, status: true, amount: true, providerPaymentId: true, receiptNumber: true, isSandbox: true, failureReason: true, createdAt: true, succeededAt: true } },
      refunds: { orderBy: { createdAt: 'desc' } },
      creditNotes: true,
      booking: { select: { id: true, code: true, serviceCategory: { select: { name: true } }, vehicle: { select: { registrationNumber: true } } } },
      tickets: { select: { id: true, number: true, status: true, category: true } },
    },
  });
  // Transparent price-difference view (approved quote vs final invoice).
  let priceDifference = null;
  if (inv.approvedQuoteId) {
    const q = await prisma.bookingQuote.findUnique({ where: { id: inv.approvedQuoteId } });
    const approved = (q?.pricingSnapshot as { breakdown?: PriceBreakdown } | null)?.breakdown;
    const final = (inv.pricingSnapshot as { breakdown?: PriceBreakdown } | null)?.breakdown;
    if (approved && final) priceDifference = { approvedTotal: q!.total, finalTotal: inv.total, ...diffAgainstApproved(approved, final) };
  }
  ok(res, { ...inv, pricingSnapshot: undefined, priceDifference });
});

invoicesRouter.get('/:id/pdf', async (req, res) => {
  const inv = await invoiceForViewer(principal(req), idParam(req));
  const pdf = await renderInvoicePdf(inv.id);
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${inv.number.replace(/\//g, '-')}.pdf"`);
  res.send(pdf);
});

invoicesRouter.post('/:id/pay', async (req, res) => {
  const body = parseBody(z.object({ amount: rupeesToPaise.optional() }), req);
  const key = req.header('idempotency-key');
  if (!key || key.length < 8) throw badRequest('Idempotency-Key header is required');
  created(res, await createPaymentOrder(principal(req), idParam(req), { amount: body.amount, idempotencyKey: key }));
});

invoicesRouter.post('/:id/refund-request', async (req, res) => {
  const p = principal(req);
  const inv = await invoiceForViewer(p, idParam(req));
  const body = parseBody(z.object({ amount: rupeesToPaise, reason: z.string().trim().min(10).max(1000) }), req);
  const refund = await requestRefund(p, inv.id, body);
  const ticket = await prisma.supportTicket.create({
    data: { number: await nextDocumentNumber(prisma, 'TKT'), userId: p.userId, category: 'REFUND_REQUEST', subject: `Refund request for ${inv.number}`, invoiceId: inv.id, bookingId: inv.bookingId, messages: { create: { authorId: p.userId, body: `${body.reason}\n\nRequested amount: ₹${(body.amount / 100).toFixed(2)} (refund ${refund.id})` } } },
  });
  created(res, { refund, ticket });
});

invoicesRouter.post('/:id/dispute', async (req, res) => {
  const p = principal(req);
  const inv = await invoiceForViewer(p, idParam(req));
  if (inv.disputed) throw conflict('A dispute is already open for this invoice');
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(10).max(2000) }), req);
  const ticket = await withTx(async (tx) => {
    await setInvoiceDispute(tx, inv.id, true);
    return tx.supportTicket.create({
      data: { number: await nextDocumentNumber(tx, 'TKT'), userId: p.userId, category: 'BILLING_DISPUTE', priority: 'HIGH', subject: `Billing dispute: ${inv.number}`, invoiceId: inv.id, bookingId: inv.bookingId, messages: { create: { authorId: p.userId, body: reason } } },
    });
  });
  created(res, ticket);
});

// ─── Payments ────────────────────────────────────────────────────────

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.get('/history', async (req, res) => {
  const p = principal(req);
  const q = parseQuery(paginationSchema, req);
  const where = { invoice: { customerUserId: p.userId } };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), select: { id: true, method: true, status: true, amount: true, receiptNumber: true, isSandbox: true, createdAt: true, succeededAt: true, failureReason: true, invoice: { select: { id: true, number: true } } } }),
    prisma.payment.count({ where }),
  ]);
  ok(res, items, pageMeta(q, total));
});

paymentsRouter.get('/:id', async (req, res) => {
  const pay = await prisma.payment.findUnique({ where: { id: idParam(req) } });
  if (!pay) throw notFound('Payment');
  await invoiceForViewer(principal(req), pay.invoiceId);
  ok(res, { id: pay.id, status: pay.status, amount: pay.amount, method: pay.method, receiptNumber: pay.receiptNumber, failureReason: pay.failureReason, isSandbox: pay.isSandbox });
});

paymentsRouter.post('/:id/checkout-callback', async (req, res) => {
  const body = parseBody(z.object({ orderId: z.string(), providerPaymentId: z.string(), signature: z.string() }), req);
  ok(res, await checkoutCallback(principal(req), idParam(req), body));
});

/** SANDBOX ONLY — simulates the gateway outcome via a signed webhook. Disabled with a real gateway. */
paymentsRouter.post('/:id/sandbox-complete', async (req, res) => {
  const { outcome } = parseBody(z.object({ outcome: z.enum(['success', 'failure']) }), req);
  const pay = await simulateSandboxPayment(principal(req), idParam(req), outcome);
  ok(res, { id: pay.id, status: pay.status, amount: pay.amount, receiptNumber: pay.receiptNumber, failureReason: pay.failureReason, isSandbox: pay.isSandbox });
});

// ─── Webhooks (raw body for signature verification) ──────────────────

export const webhooksRouter = Router();
webhooksRouter.use(publicLimiter);

webhooksRouter.post('/razorpay', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  if (!razorpayGateway) return res.status(404).json({ error: { code: 'NOT_CONFIGURED', message: 'Razorpay is not configured' } });
  const r = await processWebhook(razorpayGateway, req.body as Buffer, req.headers);
  if (r.status === 'invalid_signature') return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
  ok(res, r);
});

webhooksRouter.post('/sandbox', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const r = await processWebhook(sandboxGateway, req.body as Buffer, req.headers);
  if (r.status === 'invalid_signature') return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
  ok(res, r);
});
