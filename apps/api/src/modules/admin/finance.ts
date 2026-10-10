import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery, rupeesToPaise, queryBool } from '../../lib/http.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { nextDocumentNumber } from '../../lib/numbering.js';
import { withTx } from '../../lib/tx.js';
import { principal, requirePermission } from '../../middleware/auth.js';
import { storeUploads, uploadMiddleware } from '../../lib/upload.js';
import { signedFileUrl } from '../../integrations/storage.js';
import { decideCash, decideRefund, issueCreditNote, recomputeInvoice, recordBankTransfer, retryRefund, setInvoiceDispute, writeOff } from '../billing/service.js';
import { ageingBucket } from '../../domain/finance.js';
import { notify } from '../notifications/service.js';
import { toCsv, paiseToRupees } from './csv.js';

export const financeRouter = Router();

// ─── Invoices ────────────────────────────────────────────────────────

const invoiceFilters = z.object({ q: z.string().max(60).optional(), paymentStatus: z.string().optional(), type: z.enum(['SERVICE', 'CANCELLATION', 'MEMBERSHIP']).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), fleetAccountId: z.string().optional(), overdue: queryBool.optional() });

function invoiceWhere(q: z.infer<typeof invoiceFilters>): Prisma.InvoiceWhereInput {
  return {
    ...(q.paymentStatus ? { paymentStatus: { in: q.paymentStatus.split(',') as never } } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...(q.fleetAccountId ? { fleetAccountId: q.fleetAccountId } : {}),
    ...(q.from || q.to ? { issuedAt: { gte: q.from, lt: q.to } } : {}),
    ...(q.overdue ? { outstanding: { gt: 0 }, dueAt: { lt: new Date() }, status: 'ISSUED' } : {}),
    ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { billingName: { contains: q.q, mode: 'insensitive' } }, { booking: { code: { contains: q.q, mode: 'insensitive' } } }] } : {}),
  };
}

financeRouter.get('/invoices', requirePermission('finance:read'), async (req, res) => {
  const q = parseQuery(paginationSchema.merge(invoiceFilters), req);
  const where = invoiceWhere(q);
  const [items, total, sums] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: { issuedAt: 'desc' }, ...pageArgs(q), include: { booking: { select: { code: true } } } }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where: { ...where, status: 'ISSUED' }, _sum: { total: true, amountPaid: true, outstanding: true } }),
  ]);
  ok(res, items, { ...pageMeta(q, total), sums: sums._sum });
});

financeRouter.get('/invoices/:id', requirePermission('finance:read'), async (req, res) => {
  const inv = await prisma.invoice.findUnique({
    where: { id: idParam(req) },
    include: { items: { orderBy: { sortOrder: 'asc' } }, payments: { orderBy: { createdAt: 'desc' } }, refunds: { orderBy: { createdAt: 'desc' } }, creditNotes: true, adjustments: true, booking: { select: { id: true, code: true } }, tickets: true, fleetAccount: { select: { name: true } } },
  });
  if (!inv) throw notFound('Invoice');
  ok(res, inv);
});

financeRouter.post('/invoices/:id/credit-notes', requirePermission('finance:manage'), async (req, res) => {
  const b = parseBody(z.object({ amount: rupeesToPaise, reason: z.string().trim().min(5).max(500) }), req);
  created(res, await issueCreditNote(principal(req), idParam(req), b.amount, b.reason));
});

financeRouter.post('/invoices/:id/write-off', requirePermission('finance:manage'), async (req, res) => {
  const b = parseBody(z.object({ amount: rupeesToPaise, reason: z.string().trim().min(5).max(500) }), req);
  ok(res, await writeOff(principal(req), idParam(req), b.amount, b.reason));
});

financeRouter.post('/invoices/:id/bank-transfer', requirePermission('finance:manage'), async (req, res) => {
  const b = parseBody(z.object({ amount: rupeesToPaise, reference: z.string().trim().min(4).max(60) }), req);
  ok(res, await recordBankTransfer(principal(req), idParam(req), b.amount, b.reference));
});

financeRouter.post('/invoices/:id/dispute', requirePermission('finance:manage'), async (req, res) => {
  const b = parseBody(z.object({ disputed: z.boolean(), note: z.string().min(3).max(500) }), req);
  const r = await setInvoiceDispute(prisma, idParam(req), b.disputed);
  await audit(prisma, req, { action: b.disputed ? 'invoice.dispute.opened' : 'invoice.dispute.resolved', entityType: 'invoice', entityId: idParam(req), after: b });
  ok(res, r.invoice);
});

financeRouter.post('/invoices/:id/void', requirePermission('finance:manage'), async (req, res) => {
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(5).max(500) }), req);
  const inv = await prisma.invoice.findUnique({ where: { id: idParam(req) } });
  if (!inv) throw notFound('Invoice');
  if (inv.amountPaid > 0 || inv.amountPendingCash > 0) throw conflict('Invoices with payments cannot be voided. Issue a credit note and refund instead.');
  await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason } });
  await recomputeInvoice(prisma, inv.id);
  await audit(prisma, req, { action: 'invoice.voided', entityType: 'invoice', entityId: inv.id, after: { reason } });
  ok(res, { voided: true });
});

financeRouter.get('/invoices.csv', requirePermission('finance:read'), async (req, res) => {
  const q = parseQuery(invoiceFilters, req);
  const rows = await prisma.invoice.findMany({ where: invoiceWhere(q), orderBy: { issuedAt: 'asc' }, include: { booking: { select: { code: true } } } });
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', 'attachment; filename="invoices.csv"');
  res.send(
    toCsv(
      rows.map((i) => ({
        number: i.number,
        type: i.type,
        status: i.status,
        issuedAt: i.issuedAt,
        booking: i.booking?.code,
        billTo: i.billingName,
        gstin: i.billingGstin,
        serviceValue: paiseToRupees(i.subtotal),
        discounts: paiseToRupees(i.discountTotal),
        taxableValue: paiseToRupees(i.taxableValue),
        gst: paiseToRupees(i.taxTotal),
        passThrough: paiseToRupees(i.passThroughTotal),
        total: paiseToRupees(i.total),
        paid: paiseToRupees(i.amountPaid),
        credited: paiseToRupees(i.amountCredited),
        refunded: paiseToRupees(i.amountRefunded),
        outstanding: paiseToRupees(i.outstanding),
        paymentStatus: i.paymentStatus,
        sample: i.isSample,
      })),
    ),
  );
});

financeRouter.get('/ageing', requirePermission('finance:read'), async (_req, res) => {
  const now = new Date();
  const open = await prisma.invoice.findMany({ where: { status: 'ISSUED', outstanding: { gt: 0 } }, select: { id: true, number: true, billingName: true, outstanding: true, dueAt: true, issuedAt: true, fleetAccountId: true } });
  const buckets: Record<string, { count: number; amount: number }> = { current: { count: 0, amount: 0 }, '1-30': { count: 0, amount: 0 }, '31-60': { count: 0, amount: 0 }, '61-90': { count: 0, amount: 0 }, '90+': { count: 0, amount: 0 } };
  const rows = open.map((i) => {
    const bucket = ageingBucket(i.dueAt ?? i.issuedAt, now);
    buckets[bucket]!.count++;
    buckets[bucket]!.amount += i.outstanding;
    return { ...i, bucket };
  });
  ok(res, { buckets, invoices: rows.sort((a, b) => (a.dueAt ?? a.issuedAt).getTime() - (b.dueAt ?? b.issuedAt).getTime()) });
});

// ─── Payments: cash confirmation, reconciliation ─────────────────────

financeRouter.get('/payments', requirePermission('finance:read'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ status: z.string().optional(), method: z.enum(['ONLINE', 'CASH', 'BANK_TRANSFER', 'PREPAID_CREDIT']).optional() }), req);
  const where: Prisma.PaymentWhereInput = { ...(q.status ? { status: { in: q.status.split(',') as never } } : {}), ...(q.method ? { method: q.method } : {}) };
  const [items, total] = await Promise.all([prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), include: { invoice: { select: { number: true, billingName: true } } } }), prisma.payment.count({ where })]);
  const collectors = await prisma.user.findMany({ where: { id: { in: items.map((i) => i.collectedById).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
  ok(res, items.map((i) => ({ ...i, collectedBy: collectors.find((c) => c.id === i.collectedById)?.fullName ?? null })), pageMeta(q, total));
});

financeRouter.post('/payments/:id/cash-decision', requirePermission('finance:manage'), async (req, res) => {
  const b = parseBody(z.object({ approve: z.boolean(), note: z.string().max(300).optional() }), req);
  ok(res, await decideCash(principal(req), idParam(req), b.approve, b.note));
});

/** Gateway reconciliation: every gateway order vs confirmed webhook events vs invoices. */
financeRouter.get('/reconciliation', requirePermission('finance:read'), async (req, res) => {
  const q = parseQuery(z.object({ from: z.coerce.date().default(() => new Date(Date.now() - 7 * 86_400_000)), to: z.coerce.date().default(() => new Date()) }), req);
  const [payments, events, refunds] = await Promise.all([
    prisma.payment.findMany({ where: { method: 'ONLINE', createdAt: { gte: q.from, lt: q.to } }, include: { invoice: { select: { number: true, paymentStatus: true } } } }),
    prisma.paymentWebhookEvent.findMany({ where: { receivedAt: { gte: q.from, lt: q.to } }, orderBy: { receivedAt: 'desc' } }),
    prisma.refund.findMany({ where: { createdAt: { gte: q.from, lt: q.to } }, include: { invoice: { select: { number: true } } } }),
  ]);
  const issues: { type: string; ref: string; detail: string }[] = [];
  const stalePending = payments.filter((p) => ['CREATED', 'PENDING'].includes(p.status) && p.createdAt < new Date(Date.now() - 30 * 60_000));
  for (const p of stalePending) issues.push({ type: 'UNCONFIRMED_PAYMENT', ref: p.providerOrderId ?? p.id, detail: `Order for ${p.invoice.number} has no confirmation after 30 minutes (status ${p.status}). Check the gateway dashboard.` });
  for (const e of events.filter((e) => e.status === 'FAILED' || !e.signatureValid)) issues.push({ type: e.signatureValid ? 'WEBHOOK_FAILED' : 'INVALID_SIGNATURE', ref: e.eventId, detail: e.error ?? e.eventType });
  for (const r of refunds.filter((r) => r.status === 'FAILED' || (r.status === 'PROCESSING' && r.updatedAt < new Date(Date.now() - 24 * 3600_000))))
    issues.push({ type: r.status === 'FAILED' ? 'REFUND_FAILED' : 'REFUND_STUCK', ref: r.id, detail: `${r.invoice.number}: ${r.failureReason ?? 'processing > 24h'}` });
  const succeeded = payments.filter((p) => p.status === 'SUCCEEDED');
  ok(res, {
    range: q,
    totals: {
      ordersCreated: payments.length,
      succeeded: succeeded.length,
      succeededAmount: succeeded.reduce((a, p) => a + p.amount, 0),
      gatewayFees: succeeded.reduce((a, p) => a + p.gatewayFee, 0),
      sandboxAmount: succeeded.filter((p) => p.isSandbox).reduce((a, p) => a + p.amount, 0),
      webhookEvents: events.length,
      duplicateOrIgnored: events.filter((e) => e.status === 'IGNORED').length,
      refundsSucceeded: refunds.filter((r) => r.status === 'SUCCEEDED').reduce((a, r) => a + r.amount, 0),
    },
    issues,
    events: events.slice(0, 100).map((e) => ({ ...e, payload: undefined })),
  });
});

// ─── Refunds ─────────────────────────────────────────────────────────

financeRouter.get('/refunds', requirePermission('finance:read'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ status: z.string().optional() }), req);
  const where: Prisma.RefundWhereInput = q.status ? { status: { in: q.status.split(',') as never } } : {};
  const [items, total] = await Promise.all([prisma.refund.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), include: { invoice: { select: { number: true, billingName: true } }, payment: { select: { method: true, isSandbox: true } } } }), prisma.refund.count({ where })]);
  ok(res, items, pageMeta(q, total));
});

financeRouter.post('/refunds/:id/decision', requirePermission('finance:manage'), async (req, res) => {
  const b = parseBody(z.object({ approve: z.boolean(), note: z.string().trim().min(3).max(500), manualReference: z.string().max(60).optional(), issueCreditNote: z.boolean().default(true) }), req);
  ok(res, await decideRefund(principal(req), idParam(req), b));
});

financeRouter.post('/refunds/:id/retry', requirePermission('finance:manage'), async (req, res) => {
  ok(res, await retryRefund(principal(req), idParam(req)));
});

// ─── Expenses & vendor bills ─────────────────────────────────────────

const expenseCategories = z.enum(['FUEL', 'MAINTENANCE', 'REPAIR', 'EQUIPMENT', 'RENTAL', 'MARKETING', 'INSURANCE', 'TOLLS_PARKING', 'OFFICE', 'SOFTWARE', 'OTHER']);

financeRouter.get('/expenses', requirePermission('finance:read'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ status: z.string().optional(), category: expenseCategories.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), truckId: z.string().optional() }), req);
  const where: Prisma.ExpenseWhereInput = {
    ...(q.status ? { status: { in: q.status.split(',') as never } } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.truckId ? { truckId: q.truckId } : {}),
    ...(q.from || q.to ? { expenseDate: { gte: q.from, lt: q.to } } : {}),
  };
  const [items, total, sum] = await Promise.all([
    prisma.expense.findMany({ where, orderBy: { expenseDate: 'desc' }, ...pageArgs(q), include: { truck: { select: { registrationNumber: true } }, booking: { select: { code: true } } } }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true, taxAmount: true } }),
  ]);
  const claimants = await prisma.user.findMany({ where: { id: { in: items.map((i) => i.claimantUserId).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
  ok(
    res,
    items.map((i) => ({ ...i, claimant: claimants.find((c) => c.id === i.claimantUserId)?.fullName ?? null, attachmentUrl: i.attachmentKey ? signedFileUrl(i.attachmentKey) : null, attachmentKey: undefined })),
    { ...pageMeta(q, total), sum: sum._sum },
  );
});

financeRouter.post('/expenses', requirePermission('finance:manage'), uploadMiddleware.single('receipt'), async (req, res) => {
  const p = principal(req);
  const b = z
    .object({
      category: expenseCategories,
      source: z.enum(['DIRECT', 'VENDOR_BILL']).default('DIRECT'),
      description: z.string().trim().min(3).max(300),
      vendorName: z.string().max(120).optional(),
      vendorBillRef: z.string().max(60).optional(),
      amount: rupeesToPaise.refine((v) => v > 0),
      taxAmount: rupeesToPaise.default(0),
      expenseDate: z.coerce.date(),
      truckId: z.string().optional(),
      zoneId: z.string().optional(),
      fuelLitres: z.coerce.number().positive().optional(),
      odometerKm: z.coerce.number().int().optional(),
      paid: z
        .string()
        .optional()
        .transform((v) => v === 'true'),
      paymentRef: z.string().max(60).optional(),
    })
    .parse(req.body);
  const receipt = req.file ? (await storeUploads(req, 'expenses/finance', ['document']))[0] : null;
  const { paid, ...data } = b;
  const e = await prisma.expense.create({
    data: { ...data, number: await nextDocumentNumber(prisma, 'EXP'), status: paid ? 'PAID' : 'APPROVED', paidAt: paid ? new Date() : null, submittedById: p.userId, approvedById: p.userId, approvedAt: new Date(), attachmentKey: receipt?.storageKey },
  });
  await audit(prisma, req, { action: 'expense.created', entityType: 'expense', entityId: e.id, after: data });
  created(res, e);
});

financeRouter.post('/expenses/:id/decision', requirePermission('finance:manage'), async (req, res) => {
  const p = principal(req);
  const b = parseBody(z.object({ approve: z.boolean(), reason: z.string().max(300).optional() }), req);
  const e = await withTx(async (tx) => {
    const e0 = await tx.expense.findUnique({ where: { id: idParam(req) } });
    if (!e0) throw notFound('Expense');
    const r = await tx.expense.updateMany({ where: { id: e0.id, status: 'SUBMITTED' }, data: b.approve ? { status: 'APPROVED', approvedById: p.userId, approvedAt: new Date() } : { status: 'REJECTED', approvedById: p.userId, rejectionReason: b.reason } });
    if (r.count !== 1) throw conflict('Expense already decided');
    // Approved employee claims are reimbursed through the next payout.
    if (b.approve && e0.reimbursable && e0.claimantUserId)
      await tx.driverEarning.create({ data: { userId: e0.claimantUserId, bookingId: e0.bookingId, kind: 'REIMBURSEMENT', amount: e0.amount, expenseId: e0.id, note: `Reimbursement ${e0.number}: ${e0.description}`, createdById: p.userId } });
    await audit(tx, req, { action: b.approve ? 'expense.approved' : 'expense.rejected', entityType: 'expense', entityId: e0.id, after: b });
    if (e0.claimantUserId) await notify(tx, e0.claimantUserId, { type: 'expense.decision', title: `Expense ${e0.number} ${b.approve ? 'approved' : 'rejected'}`, body: b.reason ?? (b.approve ? 'It will be reimbursed in your next payout.' : ''), data: { expenseId: e0.id } });
    return tx.expense.findUniqueOrThrow({ where: { id: e0.id } });
  });
  ok(res, e);
});

financeRouter.post('/expenses/:id/paid', requirePermission('finance:manage'), async (req, res) => {
  const b = parseBody(z.object({ paymentRef: z.string().trim().min(2).max(60), paidAt: z.coerce.date().default(() => new Date()) }), req);
  const e = await prisma.expense.findUnique({ where: { id: idParam(req) } });
  if (!e) throw notFound('Expense');
  if (e.reimbursable) throw conflict('Reimbursable claims are paid through driver payouts');
  const r = await prisma.expense.updateMany({ where: { id: e.id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: b.paidAt, paymentRef: b.paymentRef } });
  if (r.count !== 1) throw conflict('Only approved expenses can be marked paid');
  await audit(prisma, req, { action: 'expense.paid', entityType: 'expense', entityId: e.id, after: b });
  ok(res, { paid: true });
});

// ─── Salaries (obligations vs cash paid) ─────────────────────────────

financeRouter.get('/salaries', requirePermission('payroll:manage'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ status: z.enum(['ACCRUED', 'APPROVED', 'PAID', 'CANCELLED']).optional(), userId: z.string().optional() }), req);
  const where: Prisma.SalaryRecordWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.userId ? { userId: q.userId } : {}) };
  const [items, total] = await Promise.all([prisma.salaryRecord.findMany({ where, orderBy: { periodEnd: 'desc' }, ...pageArgs(q), include: { user: { select: { fullName: true, workerProfile: { select: { employeeCode: true } } } } } }), prisma.salaryRecord.count({ where })]);
  ok(res, items, pageMeta(q, total));
});

/** Generate salary accruals for all salaried staff for a pay period. */
financeRouter.post('/salaries/generate', requirePermission('payroll:manage'), async (req, res) => {
  const p = principal(req);
  const b = parseBody(z.object({ frequency: z.enum(['WEEKLY', 'MONTHLY', 'ANNUAL']), periodStart: z.coerce.date(), periodEnd: z.coerce.date() }), req);
  if (b.periodEnd <= b.periodStart) throw badRequest('Period end must be after start');
  const staff = await prisma.workerProfile.findMany({ where: { employmentType: 'SALARIED', payFrequency: b.frequency, baseSalary: { gt: 0 }, user: { status: 'ACTIVE' } } });
  let createdCount = 0;
  for (const w of staff) {
    try {
      await prisma.salaryRecord.create({ data: { userId: w.userId, frequency: b.frequency, periodStart: b.periodStart, periodEnd: b.periodEnd, baseAmount: w.baseSalary!, netAmount: w.baseSalary!, createdById: p.userId } });
      createdCount++;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e; // already generated for this period
    }
  }
  await audit(prisma, req, { action: 'salary.generated', entityType: 'salary_record', after: { ...b, created: createdCount } });
  ok(res, { created: createdCount, eligible: staff.length });
});

financeRouter.patch('/salaries/:id', requirePermission('payroll:manage'), async (req, res) => {
  const b = parseBody(z.object({ incentives: rupeesToPaise.optional(), deductions: rupeesToPaise.optional(), notes: z.string().max(500).optional() }), req);
  const s = await prisma.salaryRecord.findUnique({ where: { id: idParam(req) } });
  if (!s) throw notFound('Salary record');
  if (s.status !== 'ACCRUED') throw conflict('Only accrued records can be adjusted');
  const incentives = b.incentives ?? s.incentives;
  const deductions = b.deductions ?? s.deductions;
  const r = await prisma.salaryRecord.update({ where: { id: s.id }, data: { incentives, deductions, netAmount: s.baseAmount + incentives - deductions, notes: b.notes } });
  await audit(prisma, req, { action: 'salary.adjusted', entityType: 'salary_record', entityId: s.id, before: s, after: r });
  ok(res, r);
});

financeRouter.post('/salaries/:id/:action', requirePermission('payroll:manage'), async (req, res) => {
  const p = principal(req);
  const action = z.enum(['approve', 'pay', 'cancel']).parse(req.params.action);
  const b = parseBody(z.object({ paymentRef: z.string().max(60).optional() }), req);
  const from = { approve: 'ACCRUED', pay: 'APPROVED', cancel: 'ACCRUED' } as const;
  if (action === 'pay' && !b.paymentRef) throw badRequest('Payment reference is required');
  const r = await prisma.salaryRecord.updateMany({
    where: { id: idParam(req), status: from[action] },
    data: action === 'approve' ? { status: 'APPROVED', approvedById: p.userId } : action === 'pay' ? { status: 'PAID', paidAt: new Date(), paymentRef: b.paymentRef } : { status: 'CANCELLED' },
  });
  if (r.count !== 1) throw conflict(`Record must be ${from[action].toLowerCase()} to ${action}`);
  await audit(prisma, req, { action: `salary.${action}`, entityType: 'salary_record', entityId: idParam(req), after: b });
  ok(res, { ok: true });
});

// ─── Earnings adjustments & payouts ──────────────────────────────────

financeRouter.post('/earnings', requirePermission('payroll:manage'), async (req, res) => {
  const p = principal(req);
  const b = parseBody(z.object({ userId: z.string(), kind: z.enum(['INCENTIVE', 'DEDUCTION']), amount: rupeesToPaise.refine((v) => v > 0), note: z.string().trim().min(3).max(300), bookingId: z.string().optional() }), req);
  const amount = b.kind === 'DEDUCTION' ? -b.amount : b.amount;
  const e = await prisma.driverEarning.create({ data: { userId: b.userId, kind: b.kind, amount, note: b.note, bookingId: b.bookingId, createdById: p.userId } });
  await audit(prisma, req, { action: `earning.${b.kind.toLowerCase()}`, entityType: 'driver_earning', entityId: e.id, after: b });
  await notify(prisma, b.userId, { type: 'earning.adjustment', title: `${b.kind === 'INCENTIVE' ? 'Incentive added' : 'Deduction recorded'}: ₹${(b.amount / 100).toFixed(2)}`, body: `${b.note}. You can challenge this via Support → Performance challenge.`, data: { earningId: e.id } });
  created(res, e);
});

financeRouter.get('/earnings', requirePermission('payroll:manage'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ userId: z.string().optional(), status: z.enum(['PENDING', 'IN_PAYOUT', 'VOID']).optional(), kind: z.enum(['JOB_FIXED', 'JOB_COMMISSION', 'INCENTIVE', 'DEDUCTION', 'REIMBURSEMENT']).optional() }), req);
  const where: Prisma.DriverEarningWhereInput = { ...(q.userId ? { userId: q.userId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) };
  const [items, total] = await Promise.all([
    prisma.driverEarning.findMany({ where, orderBy: { earnedAt: 'desc' }, ...pageArgs(q), include: { user: { select: { fullName: true } }, booking: { select: { id: true, code: true } }, payout: { select: { id: true, status: true } } } }),
    prisma.driverEarning.count({ where }),
  ]);
  ok(res, items, pageMeta(q, total));
});

financeRouter.get('/payouts', requirePermission('payroll:manage'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ status: z.enum(['DRAFT', 'APPROVED', 'PAID', 'CANCELLED']).optional() }), req);
  const where = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([prisma.driverPayout.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), include: { user: { select: { fullName: true, workerProfile: { select: { employeeCode: true, payoutMethod: true, payoutDetailsMasked: true } } } } } }), prisma.driverPayout.count({ where })]);
  const pending = await prisma.driverEarning.groupBy({ by: ['userId'], where: { status: 'PENDING' }, _sum: { amount: true }, _count: true });
  const names = await prisma.user.findMany({ where: { id: { in: pending.map((p) => p.userId) } }, select: { id: true, fullName: true } });
  ok(res, items, { ...pageMeta(q, total), pendingByWorker: pending.map((p) => ({ userId: p.userId, name: names.find((n) => n.id === p.userId)?.fullName, amount: p._sum.amount ?? 0, lines: p._count })) });
});

/** Bundle all pending earnings up to `periodEnd` into draft payouts, one per worker. */
financeRouter.post('/payouts/generate', requirePermission('payroll:manage'), async (req, res) => {
  const p = principal(req);
  const b = parseBody(z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date() }), req);
  const result = await withTx(async (tx) => {
    const pending = await tx.driverEarning.findMany({ where: { status: 'PENDING', earnedAt: { lt: b.periodEnd } } });
    const byUser = new Map<string, typeof pending>();
    for (const e of pending) byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e]);
    const payouts = [];
    for (const [userId, lines] of byUser) {
      const sumKind = (kinds: string[]) => lines.filter((l) => kinds.includes(l.kind)).reduce((a, l) => a + l.amount, 0);
      const earnings = sumKind(['JOB_FIXED', 'JOB_COMMISSION']);
      const incentives = sumKind(['INCENTIVE']);
      const deductions = -sumKind(['DEDUCTION']);
      const reimbursements = sumKind(['REIMBURSEMENT']);
      const net = earnings + incentives - deductions + reimbursements;
      const payout = await tx.driverPayout.create({ data: { userId, periodStart: b.periodStart, periodEnd: b.periodEnd, earningsAmount: earnings, incentivesAmount: incentives, deductionsAmount: deductions, reimbursementsAmount: reimbursements, netAmount: net, createdById: p.userId } });
      await tx.driverEarning.updateMany({ where: { id: { in: lines.map((l) => l.id) }, status: 'PENDING' }, data: { status: 'IN_PAYOUT', payoutId: payout.id } });
      payouts.push(payout);
    }
    await tx.auditLog.create({ data: { actorUserId: p.userId, action: 'payout.generated', entityType: 'driver_payout', after: { ...b, count: payouts.length } } });
    return payouts;
  });
  created(res, result);
});

financeRouter.post('/payouts/:id/:action', requirePermission('payroll:manage'), async (req, res) => {
  const p = principal(req);
  const action = z.enum(['approve', 'pay', 'cancel']).parse(req.params.action);
  const b = parseBody(z.object({ paymentRef: z.string().max(60).optional() }), req);
  if (action === 'pay' && !b.paymentRef) throw badRequest('Payment reference is required');
  await withTx(async (tx) => {
    const po = await tx.driverPayout.findUnique({ where: { id: idParam(req) } });
    if (!po) throw notFound('Payout');
    const from = { approve: ['DRAFT'], pay: ['APPROVED'], cancel: ['DRAFT', 'APPROVED'] }[action];
    const r = await tx.driverPayout.updateMany({
      where: { id: po.id, status: { in: from as never } },
      data: action === 'approve' ? { status: 'APPROVED', approvedById: p.userId } : action === 'pay' ? { status: 'PAID', paidAt: new Date(), paymentRef: b.paymentRef } : { status: 'CANCELLED' },
    });
    if (r.count !== 1) throw conflict(`Payout cannot be ${action}d from ${po.status}`);
    if (action === 'cancel') await tx.driverEarning.updateMany({ where: { payoutId: po.id }, data: { status: 'PENDING', payoutId: null } });
    if (action === 'pay') {
      // Reimbursed claims are settled by this payout.
      const reimb = await tx.driverEarning.findMany({ where: { payoutId: po.id, kind: 'REIMBURSEMENT', expenseId: { not: null } }, select: { expenseId: true } });
      await tx.expense.updateMany({ where: { id: { in: reimb.map((r) => r.expenseId!) }, status: 'APPROVED' }, data: { status: 'PAID', paidAt: new Date(), paymentRef: `Payout ${b.paymentRef}` } });
      await notify(tx, po.userId, { type: 'payout.paid', title: `Payout of ₹${(po.netAmount / 100).toFixed(2)} sent`, body: `Reference ${b.paymentRef}`, data: { payoutId: po.id }, channels: ['SMS'] });
    }
    await tx.auditLog.create({ data: { actorUserId: p.userId, action: `payout.${action}`, entityType: 'driver_payout', entityId: po.id, after: b } });
  });
  ok(res, { ok: true });
});
