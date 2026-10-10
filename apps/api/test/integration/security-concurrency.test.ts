import { beforeAll, describe, expect, it } from 'vitest';
import { addVehicle, api, bearer, bookingPayload, createDriver, createPricingFixtures, createStaff, drainJobs, loginCustomer, resetDb } from '../helpers.js';
import { prisma } from '../../src/lib/prisma.js';
import { invalidateSettings } from '../../src/lib/settings.js';

async function confirmedBooking(token: string, categoryId: string, vehicleOverrides: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) {
  const v = await addVehicle(token, vehicleOverrides);
  const b = (await api().post('/api/v1/bookings').set(bearer(token)).send(bookingPayload(categoryId, v.id, payload)).expect(201)).body.data;
  await api().post(`/api/v1/bookings/${b.id}/confirm`).set(bearer(token)).send({ quoteId: b.pendingQuoteId }).expect(200);
  return b.id as string;
}

describe('authorization boundaries', () => {
  let fx: Awaited<ReturnType<typeof createPricingFixtures>>;
  beforeAll(async () => {
    await resetDb();
    fx = await createPricingFixtures();
  });

  it("customers cannot see other customers' bookings or invoices", async () => {
    const a = await loginCustomer('Customer A');
    const b = await loginCustomer('Customer B');
    const v = await addVehicle(a.token);
    const booking = (await api().post('/api/v1/bookings').set(bearer(a.token)).send(bookingPayload(fx.car.id, v.id)).expect(201)).body.data;
    await api().get(`/api/v1/bookings/${booking.id}`).set(bearer(b.token)).expect(404);
    await api().post(`/api/v1/bookings/${booking.id}/cancel`).set(bearer(b.token)).send({ reason: 'not mine' }).expect(404);
    const list = (await api().get('/api/v1/bookings').set(bearer(b.token)).expect(200)).body.data;
    expect(list).toHaveLength(0);
    await api().patch(`/api/v1/vehicles/${v.id}`).set(bearer(b.token)).send({ color: 'Red' }).expect(404);
  });

  it('customers and drivers cannot use admin, finance or dispatch APIs', async () => {
    const c = await loginCustomer();
    const d = await createDriver(fx.zone.id);
    for (const t of [c.token, d.token]) {
      await api().get('/api/v1/admin/finance/invoices').set(bearer(t)).expect(403);
      await api().get('/api/v1/admin/employees').set(bearer(t)).expect(403);
      await api().get('/api/v1/dispatch/board').set(bearer(t)).expect(403);
      await api().put('/api/v1/admin/system/settings/dispatch').set(bearer(t)).send({ autoDispatch: false }).expect(403);
    }
    await api().get('/api/v1/driver/me').set(bearer(c.token)).expect(403);
  });

  it('dispatchers cannot access finance; finance cannot change settings', async () => {
    const dispatcher = await createStaff('dispatcher');
    const finance = await createStaff('finance');
    await api().get('/api/v1/dispatch/board').set(bearer(dispatcher)).expect(200);
    await api().get('/api/v1/admin/finance/invoices').set(bearer(dispatcher)).expect(403);
    await api().get('/api/v1/admin/finance/invoices').set(bearer(finance)).expect(200);
    await api().put('/api/v1/admin/system/settings/dispatch').set(bearer(finance)).send({ autoDispatch: false }).expect(403);
  });

  it('ordinary drivers cannot see other workers’ earnings', async () => {
    const d1 = await createDriver(fx.zone.id);
    const d2 = await createDriver(fx.zone.id);
    await prisma.driverEarning.create({ data: { userId: d2.user.id, kind: 'INCENTIVE', amount: 5000 } });
    const mine = (await api().get('/api/v1/driver/earnings').set(bearer(d1.token)).expect(200)).body.data;
    expect(mine.lines).toHaveLength(0);
    await api().get(`/api/v1/admin/employees/${d2.user.id}`).set(bearer(d1.token)).expect(403);
  });

  it('share links expose only limited tracking data and expire', async () => {
    const c = await loginCustomer();
    const id = await confirmedBooking(c.token, fx.car.id);
    const link = (await api().post(`/api/v1/bookings/${id}/share-links`).set(bearer(c.token)).send({ hours: 1 }).expect(201)).body.data;
    const token = link.url.split('/track/')[1];
    const pub = (await api().get(`/api/v1/public/track/${token}`).expect(200)).body.data;
    expect(pub.status).toBeTruthy();
    expect(JSON.stringify(pub)).not.toMatch(/Otp|contactPhone|"phone"|total/);
    expect(pub.pickupArea.lat).toBe(Math.round(pub.pickupArea.lat * 100) / 100); // coarsened
    await prisma.bookingShareLink.updateMany({ where: { bookingId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await api().get(`/api/v1/public/track/${token}`).expect(404);
  });

  it('a new request supersedes an unconfirmed quote for the same vehicle', async () => {
    const c = await loginCustomer('Changed Mind');
    const v = await addVehicle(c.token);
    const first = (await api().post('/api/v1/bookings').set(bearer(c.token)).send(bookingPayload(fx.car.id, v.id)).expect(201)).body.data;
    const second = (await api().post('/api/v1/bookings').set(bearer(c.token)).send(bookingPayload(fx.car.id, v.id)).expect(201)).body.data;
    expect(second.id).not.toBe(first.id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('CANCELLED');
  });

  it('private files require a valid signature', async () => {
    await api().get('/api/v1/public/files/bookings/x/a.jpg').expect(404);
    await api().get('/api/v1/public/files/bookings/x/a.jpg?exp=9999999999&sig=deadbeef').expect(404);
  });
});

describe('dispatch concurrency and failure handling', () => {
  let fx: Awaited<ReturnType<typeof createPricingFixtures>>;
  beforeAll(async () => {
    await resetDb();
    fx = await createPricingFixtures();
  });

  it('a single driver can never hold two live assignments, even under concurrent dispatch', async () => {
    const d = await createDriver(fx.zone.id);
    const c1 = await loginCustomer();
    const c2 = await loginCustomer();
    // Disable auto dispatch so the dispatchers race manually.
    await prisma.applicationSetting.upsert({ where: { key: 'dispatch' }, create: { key: 'dispatch', value: { autoDispatch: false } }, update: { value: { autoDispatch: false } } });
    invalidateSettings();
    const b1 = await confirmedBooking(c1.token, fx.car.id);
    const b2 = await confirmedBooking(c2.token, fx.car.id);
    const disp1 = await createStaff('dispatcher');
    const disp2 = await createStaff('dispatcher');
    const results = await Promise.all([
      api().post(`/api/v1/dispatch/bookings/${b1}/assign`).set(bearer(disp1)).send({ driverUserId: d.user.id }),
      api().post(`/api/v1/dispatch/bookings/${b2}/assign`).set(bearer(disp2)).send({ driverUserId: d.user.id }),
    ]);
    // The loser is rejected either by the eligibility check (422) or the database guard (409).
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect([409, 422]).toContain(results.find((r) => r.status !== 200)!.status);
    expect(await prisma.bookingAssignment.count({ where: { driverUserId: d.user.id, status: { in: ['OFFERED', 'ACCEPTED'] } } })).toBe(1);
  });

  it('two dispatchers assigning the same booking at once: exactly one wins', async () => {
    const dA = await createDriver(fx.zone.id);
    const dB = await createDriver(fx.zone.id);
    const c = await loginCustomer();
    const b = await confirmedBooking(c.token, fx.car.id);
    const disp = await createStaff('dispatcher');
    const results = await Promise.all([
      api().post(`/api/v1/dispatch/bookings/${b}/assign`).set(bearer(disp)).send({ driverUserId: dA.user.id }),
      api().post(`/api/v1/dispatch/bookings/${b}/assign`).set(bearer(disp)).send({ driverUserId: dB.user.id }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.bookingAssignment.count({ where: { bookingId: b, status: 'OFFERED' } })).toBe(1);
  });

  it('accepting an offer twice concurrently succeeds once', async () => {
    const d = await createDriver(fx.zone.id);
    const c = await loginCustomer();
    const b = await confirmedBooking(c.token, fx.car.id);
    const disp = await createStaff('dispatcher');
    await api().post(`/api/v1/dispatch/bookings/${b}/assign`).set(bearer(disp)).send({ driverUserId: d.user.id }).expect(200);
    const offer = await prisma.bookingAssignment.findFirstOrThrow({ where: { bookingId: b, status: 'OFFERED' } });
    const rs = await Promise.all([api().post(`/api/v1/driver/offers/${offer.id}/accept`).set(bearer(d.token)), api().post(`/api/v1/driver/offers/${offer.id}/accept`).set(bearer(d.token))]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('driver rejection leads to re-dispatch; no eligible provider is reported honestly', async () => {
    await prisma.applicationSetting.update({ where: { key: 'dispatch' }, data: { value: { autoDispatch: true, maxAutoAttempts: 1 } } });
    invalidateSettings();
    await prisma.driverAvailability.updateMany({ data: { status: 'OFF_DUTY' } });
    const d = await createDriver(fx.zone.id);
    const c = await loginCustomer();
    const b = await confirmedBooking(c.token, fx.car.id);
    await drainJobs();
    const offer = await prisma.bookingAssignment.findFirstOrThrow({ where: { bookingId: b, status: 'OFFERED' } });
    expect(offer.driverUserId).toBe(d.user.id);
    await api().post(`/api/v1/driver/offers/${offer.id}/reject`).set(bearer(d.token)).send({ reason: 'Truck tyre puncture' }).expect(200);
    await drainJobs();
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b } });
    // The only driver declined → nobody is assigned and the customer is told so.
    expect(booking.status).toBe('REASSIGNMENT_REQUIRED');
    expect(await prisma.bookingAssignment.count({ where: { bookingId: b, status: { in: ['OFFERED', 'ACCEPTED'] } } })).toBe(0);
    expect(await prisma.escalation.count({ where: { bookingId: b, type: { in: ['DRIVER_REJECTED', 'NO_PROVIDER'] } } })).toBeGreaterThanOrEqual(2);
    const note = await prisma.notification.findFirst({ where: { userId: c.user.id, type: 'booking.delay' } });
    expect(note?.body).toMatch(/No provider is free/);
  });

  it('unsafe conditions require a manual review before any dispatch', async () => {
    const c = await loginCustomer();
    const b = await confirmedBooking(c.token, fx.car.id, {}, { assessment: { ...bookingPayload('', '').assessment, isOverturned: 'YES' } });
    await drainJobs();
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b } });
    expect(booking.requiresManualReview).toBe(true);
    expect(booking.status).toBe('CONFIRMED');
    expect(await prisma.bookingAssignment.count({ where: { bookingId: b } })).toBe(0);
    const disp = await createStaff('dispatcher');
    const d = await createDriver(fx.zone.id);
    await api().post(`/api/v1/dispatch/bookings/${b}/assign`).set(bearer(disp)).send({ driverUserId: d.user.id }).expect(422);
    await api().post(`/api/v1/dispatch/bookings/${b}/review`).set(bearer(disp)).send({ approve: true, notes: 'Called customer: vehicle on its side in a parking lot, no injuries. Send 3 crew.', crew: 3 }).expect(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b } })).status).toBe('SEARCHING_FOR_PROVIDER');
  });

  it('field release returns cleanly, is not re-offered to the same driver, and resume keeps the first arrival time', async () => {
    await prisma.applicationSetting.upsert({ where: { key: 'dispatch' }, create: { key: 'dispatch', value: { autoDispatch: false } }, update: { value: { autoDispatch: false } } });
    invalidateSettings();
    const d = await createDriver(fx.zone.id);
    const c = await loginCustomer();
    const b = await confirmedBooking(c.token, fx.car.id);
    const disp = await createStaff('dispatcher');
    await api().post(`/api/v1/dispatch/bookings/${b}/assign`).set(bearer(disp)).send({ driverUserId: d.user.id }).expect(200);
    const o = await prisma.bookingAssignment.findFirstOrThrow({ where: { bookingId: b, status: 'OFFERED' } });
    await api().post(`/api/v1/driver/offers/${o.id}/accept`).set(bearer(d.token)).expect(200);
    const tr = (to: string, reason?: string) => api().post(`/api/v1/driver/jobs/${b}/transition`).set(bearer(d.token)).send({ to, reason });
    await tr('EN_ROUTE').expect(200);
    await tr('ARRIVED').expect(200);
    const firstArrival = (await prisma.booking.findUniqueOrThrow({ where: { id: b } })).arrivedAt!;
    await tr('CUSTOMER_UNAVAILABLE', 'No answer on phone').expect(200);
    const otp = (await prisma.booking.findUniqueOrThrow({ where: { id: b } })).pickupOtp;
    await api().post(`/api/v1/driver/jobs/${b}/verify-pickup`).set(bearer(d.token)).send({ code: otp }).expect(200);
    const resumed = await prisma.booking.findUniqueOrThrow({ where: { id: b } });
    expect(resumed.status).toBe('ARRIVED');
    expect(resumed.arrivedAt!.getTime()).toBe(firstArrival.getTime());
    await tr('INSPECTING').expect(200);
    await api().post(`/api/v1/driver/jobs/${b}/equipment-check`).set(bearer(d.token)).send({}).expect(200);
    expect(await prisma.bookingStatusHistory.count({ where: { bookingId: b, reason: { startsWith: 'Equipment & crew confirmed' } } })).toBe(1);
    const rel = await tr('REASSIGNMENT_REQUIRED', 'Winch hydraulic leak').expect(200);
    expect(rel.body.data.released).toBe(true);
    const { loadCandidates } = await import('../../src/modules/dispatch/service.js');
    const { ranked } = await loadCandidates(prisma, b);
    expect(ranked.find((r) => r.driver.userId === d.user.id)!.reasons.join()).toMatch(/declined or timed out/);
    const hist = (await api().get('/api/v1/driver/jobs').set(bearer(d.token)).expect(200)).body.data;
    expect(hist.map((j: { id: string }) => j.id)).not.toContain(b);
  });

  it('cancellation fees follow the disclosed policy and require consent', async () => {
    await prisma.applicationSetting.update({ where: { key: 'dispatch' }, data: { value: { autoDispatch: false } } });
    invalidateSettings();
    const d = await createDriver(fx.zone.id);
    const c = await loginCustomer();
    const b = await confirmedBooking(c.token, fx.car.id);
    const disp = await createStaff('dispatcher');
    await api().post(`/api/v1/dispatch/bookings/${b}/assign`).set(bearer(disp)).send({ driverUserId: d.user.id }).expect(200);
    const o = await prisma.bookingAssignment.findFirstOrThrow({ where: { bookingId: b, status: 'OFFERED' } });
    await api().post(`/api/v1/driver/offers/${o.id}/accept`).set(bearer(d.token)).expect(200);
    const preview = (await api().get(`/api/v1/bookings/${b}/cancellation`).set(bearer(c.token)).expect(200)).body.data;
    expect(preview.fee).toBe(30000);
    const r = await api().post(`/api/v1/bookings/${b}/cancel`).set(bearer(c.token)).send({ reason: 'Fixed it myself' }).expect(409);
    expect(r.body.error.details.code).toBe('CANCELLATION_FEE_REQUIRED');
    await api().post(`/api/v1/bookings/${b}/cancel`).set(bearer(c.token)).send({ reason: 'Fixed it myself', acceptFee: true }).expect(200);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { bookingId: b } });
    expect(inv.type).toBe('CANCELLATION');
    expect(inv.total).toBe(30000);
    expect((await prisma.driverAvailability.findUniqueOrThrow({ where: { userId: d.user.id } })).status).toBe('AVAILABLE');
  });
});
