import { beforeAll, describe, expect, it } from 'vitest';
import { addVehicle, api, bearer, bookingPayload, createDriver, createPricingFixtures, createStaff, drainJobs, loginCustomer, resetDb, TINY_JPEG } from '../helpers.js';
import { prisma } from '../../src/lib/prisma.js';

/**
 * End-to-end business flow through the HTTP API against a real PostgreSQL database:
 * customer requests a tow → quote → confirm → auto-dispatch → driver accepts → tracking →
 * recovery workflow with OTP custody and evidence → invoice → verified payment →
 * history and financial reports reflect it.
 */
describe('end-to-end towing job', () => {
  let fx: Awaited<ReturnType<typeof createPricingFixtures>>;
  let customer: Awaited<ReturnType<typeof loginCustomer>>;
  let driver: Awaited<ReturnType<typeof createDriver>>;
  let adminToken: string;
  let bookingId: string;
  let invoiceId: string;

  beforeAll(async () => {
    await resetDb();
    fx = await createPricingFixtures();
    customer = await loginCustomer('Flow Customer');
    driver = await createDriver(fx.zone.id);
    adminToken = await createStaff('admin');
  });

  it('customer only sees services enabled for their zone', async () => {
    const r = await api().get('/api/v1/catalog/services?lat=12.97&lng=77.59').expect(200);
    expect(r.body.data.zone.name).toBe('Test Zone');
    const outside = await api().get('/api/v1/catalog/services?lat=28.6&lng=77.2').expect(200);
    expect(outside.body.data.outsideServiceArea).toBe(true);
  });

  it('creates a booking with a transparent, snapshot quote', async () => {
    const v = await addVehicle(customer.token);
    const r = await api().post('/api/v1/bookings').set(bearer(customer.token)).send(bookingPayload(fx.car.id, v.id, { clientRequestId: 'flow-req-0001' })).expect(201);
    const b = r.body.data;
    bookingId = b.id;
    expect(b.status).toBe('QUOTED');
    expect(b.code).toMatch(/^TP-\d{6}-\d{4}$/);
    const q = b.quotes[0];
    expect(q.status).toBe('PENDING_CUSTOMER_APPROVAL');
    expect(q.items.find((i: { code: string }) => i.code === 'BASE').amount).toBe(150000);
    expect(q.total).toBe(q.taxableValue + q.taxTotal + q.passThroughTotal);
    expect(q.pricingSnapshot.rules.version).toBe(1);
    expect(b.pickupOtp).toMatch(/^\d{4}$/); // customer sees their own codes
    // Idempotent retry returns the same booking.
    const again = await api().post('/api/v1/bookings').set(bearer(customer.token)).send(bookingPayload(fx.car.id, v.id, { clientRequestId: 'flow-req-0001' })).expect(201);
    expect(again.body.data.id).toBe(bookingId);
  });

  it('confirms the quote and auto-dispatches to the eligible driver', async () => {
    const b = (await api().get(`/api/v1/bookings/${bookingId}`).set(bearer(customer.token)).expect(200)).body.data;
    await api().post(`/api/v1/bookings/${bookingId}/confirm`).set(bearer(customer.token)).send({ quoteId: b.pendingQuoteId }).expect(200);
    await drainJobs();
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(after.status).toBe('ASSIGNED');
    const offers = (await api().get('/api/v1/driver/offers').set(bearer(driver.token)).expect(200)).body.data;
    expect(offers).toHaveLength(1);
    // Offered driver sees only an approximate pickup area and no customer contact.
    expect(offers[0].booking.pickupArea.approximate).toBe(true);
    expect(offers[0].booking.pickup).toBeUndefined();
    expect(offers[0].booking.customer).toBeUndefined();
  });

  it('rejects a second request for a vehicle with a confirmed booking', async () => {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const r = await api().post('/api/v1/bookings').set(bearer(customer.token)).send(bookingPayload(fx.car.id, b.vehicleId!)).expect(409);
    expect(r.body.error.details.bookingId).toBe(bookingId);
  });

  it('driver accepts; customer sees driver, truck and ETA', async () => {
    const offer = await prisma.bookingAssignment.findFirstOrThrow({ where: { bookingId, status: 'OFFERED' } });
    const r = await api().post(`/api/v1/driver/offers/${offer.id}/accept`).set(bearer(driver.token)).expect(200);
    expect(r.body.data.status).toBe('ACCEPTED');
    expect(r.body.data.customer.phone).toBeTruthy();
    expect(r.body.data.pickupOtp).toBeUndefined(); // drivers never see OTP values
    const c = (await api().get(`/api/v1/bookings/${bookingId}`).set(bearer(customer.token)).expect(200)).body.data;
    expect(c.driver.name).toBe(driver.user.fullName);
    expect(c.driver.verified).toBe(true);
    expect(c.driver.truck.registrationNumber).toBe(driver.truck.registrationNumber);
    expect(c.etaAt).toBeTruthy();
    expect((await prisma.towTruck.findUniqueOrThrow({ where: { id: driver.truck.id } })).status).toBe('IN_USE');
  });

  it('live location updates are visible to the customer and stored as tracking events', async () => {
    await api().post('/api/v1/driver/jobs/' + bookingId + '/transition').set(bearer(driver.token)).send({ to: 'EN_ROUTE' }).expect(200);
    await api().post('/api/v1/driver/location').set(bearer(driver.token)).send({ points: [{ lat: 12.975, lng: 77.598, accuracyM: 10, recordedAt: new Date().toISOString() }] }).expect(200);
    const t = (await api().get(`/api/v1/bookings/${bookingId}/tracking`).set(bearer(customer.token)).expect(200)).body.data;
    expect(t.driverLocation.lat).toBeCloseTo(12.975);
    expect(await prisma.trackingEvent.count({ where: { bookingId } })).toBe(1);
  });

  it('enforces the recovery checklist: OTP before inspection, evidence before authorisation', async () => {
    const tr = (to: string, reason?: string) => api().post(`/api/v1/driver/jobs/${bookingId}/transition`).set(bearer(driver.token)).send({ to, reason });
    await tr('ARRIVED').expect(200);
    await tr('INSPECTING').expect(422); // pickup code not verified
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    await api().post(`/api/v1/driver/jobs/${bookingId}/verify-pickup`).set(bearer(driver.token)).send({ code: b.pickupOtp === '0000' ? '1111' : '0000' }).expect(400);
    await api().post(`/api/v1/driver/jobs/${bookingId}/verify-pickup`).set(bearer(driver.token)).send({ code: b.pickupOtp }).expect(200);
    await tr('INSPECTING').expect(200);
    await tr('RECOVERY_AUTHORIZED').expect(422); // no pickup condition report yet

    const up = await api().post(`/api/v1/driver/jobs/${bookingId}/attachments`).set(bearer(driver.token)).field('kind', 'PICKUP_EVIDENCE').attach('files', TINY_JPEG, { filename: 'pickup.jpg', contentType: 'image/jpeg' }).expect(201);
    // Spoofed file types are rejected by magic-byte sniffing.
    await api().post(`/api/v1/driver/jobs/${bookingId}/attachments`).set(bearer(driver.token)).field('kind', 'PICKUP_EVIDENCE').attach('files', Buffer.from('MZ fake exe'), { filename: 'x.jpg', contentType: 'image/jpeg' }).expect(400);
    await api().post(`/api/v1/driver/jobs/${bookingId}/condition-reports`).set(bearer(driver.token)).send({ stage: 'PICKUP', damageMarks: [{ area: 'Rear bumper', description: 'Scratch' }], attachmentIds: [up.body.data[0].id], fuelLevel: 'Half' }).expect(201);
    await tr('RECOVERY_AUTHORIZED').expect(200);
  });

  it('extra work needs customer approval before it can be charged', async () => {
    const rev = await api().post(`/api/v1/driver/jobs/${bookingId}/quote-revision`).set(bearer(driver.token)).send({ reason: 'Vehicle in gear and steering locked', items: [{ description: 'Steering lock release', amount: 500, reason: 'Steering lock engaged' }] }).expect(201);
    await api().post(`/api/v1/driver/jobs/${bookingId}/transition`).set(bearer(driver.token)).send({ to: 'LOADING' }).expect(200);
    const c = (await api().get(`/api/v1/bookings/${bookingId}`).set(bearer(customer.token)).expect(200)).body.data;
    expect(c.pendingQuoteId).toBe(rev.body.data.id);
    await api().post(`/api/v1/bookings/${bookingId}/quotes/${rev.body.data.id}/decision`).set(bearer(customer.token)).send({ approve: true }).expect(200);
    const approved = await prisma.bookingQuote.findFirstOrThrow({ where: { bookingId, status: 'APPROVED' } });
    expect(approved.id).toBe(rev.body.data.id);
    expect(approved.total - rev.body.data.total).toBe(0);
  });

  it('handover requires delivery evidence and the handover code', async () => {
    const tr = (to: string) => api().post(`/api/v1/driver/jobs/${bookingId}/transition`).set(bearer(driver.token)).send({ to });
    await tr('IN_TRANSIT').expect(200);
    await tr('DELIVERED').expect(422);
    const up = await api().post(`/api/v1/driver/jobs/${bookingId}/attachments`).set(bearer(driver.token)).field('kind', 'DELIVERY_EVIDENCE').attach('files', TINY_JPEG, { filename: 'drop.jpg', contentType: 'image/jpeg' }).expect(201);
    await api().post(`/api/v1/driver/jobs/${bookingId}/condition-reports`).set(bearer(driver.token)).send({ stage: 'DELIVERY', attachmentIds: [up.body.data[0].id] }).expect(201);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    await api().post(`/api/v1/driver/jobs/${bookingId}/handover`).set(bearer(driver.token)).send({ code: b.handoverOtp, recipientName: 'Garage Supervisor', recipientRelation: 'Garage' }).expect(200);
    await tr('DELIVERED').expect(200);
  });

  it('closing the job issues an invoice from the frozen quote and releases driver and truck', async () => {
    // Change the live rate card: historic invoices must not be affected.
    await prisma.rateCard.update({ where: { id: fx.carCard.id }, data: { baseFee: 999999 } });
    const r = await api().post(`/api/v1/driver/jobs/${bookingId}/close`).set(bearer(driver.token)).send({ tolls: 0, parking: 0, odometerKm: 12345 }).expect(200);
    invoiceId = r.body.data.invoiceId;
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true } });
    expect(inv.items.find((i) => i.code === 'BASE')!.amount).toBe(150000);
    expect(inv.items.some((i) => i.isAdditional && i.amount === 50000)).toBe(true);
    expect(inv.number).toMatch(/^INV\/\d{4}-\d{2}\/\d{6}$/);
    expect(inv.outstanding).toBe(inv.total);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b.status).toBe('COMPLETED');
    expect((await prisma.driverAvailability.findUniqueOrThrow({ where: { userId: driver.user.id } })).status).toBe('AVAILABLE');
    expect((await prisma.towTruck.findUniqueOrThrow({ where: { id: driver.truck.id } })).status).toBe('AVAILABLE');
    const earning = await prisma.driverEarning.findFirstOrThrow({ where: { bookingId, userId: driver.user.id } });
    expect(earning.amount).toBe(Math.round(inv.taxableValue * 0.25));
    // Duplicate close is rejected; no second invoice.
    await api().post(`/api/v1/driver/jobs/${bookingId}/close`).set(bearer(driver.token)).send({ tolls: 0, parking: 0 }).expect(409);
    expect(await prisma.invoice.count({ where: { bookingId } })).toBe(1);
  });

  it('payment is confirmed only by the verified (sandbox) webhook', async () => {
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const order = await api().post(`/api/v1/invoices/${invoiceId}/pay`).set(bearer(customer.token)).set('Idempotency-Key', 'pay-flow-0001').send({}).expect(201);
    expect(order.body.data.sandbox).toBe(true);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).paymentStatus).toBe('PAYMENT_PENDING');
    // Same idempotency key → same order, no duplicate payment row.
    const again = await api().post(`/api/v1/invoices/${invoiceId}/pay`).set(bearer(customer.token)).set('Idempotency-Key', 'pay-flow-0001').send({}).expect(201);
    expect(again.body.data.paymentId).toBe(order.body.data.paymentId);
    await api().post(`/api/v1/payments/${order.body.data.paymentId}/sandbox-complete`).set(bearer(customer.token)).send({ outcome: 'success' }).expect(200);
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(paid.paymentStatus).toBe('PAID');
    expect(paid.amountPaid).toBe(inv.total);
    expect(paid.outstanding).toBe(0);
    expect(await prisma.paymentWebhookEvent.count({ where: { status: 'PROCESSED' } })).toBe(1);
  });

  it('booking appears in customer history and admin analytics reconcile with records', async () => {
    const hist = (await api().get('/api/v1/bookings?group=completed').set(bearer(customer.token)).expect(200)).body.data;
    expect(hist.map((b: { id: string }) => b.id)).toContain(bookingId);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const pay = await prisma.payment.findFirstOrThrow({ where: { invoiceId, status: 'SUCCEEDED' } });
    const earning = await prisma.driverEarning.findFirstOrThrow({ where: { bookingId } });
    const fin = (await api().get('/api/v1/admin/reports/financial?period=today&compare=false').set(bearer(adminToken)).expect(200)).body.data.current;
    expect(fin.operating.recognizedRevenue).toBe(inv.taxableValue);
    expect(fin.operating.taxesCollected).toBe(inv.taxTotal);
    expect(fin.operating.driverEarnings).toBe(earning.amount);
    expect(fin.operating.gatewayFees).toBe(pay.gatewayFee);
    expect(fin.operating.operatingProfit).toBe(inv.taxableValue - earning.amount - pay.gatewayFee);
    expect(fin.cashFlow.onlineReceived).toBe(inv.total);
    expect(fin.receivables.amount).toBe(0);
    expect(fin.completedBookings).toBe(1);
    const kpis = (await api().get('/api/v1/admin/reports/overview?period=today').set(bearer(adminToken)).expect(200)).body.data.kpis;
    expect(kpis.find((k: { key: string }) => k.key === 'completedToday').value).toBe(1);
    // Custody report and invoice PDF render.
    const pdf = await api().get(`/api/v1/bookings/${bookingId}/custody-report`).set(bearer(customer.token)).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await api().get(`/api/v1/invoices/${invoiceId}/pdf`).set(bearer(customer.token)).expect(200);
  });

  it('customer can rate the completed job once', async () => {
    await api().post(`/api/v1/bookings/${bookingId}/rating`).set(bearer(customer.token)).send({ score: 5, comment: 'Great' }).expect(201);
    await api().post(`/api/v1/bookings/${bookingId}/rating`).set(bearer(customer.token)).send({ score: 4 }).expect(409);
  });
});
