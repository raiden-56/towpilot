/** Read models shared by several portals, mirroring the API's projections. */
import type { BookingDetail, BookingSummary, Invoice, Me } from '@/api/types';
import type { GBooking, GInvoice, GUser } from './model';
import { categoryById, db, invoiceForBooking, permissionsFor, truckById, userById, vehicleById, zoneById } from './db';
import { actorFor, allowedNext, LIVE_TRACKING_STATUSES, STATUS_LABELS, TERMINAL_STATUSES } from './bookingOps';

export type Viewer = 'customer' | 'field' | 'offered' | 'staff';

export function meFor(u: GUser): Me {
  return {
    id: u.id,
    fullName: u.fullName,
    phone: u.phone,
    email: u.email,
    status: u.status,
    roles: u.roles,
    permissions: permissionsFor(u.roles),
    photoUrl: u.photoUrl,
    customerProfile: u.customerProfile && {
      marketingConsent: u.customerProfile.marketingConsent,
      locationConsent: u.customerProfile.locationConsent,
      notifySms: u.customerProfile.notifySms,
      notifyEmail: u.customerProfile.notifyEmail,
      notifyPush: u.customerProfile.notifyPush,
      preferredLanguage: u.customerProfile.preferredLanguage,
      consentVersion: u.customerProfile.consentVersion,
    },
    workerProfile: u.workerProfile && { employeeCode: u.workerProfile.employeeCode, verificationStatus: u.workerProfile.verificationStatus, employmentType: u.workerProfile.employmentType },
  };
}

/** Which projection a user gets for a booking (as resolveViewer in the API). */
export function resolveViewer(u: GUser, b: GBooking): Viewer | null {
  if (b.customerUserId === u.id) return 'customer';
  if (permissionsFor(u.roles).includes('booking:read_any')) return 'staff';
  const a = [...b.assignments].reverse().find((x) => x.driverUserId === u.id && ['OFFERED', 'ACCEPTED', 'COMPLETED'].includes(x.status));
  if (a?.status === 'ACCEPTED' || a?.status === 'COMPLETED') return 'field';
  if (b.teamMembers.some((t) => t.userId === u.id && t.active)) return 'field';
  if (a?.status === 'OFFERED') return 'offered';
  return null;
}

const coarsen = (p: { lat: number; lng: number }) => ({ lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 });

export function invoiceBrief(inv: GInvoice | undefined) {
  return inv ? { id: inv.id, number: inv.number, total: inv.total, outstanding: inv.outstanding, paymentStatus: inv.paymentStatus, amountPaid: inv.amountPaid, amountPendingCash: inv.amountPendingCash } : null;
}

/** Role-scoped projection of a booking — GET /bookings/:id. */
export function projectBooking(b: GBooking, viewer: Viewer, u: GUser): BookingDetail & Record<string, unknown> {
  const c = categoryById(b.serviceCategoryId);
  const z = zoneById(b.zoneId);
  const v = vehicleById(b.vehicleId);
  const live = b.assignments.find((a) => a.status === 'ACCEPTED') ?? null;
  const offered = b.assignments.find((a) => a.status === 'OFFERED') ?? null;
  const quotes = [...b.quotes].sort((x, y) => y.version - x.version);
  const approved = quotes.find((q) => q.status === 'APPROVED') ?? null;
  const pending = quotes.find((q) => q.status === 'PENDING_CUSTOMER_APPROVAL' || q.status === 'PENDING_INTERNAL_APPROVAL') ?? null;
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
    serviceCategory: { id: c.id, key: c.key, name: c.name, kind: c.kind },
    zone: z ? { id: z.id, name: z.name, city: z.city } : null,
    vehicle: v ? { id: v.id, vehicleClass: v.vehicleClass, registrationNumber: v.registrationNumber, make: v.make, model: v.model, fuelType: v.fuelType, color: v.color } : null,
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
    return {
      ...common,
      viewer,
      pickupArea: { ...coarsen(pickup), landmark: pickup.landmark ?? null, approximate: true },
      dropoffArea: dropoff ? { ...coarsen(dropoff), placeName: dropoff.placeName, approximate: true } : null,
      assessment: b.assessment,
      recommendation: b.recommendation,
      crewRecommended: b.crewRecommended,
      offer: offered && offered.driverUserId === u.id ? { id: offered.id, expiresAt: offered.expiresAt, etaMinutes: offered.etaMinutes, distanceKm: offered.distanceKm } : null,
      quoteTotal: approved?.total ?? null,
    };
  }
  const liveDriver = live ? userById(live.driverUserId) : undefined;
  const liveTruck = truckById(live?.truckId);
  const av = liveDriver?.availability;
  const driverLocation = live && LIVE_TRACKING_STATUSES.includes(b.status) && av?.lastLat != null && av.lastLng != null ? { lat: av.lastLat, lng: av.lastLng, at: av.lastLocationAt ?? b.updatedAt, accuracyM: av.lastAccuracyM } : null;
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
    attachments: b.attachments.map((a) => ({ id: a.id, kind: a.kind, mimeType: a.mimeType, url: a.url, caption: a.caption, createdAt: a.createdAt })),
    quotes: quotes.map((q) => ({ ...q, items: [...q.items].sort((x, y) => x.sortOrder - y.sortOrder) })),
    approvedQuoteId: approved?.id ?? null,
    pendingQuoteId: pending?.id ?? null,
    driver: live && liveDriver
      ? {
          id: liveDriver.id,
          name: liveDriver.fullName,
          verified: liveDriver.workerProfile?.verificationStatus === 'APPROVED',
          photoUrl: liveDriver.photoUrl,
          truck: liveTruck ? { id: liveTruck.id, registrationNumber: liveTruck.registrationNumber, truckType: liveTruck.truckType, make: liveTruck.make, model: liveTruck.model } : null,
          etaMinutes: b.etaAt && ['ACCEPTED', 'EN_ROUTE'].includes(b.status) ? Math.max(1, Math.round((new Date(b.etaAt).getTime() - Date.now()) / 60_000)) : live.etaMinutes,
        }
      : null,
    team: b.teamMembers.filter((t) => t.active).map((t) => ({ userId: t.userId, name: userById(t.userId)?.fullName ?? 'Crew member', role: t.role, responsibility: t.responsibility, photoUrl: null })),
    driverLocation,
    statusHistory: b.statusHistory,
    conditionReports: b.conditionReports,
    custody: b.custody.map((x) => ({ stage: x.stage, method: x.method, recipientName: x.recipientName, recipientRelation: x.recipientRelation, overrideReason: x.overrideReason, createdAt: x.createdAt })),
    invoice: invoiceBrief(invoiceForBooking(b.id)),
    cancellationReason: b.cancellationReason,
    cancellationFee: b.cancellationFee,
    failureReason: b.failureReason,
    pickupVerifiedAt: b.pickupVerifiedAt,
    waitingMinutes: b.waitingMinutes,
  };
  const ratings = ratingsFor(b.id);
  if (viewer === 'customer') {
    return {
      ...full,
      pickupOtp: TERMINAL_STATUSES.includes(b.status) ? null : b.pickupOtp,
      handoverOtp: TERMINAL_STATUSES.includes(b.status) ? null : b.handoverOtp,
      ratings: ratings.filter((r) => r.raterUserId === u.id).map((r) => ({ score: r.score, comment: r.comment })),
      shareLinks: b.shareLinks.filter((s) => !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now()).map((s) => ({ id: s.id, expiresAt: s.expiresAt, viewCount: s.viewCount, createdAt: s.createdAt })),
      cancellable: allowedNext(b.status, 'CUSTOMER').includes('CANCELLED'),
      contactPhone: b.contactPhone,
    };
  }
  if (viewer === 'field') {
    return {
      ...full,
      customer: { name: b.contactName, phone: b.contactPhone },
      quotes: full.quotes.map((q) => ({ ...q, pricingSnapshot: undefined })),
      allowedNext: allowedNext(b.status, u.roles.includes('driver') ? 'DRIVER' : 'WORKER'),
    } as BookingDetail & Record<string, unknown>;
  }
  const cust = userById(b.customerUserId);
  return {
    ...full,
    customer: { id: b.customerUserId, fullName: cust?.fullName ?? b.contactName, phone: cust?.phone ?? null },
    contactPhone: b.contactPhone,
    assignments: [...b.assignments]
      .sort((x, y) => y.offeredAt.localeCompare(x.offeredAt))
      .map((a) => {
        const d = userById(a.driverUserId);
        const t = truckById(a.truckId);
        return { ...a, driver: { id: a.driverUserId, fullName: d?.fullName ?? 'Driver', phone: d?.phone ?? null }, truck: t ? { id: t.id, registrationNumber: t.registrationNumber, truckType: t.truckType, make: t.make, model: t.model } : null };
      }),
    escalations: escalationsFor(b.id),
    incidents: incidentsFor(b.id),
    ratings: ratings.map((r) => ({ id: r.id, score: r.score, comment: r.comment, tags: r.tags, createdAt: r.createdAt })),
    allowedNext: allowedNext(b.status, actorFor(u.roles)),
  } as unknown as BookingDetail & Record<string, unknown>;
}

const ratingsFor = (bookingId: string) => db.ratings.filter((r) => r.bookingId === bookingId);
const escalationsFor = (bookingId: string) => db.escalations.filter((e) => e.bookingId === bookingId).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
const incidentsFor = (bookingId: string) => db.incidents.filter((e) => e.bookingId === bookingId).sort((x, y) => y.createdAt.localeCompare(x.createdAt));

/** List row — GET /bookings (listSummarySelect). */
export function bookingSummary(b: GBooking): BookingSummary & { contactName: string } {
  const c = categoryById(b.serviceCategoryId);
  const v = vehicleById(b.vehicleId);
  const inv = invoiceForBooking(b.id);
  const q = [...b.quotes].sort((x, y) => y.version - x.version).find((x) => x.status === 'APPROVED' || x.status === 'PENDING_CUSTOMER_APPROVAL');
  return {
    id: b.id,
    code: b.code,
    status: b.status,
    type: b.type,
    priority: b.priority,
    scheduledFor: b.scheduledFor,
    createdAt: b.createdAt,
    completedAt: b.completedAt,
    requiresManualReview: b.requiresManualReview,
    safetyFlags: b.safetyFlags,
    contactName: b.contactName,
    serviceCategory: { name: c.name, key: c.key, kind: c.kind },
    vehicle: v ? { registrationNumber: v.registrationNumber, make: v.make, model: v.model, vehicleClass: v.vehicleClass } : null,
    zone: zoneById(b.zoneId) ? { name: zoneById(b.zoneId)!.name } : null,
    invoice: inv ? { id: inv.id, number: inv.number, total: inv.total, outstanding: inv.outstanding, paymentStatus: inv.paymentStatus } : null,
    quotes: q ? [{ total: q.total, status: q.status }] : [],
    locations: b.locations.map((l) => ({ kind: l.kind, address: l.address, lat: l.lat, lng: l.lng, placeName: l.placeName })),
  };
}

/** Invoice as listed to customers — GET /invoices (scalar invoice fields + booking code). */
export function invoiceView(inv: GInvoice): Invoice & Record<string, unknown> {
  const { items: _items, ...rest } = inv;
  void _items;
  const b = inv.bookingId ? db.bookings.find((x) => x.id === inv.bookingId) : undefined;
  return { ...rest, booking: b ? { id: b.id, code: b.code } : null };
}
