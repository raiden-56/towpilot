import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, createStaff, drainJobs, loginCustomer, resetDb } from '../helpers.js';
import { prisma } from '../../src/lib/prisma.js';
import { sandboxGateway } from '../../src/integrations/payments.js';
import { recomputeInvoice } from '../../src/modules/billing/service.js';

async function makeInvoice(customerId: string, total = 118000) {
  const inv = await prisma.invoice.create({
    data: { number: `INV/TEST/${Math.random().toString(36).slice(2, 8)}`, type: 'SERVICE', customerUserId: customerId, billingName: 'T', subtotal: 100000, discountTotal: 0, taxableValue: 100000, taxTotal: 18000, passThroughTotal: total - 118000, total, outstanding: total },
  });
  await recomputeInvoice(prisma, inv.id);
  return inv;
}

async function payOnline(token: string, invoiceId: string, key: string, amount?: number) {
  const o = await api().post(`/api/v1/invoices/${invoiceId}/pay`).set(bearer(token)).set('Idempotency-Key', key).send(amount ? { amount } : {}).expect(201);
  return o.body.data as { paymentId: string; orderId: string; amount: number };
}

describe('payments, webhooks and refunds', () => {
  let c: Awaited<ReturnType<typeof loginCustomer>>;
  let finance: string;
  beforeAll(async () => {
    await resetDb();
    c = await loginCustomer('Payer');
    finance = await createStaff('finance');
  });

  it('supports partial payments with an accurate outstanding balance', async () => {
    const inv = await makeInvoice(c.user.id);
    const p1 = await payOnline(c.token, inv.id, 'partial-0001', 500);
    expect(p1.amount).toBe(50000);
    await api().post(`/api/v1/payments/${p1.paymentId}/sandbox-complete`).set(bearer(c.token)).send({ outcome: 'success' }).expect(200);
    let i = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(i.paymentStatus).toBe('PARTIALLY_PAID');
    expect(i.outstanding).toBe(68000);
    await api().post(`/api/v1/invoices/${inv.id}/pay`).set(bearer(c.token)).set('Idempotency-Key', 'partial-0002').send({ amount: 1000 }).expect(400); // more than due
    const p2 = await payOnline(c.token, inv.id, 'partial-0003');
    await api().post(`/api/v1/payments/${p2.paymentId}/sandbox-complete`).set(bearer(c.token)).send({ outcome: 'success' }).expect(200);
    i = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(i.paymentStatus).toBe('PAID');
    expect(i.outstanding).toBe(0);
  });

  it('a failed payment never marks the invoice paid', async () => {
    const inv = await makeInvoice(c.user.id);
    const p = await payOnline(c.token, inv.id, 'fail-0001');
    await api().post(`/api/v1/payments/${p.paymentId}/sandbox-complete`).set(bearer(c.token)).send({ outcome: 'failure' }).expect(200);
    const i = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(i.paymentStatus).toBe('PAYMENT_FAILED');
    expect(i.amountPaid).toBe(0);
  });

  it('duplicate webhook deliveries are processed once; forged signatures are rejected', async () => {
    const inv = await makeInvoice(c.user.id);
    const p = await payOnline(c.token, inv.id, 'dup-0001');
    const { raw, headers } = sandboxGateway.signEvent({ event: 'payment.captured', payload: { payment: { entity: { id: 'sbx_pay_dup', order_id: p.orderId, amount: p.amount, fee: 100, tax: 18 } } } });
    const send = (body: Buffer, h: Record<string, string>) => api().post('/api/v1/webhooks/payments/sandbox').set(h).set('content-type', 'application/json').send(body.toString('utf8'));
    await send(raw, headers).expect(200);
    const dup = await send(raw, headers).expect(200);
    expect(dup.body.data.status).toBe('duplicate');
    expect(await prisma.payment.count({ where: { invoiceId: inv.id, status: 'SUCCEEDED' } })).toBe(1);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid).toBe(p.amount);

    const forged = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'x', order_id: p.orderId, amount: 1 } } } }));
    await send(forged, { 'x-sandbox-signature': 'bad', 'x-sandbox-event-id': 'evt-forged' }).expect(401);
  });

  it('refunds: approval issues a credit note, settles via webhook, and can never exceed what was paid', async () => {
    const inv = await makeInvoice(c.user.id);
    const p = await payOnline(c.token, inv.id, 'refund-0001');
    await api().post(`/api/v1/payments/${p.paymentId}/sandbox-complete`).set(bearer(c.token)).send({ outcome: 'success' }).expect(200);

    const req1 = await api().post(`/api/v1/invoices/${inv.id}/refund-request`).set(bearer(c.token)).send({ amount: 300, reason: 'Driver arrived 40 minutes late' }).expect(201);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paymentStatus).toBe('REFUND_PENDING');
    // Cannot request more than remains refundable while one is pending.
    await api().post(`/api/v1/invoices/${inv.id}/refund-request`).set(bearer(c.token)).send({ amount: 1000, reason: 'Trying to over-refund the invoice' }).expect(400);

    await api().post(`/api/v1/admin/finance/refunds/${req1.body.data.refund.id}/decision`).set(bearer(finance)).send({ approve: true, note: 'Late arrival goodwill' }).expect(200);
    // Approving twice is rejected.
    await api().post(`/api/v1/admin/finance/refunds/${req1.body.data.refund.id}/decision`).set(bearer(finance)).send({ approve: true, note: 'again' }).expect(409);
    await new Promise((r) => setTimeout(r, 3200));
    await drainJobs();
    const r = await prisma.refund.findUniqueOrThrow({ where: { id: req1.body.data.refund.id } });
    expect(r.status).toBe('SUCCEEDED');
    const i = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(i.amountRefunded).toBe(30000);
    expect(i.amountCredited).toBe(30000);
    expect(i.outstanding).toBe(0);
    expect(i.paymentStatus).toBe('PARTIALLY_REFUNDED');
    const cn = await prisma.creditNote.findFirstOrThrow({ where: { invoiceId: inv.id } });
    expect(cn.taxAmount + cn.taxableAmount).toBe(30000);
  });

  it('field cash collections count as paid only after finance confirms', async () => {
    const inv = await makeInvoice(c.user.id);
    const { recordCashCollection } = await import('../../src/modules/billing/service.js');
    const pay = await recordCashCollection(c.user.id, inv.id, 118000, 'test');
    let i = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(i.amountPaid).toBe(0);
    expect(i.amountPendingCash).toBe(118000);
    await api().post(`/api/v1/admin/finance/payments/${pay.id}/cash-decision`).set(bearer(finance)).send({ approve: true }).expect(200);
    i = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(i.paymentStatus).toBe('PAID');
    expect(i.amountPendingCash).toBe(0);
  });

  it('customers cannot pay or view invoices that are not theirs', async () => {
    const other = await loginCustomer('Other');
    const inv = await makeInvoice(c.user.id);
    await api().get(`/api/v1/invoices/${inv.id}`).set(bearer(other.token)).expect(404);
    await api().post(`/api/v1/invoices/${inv.id}/pay`).set(bearer(other.token)).set('Idempotency-Key', 'other-0001').send({}).expect(404);
  });
});
