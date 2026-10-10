import type { Booking, Invoice, Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { prisma, type Db, type Tx } from '../../lib/prisma.js';
import { withTx } from '../../lib/tx.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { nextDocumentNumber } from '../../lib/numbering.js';
import { getSettings } from '../../lib/settings.js';
import { formatInr } from '../../lib/money.js';
import { randomToken } from '../../lib/crypto.js';
import { derivePaymentStatus, outstandingAmount, refundableAmount } from '../../domain/paymentStatus.js';
import type { PriceBreakdown } from '../../domain/pricing.js';
import { gateway, razorpayGateway, sandboxFee, sandboxGateway, type PaymentGateway } from '../../integrations/payments.js';
import { enqueue, registerJob } from '../../jobs/queue.js';
import { notify } from '../notifications/service.js';
import { emitToBooking, emitToUser } from '../../realtime/socket.js';
import { logger } from '../../lib/logger.js';
import type { Principal } from '../../middleware/auth.js';

// ─── Ledger ──────────────────────────────────────────────────────────

/**
 * Recomputes an invoice's cached balances and payment status from its immutable ledger rows
 * (payments, credit notes, refunds, adjustments). Always call inside the transaction that
 * changed the ledger.
 */
export async function recomputeInvoice(tx: Db, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const [paid, pendingCash, credited, refunds, writeOffs, lastOnline] = await Promise.all([
    tx.payment.aggregate({ where: { invoiceId, status: 'SUCCEEDED' }, _sum: { amount: true } }),
    tx.payment.aggregate({ where: { invoiceId, status: 'PENDING', method: 'CASH' }, _sum: { amount: true } }),
    tx.creditNote.aggregate({ where: { invoiceId }, _sum: { amount: true } }),
    tx.refund.groupBy({ by: ['status'], where: { invoiceId }, _sum: { amount: true } }),
    tx.financialAdjustment.aggregate({ where: { invoiceId, type: 'WRITE_OFF' }, _sum: { amount: true } }),
    tx.payment.findFirst({ where: { invoiceId, method: 'ONLINE' }, orderBy: { createdAt: 'desc' } }),
  ]);
  const refundSum = (statuses: string[]) => refunds.filter((r) => statuses.includes(r.status)).reduce((a, r) => a + (r._sum.amount ?? 0), 0);
  const ledger = {
    total: inv.total,
    paid: paid._sum.amount ?? 0,
    pendingCash: pendingCash._sum.amount ?? 0,
    credited: credited._sum.amount ?? 0,
    refunded: refundSum(['SUCCEEDED']),
    refundPending: refundSum(['REQUESTED', 'APPROVED', 'PROCESSING']),
    writtenOff: writeOffs._sum.amount ?? 0,
    hasPendingOnlineAttempt: !!lastOnline && ['CREATED', 'PENDING'].includes(lastOnline.status) && lastOnline.createdAt > new Date(Date.now() - 30 * 60_000),
    lastAttemptFailed: lastOnline?.status === 'FAILED',
    disputed: inv.disputed,
  };
  const updated = await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: ledger.paid,
      amountPendingCash: ledger.pendingCash,
      amountCredited: ledger.credited,
      amountRefunded: ledger.refunded,
      amountWrittenOff: ledger.writtenOff,
      outstanding: inv.status === 'VOID' ? 0 : outstandingAmount(ledger),
      paymentStatus: derivePaymentStatus(ledger),
    },
  });
  return { invoice: updated, ledger };
}

async function billingFor(db: Db, customerUserId: string, fleetAccountId: string | null) {
  const s = await getSettings(db);
  if (fleetAccountId) {
    const fa = await db.fleetAccount.findUniqueOrThrow({ where: { id: fleetAccountId } });
    return { billingName: fa.name, billingEmail: fa.billingEmail, billingPhone: fa.billingPhone, billingAddress: fa.billingAddress, billingGstin: fa.gstin, dueDays: fa.paymentTermsDays, s };
  }
  const u = await db.user.findUniqueOrThrow({ where: { id: customerUserId } });
  return { billingName: u.fullName, billingEmail: u.email, billingPhone: u.phone, billingAddress: null, billingGstin: null, dueDays: 0, s };
}

function itemsFromBreakdown(b: PriceBreakdown, sourceQuoteId: string | null): Prisma.InvoiceItemCreateWithoutInvoiceInput[] {
  return b.lines.map((l, i) => ({
    code: l.code,
    description: l.description,
    quantity: l.quantity,
    unitAmount: l.unitAmount,
    amount: l.amount,
    taxable: l.taxable,
    isPassThrough: l.isPassThrough,
    isAdditional: l.isAdditional,
    sourceQuoteId,
    reason: l.reason,
    sortOrder: i,
  }));
}

/** Final service invoice. One per booking (unique constraint prevents duplicates). */
export async function issueServiceInvoice(tx: Tx, booking: Booking, final: PriceBreakdown, approved: { id: string; total: number }, snapshot: unknown, isSample = false) {
  const existing = await tx.invoice.findUnique({ where: { bookingId: booking.id } });
  if (existing) return existing;
  const bill = await billingFor(tx, booking.customerUserId, booking.fleetAccountId);
  const now = new Date();
  const inv = await tx.invoice.create({
    data: {
      number: await nextDocumentNumber(tx, 'INV', now),
      type: 'SERVICE',
      bookingId: booking.id,
      customerUserId: booking.customerUserId,
      fleetAccountId: booking.fleetAccountId,
      approvedQuoteId: approved.id,
      approvedQuoteTotal: approved.total,
      billingName: bill.billingName,
      billingEmail: bill.billingEmail,
      billingPhone: bill.billingPhone,
      billingAddress: bill.billingAddress,
      billingGstin: bill.billingGstin,
      subtotal: final.subtotal,
      discountTotal: final.discountTotal,
      taxableValue: final.taxableValue,
      taxTotal: final.taxTotal,
      passThroughTotal: final.passThroughTotal,
      total: final.total,
      outstanding: final.total,
      pricingSnapshot: snapshot as Prisma.InputJsonValue,
      issuedAt: now,
      dueAt: new Date(now.getTime() + bill.dueDays * 86_400_000),
      isSample,
      items: { create: itemsFromBreakdown(final, approved.id) },
    },
  });
  await recomputeInvoice(tx, inv.id);
  return inv;
}

export async function createCancellationInvoice(tx: Tx, booking: Booking, fee: number, policyDescription: string) {
  const bill = await billingFor(tx, booking.customerUserId, booking.fleetAccountId);
  const taxRateBps = 1800;
  // Fee is quoted GST-inclusive in the policy; split into taxable value + GST.
  const taxable = Math.round((fee * 10000) / (10000 + taxRateBps));
  const tax = fee - taxable;
  const now = new Date();
  const inv = await tx.invoice.create({
    data: {
      number: await nextDocumentNumber(tx, 'INV', now),
      type: 'CANCELLATION',
      bookingId: booking.id,
      customerUserId: booking.customerUserId,
      fleetAccountId: booking.fleetAccountId,
      billingName: bill.billingName,
      billingEmail: bill.billingEmail,
      billingPhone: bill.billingPhone,
      billingAddress: bill.billingAddress,
      billingGstin: bill.billingGstin,
      subtotal: taxable,
      discountTotal: 0,
      taxableValue: taxable,
      taxTotal: tax,
      passThroughTotal: 0,
      total: fee,
      outstanding: fee,
      issuedAt: now,
      dueAt: new Date(now.getTime() + bill.dueDays * 86_400_000),
      notes: policyDescription,
      items: { create: [{ code: 'CANCELLATION', description: `Cancellation fee (${policyDescription})`, quantity: 1, unitAmount: taxable, amount: taxable, sortOrder: 0 }] },
    },
  });
  await recomputeInvoice(tx, inv.id);
  return inv;
}

// ─── Access control ──────────────────────────────────────────────────

export async function invoiceForViewer(p: Principal, invoiceId: string) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw notFound('Invoice');
  if (inv.customerUserId === p.userId) return inv;
  if (p.permissions.has('finance:read')) return inv;
  if (inv.fleetAccountId) {
    const m = await prisma.fleetAccountMember.findUnique({ where: { fleetAccountId_userId: { fleetAccountId: inv.fleetAccountId, userId: p.userId } } });
    if (m?.isManager) return inv;
  }
  throw notFound('Invoice');
}

// ─── Online payments ─────────────────────────────────────────────────

export async function createPaymentOrder(p: Principal, invoiceId: string, input: { amount?: number; idempotencyKey: string }) {
  const inv = await invoiceForViewer(p, invoiceId);
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.invoiceId !== inv.id) throw conflict('Idempotency key already used');
    return paymentOrderView(existing, inv);
  }
  if (inv.status !== 'ISSUED') throw conflict('This invoice is not payable');
  const { invoice } = await recomputeInvoice(prisma, inv.id);
  const payable = invoice.outstanding - invoice.amountPendingCash;
  if (payable <= 0) throw conflict('Nothing is due on this invoice');
  const amount = input.amount ?? payable;
  if (amount < 100) throw badRequest('Minimum payment is ₹1');
  if (amount > payable) throw badRequest(`You can pay at most ${formatInr(payable)}`);

  const order = await gateway.createOrder({ amount, currency: inv.currency, receipt: inv.number, notes: { invoiceId: inv.id, invoiceNumber: inv.number } });
  const payment = await withTx(async (tx) => {
    // Expire older open attempts so status reflects the latest one.
    await tx.payment.updateMany({ where: { invoiceId: inv.id, method: 'ONLINE', status: 'CREATED' }, data: { status: 'CANCELLED', failureReason: 'Superseded by a newer attempt' } });
    const pay = await tx.payment.create({
      data: {
        invoiceId: inv.id,
        method: 'ONLINE',
        provider: gateway.provider,
        status: 'CREATED',
        amount,
        providerOrderId: order.orderId,
        idempotencyKey: input.idempotencyKey,
        initiatedById: p.userId,
        isSandbox: gateway.isSandbox,
      },
    });
    await recomputeInvoice(tx, inv.id);
    return pay;
  });
  return paymentOrderView(payment, inv);
}

function paymentOrderView(pay: { id: string; amount: number; providerOrderId: string | null; status: string; isSandbox: boolean }, inv: Invoice) {
  return {
    paymentId: pay.id,
    orderId: pay.providerOrderId,
    amount: pay.amount,
    currency: inv.currency,
    status: pay.status,
    provider: gateway.provider,
    keyId: gateway.publicKeyId,
    sandbox: pay.isSandbox,
    invoiceNumber: inv.number,
  };
}

/**
 * Client callback after the checkout widget closes. We only record the provider payment id and
 * move to PENDING — the payment is confirmed exclusively by the verified webhook.
 */
export async function checkoutCallback(p: Principal, paymentId: string, input: { orderId: string; providerPaymentId: string; signature: string }) {
  const pay = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!pay) throw notFound('Payment');
  await invoiceForViewer(p, pay.invoiceId);
  const gw = pay.provider === 'SANDBOX' ? sandboxGateway : razorpayGateway;
  if (!gw || pay.providerOrderId !== input.orderId || !gw.verifyCheckoutSignature({ orderId: input.orderId, paymentId: input.providerPaymentId, signature: input.signature }))
    throw badRequest('Payment signature could not be verified');
  await prisma.payment.updateMany({ where: { id: pay.id, status: 'CREATED' }, data: { status: 'PENDING', providerPaymentId: input.providerPaymentId } });
  await recomputeInvoice(prisma, pay.invoiceId);
  return { status: 'PENDING', message: 'Payment received by the gateway. Waiting for confirmation.' };
}

export async function processWebhook(gw: PaymentGateway, raw: Buffer, headers: Record<string, string | string[] | undefined>) {
  const valid = gw.verifyWebhookSignature(raw, headers);
  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('Invalid webhook body');
  }
  const ev = gw.parseWebhook(body, headers);
  let record;
  try {
    record = await prisma.paymentWebhookEvent.create({ data: { provider: gw.provider, eventId: ev.eventId, eventType: ev.eventType, signatureValid: valid, payload: body as Prisma.InputJsonValue } });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return { status: 'duplicate' as const };
    throw e;
  }
  if (!valid) {
    await prisma.paymentWebhookEvent.update({ where: { id: record.id }, data: { status: 'IGNORED', error: 'Invalid signature', processedAt: new Date() } });
    return { status: 'invalid_signature' as const };
  }
  try {
    const outcome = await applyWebhook(gw, ev);
    await prisma.paymentWebhookEvent.update({ where: { id: record.id }, data: { status: outcome === 'ignored' ? 'IGNORED' : 'PROCESSED', processedAt: new Date() } });
    return { status: outcome };
  } catch (err) {
    await prisma.paymentWebhookEvent.update({ where: { id: record.id }, data: { status: 'FAILED', error: String((err as Error).message).slice(0, 1000) } });
    throw err;
  }
}

async function applyWebhook(gw: PaymentGateway, ev: ReturnType<PaymentGateway['parseWebhook']>): Promise<'processed' | 'ignored'> {
  if (ev.kind === 'payment.captured' || ev.kind === 'payment.failed') {
    if (!ev.orderId) return 'ignored';
    const effects = await withTx(async (tx, after) => {
      await tx.$queryRaw`SELECT id FROM "payments" WHERE "providerOrderId" = ${ev.orderId} FOR UPDATE`;
      const pay = await tx.payment.findUnique({ where: { providerOrderId: ev.orderId! }, include: { invoice: true } });
      if (!pay || pay.provider !== gw.provider) return 'ignored' as const;
      if (pay.status === 'SUCCEEDED') return 'processed' as const; // already applied
      if (ev.kind === 'payment.failed') {
        await tx.payment.update({ where: { id: pay.id }, data: { status: 'FAILED', providerPaymentId: ev.paymentId ?? pay.providerPaymentId, failureReason: ev.failureReason ?? 'Payment failed' } });
        await recomputeInvoice(tx, pay.invoiceId);
        await notify(tx, pay.invoice.customerUserId, { type: 'payment.failed', title: `Payment failed for ${pay.invoice.number}`, body: ev.failureReason ?? 'Your payment did not go through. No money was taken, or it will be auto-reversed by your bank.', data: { invoiceId: pay.invoiceId } });
        after(() => notifyPaymentChange(pay.invoice));
        return 'processed' as const;
      }
      if (ev.amount != null && ev.amount !== pay.amount) logger.warn({ paymentId: pay.id, expected: pay.amount, got: ev.amount }, 'captured amount differs from order amount');
      const captured = ev.amount ?? pay.amount;
      await tx.payment.update({
        where: { id: pay.id },
        data: {
          status: 'SUCCEEDED',
          amount: captured,
          providerPaymentId: ev.paymentId ?? pay.providerPaymentId,
          gatewayFee: ev.fee ?? 0,
          gatewayTax: ev.tax ?? 0,
          succeededAt: new Date(),
          receiptNumber: await nextDocumentNumber(tx, 'RCP'),
        },
      });
      const { invoice, ledger } = await recomputeInvoice(tx, pay.invoiceId);
      await notify(tx, invoice.customerUserId, { type: 'payment.succeeded', title: `Payment received: ${formatInr(captured)}`, body: `Invoice ${invoice.number}. ${invoice.outstanding > 0 ? `Outstanding: ${formatInr(invoice.outstanding)}` : 'Fully paid. Thank you!'}`, data: { invoiceId: invoice.id }, channels: ['SMS', 'EMAIL'] });

      // Overpayment (e.g. two tabs paid at once): refund the excess automatically.
      const excess = ledger.paid - ledger.refunded - (invoice.total - ledger.credited - ledger.writtenOff);
      if (excess > 0) {
        const r = await tx.refund.create({ data: { invoiceId: invoice.id, paymentId: pay.id, amount: excess, status: 'APPROVED', reason: 'Automatic refund of overpayment', idempotencyKey: `overpay:${pay.id}`, requestedById: invoice.customerUserId, isSandbox: pay.isSandbox } });
        await recomputeInvoice(tx, invoice.id);
        after(() => submitRefundToGateway(r.id).then(() => undefined));
      }
      if (invoice.type === 'MEMBERSHIP' && invoice.subscriptionId && invoice.outstanding === 0) await activateSubscription(tx, invoice.subscriptionId);
      after(() => notifyPaymentChange(invoice));
      return 'processed' as const;
    });
    return effects;
  }

  if (ev.kind === 'refund.processed' || ev.kind === 'refund.failed') {
    if (!ev.refundId) return 'ignored';
    return withTx(async (tx, after) => {
      const r = await tx.refund.findUnique({ where: { providerRefundId: ev.refundId! }, include: { invoice: true } });
      if (!r) return 'ignored' as const;
      if (r.status === 'SUCCEEDED' || r.status === 'FAILED') return 'processed' as const;
      if (ev.kind === 'refund.processed') {
        await tx.refund.update({ where: { id: r.id }, data: { status: 'SUCCEEDED', processedAt: new Date() } });
        await notify(tx, r.invoice.customerUserId, { type: 'refund.succeeded', title: `Refund processed: ${formatInr(r.amount)}`, body: `Against invoice ${r.invoice.number}. It may take 5–7 working days to reflect in your account.`, data: { invoiceId: r.invoiceId }, channels: ['SMS'] });
      } else {
        await tx.refund.update({ where: { id: r.id }, data: { status: 'FAILED', failureReason: ev.failureReason ?? 'Refund failed at gateway' } });
      }
      const { invoice } = await recomputeInvoice(tx, r.invoiceId);
      after(() => notifyPaymentChange(invoice));
      return 'processed' as const;
    });
  }
  return 'ignored';
}

function notifyPaymentChange(invoice: Invoice) {
  emitToUser(invoice.customerUserId, 'invoice.updated', { invoiceId: invoice.id, paymentStatus: invoice.paymentStatus, outstanding: invoice.outstanding });
  if (invoice.bookingId) emitToBooking(invoice.bookingId, 'payment.status', { invoiceId: invoice.id, paymentStatus: invoice.paymentStatus, outstanding: invoice.outstanding }, { paymentStatus: invoice.paymentStatus });
}

/**
 * SANDBOX ONLY: simulate the gateway completing (or failing) a checkout. The result is delivered
 * as a signed webhook through processWebhook(), exactly like a real gateway event.
 */
export async function simulateSandboxPayment(p: Principal, paymentId: string, outcome: 'success' | 'failure') {
  if (!gateway.isSandbox) throw forbidden('Sandbox payments are disabled');
  const pay = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!pay || pay.provider !== 'SANDBOX') throw notFound('Payment');
  await invoiceForViewer(p, pay.invoiceId);
  if (!['CREATED', 'PENDING'].includes(pay.status)) throw conflict(`Payment is already ${pay.status.toLowerCase()}`);
  const fee = sandboxFee(pay.amount);
  const sbxPaymentId = pay.providerPaymentId ?? `sbx_pay_${randomToken(9)}`;
  const { raw, headers } = sandboxGateway.signEvent({
    event: outcome === 'success' ? 'payment.captured' : 'payment.failed',
    payload: { payment: { entity: { id: sbxPaymentId, order_id: pay.providerOrderId!, amount: pay.amount, fee: fee.fee, tax: fee.tax, error_description: outcome === 'failure' ? 'Sandbox: payment declined by simulated bank' : undefined } } },
  });
  await processWebhook(sandboxGateway, raw, headers);
  return prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
}

// ─── Cash and bank transfers ─────────────────────────────────────────

/** Field worker records cash collected. It counts as paid only after finance confirms it. */
export async function recordCashCollection(collectorId: string, invoiceId: string, amount: number, note?: string) {
  return withTx(async (tx, after) => {
    const { invoice } = await recomputeInvoice(tx, invoiceId);
    const collectable = invoice.outstanding - invoice.amountPendingCash;
    if (amount <= 0 || amount > collectable) throw badRequest(`Cash amount must be between ₹0.01 and ${formatInr(collectable)}`);
    const pay = await tx.payment.create({
      data: { invoiceId, method: 'CASH', provider: 'MANUAL', status: 'PENDING', amount, idempotencyKey: `cash:${randomToken(12)}`, collectedById: collectorId, initiatedById: collectorId, notes: note, isSandbox: false },
    });
    const r = await recomputeInvoice(tx, invoiceId);
    after(() => notifyPaymentChange(r.invoice));
    return pay;
  });
}

export async function decideCash(finance: Principal, paymentId: string, approve: boolean, note?: string) {
  return withTx(async (tx, after) => {
    const pay = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!pay || pay.method !== 'CASH') throw notFound('Cash payment');
    const res = await tx.payment.updateMany({
      where: { id: pay.id, status: 'PENDING' },
      data: approve
        ? { status: 'SUCCEEDED', confirmedById: finance.userId, succeededAt: new Date(), receiptNumber: await nextDocumentNumber(tx, 'RCP'), notes: note ?? pay.notes }
        : { status: 'CANCELLED', confirmedById: finance.userId, failureReason: note ?? 'Rejected by finance' },
    });
    if (res.count !== 1) throw conflict('This cash entry was already processed');
    await tx.auditLog.create({ data: { actorUserId: finance.userId, action: approve ? 'payment.cash.confirmed' : 'payment.cash.rejected', entityType: 'payment', entityId: pay.id, after: { amount: pay.amount, note } } });
    const { invoice } = await recomputeInvoice(tx, pay.invoiceId);
    if (invoice.type === 'MEMBERSHIP' && invoice.subscriptionId && invoice.outstanding === 0) await activateSubscription(tx, invoice.subscriptionId);
    after(() => notifyPaymentChange(invoice));
    return invoice;
  });
}

export async function recordBankTransfer(finance: Principal, invoiceId: string, amount: number, reference: string) {
  return withTx(async (tx, after) => {
    const { invoice } = await recomputeInvoice(tx, invoiceId);
    if (amount <= 0 || amount > invoice.outstanding) throw badRequest(`Amount must not exceed outstanding ${formatInr(invoice.outstanding)}`);
    await tx.payment.create({
      data: { invoiceId, method: 'BANK_TRANSFER', provider: 'MANUAL', status: 'SUCCEEDED', amount, idempotencyKey: `bank:${reference}`, confirmedById: finance.userId, initiatedById: finance.userId, succeededAt: new Date(), receiptNumber: await nextDocumentNumber(tx, 'RCP'), notes: `Bank ref ${reference}` },
    });
    await tx.auditLog.create({ data: { actorUserId: finance.userId, action: 'payment.bank_transfer', entityType: 'invoice', entityId: invoiceId, after: { amount, reference } } });
    const r = await recomputeInvoice(tx, invoiceId);
    if (r.invoice.type === 'MEMBERSHIP' && r.invoice.subscriptionId && r.invoice.outstanding === 0) await activateSubscription(tx, r.invoice.subscriptionId);
    after(() => notifyPaymentChange(r.invoice));
    return r.invoice;
  });
}

// ─── Refunds ─────────────────────────────────────────────────────────

export async function requestRefund(p: Principal, invoiceId: string, input: { amount: number; reason: string; paymentId?: string }) {
  return withTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "invoices" WHERE id = ${invoiceId} FOR UPDATE`;
    const { ledger } = await recomputeInvoice(tx, invoiceId);
    const max = refundableAmount(ledger);
    if (input.amount <= 0 || input.amount > max) throw badRequest(`Refund amount must be between ₹0.01 and ${formatInr(max)}`);
    const pay = input.paymentId
      ? await tx.payment.findFirst({ where: { id: input.paymentId, invoiceId, status: 'SUCCEEDED' } })
      : await tx.payment.findFirst({ where: { invoiceId, status: 'SUCCEEDED' }, orderBy: { amount: 'desc' } });
    if (!pay) throw unprocessable('No successful payment to refund');
    const r = await tx.refund.create({ data: { invoiceId, paymentId: pay.id, amount: input.amount, status: 'REQUESTED', reason: input.reason, idempotencyKey: `refund:${randomToken(12)}`, requestedById: p.userId, isSandbox: pay.isSandbox } });
    await recomputeInvoice(tx, invoiceId);
    return r;
  });
}

/**
 * Approve or reject a refund. Approval issues a credit note for the refunded value (keeping the
 * invoice's tax position correct) and submits the refund to the gateway, or — for cash/bank
 * payments — records the manual refund reference.
 */
export async function decideRefund(finance: Principal, refundId: string, input: { approve: boolean; note: string; manualReference?: string; issueCreditNote?: boolean }) {
  const r0 = await prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true, invoice: true } });
  if (!r0) throw notFound('Refund');
  await withTx(async (tx) => {
    const res = await tx.refund.updateMany({ where: { id: r0.id, status: 'REQUESTED' }, data: input.approve ? { status: 'APPROVED', approvedById: finance.userId } : { status: 'REJECTED', approvedById: finance.userId, failureReason: input.note } });
    if (res.count !== 1) throw conflict('Refund already processed');
    if (input.approve && input.issueCreditNote !== false) await createCreditNoteTx(tx, finance.userId, r0.invoiceId, r0.amount, `Refund: ${r0.reason}`);
    if (input.approve && r0.payment && r0.payment.method !== 'ONLINE') {
      if (!input.manualReference) throw badRequest('Provide the bank/cash refund reference for non-online payments');
      await tx.refund.update({ where: { id: r0.id }, data: { status: 'SUCCEEDED', processedAt: new Date(), providerRefundId: `manual:${input.manualReference}` } });
    }
    await tx.auditLog.create({ data: { actorUserId: finance.userId, action: input.approve ? 'refund.approved' : 'refund.rejected', entityType: 'refund', entityId: r0.id, after: { note: input.note, amount: r0.amount } } });
    await recomputeInvoice(tx, r0.invoiceId);
  });
  if (input.approve && r0.payment?.method === 'ONLINE') await submitRefundToGateway(r0.id);
  return prisma.refund.findUniqueOrThrow({ where: { id: r0.id } });
}

/** Sends an approved refund to the gateway. Idempotent: the gateway call carries our idempotency key. */
export async function submitRefundToGateway(refundId: string) {
  const r = await prisma.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
  if (r.status !== 'APPROVED' || !r.payment?.providerPaymentId) return r;
  const claimed = await prisma.refund.updateMany({ where: { id: r.id, status: 'APPROVED' }, data: { status: 'PROCESSING' } });
  if (claimed.count !== 1) return r;
  const gw = r.payment.provider === 'SANDBOX' ? sandboxGateway : razorpayGateway;
  if (!gw) {
    await prisma.refund.update({ where: { id: r.id }, data: { status: 'FAILED', failureReason: 'Payment provider not configured' } });
    return r;
  }
  const out = await gw.createRefund({ paymentId: r.payment.providerPaymentId, amount: r.amount, idempotencyKey: r.idempotencyKey, notes: { refundId: r.id } });
  if (out.status === 'failed') {
    await prisma.refund.update({ where: { id: r.id }, data: { status: 'FAILED', failureReason: out.error ?? 'Gateway rejected refund' } });
  } else {
    await prisma.refund.update({ where: { id: r.id }, data: { providerRefundId: out.refundId, ...(out.status === 'processed' ? { status: 'SUCCEEDED', processedAt: new Date() } : {}) } });
    if (gw.isSandbox) await enqueue(prisma, 'payments.sandboxRefundSettle', { refundId: r.id }, { runAt: new Date(Date.now() + 3000), dedupeKey: `sbx-refund:${r.id}` });
  }
  await recomputeInvoice(prisma, r.invoiceId);
  return prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
}

registerJob<{ refundId: string }>('payments.sandboxRefundSettle', async ({ refundId }) => {
  const r = await prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
  if (!r || r.status !== 'PROCESSING' || !r.providerRefundId) return;
  const { raw, headers } = sandboxGateway.signEvent({ event: 'refund.processed', payload: { refund: { entity: { id: r.providerRefundId, payment_id: r.payment?.providerPaymentId ?? undefined, amount: r.amount } } } });
  await processWebhook(sandboxGateway, raw, headers);
});

/** Retry refunds that failed transiently (manual trigger from finance). */
export async function retryRefund(finance: Principal, refundId: string) {
  const r = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!r || r.status !== 'FAILED') throw conflict('Only failed refunds can be retried');
  await prisma.refund.update({ where: { id: r.id }, data: { status: 'APPROVED', failureReason: null } });
  await prisma.auditLog.create({ data: { actorUserId: finance.userId, action: 'refund.retry', entityType: 'refund', entityId: r.id } });
  return submitRefundToGateway(r.id);
}

// ─── Credit notes, write-offs, disputes ──────────────────────────────

async function createCreditNoteTx(tx: Tx, userId: string, invoiceId: string, amount: number, reason: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const credited = await tx.creditNote.aggregate({ where: { invoiceId }, _sum: { amount: true } });
  const maxCredit = inv.total - inv.passThroughTotal - (credited._sum.amount ?? 0);
  if (amount <= 0 || amount > maxCredit) throw badRequest(`Credit note cannot exceed ${formatInr(Math.max(0, maxCredit))}`);
  // Split GST-inclusive amount proportionally to the invoice's tax structure.
  const taxShare = inv.taxableValue + inv.taxTotal > 0 ? inv.taxTotal / (inv.taxableValue + inv.taxTotal) : 0;
  const taxAmount = Math.round(amount * taxShare);
  return tx.creditNote.create({ data: { number: await nextDocumentNumber(tx, 'CN'), invoiceId, amount, taxAmount, taxableAmount: amount - taxAmount, reason, issuedById: userId } });
}

export async function issueCreditNote(finance: Principal, invoiceId: string, amount: number, reason: string) {
  return withTx(async (tx, after) => {
    const cn = await createCreditNoteTx(tx, finance.userId, invoiceId, amount, reason);
    await tx.auditLog.create({ data: { actorUserId: finance.userId, action: 'credit_note.issued', entityType: 'invoice', entityId: invoiceId, after: { number: cn.number, amount, reason } } });
    const { invoice } = await recomputeInvoice(tx, invoiceId);
    after(() => notifyPaymentChange(invoice));
    return cn;
  });
}

export async function writeOff(finance: Principal, invoiceId: string, amount: number, reason: string) {
  return withTx(async (tx) => {
    const { invoice } = await recomputeInvoice(tx, invoiceId);
    if (amount <= 0 || amount > invoice.outstanding) throw badRequest(`Write-off cannot exceed outstanding ${formatInr(invoice.outstanding)}`);
    await tx.financialAdjustment.create({ data: { invoiceId, type: 'WRITE_OFF', amount, reason, createdById: finance.userId, approvedById: finance.userId } });
    await tx.auditLog.create({ data: { actorUserId: finance.userId, action: 'invoice.write_off', entityType: 'invoice', entityId: invoiceId, after: { amount, reason } } });
    return (await recomputeInvoice(tx, invoiceId)).invoice;
  });
}

export async function setInvoiceDispute(db: Db, invoiceId: string, disputed: boolean) {
  await db.invoice.update({ where: { id: invoiceId }, data: { disputed } });
  return recomputeInvoice(db, invoiceId);
}

// ─── Memberships ─────────────────────────────────────────────────────

export async function activateSubscription(tx: Db, subscriptionId: string) {
  const sub = await tx.membershipSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  if (sub.status !== 'PENDING_PAYMENT') return;
  const plan = sub.planSnapshot as { durationMonths: number; name: string };
  const startsAt = new Date();
  const endsAt = new Date(startsAt);
  endsAt.setMonth(endsAt.getMonth() + plan.durationMonths);
  await tx.membershipSubscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', startsAt, endsAt } });
  if (sub.userId) await notify(tx, sub.userId, { type: 'membership.active', title: `${plan.name} is active`, body: `Valid until ${endsAt.toDateString()}.`, data: { subscriptionId: sub.id } });
}

export async function createMembershipInvoice(tx: Tx, sub: { id: string; userId: string | null; fleetAccountId: string | null }, plan: { name: string; price: number; durationMonths: number }) {
  const bill = await billingFor(tx, sub.userId!, sub.fleetAccountId);
  const taxable = Math.round((plan.price * 10000) / 11800);
  const tax = plan.price - taxable;
  const now = new Date();
  const inv = await tx.invoice.create({
    data: {
      number: await nextDocumentNumber(tx, 'INV', now),
      type: 'MEMBERSHIP',
      subscriptionId: sub.id,
      customerUserId: sub.userId!,
      fleetAccountId: sub.fleetAccountId,
      billingName: bill.billingName,
      billingEmail: bill.billingEmail,
      billingPhone: bill.billingPhone,
      billingAddress: bill.billingAddress,
      billingGstin: bill.billingGstin,
      subtotal: taxable,
      discountTotal: 0,
      taxableValue: taxable,
      taxTotal: tax,
      passThroughTotal: 0,
      total: plan.price,
      outstanding: plan.price,
      issuedAt: now,
      dueAt: now,
      items: { create: [{ code: 'MEMBERSHIP', description: `${plan.name} (${plan.durationMonths} month${plan.durationMonths > 1 ? 's' : ''})`, quantity: 1, unitAmount: taxable, amount: taxable }] },
    },
  });
  await recomputeInvoice(tx, inv.id);
  return inv;
}

// ─── PDF ─────────────────────────────────────────────────────────────

export async function renderInvoicePdf(invoiceId: string): Promise<Buffer> {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { items: { orderBy: { sortOrder: 'asc' } }, payments: { where: { status: 'SUCCEEDED' } }, creditNotes: true, refunds: { where: { status: 'SUCCEEDED' } }, booking: { select: { code: true, vehicle: { select: { registrationNumber: true } } } } },
  });
  const s = await getSettings();
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const rs = (p: number) => `Rs. ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dt = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: s.locale.timezone, day: '2-digit', month: 'short', year: 'numeric' });

  if (inv.isSample) doc.save().fontSize(60).fillColor('#e5e7eb').rotate(-30, { origin: [300, 400] }).text('SAMPLE DATA', 80, 380).restore();
  doc.fillColor('#0f172a').fontSize(20).text(s.business.brandName, { continued: false });
  doc.fontSize(9).fillColor('#475569').text(s.business.legalName).text(s.business.address).text(`GSTIN: ${s.business.gstin || 'not configured'}  ·  ${s.business.supportPhone}  ·  ${s.business.supportEmail}`);
  doc.moveDown();
  doc.fillColor('#0f172a').fontSize(14).text(inv.type === 'SERVICE' ? 'TAX INVOICE' : inv.type === 'CANCELLATION' ? 'TAX INVOICE — CANCELLATION FEE' : 'TAX INVOICE — MEMBERSHIP');
  doc.fontSize(10).text(`Invoice no: ${inv.number}`).text(`Date: ${dt(inv.issuedAt)}${inv.dueAt && inv.dueAt > inv.issuedAt ? `   Due: ${dt(inv.dueAt)}` : ''}`);
  if (inv.booking) doc.text(`Booking: ${inv.booking.code}${inv.booking.vehicle ? `   Vehicle: ${inv.booking.vehicle.registrationNumber}` : ''}`);
  doc.moveDown(0.5).text(`Bill to: ${inv.billingName}`);
  if (inv.billingGstin) doc.text(`GSTIN: ${inv.billingGstin}`);
  if (inv.billingAddress) doc.text(inv.billingAddress);
  doc.moveDown();

  const col = { d: 48, q: 330, a: 470 };
  doc.fontSize(9).fillColor('#475569').text('Description', col.d, doc.y, { continued: false });
  const headerY = doc.y - 11;
  doc.text('Qty', col.q, headerY).text('Amount', col.a, headerY, { width: 80, align: 'right' });
  doc.moveTo(48, doc.y + 2).lineTo(547, doc.y + 2).strokeColor('#cbd5e1').stroke();
  doc.moveDown(0.5).fillColor('#0f172a');
  for (const it of inv.items) {
    const y = doc.y;
    doc.text(it.description + (it.isAdditional && it.reason ? ` — ${it.reason}` : ''), col.d, y, { width: 270 });
    const after = doc.y;
    doc.text(String(it.quantity), col.q, y).text(rs(it.amount), col.a, y, { width: 80, align: 'right' });
    doc.y = Math.max(after, y + 12);
  }
  doc.moveDown();
  const line = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 300, y).text(value, col.a, y, { width: 80, align: 'right' });
  };
  line('Service value', rs(inv.subtotal));
  if (inv.discountTotal) line('Discounts', `- ${rs(inv.discountTotal)}`);
  line('Taxable value', rs(inv.taxableValue));
  line('GST', rs(inv.taxTotal));
  if (inv.passThroughTotal) line('Tolls/parking (pass-through)', rs(inv.passThroughTotal));
  line('Invoice total', rs(inv.total), true);
  if (inv.amountCredited) line('Credit notes', `- ${rs(inv.amountCredited)}`);
  line('Paid', rs(inv.amountPaid));
  if (inv.amountRefunded) line('Refunded', rs(inv.amountRefunded));
  line('Outstanding', rs(inv.outstanding), true);
  doc.font('Helvetica').moveDown();
  if (inv.approvedQuoteTotal != null && inv.approvedQuoteTotal !== inv.total)
    doc.fontSize(9).fillColor('#475569').text(`Approved quote total was ${rs(inv.approvedQuoteTotal)}. Differences are itemised above with reasons.`, 48);
  if (inv.payments.length) {
    doc.moveDown().fontSize(9).fillColor('#0f172a').text('Payments', 48);
    for (const p of inv.payments) doc.fillColor('#475569').text(`${dt(p.succeededAt ?? p.createdAt)}  ${p.method}${p.isSandbox ? ' (SANDBOX — not real money)' : ''}  ${p.receiptNumber ?? ''}  ${rs(p.amount)}`);
  }
  doc.moveDown(2).fontSize(8).fillColor('#94a3b8').text('This is a computer-generated invoice. Tolls and parking are reimbursed at actuals and are not part of taxable value.', 48);
  doc.end();
  return done;
}
