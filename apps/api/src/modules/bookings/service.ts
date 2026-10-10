import type { Booking, BookingStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Db } from '../../lib/prisma.js';
import { withTx } from '../../lib/tx.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { numericCode } from '../../lib/crypto.js';
import { nextBookingCode } from '../../lib/numbering.js';
import { coarsen, haversineKm, resolveZone } from '../../lib/geo.js';
import { getSettings } from '../../lib/settings.js';
import { routeEstimate } from '../../integrations/maps.js';
import { signedFileUrl } from '../../integrations/storage.js';
import { recommendRecovery, type Recommendation } from '../../domain/recommendation.js';
import { cancellationStage, LIVE_TRACKING_STATUSES, NEEDS_PROVIDER_STATUSES, STATUS_LABELS, TERMINAL_STATUSES, allowedNext } from '../../domain/bookingStateMachine.js';
import { cancellationFee, type RateCardRules } from '../../domain/pricing.js';
import type { Principal } from '../../middleware/auth.js';
import { enqueue } from '../../jobs/queue.js';
import { createQuote, priceBooking } from '../pricing/service.js';
import { SYSTEM, transition, type Actor } from './transitions.js';
import { notifyOps } from '../notifications/service.js';
import { createCancellationInvoice } from '../billing/service.js';
import { raiseEscalation, releaseLiveAssignment } from '../dispatch/service.js';
import { emitToUser } from '../../realtime/socket.js';

// ─── Input schemas ───────────────────────────────────────────────────

const tri = z.enum(['YES', 'NO', 'NOT_SURE']);
const coord = { lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };

export const locationInput = z.object({
  ...coord,
  accuracyM: z.number().nonnegative().max(100_000).optional(),
  capturedAt: z.coerce.date().optional(),
  source: z.enum(['GPS', 'MAP_PIN', 'MANUAL', 'LINK', 'SAVED']),
  address: z.string().trim().max(500).optional(),
  landmark: z.string().trim().max(200).optional(),
  highway: z.string().trim().max(120).optional(),
  roadDirection: z.string().trim().max(120).optional(),
  kmMarker: z.string().trim().max(40).optional(),
  gateNumber: z.string().trim().max(40).optional(),
  floor: z.string().trim().max(40).optional(),
  parkingLevel: z.string().trim().max(40).optional(),
  accessNotes: z.string().trim().max(500).optional(),
  isSafeLocation: z.boolean().optional(),
});

export const dropoffInput = locationInput.extend({
  destinationType: z.enum(['GARAGE', 'SERVICE_CENTRE', 'HOME', 'CUSTOM']),
  placeName: z.string().trim().max(200).optional(),
});

export const assessmentInput = z.object({
  breakdownType: z.enum(['MECHANICAL', 'COLLISION', 'ENGINE', 'BATTERY', 'TYRE', 'TRANSMISSION', 'FLOOD', 'FUEL', 'LOCKOUT', 'OTHER']),
  engineStarts: tri,
  wheelsRotate: tri,
  steeringWorks: tri,
  brakesWork: tri,
  isStuck: tri,
  isOverturned: tri,
  isSubmerged: tri,
  blockingTraffic: tri,
  majorDamage: tri,
  isEvOrHybrid: z.boolean().default(false),
  accessRestriction: z.enum(['NONE', 'BASEMENT', 'NARROW_LANE', 'PARKING_STRUCTURE', 'RESTRICTED_AREA']).default('NONE'),
  hasChildren: z.boolean().default(false),
  hasElderly: z.boolean().default(false),
  needsAccessibility: z.boolean().default(false),
  passengersNeedingTransport: z.number().int().min(0).max(20).default(0),
  notes: z.string().trim().max(1000).optional(),
});

export const createBookingInput = z.object({
  clientRequestId: z.string().min(8).max(64).optional(),
  serviceCategoryId: z.string().min(1),
  vehicleId: z.string().min(1),
  type: z.enum(['EMERGENCY', 'SCHEDULED']).default('EMERGENCY'),
  scheduledFor: z.coerce.date().optional(),
  pickup: locationInput,
  dropoff: dropoffInput.optional(),
  assessment: assessmentInput,
  crewRequested: z.number().int().min(1).max(6).default(1),
  contactName: z.string().trim().min(2).max(100),
  contactPhone: z.string().trim().min(10).max(16),
  instructions: z.string().trim().max(1000).optional(),
  promoCode: z.string().trim().max(30).optional(),
  useMembership: z.boolean().default(true),
});
export type CreateBookingInput = z.infer<typeof createBookingInput>;

// ─── Create & quote ──────────────────────────────────────────────────

/** Estimated pickup distance: nearest available, verified provider with a fresh location in the zone. */
async function estimatePickupDistance(db: Db, zoneId: string, pickup: { lat: number; lng: number }) {
  const s = await getSettings();
  const fresh = new Date(Date.now() - s.dispatch.locationStaleMinutes * 60_000);
  const drivers = await db.driverAvailability.findMany({
    where: {
      status: 'AVAILABLE',
      lastLocationAt: { gt: fresh },
      lastLat: { not: null },
      user: { status: 'ACTIVE', workerProfile: { verificationStatus: 'APPROVED', zones: { some: { id: zoneId } } }, driverProfile: { isNot: null } },
    },
    select: { lastLat: true, lastLng: true },
  });
  let nearest: { lat: number; lng: number } | null = null;
  let bestKm = Infinity;
  for (const d of drivers) {
    const km = haversineKm({ lat: d.lastLat!, lng: d.lastLng! }, pickup);
    if (km < bestKm) {
      bestKm = km;
      nearest = { lat: d.lastLat!, lng: d.lastLng! };
    }
  }
  if (!nearest) return { km: null as number | null, note: 'No provider location available yet; pickup travel is not charged for this booking.' };
  const route = await routeEstimate(nearest, pickup);
  return { km: route.distanceKm, note: `Pickup distance estimated from the nearest available provider (${route.source}).` };
}

export async function createBooking(customer: Principal, input: CreateBookingInput) {
  if (input.clientRequestId) {
    const existing = await prisma.booking.findUnique({ where: { clientRequestId: input.clientRequestId } });
    if (existing) {
      if (existing.customerUserId !== customer.userId) throw conflict('Duplicate request id');
      return existing.id; // idempotent retry
    }
  }

  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: input.vehicleId,
      deletedAt: null,
      OR: [{ ownerUserId: customer.userId }, { fleetAccount: { members: { some: { userId: customer.userId } } } }],
    },
  });
  if (!vehicle) throw notFound('Vehicle');

  const category = await prisma.serviceCategory.findUnique({ where: { id: input.serviceCategoryId } });
  if (!category || !category.active) throw unprocessable('This service is not available');
  if (category.vehicleClasses.length && !category.vehicleClasses.includes(vehicle.vehicleClass))
    throw unprocessable(`${category.name} is not available for ${vehicle.vehicleClass.replace('_', ' ').toLowerCase()} vehicles`);

  const zones = await prisma.serviceZone.findMany({ where: { active: true } });
  const zone = resolveZone(input.pickup, zones);
  if (!zone) throw unprocessable('This location is outside our current service area. Please call support for alternatives.', { code: 'OUTSIDE_SERVICE_AREA' });
  const enabled = await prisma.serviceZoneCategory.findUnique({ where: { zoneId_categoryId: { zoneId: zone.id, categoryId: category.id } } });
  if (!enabled?.active) throw unprocessable(`${category.name} is not offered in ${zone.name} right now`);

  if (category.kind === 'TOWING' && !input.dropoff) throw badRequest('A destination is required for towing', { field: 'dropoff' });
  if (input.type === 'SCHEDULED') {
    if (!input.scheduledFor) throw badRequest('Choose a date and time for the scheduled booking');
    const mins = (input.scheduledFor.getTime() - Date.now()) / 60000;
    if (mins < 30 || mins > 30 * 24 * 60) throw badRequest('Scheduled time must be between 30 minutes and 30 days from now');
  }

  const dup = await prisma.booking.findFirst({
    where: { vehicleId: vehicle.id, status: { notIn: [...TERMINAL_STATUSES, 'DELIVERED', 'DISPUTED', 'REQUESTED', 'QUOTED'] } },
    select: { id: true, code: true },
  });
  if (dup) throw conflict(`This vehicle already has an active booking (${dup.code})`, { bookingId: dup.id });

  const recommendation = recommendRecovery(
    { key: category.key, kind: category.kind, allowedTruckTypes: category.allowedTruckTypes, requiredEquipment: category.requiredEquipment, defaultCrew: category.defaultCrew },
    vehicle.vehicleClass,
    input.assessment,
    input.crewRequested,
  );
  if (input.pickup.isSafeLocation === false && !recommendation.safetyFlags.includes('UNSAFE_LOCATION')) recommendation.safetyFlags.push('UNSAFE_LOCATION');

  const tow = category.kind === 'TOWING' && input.dropoff ? await routeEstimate(input.pickup, input.dropoff) : null;
  const pickupEst = await estimatePickupDistance(prisma, zone.id, input.pickup);

  const fleetAccountId = vehicle.fleetAccountId;
  // Contract customers with a response-time SLA are dispatched ahead of normal requests.
  if (fleetAccountId && recommendation.priority === 'NORMAL') {
    const sla = await prisma.fleetContract.findFirst({ where: { fleetAccountId, active: true, slaResponseMinutes: { not: null }, startsAt: { lte: new Date() }, endsAt: { gt: new Date() } } });
    if (sla) {
      recommendation.priority = 'HIGH';
      recommendation.reasons.push(`Business contract SLA: response within ${sla.slaResponseMinutes} minutes.`);
    }
  }

  return withTx(async (tx, after) => {
    // An unconfirmed quote for the same vehicle is superseded by the new request (free to cancel).
    const stale = await tx.booking.findMany({ where: { vehicleId: vehicle.id, customerUserId: customer.userId, status: { in: ['REQUESTED', 'QUOTED'] } } });
    for (const s of stale) {
      await tx.bookingQuote.updateMany({ where: { bookingId: s.id, status: 'PENDING_CUSTOMER_APPROVAL' }, data: { status: 'SUPERSEDED' } });
      await transition(tx, after, s, 'CANCELLED', SYSTEM, { reason: 'Superseded by a new request for the same vehicle', data: { cancellationReason: 'Superseded by a new request' }, quiet: true });
    }
    const code = await nextBookingCode(tx);
    const booking = await tx.booking.create({
      data: {
        code,
        clientRequestId: input.clientRequestId,
        customerUserId: customer.userId,
        vehicleId: vehicle.id,
        fleetAccountId,
        serviceCategoryId: category.id,
        zoneId: zone.id,
        type: input.type,
        scheduledFor: input.type === 'SCHEDULED' ? input.scheduledFor : null,
        priority: recommendation.priority,
        safetyFlags: recommendation.safetyFlags,
        requiresManualReview: recommendation.manualReviewReasons.length > 0,
        manualReviewReasons: recommendation.manualReviewReasons,
        recommendation: recommendation as unknown as Prisma.InputJsonValue,
        crewRequested: input.crewRequested,
        crewRecommended: recommendation.crew,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        instructions: input.instructions,
        promoCode: input.promoCode?.toUpperCase(),
        pickupOtp: numericCode(4),
        handoverOtp: numericCode(4),
        towDistanceKm: tow?.distanceKm ?? null,
        pickupDistanceKm: pickupEst.km,
        distanceSource: tow?.source ?? null,
        locations: {
          create: [
            { kind: 'PICKUP', ...input.pickup },
            ...(input.dropoff && category.kind === 'TOWING' ? [{ kind: 'DROPOFF' as const, ...input.dropoff }] : []),
          ],
        },
        assessment: { create: input.assessment },
        statusHistory: { create: { toStatus: 'REQUESTED', actorUserId: customer.userId, actorRole: 'CUSTOMER' } },
      },
    });

    const priced = await priceBooking(tx, { booking, category, vehicleClass: vehicle.vehicleClass, recommendation, useMembership: input.useMembership });
    await tx.booking.update({ where: { id: booking.id }, data: { membershipSubscriptionId: priced.subscriptionId } });
    await createQuote(tx, booking.id, priced, {
      kind: 'INITIAL',
      status: 'PENDING_CUSTOMER_APPROVAL',
      assumptions: { pickupDistance: pickupEst.note, towDistanceSource: tow?.source ?? null, useMembership: input.useMembership },
    });
    await transition(tx, after, booking, 'QUOTED', SYSTEM);
    return booking.id;
  });
}

/** Re-quote while still in QUOTED (expired quote, changed promo/membership choice). */
export async function requote(customer: Principal, bookingId: string, opts: { promoCode?: string | null; useMembership?: boolean }) {
  return withTx(async (tx, after) => {
    const b = await tx.booking.findUnique({ where: { id: bookingId }, include: { serviceCategory: true, vehicle: true } });
    if (!b || b.customerUserId !== customer.userId) throw notFound('Booking');
    if (b.status !== 'QUOTED') throw conflict('Quotes can only be refreshed before confirmation');
    if (opts.promoCode !== undefined) await tx.booking.update({ where: { id: b.id }, data: { promoCode: opts.promoCode?.toUpperCase() ?? null } });
    const fresh = { ...b, promoCode: opts.promoCode !== undefined ? (opts.promoCode?.toUpperCase() ?? null) : b.promoCode };
    const priced = await priceBooking(tx, { booking: fresh, category: b.serviceCategory, vehicleClass: b.vehicle!.vehicleClass, recommendation: b.recommendation as unknown as Recommendation, useMembership: opts.useMembership ?? true });
    await tx.booking.update({ where: { id: b.id }, data: { membershipSubscriptionId: priced.subscriptionId } });
    await createQuote(tx, b.id, priced, { kind: 'INITIAL', status: 'PENDING_CUSTOMER_APPROVAL', assumptions: { useMembership: opts.useMembership ?? true } });
    await transition(tx, after, b, 'QUOTED', { userId: customer.userId, role: 'CUSTOMER' }, { reason: 'Quote refreshed', quiet: true });
  });
}

export async function confirmBooking(customer: Principal, bookingId: string, quoteId: string) {
  return withTx(async (tx, after) => {
    const b = await tx.booking.findUnique({ where: { id: bookingId }, include: { fleetAccount: true } });
    if (!b || b.customerUserId !== customer.userId) throw notFound('Booking');
    if (b.status !== 'QUOTED') throw conflict(`Booking is already ${STATUS_LABELS[b.status].toLowerCase()}`);
    const q = await tx.bookingQuote.findUnique({ where: { id: quoteId } });
    if (!q || q.bookingId !== b.id || q.status !== 'PENDING_CUSTOMER_APPROVAL') throw conflict('This quote is no longer available. Refresh the quote.');
    if (q.expiresAt && q.expiresAt < new Date()) {
      await tx.bookingQuote.update({ where: { id: q.id }, data: { status: 'EXPIRED' } });
      throw conflict('This quote has expired. Refresh to get an updated price.', { code: 'QUOTE_EXPIRED' });
    }

    // Corporate accounts: enforce credit limit and contract usage limits.
    if (b.fleetAccount) {
      if (b.fleetAccount.status !== 'ACTIVE') throw forbidden('This business account is not active');
      if (b.fleetAccount.creditLimit > 0) {
        const owed = await tx.invoice.aggregate({ where: { fleetAccountId: b.fleetAccount.id, status: 'ISSUED' }, _sum: { outstanding: true } });
        if ((owed._sum.outstanding ?? 0) + q.total > b.fleetAccount.creditLimit) throw unprocessable('This booking would exceed your business account credit limit. Contact your fleet manager.');
      }
      const contract = await tx.fleetContract.findFirst({ where: { fleetAccountId: b.fleetAccount.id, active: true, startsAt: { lte: new Date() }, endsAt: { gt: new Date() } } });
      if (contract?.monthlyServiceLimit) {
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);
        const used = await tx.booking.count({ where: { fleetAccountId: b.fleetAccount.id, createdAt: { gte: monthStart }, status: { notIn: ['CANCELLED', 'REQUESTED', 'QUOTED'] } } });
        if (used >= contract.monthlyServiceLimit) throw unprocessable(`Your contract allows ${contract.monthlyServiceLimit} services per month and this limit has been reached.`);
      }
    }

    await tx.bookingQuote.update({ where: { id: q.id }, data: { status: 'APPROVED', decidedById: customer.userId, decidedAt: new Date() } });
    if (b.promoCode) {
      await tx.promoCode.updateMany({ where: { code: b.promoCode, OR: [{ maxUses: null }, { usedCount: { lt: tx.promoCode.fields.maxUses } }] }, data: { usedCount: { increment: 1 } } });
    }
    await transition(tx, after, b, 'CONFIRMED', { userId: customer.userId, role: 'CUSTOMER' }, { metadata: { quoteId: q.id, total: q.total } });

    const s = await getSettings(tx);
    if (b.requiresManualReview) {
      await raiseEscalation(tx, after, b.id, 'MANUAL_REVIEW', `Manual review required: ${b.manualReviewReasons.join('; ')}`);
    } else if (b.type === 'EMERGENCY') {
      await transition(tx, after, b, 'SEARCHING_FOR_PROVIDER', SYSTEM);
      if (s.dispatch.autoDispatch) await enqueue(tx, 'dispatch.run', { bookingId: b.id }, { dedupeKey: `dispatch:${b.id}:${b.version}` });
      else await notifyOps(tx, { type: 'dispatch.needed', title: `${b.code} needs assignment`, body: 'Auto-dispatch is off. Assign a provider manually.', data: { bookingId: b.id } });
    }
  });
}

// ─── Cancellation ────────────────────────────────────────────────────

async function policyFor(db: Db, bookingId: string) {
  const q = await db.bookingQuote.findFirst({ where: { bookingId, status: { in: ['APPROVED', 'PENDING_CUSTOMER_APPROVAL'] } }, orderBy: { version: 'desc' } });
  const rules = (q?.pricingSnapshot as { rules?: RateCardRules } | null)?.rules;
  return rules?.cancellationPolicy ?? { acceptedFee: 0, arrivedFee: 0, description: 'Free cancellation' };
}

export async function cancellationPreview(bookingId: string) {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const policy = await policyFor(prisma, bookingId);
  const stage = cancellationStage(b.status);
  return { status: b.status, stage, fee: cancellationFee(policy, stage), policy };
}

export async function cancelBooking(
  actor: Actor,
  bookingId: string,
  input: { reason: string; acceptFee?: boolean; waiveFee?: boolean },
) {
  return withTx(async (tx, after) => {
    const b = await tx.booking.findUnique({ where: { id: bookingId }, include: { customer: true } });
    if (!b) throw notFound('Booking');
    if (actor.role === 'CUSTOMER' && b.customerUserId !== actor.userId) throw notFound('Booking');
    const policy = await policyFor(tx, b.id);
    const stage = cancellationStage(b.status);
    let fee = cancellationFee(policy, stage);
    if (input.waiveFee) {
      if (actor.role === 'CUSTOMER') throw forbidden('Only operations staff can waive cancellation fees');
      fee = 0;
    }
    if (fee > 0 && actor.role === 'CUSTOMER' && !input.acceptFee)
      throw conflict('A cancellation fee applies at this stage', { code: 'CANCELLATION_FEE_REQUIRED', fee, stage, policy });

    const released = await releaseLiveAssignment(tx, after, b.id, 'CANCELLED', 'Booking cancelled');
    await tx.bookingQuote.updateMany({ where: { bookingId: b.id, status: { in: ['PENDING_CUSTOMER_APPROVAL', 'PENDING_INTERNAL_APPROVAL'] } }, data: { status: 'SUPERSEDED' } });
    await transition(tx, after, b, 'CANCELLED', actor, {
      reason: input.reason,
      data: { cancellationReason: input.reason, cancellationFee: fee, cancelledById: actor.userId },
      metadata: { fee, stage, waived: !!input.waiveFee },
    });
    if (fee > 0) await createCancellationInvoice(tx, b, fee, policy.description);
    if (released) after(() => emitToUser(released, 'job.cancelled', { bookingId: b.id, reason: input.reason }, b.id));
    return { fee };
  });
}

// ─── Read models ─────────────────────────────────────────────────────

export const bookingDetailInclude = {
  serviceCategory: true,
  zone: { select: { id: true, name: true, city: true } },
  vehicle: true,
  customer: { select: { id: true, fullName: true, phone: true } },
  locations: true,
  assessment: true,
  attachments: { orderBy: { createdAt: 'asc' } },
  quotes: { orderBy: { version: 'desc' }, include: { items: { orderBy: { sortOrder: 'asc' } } } },
  assignments: {
    orderBy: { offeredAt: 'desc' },
    include: {
      driver: { select: { id: true, fullName: true, phone: true, photoKey: true, workerProfile: { select: { verificationStatus: true, employeeCode: true } } } },
      truck: { select: { id: true, registrationNumber: true, truckType: true, make: true, model: true } },
    },
  },
  teamMembers: { where: { active: true }, include: { user: { select: { id: true, fullName: true, phone: true, photoKey: true } } } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  conditionReports: { orderBy: { createdAt: 'asc' } },
  custody: true,
  invoice: { select: { id: true, number: true, total: true, outstanding: true, paymentStatus: true, amountPaid: true, amountPendingCash: true } },
  ratings: true,
  escalations: { orderBy: { createdAt: 'desc' } },
  incidents: { orderBy: { createdAt: 'desc' } },
  shareLinks: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, expiresAt: true, viewCount: true, createdAt: true } },
} satisfies Prisma.BookingInclude;

type BookingDetail = Prisma.BookingGetPayload<{ include: typeof bookingDetailInclude }>;

export type Viewer = 'customer' | 'field' | 'offered' | 'staff';

export async function resolveViewer(p: Principal, b: Pick<Booking, 'id' | 'customerUserId'>): Promise<Viewer | null> {
  if (b.customerUserId === p.userId) return 'customer';
  if (p.permissions.has('booking:read_any')) return 'staff';
  const a = await prisma.bookingAssignment.findFirst({ where: { bookingId: b.id, driverUserId: p.userId, status: { in: ['OFFERED', 'ACCEPTED', 'COMPLETED'] } }, orderBy: { offeredAt: 'desc' } });
  if (a?.status === 'ACCEPTED' || a?.status === 'COMPLETED') return 'field';
  const t = await prisma.bookingTeamMember.findFirst({ where: { bookingId: b.id, userId: p.userId, active: true } });
  if (t) return 'field';
  if (a?.status === 'OFFERED') return 'offered';
  return null;
}

async function driverLocation(b: BookingDetail) {
  const live = b.assignments.find((a) => a.status === 'ACCEPTED');
  if (!live || !LIVE_TRACKING_STATUSES.includes(b.status)) return null;
  const av = await prisma.driverAvailability.findUnique({ where: { userId: live.driverUserId }, select: { lastLat: true, lastLng: true, lastLocationAt: true, lastAccuracyM: true } });
  if (!av?.lastLat || !av.lastLng) return null;
  return { lat: av.lastLat, lng: av.lastLng, at: av.lastLocationAt, accuracyM: av.lastAccuracyM };
}

const signAttachments = (atts: BookingDetail['attachments']) => atts.map((a) => ({ ...a, storageKey: undefined, url: signedFileUrl(a.storageKey) }));

/** Role-scoped projection: each viewer only receives what they are entitled to see. */
export async function projectBooking(b: BookingDetail, viewer: Viewer, p: Principal) {
  const liveAssignment = b.assignments.find((a) => a.status === 'ACCEPTED') ?? null;
  const offered = b.assignments.find((a) => a.status === 'OFFERED') ?? null;
  const approved = b.quotes.find((q) => q.status === 'APPROVED') ?? null;
  const pendingQuote = b.quotes.find((q) => q.status === 'PENDING_CUSTOMER_APPROVAL' || q.status === 'PENDING_INTERNAL_APPROVAL') ?? null;
  const pickup = b.locations.find((l) => l.kind === 'PICKUP')!;
  const dropoff = b.locations.find((l) => l.kind === 'DROPOFF') ?? null;
  const common = {
    id: b.id,
    code: b.code,
    status: b.status,
    statusLabel: STATUS_LABELS[b.status],
    type: b.type,
    scheduledFor: b.scheduledFor,
    priority: b.priority,
    safetyFlags: b.safetyFlags,
    serviceCategory: { id: b.serviceCategory.id, key: b.serviceCategory.key, name: b.serviceCategory.name, kind: b.serviceCategory.kind },
    zone: b.zone,
    vehicle: b.vehicle && { id: b.vehicle.id, vehicleClass: b.vehicle.vehicleClass, registrationNumber: b.vehicle.registrationNumber, make: b.vehicle.make, model: b.vehicle.model, fuelType: b.vehicle.fuelType, color: b.vehicle.color },
    towDistanceKm: b.towDistanceKm,
    pickupDistanceKm: b.pickupDistanceKm,
    distanceSource: b.distanceSource,
    etaAt: b.etaAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    completedAt: b.completedAt,
    version: b.version,
  };

  if (viewer === 'offered') {
    // Before acceptance: no exact customer location or contact details.
    return {
      ...common,
      viewer,
      pickupArea: { ...coarsen(pickup), landmark: pickup.landmark ?? null, approximate: true },
      dropoffArea: dropoff ? { ...coarsen(dropoff), placeName: dropoff.placeName, approximate: true } : null,
      assessment: b.assessment,
      recommendation: b.recommendation,
      crewRecommended: b.crewRecommended,
      offer: offered && offered.driverUserId === p.userId ? { id: offered.id, expiresAt: offered.expiresAt, etaMinutes: offered.etaMinutes, distanceKm: offered.distanceKm } : null,
      quoteTotal: approved?.total ?? null,
    };
  }

  const team = b.teamMembers.map((t) => ({ userId: t.userId, name: t.user.fullName, role: t.role, responsibility: t.responsibility, photoUrl: t.user.photoKey ? signedFileUrl(t.user.photoKey) : null }));
  const driver = liveAssignment && {
    id: liveAssignment.driver.id,
    name: liveAssignment.driver.fullName,
    verified: liveAssignment.driver.workerProfile?.verificationStatus === 'APPROVED',
    photoUrl: liveAssignment.driver.photoKey ? signedFileUrl(liveAssignment.driver.photoKey) : null,
    truck: liveAssignment.truck,
    etaMinutes: liveAssignment.etaMinutes,
  };
  const full = {
    ...common,
    viewer,
    pickup,
    dropoff,
    assessment: b.assessment,
    recommendation: b.recommendation,
    crewRequested: b.crewRequested,
    crewRecommended: b.crewRecommended,
    requiresManualReview: b.requiresManualReview,
    manualReviewReasons: b.manualReviewReasons,
    reviewedAt: b.reviewedAt,
    instructions: b.instructions,
    contactName: b.contactName,
    attachments: signAttachments(b.attachments),
    quotes: b.quotes,
    approvedQuoteId: approved?.id ?? null,
    pendingQuoteId: pendingQuote?.id ?? null,
    driver,
    team,
    driverLocation: await driverLocation(b),
    statusHistory: b.statusHistory,
    conditionReports: b.conditionReports,
    custody: b.custody.map((c) => ({ stage: c.stage, method: c.method, recipientName: c.recipientName, recipientRelation: c.recipientRelation, overrideReason: c.overrideReason, createdAt: c.createdAt })),
    invoice: b.invoice,
    cancellationReason: b.cancellationReason,
    cancellationFee: b.cancellationFee,
    failureReason: b.failureReason,
    pickupVerifiedAt: b.pickupVerifiedAt,
    waitingMinutes: b.waitingMinutes,
  };

  if (viewer === 'customer') {
    return {
      ...full,
      // Codes the customer shares in person: pickup code with the driver, handover code with the recipient.
      pickupOtp: TERMINAL_STATUSES.includes(b.status) ? null : b.pickupOtp,
      handoverOtp: TERMINAL_STATUSES.includes(b.status) ? null : b.handoverOtp,
      ratings: b.ratings.filter((r) => r.raterUserId === p.userId),
      shareLinks: b.shareLinks,
      cancellable: allowedNext(b.status, 'CUSTOMER').includes('CANCELLED'),
      contactPhone: b.contactPhone,
    };
  }
  if (viewer === 'field') {
    return {
      ...full,
      customer: { name: b.contactName, phone: b.contactPhone },
      // Field staff see the quoted total and their own team; never OTP values.
      quotes: b.quotes.map((q) => ({ ...q, pricingSnapshot: undefined })),
      allowedNext: allowedNext(b.status, p.roles.includes('driver') ? 'DRIVER' : 'WORKER'),
    };
  }
  // staff
  return {
    ...full,
    customer: b.customer,
    contactPhone: b.contactPhone,
    assignments: b.assignments.map((a) => ({ ...a, driver: { id: a.driver.id, fullName: a.driver.fullName, phone: a.driver.phone } })),
    escalations: b.escalations,
    incidents: b.incidents,
    ratings: b.ratings,
    allowedNext: allowedNext(b.status, p.roles.includes('admin') ? 'ADMIN' : 'DISPATCHER'),
  };
}

export async function getBookingFor(p: Principal, id: string) {
  const b = await prisma.booking.findUnique({ where: { id }, include: bookingDetailInclude });
  if (!b) throw notFound('Booking');
  const viewer = await resolveViewer(p, b);
  if (!viewer) throw notFound('Booking'); // do not reveal existence
  return projectBooking(b, viewer, p);
}

export const listSummarySelect = {
  id: true,
  code: true,
  status: true,
  type: true,
  priority: true,
  scheduledFor: true,
  createdAt: true,
  completedAt: true,
  requiresManualReview: true,
  safetyFlags: true,
  contactName: true,
  serviceCategory: { select: { name: true, key: true, kind: true } },
  vehicle: { select: { registrationNumber: true, make: true, model: true, vehicleClass: true } },
  zone: { select: { name: true } },
  invoice: { select: { id: true, number: true, total: true, outstanding: true, paymentStatus: true } },
  quotes: { where: { status: { in: ['APPROVED', 'PENDING_CUSTOMER_APPROVAL'] } }, select: { total: true, status: true }, orderBy: { version: 'desc' }, take: 1 },
  locations: { select: { kind: true, address: true, lat: true, lng: true, placeName: true } },
} satisfies Prisma.BookingSelect;

export const statusGroups: Record<string, BookingStatus[]> = {
  active: (Object.keys(STATUS_LABELS) as BookingStatus[]).filter((s) => !TERMINAL_STATUSES.includes(s)),
  completed: ['COMPLETED', 'DELIVERED'],
  cancelled: ['CANCELLED', 'FAILED'],
  unassigned: NEEDS_PROVIDER_STATUSES,
};
