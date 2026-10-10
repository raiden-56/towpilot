import type { Booking, EscalationType, Prisma } from '@prisma/client';
import { prisma, type Db, type Tx } from '../../lib/prisma.js';
import { withTx, type AfterCommit } from '../../lib/tx.js';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import { startOfLocalDay } from '../../lib/time.js';
import { haversineKm } from '../../lib/geo.js';
import { enqueue, registerJob } from '../../jobs/queue.js';
import { emitToBooking, emitToOps, emitToUser, revokeBookingRoom } from '../../realtime/socket.js';
import { rankCandidates, truckIssues, type DriverCandidate, type DispatchRequest } from '../../domain/dispatch.js';
import { NEEDS_PROVIDER_STATUSES, FIELD_ACTIVE_STATUSES } from '../../domain/bookingStateMachine.js';
import type { Recommendation } from '../../domain/recommendation.js';
import { SYSTEM, transition, type Actor } from '../bookings/transitions.js';
import { notify, notifyOps } from '../notifications/service.js';
import { routeEstimate } from '../../integrations/maps.js';
import { logger } from '../../lib/logger.js';

// ─── Escalations ─────────────────────────────────────────────────────

export async function raiseEscalation(db: Db, after: AfterCommit | null, bookingId: string, type: EscalationType, detail: string, dedupeSuffix = '') {
  const dedupeKey = `${bookingId}:${type}${dedupeSuffix ? ':' + dedupeSuffix : ''}`;
  const existing = await db.escalation.findUnique({ where: { dedupeKey } });
  if (existing) return existing;
  const e = await db.escalation.create({ data: { bookingId, type, detail, dedupeKey } });
  const b = await db.booking.findUnique({ where: { id: bookingId }, select: { code: true } });
  await notifyOps(db, { type: 'escalation', title: `${b?.code ?? 'Booking'}: ${type.replace(/_/g, ' ').toLowerCase()}`, body: detail, data: { bookingId, escalationId: e.id } });
  after?.(() => emitToOps('escalation.created', { id: e.id, type, detail }, bookingId));
  return e;
}

// ─── Assignment lifecycle ────────────────────────────────────────────

/**
 * Releases the live (offered/accepted) assignment of a booking, returning the driver and truck
 * to availability. Returns the released driver's user id, if any.
 */
export async function releaseLiveAssignment(tx: Tx, after: AfterCommit, bookingId: string, status: 'CANCELLED' | 'RELEASED' | 'COMPLETED', reason: string) {
  const live = await tx.bookingAssignment.findFirst({ where: { bookingId, status: { in: ['OFFERED', 'ACCEPTED'] } } });
  if (!live) return null;
  await tx.bookingAssignment.update({ where: { id: live.id }, data: { status, respondedAt: live.respondedAt ?? new Date(), rejectionReason: status === 'COMPLETED' ? null : reason } });
  if (live.status === 'ACCEPTED') {
    await setAvailability(tx, live.driverUserId, 'AVAILABLE');
    if (live.truckId) await tx.towTruck.updateMany({ where: { id: live.truckId, status: 'IN_USE' }, data: { status: 'AVAILABLE' } });
  }
  const team = await tx.bookingTeamMember.findMany({ where: { bookingId, active: true } });
  if (status !== 'COMPLETED') {
    await tx.bookingTeamMember.updateMany({ where: { bookingId, active: true }, data: { active: false } });
    for (const t of team) if (t.userId !== live.driverUserId) await setAvailability(tx, t.userId, 'AVAILABLE');
  } else {
    for (const t of team) if (t.userId !== live.driverUserId) await setAvailability(tx, t.userId, 'AVAILABLE');
  }
  after(() => {
    if (status !== 'COMPLETED') {
      revokeBookingRoom(live.driverUserId, bookingId);
      team.forEach((t) => revokeBookingRoom(t.userId, bookingId));
    }
  });
  return live.driverUserId;
}

export async function setAvailability(db: Db, userId: string, status: 'AVAILABLE' | 'ON_JOB' | 'BUSY' | 'ON_BREAK' | 'OFF_DUTY', zoneId?: string | null) {
  const current = await db.driverAvailability.findUnique({ where: { userId } });
  if (current?.status === status && (zoneId === undefined || zoneId === current.zoneId)) return current;
  // Close the open attendance log and open a new one.
  await db.availabilityLog.updateMany({ where: { userId, endedAt: null }, data: { endedAt: new Date() } });
  await db.availabilityLog.create({ data: { userId, status, zoneId: zoneId ?? current?.zoneId ?? null } });
  return db.driverAvailability.upsert({
    where: { userId },
    create: { userId, status, zoneId: zoneId ?? null, statusSince: new Date(), locationSharing: status !== 'OFF_DUTY' },
    update: { status, statusSince: new Date(), ...(zoneId !== undefined ? { zoneId } : {}), locationSharing: status !== 'OFF_DUTY' },
  });
}

// ─── Candidates ──────────────────────────────────────────────────────

async function dispatchRequestFor(db: Db, booking: Booking & { locations: { kind: string; lat: number; lng: number }[]; vehicle: { vehicleClass: Prisma.VehicleGetPayload<object>['vehicleClass'] } | null }): Promise<DispatchRequest> {
  const s = await getSettings(db);
  const pickup = booking.locations.find((l) => l.kind === 'PICKUP')!;
  const rec = booking.recommendation as unknown as Recommendation | null;
  return {
    zoneId: booking.zoneId,
    pickup: { lat: pickup.lat, lng: pickup.lng },
    truckTypes: rec?.truckTypes ?? [],
    equipment: rec?.equipment ?? [],
    vehicleClass: booking.vehicle?.vehicleClass ?? 'SEDAN',
    now: new Date(),
    staleMinutes: s.dispatch.locationStaleMinutes,
    radiusKm: s.dispatch.searchRadiusKm,
    avgSpeedKmh: s.dispatch.avgSpeedKmh,
  };
}

export async function loadCandidates(db: Db, bookingId: string) {
  const s = await getSettings(db);
  const booking = await db.booking.findUnique({ where: { id: bookingId }, include: { locations: true, vehicle: { select: { vehicleClass: true } } } });
  if (!booking) throw notFound('Booking');
  const req = await dispatchRequestFor(db, booking);

  // Drivers who declined, timed out or released this job are not offered it again automatically.
  const declined = await db.bookingAssignment.findMany({ where: { bookingId, status: { in: ['REJECTED', 'TIMED_OUT', 'RELEASED'] } }, select: { driverUserId: true } });
  const declinedSet = new Set(declined.map((d) => d.driverUserId));
  const dayStart = startOfLocalDay(new Date(), s.locale.timezone);

  const drivers = await db.user.findMany({
    where: { deletedAt: null, driverProfile: { isNot: null }, workerProfile: { isNot: null }, roles: { some: { role: { key: 'driver' } } } },
    include: {
      workerProfile: { include: { zones: { select: { id: true } } } },
      driverProfile: true,
      availability: true,
      assignedTruck: { include: { equipment: true } },
      assignments: { where: { OR: [{ status: { in: ['OFFERED', 'ACCEPTED'] } }, { status: 'COMPLETED', offeredAt: { gte: dayStart } }] }, select: { status: true } },
    },
  });
  const ratings = await db.rating.groupBy({ by: ['rateeUserId'], where: { rateeUserId: { in: drivers.map((d) => d.id) } }, _avg: { score: true } });
  const ratingMap = new Map(ratings.map((r) => [r.rateeUserId, r._avg.score]));

  const candidates: DriverCandidate[] = drivers.map((d) => ({
    userId: d.id,
    name: d.fullName,
    userStatus: d.status,
    verificationStatus: d.workerProfile!.verificationStatus,
    availability: d.availability?.status ?? 'OFF_DUTY',
    availabilityZoneId: d.availability?.zoneId ?? null,
    zoneIds: d.workerProfile!.zones.map((z) => z.id),
    lastLocation: d.availability?.lastLat != null && d.availability.lastLng != null ? { lat: d.availability.lastLat, lng: d.availability.lastLng } : null,
    lastLocationAt: d.availability?.lastLocationAt ?? null,
    licenceExpiry: d.driverProfile!.licenceExpiry,
    heavyVehicleCert: d.driverProfile!.heavyVehicleCert,
    hasLiveAssignment: d.assignments.some((a) => a.status === 'OFFERED' || a.status === 'ACCEPTED'),
    previouslyDeclined: declinedSet.has(d.id),
    jobsToday: d.assignments.filter((a) => a.status === 'COMPLETED').length,
    rating: ratingMap.get(d.id) ?? null,
    truck: d.assignedTruck
      ? {
          id: d.assignedTruck.id,
          registrationNumber: d.assignedTruck.registrationNumber,
          status: d.assignedTruck.status,
          truckType: d.assignedTruck.truckType,
          maxVehicleClass: d.assignedTruck.maxVehicleClass,
          zoneId: d.assignedTruck.zoneId,
          equipment: d.assignedTruck.equipment.map((e) => ({ type: e.type, status: e.status })),
          insuranceExpiry: d.assignedTruck.insuranceExpiry,
          fitnessExpiry: d.assignedTruck.fitnessExpiry,
          permitExpiry: d.assignedTruck.permitExpiry,
          pucExpiry: d.assignedTruck.pucExpiry,
        }
      : null,
  }));
  return { booking, request: req, ranked: rankCandidates(candidates, req, s.dispatch.weights) };
}

// ─── Offers ──────────────────────────────────────────────────────────

async function makeOffer(
  tx: Tx,
  after: AfterCommit,
  booking: Booking,
  c: { driverUserId: string; truckId: string | null; etaMinutes: number | null; distanceKm: number | null; score?: number | null; scoreBreakdown?: unknown },
  method: 'AUTO' | 'MANUAL',
  actor: Actor,
  note?: string,
) {
  const s = await getSettings(tx);
  const attempt = (await tx.bookingAssignment.count({ where: { bookingId: booking.id } })) + 1;
  // The partial unique indexes guarantee one live assignment per booking and per driver,
  // so two concurrent dispatchers cannot both succeed.
  let assignment;
  try {
    assignment = await tx.bookingAssignment.create({
      data: {
        bookingId: booking.id,
        driverUserId: c.driverUserId,
        truckId: c.truckId,
        status: 'OFFERED',
        method,
        attempt,
        expiresAt: new Date(Date.now() + s.dispatch.offerTimeoutSec * 1000),
        assignedById: actor.userId,
        etaMinutes: c.etaMinutes,
        distanceKm: c.distanceKm,
        score: c.score ?? null,
        scoreBreakdown: (c.scoreBreakdown ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw conflict('This booking or driver already has a live assignment');
    throw e;
  }
  await transition(tx, after, booking, 'ASSIGNED', actor, { reason: note, metadata: { assignmentId: assignment.id, driverUserId: c.driverUserId, method }, quiet: true });
  await tx.booking.update({ where: { id: booking.id }, data: { dispatchAttempts: { increment: 1 } } });
  await enqueue(tx, 'dispatch.offerTimeout', { assignmentId: assignment.id }, { runAt: assignment.expiresAt, dedupeKey: `offer-timeout:${assignment.id}` });
  await notify(tx, c.driverUserId, {
    type: 'job.offer',
    title: `New job ${booking.code}`,
    body: `Pickup ~${c.distanceKm ?? '?'} km away. Respond within ${s.dispatch.offerTimeoutSec} seconds.`,
    data: { bookingId: booking.id, assignmentId: assignment.id },
    channels: ['PUSH'],
  });
  after(() => {
    emitToUser(c.driverUserId, 'job.offer', { assignmentId: assignment.id, bookingId: booking.id, expiresAt: assignment.expiresAt }, booking.id);
    emitToOps('dispatch.offered', { assignmentId: assignment.id, driverUserId: c.driverUserId }, booking.id);
  });
  return assignment;
}

/**
 * Automatic dispatch: offer the best eligible provider. If none is available, the dispatcher is
 * alerted and the customer is told the truth (still searching) — never that someone is assigned.
 */
export async function runAutoDispatch(bookingId: string) {
  const s = await getSettings();
  return withTx(async (tx, after) => {
    // Row lock serialises concurrent dispatch runs for the same booking.
    await tx.$queryRaw`SELECT id FROM "bookings" WHERE id = ${bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking || !NEEDS_PROVIDER_STATUSES.includes(booking.status)) return { offered: false, reason: 'not awaiting provider' };
    if (booking.requiresManualReview && !booking.reviewedAt) return { offered: false, reason: 'awaiting manual review' };
    if (booking.status !== 'SEARCHING_FOR_PROVIDER') await transition(tx, after, booking, 'SEARCHING_FOR_PROVIDER', SYSTEM, { quiet: booking.status === 'REJECTED' });

    const { ranked } = await loadCandidates(tx, bookingId);
    const best = ranked.find((r) => r.eligible);
    if (best) {
      await makeOffer(tx, after, booking, { driverUserId: best.driver.userId, truckId: best.driver.truck?.id ?? null, etaMinutes: best.etaMinutes, distanceKm: best.distanceKm, score: best.score?.total, scoreBreakdown: best.score }, 'AUTO', SYSTEM);
      return { offered: true, driverUserId: best.driver.userId };
    }

    const attempts = await tx.escalation.count({ where: { bookingId, type: 'NO_PROVIDER' } });
    const summary = ranked.slice(0, 5).map((r) => `${r.driver.name}: ${r.reasons[0] ?? 'ok'}`).join('; ') || 'no drivers registered';
    await raiseEscalation(tx, after, bookingId, 'NO_PROVIDER', `No eligible provider found (attempt ${attempts + 1}). ${summary}`, String(attempts + 1));
    if (attempts + 1 >= s.dispatch.maxAutoAttempts) {
      await transition(tx, after, booking, 'REASSIGNMENT_REQUIRED', SYSTEM, { reason: 'No eligible provider available after automatic retries', quiet: true });
      await notify(tx, booking.customerUserId, {
        type: 'booking.delay',
        title: `${booking.code}: still looking for a provider`,
        body: 'No provider is free near you right now. Our dispatch team is working on it. You can wait, schedule for later, or call support for alternatives.',
        data: { bookingId },
        channels: ['SMS'],
      });
    } else {
      await enqueue(tx, 'dispatch.run', { bookingId }, { runAt: new Date(Date.now() + 60_000), dedupeKey: `dispatch-retry:${bookingId}:${attempts + 1}` });
      if (attempts === 0)
        await notify(tx, booking.customerUserId, { type: 'booking.searching', title: `${booking.code}: finding a provider`, body: 'All nearby providers are busy. We are still searching and will update you.', data: { bookingId } });
    }
    return { offered: false, reason: 'no eligible provider' };
  });
}

export async function manualAssign(actor: Actor, bookingId: string, input: { driverUserId: string; note?: string; force?: boolean }) {
  return withTx(async (tx, after) => {
    await tx.$queryRaw`SELECT id FROM "bookings" WHERE id = ${bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw notFound('Booking');
    if (!NEEDS_PROVIDER_STATUSES.includes(booking.status)) throw conflict(`Cannot assign while booking is ${booking.status}`);
    if (booking.requiresManualReview && !booking.reviewedAt) throw unprocessable('Complete the manual safety review before assigning');
    const { ranked } = await loadCandidates(tx, bookingId);
    const c = ranked.find((r) => r.driver.userId === input.driverUserId);
    if (!c) throw notFound('Driver');
    // Hard safety/eligibility blocks can never be overridden; soft ones (distance, stale location, zone) can, with a reason.
    const hard = c.reasons.filter((r) => /Driver is (off duty|on break|busy)|not verified|not active|expired|holds an assignment|No truck|not suitable|capacity|Missing working equipment|maintenance|out of service|retired|heavy-vehicle/i.test(r));
    if (hard.length) throw unprocessable(`Driver is not eligible: ${hard.join('; ')}`);
    if (!c.eligible && !input.force) throw unprocessable(`Driver has warnings: ${c.reasons.join('; ')}. Confirm to assign anyway.`, { warnings: c.reasons });
    if (!c.eligible && !input.note) throw unprocessable('A reason is required when overriding dispatch warnings');
    return makeOffer(tx, after, booking, { driverUserId: c.driver.userId, truckId: c.driver.truck?.id ?? null, etaMinutes: c.etaMinutes, distanceKm: c.distanceKm, score: c.score?.total, scoreBreakdown: c.score }, 'MANUAL', actor, input.note);
  });
}

export async function acceptOffer(driverUserId: string, assignmentId: string) {
  return withTx(async (tx, after) => {
    const now = new Date();
    const res = await tx.bookingAssignment.updateMany({ where: { id: assignmentId, driverUserId, status: 'OFFERED', expiresAt: { gt: now } }, data: { status: 'ACCEPTED', respondedAt: now } });
    if (res.count !== 1) throw conflict('This offer has expired or was withdrawn');
    const a = await tx.bookingAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { truck: true } });
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: a.bookingId }, include: { locations: true } });
    if (booking.status !== 'ASSIGNED') throw conflict('Booking is no longer awaiting acceptance');

    // Truck must still be dispatchable at acceptance time.
    if (a.truck) {
      const issues = truckIssues(
        { ...a.truck, equipment: await tx.truckEquipment.findMany({ where: { truckId: a.truck.id }, select: { type: true, status: true } }) },
        { truckTypes: [], equipment: [], vehicleClass: 'TWO_WHEELER', now },
      );
      if (issues.length) throw unprocessable(`Your truck cannot be dispatched: ${issues.join('; ')}`);
      const t = await tx.towTruck.updateMany({ where: { id: a.truck.id, status: 'AVAILABLE' }, data: { status: 'IN_USE' } });
      if (t.count !== 1) throw conflict('Your truck is not available');
    }
    await setAvailability(tx, driverUserId, 'ON_JOB');
    await tx.bookingTeamMember.upsert({
      where: { bookingId_userId: { bookingId: booking.id, userId: driverUserId } },
      create: { bookingId: booking.id, userId: driverUserId, role: 'TEAM_LEADER', responsibility: 'Driver and team leader' },
      update: { active: true, role: 'TEAM_LEADER' },
    });

    const pickup = booking.locations.find((l) => l.kind === 'PICKUP')!;
    const av = await tx.driverAvailability.findUnique({ where: { userId: driverUserId } });
    let etaAt: Date | null = null;
    if (av?.lastLat != null && av.lastLng != null) {
      const r = await routeEstimate({ lat: av.lastLat, lng: av.lastLng }, pickup);
      etaAt = new Date(Date.now() + r.durationMin * 60_000);
      await tx.bookingAssignment.update({ where: { id: a.id }, data: { etaMinutes: r.durationMin, distanceKm: r.distanceKm } });
    }
    const actor: Actor = { userId: driverUserId, role: 'DRIVER' };
    await transition(tx, after, booking, 'ACCEPTED', actor, { data: { etaAt } });
    after(() => emitToBooking(booking.id, 'booking.assignment', { driverUserId, etaAt }, { etaAt }));
    return booking.id;
  });
}

export async function rejectOffer(driverUserId: string, assignmentId: string, reason?: string) {
  const bookingId = await withTx(async (tx, after) => {
    const res = await tx.bookingAssignment.updateMany({ where: { id: assignmentId, driverUserId, status: 'OFFERED' }, data: { status: 'REJECTED', respondedAt: new Date(), rejectionReason: reason ?? 'Declined' } });
    if (res.count !== 1) throw conflict('This offer is no longer open');
    const a = await tx.bookingAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: a.bookingId } });
    if (booking.status === 'ASSIGNED') await transition(tx, after, booking, 'REJECTED', { userId: driverUserId, role: 'DRIVER' }, { reason: reason ?? 'Driver declined', quiet: true });
    await raiseEscalation(tx, after, booking.id, 'DRIVER_REJECTED', `Driver declined${reason ? `: ${reason}` : ''}`, a.id);
    return booking.id;
  });
  await enqueue(prisma, 'dispatch.run', { bookingId }, { dedupeKey: `dispatch-after-reject:${assignmentId}` });
  return bookingId;
}

registerJob<{ bookingId: string }>('dispatch.run', async ({ bookingId }) => {
  const s = await getSettings();
  if (!s.dispatch.autoDispatch) return;
  await runAutoDispatch(bookingId);
});

registerJob<{ assignmentId: string }>('dispatch.offerTimeout', async ({ assignmentId }) => {
  const bookingId = await withTx(async (tx, after) => {
    const res = await tx.bookingAssignment.updateMany({ where: { id: assignmentId, status: 'OFFERED', expiresAt: { lte: new Date() } }, data: { status: 'TIMED_OUT', respondedAt: new Date(), rejectionReason: 'No response before timeout' } });
    if (res.count !== 1) return null;
    const a = await tx.bookingAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: a.bookingId } });
    if (booking.status === 'ASSIGNED') await transition(tx, after, booking, 'REJECTED', SYSTEM, { reason: 'Driver did not respond in time', quiet: true });
    await raiseEscalation(tx, after, booking.id, 'DRIVER_NO_RESPONSE', 'Offer timed out without a response', a.id);
    after(() => emitToUser(a.driverUserId, 'job.offerExpired', { assignmentId }, booking.id));
    return booking.id;
  });
  if (bookingId) await enqueue(prisma, 'dispatch.run', { bookingId }, { dedupeKey: `dispatch-after-timeout:${assignmentId}` });
});

/** Dispatcher withdraws the current provider (e.g. vehicle broke down) and returns the job to the queue. */
export async function reassign(actor: Actor, bookingId: string, reason: string) {
  const id = await withTx(async (tx, after) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw notFound('Booking');
    const released = await releaseLiveAssignment(tx, after, booking.id, 'RELEASED', reason);
    await transition(tx, after, booking, 'REASSIGNMENT_REQUIRED', actor, { reason });
    if (released) after(() => emitToUser(released, 'job.cancelled', { bookingId, reason }, bookingId));
    return booking.id;
  });
  await enqueue(prisma, 'dispatch.run', { bookingId: id }, { dedupeKey: `dispatch-reassign:${id}:${Date.now()}` });
}

/** Dispatcher decision on a booking flagged for manual safety review. */
export async function completeReview(actor: Actor, bookingId: string, input: { approve: boolean; notes: string; crew?: number; truckTypes?: string[]; equipment?: string[] }) {
  return withTx(async (tx, after) => {
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) throw notFound('Booking');
    if (!b.requiresManualReview) throw conflict('This booking does not require review');
    if (b.reviewedAt) throw conflict('Review already completed');
    const rec = (b.recommendation ?? {}) as unknown as Recommendation;
    const override = {
      ...rec,
      crew: input.crew ?? rec.crew,
      truckTypes: (input.truckTypes as Recommendation['truckTypes']) ?? rec.truckTypes,
      equipment: (input.equipment as Recommendation['equipment']) ?? rec.equipment,
      reviewNotes: input.notes,
      overriddenBy: actor.userId,
    };
    await tx.booking.update({
      where: { id: b.id },
      data: { reviewedById: actor.userId, reviewedAt: new Date(), recommendation: override as unknown as Prisma.InputJsonValue, crewRecommended: override.crew },
    });
    await tx.escalation.updateMany({ where: { bookingId: b.id, type: 'MANUAL_REVIEW', status: { not: 'RESOLVED' } }, data: { status: 'RESOLVED', resolvedById: actor.userId, resolvedAt: new Date() } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: input.approve ? 'booking.review.approved' : 'booking.review.declined', entityType: 'booking', entityId: b.id, before: rec as object, after: override as object } });
    if (!input.approve) {
      await transition(tx, after, b, 'CANCELLED', actor, { reason: `Recovery declined after safety review: ${input.notes}`, data: { cancellationReason: input.notes, cancelledById: actor.userId } });
      return { approved: false };
    }
    if (b.status === 'CONFIRMED' && b.type === 'EMERGENCY') {
      await transition(tx, after, b, 'SEARCHING_FOR_PROVIDER', actor, { reason: 'Safety review approved' });
      const s = await getSettings(tx);
      if (s.dispatch.autoDispatch) await enqueue(tx, 'dispatch.run', { bookingId: b.id }, { dedupeKey: `dispatch-reviewed:${b.id}` });
    }
    return { approved: true };
  });
}

// ─── Sweeps: no-response rescue escalation ───────────────────────────

export async function escalationSweep() {
  const s = await getSettings();
  const now = Date.now();

  // Missed ETA: en route past ETA + grace.
  const late = await prisma.booking.findMany({ where: { status: 'EN_ROUTE', etaAt: { lt: new Date(now - s.dispatch.missedEtaGraceMinutes * 60_000) } }, select: { id: true, etaAt: true } });
  for (const b of late) await raiseEscalation(prisma, null, b.id, 'MISSED_ETA', `Driver has not arrived; ETA was ${b.etaAt?.toISOString()}`, b.etaAt?.toISOString().slice(0, 16));

  // Failed location updates while on an active job.
  const stale = new Date(now - s.dispatch.locationStaleMinutes * 60_000);
  const active = await prisma.bookingAssignment.findMany({
    where: { status: 'ACCEPTED', booking: { status: { in: ['ACCEPTED', 'EN_ROUTE', 'LOADING', 'IN_TRANSIT'] } } },
    select: { bookingId: true, driverUserId: true, driver: { select: { availability: { select: { lastLocationAt: true } } } } },
  });
  for (const a of active) {
    const last = a.driver.availability?.lastLocationAt;
    if (!last || last < stale) {
      const bucket = Math.floor(now / (15 * 60_000)); // re-alert at most every 15 minutes
      await raiseEscalation(prisma, null, a.bookingId, 'LOCATION_STALE', `No location update from driver since ${last?.toISOString() ?? 'job start'}`, String(bucket));
    }
  }

  // Bookings waiting too long without a provider.
  const waiting = await prisma.booking.findMany({ where: { status: { in: ['SEARCHING_FOR_PROVIDER', 'REASSIGNMENT_REQUIRED'] }, updatedAt: { lt: new Date(now - 10 * 60_000) } }, select: { id: true } });
  for (const b of waiting) await raiseEscalation(prisma, null, b.id, 'NO_PROVIDER', 'Booking has waited more than 10 minutes for a provider', `wait:${Math.floor(now / (30 * 60_000))}`);
}

/** Starts dispatch for scheduled bookings when their lead time is reached. */
export async function scheduledDispatchSweep() {
  const s = await getSettings();
  const due = await prisma.booking.findMany({
    where: { type: 'SCHEDULED', status: 'CONFIRMED', scheduledFor: { lte: new Date(Date.now() + s.dispatch.scheduledLeadMinutes * 60_000) }, OR: [{ requiresManualReview: false }, { reviewedAt: { not: null } }] },
    select: { id: true },
  });
  for (const b of due) {
    await withTx(async (tx, after) => {
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: b.id } });
      if (booking.status !== 'CONFIRMED') return;
      await transition(tx, after, booking, 'SEARCHING_FOR_PROVIDER', SYSTEM, { reason: 'Scheduled time approaching' });
      await enqueue(tx, 'dispatch.run', { bookingId: b.id }, { dedupeKey: `dispatch-scheduled:${b.id}` });
    }).catch((e) => logger.warn({ bookingId: b.id, err: (e as Error).message }, 'scheduled dispatch failed'));
  }
}

/** Expires stale quotes awaiting customer approval and cancels long-abandoned requests. */
export async function quoteExpirySweep() {
  await prisma.bookingQuote.updateMany({ where: { status: 'PENDING_CUSTOMER_APPROVAL', kind: 'INITIAL', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
  const abandoned = await prisma.booking.findMany({ where: { status: 'QUOTED', updatedAt: { lt: new Date(Date.now() - 24 * 3600_000) } }, select: { id: true } });
  for (const b of abandoned) {
    await withTx(async (tx, after) => {
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: b.id } });
      if (booking.status === 'QUOTED') await transition(tx, after, booking, 'CANCELLED', SYSTEM, { reason: 'Quote not approved within 24 hours', data: { cancellationReason: 'Quote not approved within 24 hours' }, quiet: true });
    }).catch(() => {});
  }
}

export async function ensureNotFieldActive(bookingStatus: string) {
  if (FIELD_ACTIVE_STATUSES.includes(bookingStatus as never)) throw forbidden('Operation not allowed while the job is in progress');
}

export const distanceBetween = haversineKm;
