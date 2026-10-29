/**
 * Guest-mode bookings API (apps/api/src/modules/bookings): list, detail, the request wizard,
 * quote confirmation, simulated dispatch, cancellation, sharing, evidence and customer actions.
 * Account, billing, memberships, support and profile endpoints live in ./customerAccount.
 */
import type { Assessment, BookingStatus } from '@/api/types';
import type { GBooking, GInvoice, GLocation, GUser } from '../model';
import type { QuoteDiscounts, QuoteInput } from '../pricing';
import {
  categoryById,
  db,
  HOUR,
  istHour,
  MIN,
  newId,
  newOtp,
  nextBookingCode,
  nextInvoiceNumber,
  nowIso,
  pushNotification,
  quoteRecord,
  recommendationFor,
  truckForDriver,
  userById,
  vehicleById,
} from '../db';
import { cancellationStage, statusGroups, STATUS_LABELS, TERMINAL_STATUSES, transition } from '../bookingOps';
import { fail, inRange, matchesText, notFound, on, paged, str } from '../router';
import { bookingSummary, projectBooking, resolveViewer } from '../serialize';
import { pdfFile, placeholderImage } from '../files';
import { zoneAt } from './core';
import { can, createTicket, haversineKm, me, roadKm } from './customerShared';
import './customerAccount';

const bookingOr404 = (id: string) => db.bookings.find((b) => b.id === id) ?? notFound('Booking');
/** Booking the user is entitled to see, with their projection. */
function visible(u: GUser, id: string) {
  const b = bookingOr404(id);
  const viewer = resolveViewer(u, b);
  if (!viewer) return notFound('Booking');
  return { b, viewer };
}
const detail = (u: GUser, b: GBooking) => projectBooking(b, resolveViewer(u, b) ?? 'customer', u);
const ownBooking = (u: GUser, id: string) => {
  const b = bookingOr404(id);
  if (b.customerUserId !== u.id) notFound('Booking');
  return b;
};

// ─── List & detail ────────────────────────────────────────────────────

on('GET', '/bookings', (c) => {
  const u = me(c.userId);
  const q = c.query;
  const staff = can(u, 'booking:read_any');
  const group = str(q.group);
  const statuses = str(q.status)?.split(',') as BookingStatus[] | undefined;
  const rows = db.bookings
    .filter((b) => staff || b.customerUserId === u.id)
    .filter((b) => !group || (statusGroups[group] ?? []).includes(b.status))
    .filter((b) => !statuses || statuses.includes(b.status))
    .filter((b) => !str(q.zoneId) || b.zoneId === q.zoneId)
    .filter((b) => !str(q.serviceCategoryId) || b.serviceCategoryId === q.serviceCategoryId)
    .filter((b) => (!q.from && !q.to) || inRange(b.createdAt, q))
    .filter((b) => matchesText(str(q.q), b.code, vehicleById(b.vehicleId)?.registrationNumber, b.contactName))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return paged(rows.map(bookingSummary), q);
});

on('GET', '/bookings/:id', (c) => {
  const u = me(c.userId);
  const { b, viewer } = visible(u, c.params.id!);
  return projectBooking(b, viewer, u);
});

on('GET', '/bookings/:id/tracking', (c) => {
  const u = me(c.userId);
  const { b, viewer } = visible(u, c.params.id!);
  const d = projectBooking(b, viewer, u);
  return { status: d.status, etaAt: d.etaAt, driverLocation: d.driverLocation ?? null, serverTime: nowIso() };
});

// ─── Request wizard: create & quote ───────────────────────────────────

type LocationBody = Partial<GLocation> & { lat: number; lng: number; source?: GLocation['source'] };

function locationFrom(kind: GLocation['kind'], l: LocationBody): GLocation {
  return {
    id: newId('loc'),
    kind,
    lat: Number(l.lat),
    lng: Number(l.lng),
    accuracyM: l.accuracyM ?? null,
    capturedAt: l.capturedAt ?? (kind === 'PICKUP' ? nowIso() : null),
    source: l.source ?? 'MAP_PIN',
    address: l.address ?? null,
    landmark: l.landmark ?? null,
    highway: l.highway ?? null,
    roadDirection: l.roadDirection ?? null,
    kmMarker: l.kmMarker ?? null,
    gateNumber: l.gateNumber ?? null,
    floor: l.floor ?? null,
    parkingLevel: l.parkingLevel ?? null,
    accessNotes: l.accessNotes ?? null,
    isSafeLocation: l.isSafeLocation ?? null,
    destinationType: kind === 'DROPOFF' ? (l.destinationType ?? 'CUSTOM') : null,
    placeName: l.placeName ?? null,
    createdAt: nowIso(),
  };
}

/** Field staff who could take a job: available, verified, with a suitable free truck. */
function candidates(b: GBooking) {
  const pickup = b.locations.find((l) => l.kind === 'PICKUP')!;
  return db.users
    .filter((u) => u.roles.includes('driver') && u.status === 'ACTIVE' && u.workerProfile?.verificationStatus === 'APPROVED' && u.availability?.status === 'AVAILABLE' && u.availability.lastLat != null)
    .map((u) => ({ u, truck: truckForDriver(u.id) }))
    .filter((x) => x.truck && x.truck.status === 'AVAILABLE' && b.recommendation.truckTypes.includes(x.truck.truckType))
    .map((x) => ({ ...x, km: haversineKm({ lat: x.u.availability!.lastLat!, lng: x.u.availability!.lastLng! }, pickup), inZone: !!b.zoneId && !!x.u.workerProfile?.zoneIds.includes(b.zoneId) }))
    .sort((a, b2) => Number(b2.inZone) - Number(a.inZone) || a.km - b2.km);
}

/** Discounts as resolveDiscounts() in apps/api/src/modules/pricing/service.ts. */
function discountsFor(b: GBooking, categoryKey: string, useMembership: boolean) {
  const notes: string[] = [];
  const discounts: QuoteDiscounts = {};
  let subscriptionId: string | null = null;
  if (useMembership) {
    const sub = db.subscriptions
      .filter((s) => s.status === 'ACTIVE' && (!s.endsAt || new Date(s.endsAt).getTime() > Date.now()) && (s.userId === b.customerUserId || (!!b.fleetAccountId && s.fleetAccountId === b.fleetAccountId)))
      .sort((x, y) => (y.endsAt ?? '').localeCompare(x.endsAt ?? ''))[0];
    const plan = sub && db.memberships.find((m) => m.id === sub.membershipId);
    if (sub && plan) {
      if (plan.coveredCategoryKeys.includes(categoryKey)) {
        const remaining = plan.includedServices - sub.servicesUsed;
        discounts.membership = { label: plan.name, waiveBaseFee: remaining > 0, extraFreeKm: remaining > 0 ? plan.includedKmPerService : 0, discountBps: plan.discountBps };
        subscriptionId = sub.id;
        notes.push(remaining > 0 ? `${plan.name}: ${remaining} covered service(s) remaining this term.` : `${plan.name}: covered services used up — member discount still applies.`);
      } else notes.push(`${plan.name} does not cover this service.`);
    }
  }
  if (b.fleetAccountId) {
    const contract = db.fleetAccounts.find((f) => f.id === b.fleetAccountId)?.contracts.find((x) => x.active && new Date(x.startsAt).getTime() <= Date.now() && new Date(x.endsAt).getTime() > Date.now());
    if (contract?.discountBps) discounts.contract = { label: `Contract ${contract.name}`, discountBps: contract.discountBps };
  }
  if (b.promoCode) {
    const p = db.promos.find((x) => x.code === b.promoCode);
    const now = Date.now();
    const valid = p && p.active && new Date(p.validFrom).getTime() <= now && new Date(p.validTo).getTime() > now && (p.maxUses == null || p.usedCount < p.maxUses);
    if (p && valid) discounts.promo = { code: p.code, discountBps: p.discountBps, maxDiscount: p.maxDiscount };
    else notes.push(`Promo code ${b.promoCode} is not valid.`);
  }
  return { discounts, subscriptionId, notes };
}

/** Prices the booking and adds a new quote awaiting the customer's approval. */
function addQuote(b: GBooking, useMembership: boolean, extraNotes: string[] = []) {
  const c = categoryById(b.serviceCategoryId);
  const d = discountsFor(b, c.key, useMembership);
  b.membershipSubscriptionId = d.subscriptionId;
  const when = b.scheduledFor ? new Date(b.scheduledFor).getTime() : Date.now();
  const input: QuoteInput = {
    serviceKind: c.kind,
    towDistanceKm: b.towDistanceKm ?? 0,
    pickupDistanceKm: b.pickupDistanceKm,
    crew: Math.max(b.crewRequested, b.crewRecommended),
    equipment: [...b.recommendation.equipment],
    localHour: istHour(when),
    isHoliday: false,
    scheduled: b.type === 'SCHEDULED',
    discounts: d.discounts,
  };
  for (const q of b.quotes) if (q.status === 'PENDING_CUSTOMER_APPROVAL') q.status = 'SUPERSEDED';
  const version = b.quotes.reduce((m, q) => Math.max(m, q.version), 0) + 1;
  const quote = quoteRecord(b.id, version, 'INITIAL', 'PENDING_CUSTOMER_APPROVAL', c.key, input, Date.now(), { id: newId('q') });
  quote.assumptions = { ...quote.assumptions, notes: [...extraNotes, ...d.notes, ...(quote.assumptions.notes ?? [])] };
  b.quotes.push(quote);
  return quote;
}

on('POST', '/bookings', (c) => {
  const u = me(c.userId);
  const body = c.body as {
    serviceCategoryId: string;
    vehicleId: string;
    type?: 'EMERGENCY' | 'SCHEDULED';
    scheduledFor?: string;
    pickup: LocationBody;
    dropoff?: LocationBody;
    assessment: Assessment;
    crewRequested?: number;
    contactName: string;
    contactPhone: string;
    instructions?: string;
    promoCode?: string;
    useMembership?: boolean;
  };
  const v = vehicleById(body.vehicleId);
  const fleetMember = (fid: string | null) => !!fid && db.fleetAccounts.some((f) => f.id === fid && f.members.some((m) => m.userId === u.id));
  if (!v || v.deletedAt || (v.ownerUserId !== u.id && !fleetMember(v.fleetAccountId))) return notFound('Vehicle');
  const cat = db.categories.find((x) => x.id === body.serviceCategoryId);
  if (!cat || !cat.active) return fail(422, 'UNPROCESSABLE', 'This service is not available');
  if (cat.vehicleClasses.length && !cat.vehicleClasses.includes(v.vehicleClass)) fail(422, 'UNPROCESSABLE', `${cat.name} is not available for ${v.vehicleClass.replace('_', ' ').toLowerCase()} vehicles`);
  if (!body.pickup) fail(400, 'VALIDATION_ERROR', 'Pickup location is required', [{ path: 'pickup', message: 'Required' }]);
  const zone = zoneAt(Number(body.pickup.lat), Number(body.pickup.lng));
  if (!zone) fail(422, 'UNPROCESSABLE', 'This location is outside our current service area. Please call support for alternatives.', { code: 'OUTSIDE_SERVICE_AREA' });
  if (!zone.categoryKeys.includes(cat.key)) fail(422, 'UNPROCESSABLE', `${cat.name} is not offered in ${zone.name} right now`);
  if (cat.kind === 'TOWING' && !body.dropoff) fail(400, 'BAD_REQUEST', 'A destination is required for towing', { field: 'dropoff' });
  const type = body.type ?? 'EMERGENCY';
  if (type === 'SCHEDULED') {
    if (!body.scheduledFor) fail(400, 'BAD_REQUEST', 'Choose a date and time for the scheduled booking');
    const mins = (new Date(body.scheduledFor).getTime() - Date.now()) / 60000;
    if (mins < 30 || mins > 30 * 24 * 60) fail(400, 'BAD_REQUEST', 'Scheduled time must be between 30 minutes and 30 days from now');
  }

  // An unconfirmed quote for the same vehicle is superseded by the new request.
  for (const s of db.bookings.filter((x) => x.vehicleId === v.id && x.customerUserId === u.id && (x.status === 'REQUESTED' || x.status === 'QUOTED'))) {
    for (const q of s.quotes) if (q.status === 'PENDING_CUSTOMER_APPROVAL') q.status = 'SUPERSEDED';
    transition(s, 'CANCELLED', 'SYSTEM', null, { reason: 'Superseded by a new request for the same vehicle' });
  }

  const assessment: Assessment = { ...body.assessment, notes: body.assessment.notes ?? null };
  const rec = recommendationFor(cat, v.vehicleClass, assessment);
  if (body.pickup.isSafeLocation === false && !rec.safetyFlags.includes('UNSAFE_LOCATION')) rec.safetyFlags.push('UNSAFE_LOCATION');
  const pickup = locationFrom('PICKUP', body.pickup);
  const dropoff = cat.kind === 'TOWING' && body.dropoff ? locationFrom('DROPOFF', body.dropoff) : null;
  const at = nowIso();
  const id = newId('bk');
  const fleetContract = v.fleetAccountId ? db.fleetAccounts.find((f) => f.id === v.fleetAccountId)?.contracts.find((x) => x.active && x.slaResponseMinutes) : undefined;
  if (fleetContract && rec.priority === 'NORMAL') {
    rec.priority = 'HIGH';
    rec.reasons.push(`Business contract SLA: response within ${fleetContract.slaResponseMinutes} minutes.`);
  }
  const b: GBooking = {
    id,
    code: nextBookingCode(),
    customerUserId: u.id,
    vehicleId: v.id,
    fleetAccountId: v.fleetAccountId,
    serviceCategoryId: cat.id,
    zoneId: zone.id,
    status: 'REQUESTED',
    type,
    scheduledFor: type === 'SCHEDULED' && body.scheduledFor ? new Date(body.scheduledFor).toISOString() : null,
    priority: rec.priority as GBooking['priority'],
    safetyFlags: rec.safetyFlags,
    requiresManualReview: rec.manualReviewReasons.length > 0,
    manualReviewReasons: rec.manualReviewReasons,
    reviewedById: null,
    reviewedAt: null,
    recommendation: rec,
    crewRequested: body.crewRequested ?? 1,
    crewRecommended: rec.crew,
    contactName: body.contactName,
    contactPhone: body.contactPhone,
    instructions: body.instructions ?? null,
    promoCode: body.promoCode?.toUpperCase() ?? null,
    membershipSubscriptionId: null,
    pickupOtp: newOtp(),
    handoverOtp: newOtp(),
    pickupVerifiedAt: null,
    pickupDistanceKm: null,
    towDistanceKm: dropoff ? roadKm(pickup, dropoff) : null,
    distanceSource: dropoff ? 'estimate' : null,
    etaAt: null,
    arrivedAt: null,
    waitingMinutes: 0,
    dispatchAttempts: 0,
    cancellationReason: null,
    cancellationFee: 0,
    cancelledById: null,
    failureReason: null,
    holdReturnStatus: null,
    completedAt: null,
    version: 0,
    isSample: true,
    createdAt: at,
    updatedAt: at,
    locations: dropoff ? [pickup, dropoff] : [pickup],
    assessment,
    attachments: [],
    quotes: [],
    assignments: [],
    teamMembers: [],
    statusHistory: [{ id: newId('sh'), fromStatus: null, toStatus: 'REQUESTED', actorUserId: u.id, actorRole: 'CUSTOMER', reason: null, isOverride: false, metadata: null, createdAt: at }],
    conditionReports: [],
    custody: [],
    shareLinks: [],
  };
  const nearest = candidates(b)[0];
  b.pickupDistanceKm = nearest ? Math.max(0.8, Math.round(nearest.km * 1.35 * 10) / 10) : null;
  addQuote(b, body.useMembership ?? true, [nearest ? 'Pickup distance estimated from the nearest available provider (estimate).' : 'No provider location available yet; pickup travel is not charged for this booking.']);
  db.bookings.push(b);
  transition(b, 'QUOTED', 'SYSTEM', null);
  return detail(u, b);
});

on('POST', '/bookings/:id/requote', (c) => {
  const u = me(c.userId);
  const b = ownBooking(u, c.params.id!);
  if (b.status !== 'QUOTED') fail(409, 'CONFLICT', 'Quotes can only be refreshed before confirmation');
  if (c.body.promoCode !== undefined) b.promoCode = c.body.promoCode ? String(c.body.promoCode).toUpperCase() : null;
  addQuote(b, c.body.useMembership !== false);
  b.statusHistory.push({ id: newId('sh'), fromStatus: 'QUOTED', toStatus: 'QUOTED', actorUserId: u.id, actorRole: 'CUSTOMER', reason: 'Quote refreshed', isOverride: false, metadata: null, createdAt: nowIso() });
  b.updatedAt = nowIso();
  return detail(u, b);
});

// ─── Simulated dispatch so a new booking comes alive ──────────────────

function raiseEscalation(b: GBooking, type: 'NO_PROVIDER' | 'MANUAL_REVIEW' | 'CUSTOMER_CANNOT_CONTACT', detailText: string) {
  if (db.escalations.some((e) => e.bookingId === b.id && e.type === type && e.status !== 'RESOLVED')) return;
  db.escalations.unshift({ id: newId('esc'), bookingId: b.id, type, status: 'OPEN', detail: detailText, resolution: null, resolvedById: null, resolvedAt: null, createdAt: nowIso() });
  for (const staff of ['u_admin', 'u_dispatch']) pushNotification(staff, 'escalation.created', type === 'MANUAL_REVIEW' ? 'Manual review needed' : type === 'NO_PROVIDER' ? 'No provider available' : 'Customer cannot reach driver', `${b.code}: ${detailText}`, { bookingId: b.id });
}

/** Offers the job to the best candidate, who accepts and sets off a few seconds later. */
export function simulateDispatch(bookingId: string) {
  setTimeout(() => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b || b.status !== 'SEARCHING_FOR_PROVIDER') return;
    const best = candidates(b)[0];
    if (!best) return raiseEscalation(b, 'NO_PROVIDER', 'No eligible provider is available right now.');
    const now = Date.now();
    const eta = Math.max(8, Math.round((best.km * 1.35 * 60) / 22));
    const a = { id: newId('asg'), bookingId: b.id, driverUserId: best.u.id, truckId: best.truck!.id, status: 'OFFERED' as const, method: 'AUTO' as const, attempt: b.assignments.length + 1, offeredAt: new Date(now).toISOString(), expiresAt: new Date(now + 90_000).toISOString(), respondedAt: null, rejectionReason: null, assignedById: null, etaMinutes: eta, distanceKm: Math.round(best.km * 10) / 10, score: 0.86 };
    b.assignments.push({ ...a });
    b.dispatchAttempts++;
    transition(b, 'ASSIGNED', 'SYSTEM', null);
    setTimeout(() => {
      const asg = b.assignments.find((x) => x.id === a.id);
      if (b.status !== 'ASSIGNED' || !asg || asg.status !== 'OFFERED') return;
      asg.status = 'ACCEPTED';
      asg.respondedAt = nowIso();
      b.teamMembers.push({ id: newId('tm'), userId: best.u.id, role: 'TEAM_LEADER', responsibility: 'Driver and team leader', addedById: null, active: true, createdAt: nowIso() });
      b.etaAt = new Date(Date.now() + eta * MIN).toISOString();
      best.u.availability = { ...best.u.availability!, status: 'ON_JOB', statusSince: nowIso() };
      best.truck!.status = 'IN_USE';
      transition(b, 'ACCEPTED', 'DRIVER', best.u.id);
      setTimeout(() => {
        if (b.status === 'ACCEPTED') transition(b, 'EN_ROUTE', 'DRIVER', best.u.id);
      }, 4000);
    }, 5000);
  }, 8000 + Math.random() * 5000);
}

on('POST', '/bookings/:id/confirm', (c) => {
  const u = me(c.userId);
  const b = ownBooking(u, c.params.id!);
  if (b.status !== 'QUOTED') fail(409, 'CONFLICT', `Booking is already ${STATUS_LABELS[b.status].toLowerCase()}`);
  const q = b.quotes.find((x) => x.id === c.body.quoteId);
  if (!q || q.status !== 'PENDING_CUSTOMER_APPROVAL') fail(409, 'CONFLICT', 'This quote is no longer available. Refresh the quote.');
  if (q.expiresAt && new Date(q.expiresAt).getTime() < Date.now()) {
    q.status = 'EXPIRED';
    fail(409, 'CONFLICT', 'This quote has expired. Refresh to get an updated price.', { code: 'QUOTE_EXPIRED' });
  }
  q.status = 'APPROVED';
  q.decidedById = u.id;
  q.decidedAt = nowIso();
  if (b.promoCode) {
    const p = db.promos.find((x) => x.code === b.promoCode);
    if (p) p.usedCount++;
  }
  transition(b, 'CONFIRMED', 'CUSTOMER', u.id, { metadata: { quoteId: q.id, total: q.total } });
  if (b.requiresManualReview) raiseEscalation(b, 'MANUAL_REVIEW', `Manual review required: ${b.manualReviewReasons.join('; ')}`);
  else if (b.type === 'EMERGENCY') {
    transition(b, 'SEARCHING_FOR_PROVIDER', 'SYSTEM', null);
    simulateDispatch(b.id);
  }
  return detail(u, b);
});

// ─── Cancellation ─────────────────────────────────────────────────────

function policyFor(b: GBooking) {
  const q = [...b.quotes].sort((x, y) => y.version - x.version).find((x) => x.status === 'APPROVED' || x.status === 'PENDING_CUSTOMER_APPROVAL');
  return q?.pricingSnapshot.rules.cancellationPolicy ?? { acceptedFee: 0, arrivedFee: 0, description: 'Free cancellation' };
}
const feeFor = (b: GBooking) => {
  const policy = policyFor(b);
  const stage = cancellationStage(b.status);
  return { policy, stage, fee: stage === 'ARRIVED' ? policy.arrivedFee : stage === 'ACCEPTED' ? policy.acceptedFee : 0 };
};

on('GET', '/bookings/:id/cancellation', (c) => {
  const { b } = visible(me(c.userId), c.params.id!);
  return { status: b.status, ...feeFor(b) };
});

function cancellationInvoice(b: GBooking, fee: number, description: string): GInvoice {
  const cust = userById(b.customerUserId)!;
  const taxable = Math.round(fee / 1.18);
  const at = nowIso();
  const inv: GInvoice = {
    id: newId('inv'),
    number: nextInvoiceNumber(),
    type: 'CANCELLATION',
    status: 'ISSUED',
    paymentStatus: 'UNPAID',
    bookingId: b.id,
    subscriptionId: null,
    customerUserId: b.customerUserId,
    fleetAccountId: b.fleetAccountId,
    approvedQuoteId: null,
    billingName: cust.fullName,
    billingPhone: cust.phone,
    billingEmail: cust.email,
    billingAddress: null,
    billingGstin: null,
    currency: 'INR',
    subtotal: taxable,
    discountTotal: 0,
    taxableValue: taxable,
    taxTotal: fee - taxable,
    passThroughTotal: 0,
    total: fee,
    amountPaid: 0,
    amountPendingCash: 0,
    amountCredited: 0,
    amountRefunded: 0,
    amountWrittenOff: 0,
    outstanding: fee,
    approvedQuoteTotal: null,
    disputed: false,
    notes: description,
    issuedAt: at,
    dueAt: at,
    voidedAt: null,
    voidReason: null,
    isSample: true,
    createdAt: at,
    updatedAt: at,
    items: [{ id: newId('ii'), code: 'CANCELLATION', description: `Cancellation fee — ${description}`, quantity: 1, unitAmount: taxable, amount: taxable, taxable: true, isPassThrough: false, isAdditional: false, reason: null, sortOrder: 0 }],
  };
  db.invoices.push(inv);
  return inv;
}

on('POST', '/bookings/:id/cancel', (c) => {
  const u = me(c.userId);
  const b = bookingOr404(c.params.id!);
  const isCustomer = b.customerUserId === u.id;
  if (!isCustomer && !can(u, 'booking:manage')) notFound('Booking');
  const reason = String(c.body.reason ?? '').trim();
  if (reason.length < 3) fail(400, 'VALIDATION_ERROR', 'Give a reason for cancelling', [{ path: 'reason', message: 'Give a reason for cancelling' }]);
  const { policy, stage, fee: baseFee } = feeFor(b);
  let fee = baseFee;
  if (c.body.waiveFee) {
    if (isCustomer) fail(403, 'FORBIDDEN', 'Only operations staff can waive cancellation fees');
    fee = 0;
  }
  if (fee > 0 && isCustomer && !c.body.acceptFee) fail(409, 'CONFLICT', 'A cancellation fee applies at this stage', { code: 'CANCELLATION_FEE_REQUIRED', fee, stage, policy });
  for (const q of b.quotes) if (q.status === 'PENDING_CUSTOMER_APPROVAL' || q.status === 'PENDING_INTERNAL_APPROVAL') q.status = 'SUPERSEDED';
  transition(b, 'CANCELLED', isCustomer ? 'CUSTOMER' : u.roles.includes('admin') ? 'ADMIN' : 'DISPATCHER', u.id, { reason, metadata: { fee, stage, waived: !!c.body.waiveFee } });
  b.cancellationFee = fee;
  if (fee > 0) cancellationInvoice(b, fee, policy.description);
  return { fee, booking: detail(u, b) };
});

// ─── Revisions, contact, escalation, rating, dispute ──────────────────

on('POST', '/bookings/:id/quotes/:quoteId/decision', (c) => {
  const u = me(c.userId);
  const b = ownBooking(u, c.params.id!);
  const q = b.quotes.find((x) => x.id === c.params.quoteId);
  if (!q || q.kind !== 'REVISION' || q.status !== 'PENDING_CUSTOMER_APPROVAL') fail(409, 'CONFLICT', 'This revision is no longer awaiting your decision');
  const approve = !!c.body.approve;
  const note = str(c.body.note);
  if (approve) {
    for (const x of b.quotes) if (x.status === 'APPROVED') x.status = 'SUPERSEDED';
    q.status = 'APPROVED';
  } else {
    q.status = 'REJECTED';
    q.reason = `${q.reason ?? ''} | Customer: ${note ?? 'declined'}`;
  }
  q.decidedById = u.id;
  q.decidedAt = nowIso();
  b.statusHistory.push({ id: newId('sh'), fromStatus: b.status, toStatus: b.status, actorUserId: u.id, actorRole: 'CUSTOMER', reason: `Revised quote v${q.version} ${approve ? 'approved' : 'declined'}${note ? `: ${note}` : ''}`, isOverride: false, metadata: null, createdAt: nowIso() });
  b.updatedAt = nowIso();
  const lead = b.assignments.find((a) => a.status === 'ACCEPTED');
  if (lead) pushNotification(lead.driverUserId, 'quote.decision', `${b.code}: customer ${approve ? 'approved' : 'declined'} the revised quote`, approve ? 'You may proceed with the revised scope.' : 'Continue only with the originally approved scope, or contact dispatch.', { bookingId: b.id });
  return { approved: approve };
});

on('POST', '/bookings/:id/contact', (c) => {
  const u = me(c.userId);
  const { b, viewer } = visible(u, c.params.id!);
  if (viewer === 'customer') {
    const a = b.assignments.find((x) => x.status === 'ACCEPTED');
    if (!a) fail(409, 'CONFLICT', 'No driver has accepted this booking yet');
    const d = userById(a.driverUserId);
    return { name: d?.fullName ?? 'Driver', phone: d?.phone ?? null, masked: false, note: 'Number masking is not configured; this is the driver’s work number for this job only.' };
  }
  if (viewer === 'field') return { name: b.contactName, phone: b.contactPhone, masked: false, note: 'Customer contact for this job only.' };
  return notFound('Booking');
});

on('POST', '/bookings/:id/report-unreachable', (c) => {
  const b = ownBooking(me(c.userId), c.params.id!);
  const note = str(c.body.note);
  raiseEscalation(b, 'CUSTOMER_CANNOT_CONTACT', `Customer cannot reach the assigned driver${note ? `: ${note}` : ''}`);
  return { escalated: true, message: 'Our dispatch team has been alerted and will contact you shortly.' };
});

on('POST', '/bookings/:id/rating', (c) => {
  const u = me(c.userId);
  const b = ownBooking(u, c.params.id!);
  if (!['COMPLETED', 'DELIVERED'].includes(b.status)) fail(409, 'CONFLICT', 'You can rate after the job is completed');
  const lead = b.teamMembers.find((t) => t.role === 'TEAM_LEADER');
  if (!lead) fail(409, 'CONFLICT', 'No driver to rate');
  if (db.ratings.some((r) => r.bookingId === b.id && r.raterUserId === u.id)) fail(409, 'CONFLICT', 'You have already rated this booking');
  const r = { id: newId('rt'), bookingId: b.id, raterUserId: u.id, rateeUserId: lead.userId, score: Number(c.body.score), comment: str(c.body.comment) ?? null, tags: Array.isArray(c.body.tags) ? (c.body.tags as string[]) : [], createdAt: nowIso() };
  db.ratings.push(r);
  pushNotification(lead.userId, 'rating', `New ${r.score}★ rating`, `${u.fullName} rated booking ${b.code}.`, { bookingId: b.id });
  return r;
});

on('POST', '/bookings/:id/dispute', (c) => {
  const u = me(c.userId);
  const b = ownBooking(u, c.params.id!);
  const reason = String(c.body.reason ?? '').trim();
  if (reason.length < 10) fail(400, 'VALIDATION_ERROR', 'Describe the problem in at least 10 characters', [{ path: 'reason', message: 'At least 10 characters' }]);
  transition(b, 'DISPUTED', 'CUSTOMER', u.id, { reason });
  const t = createTicket(u.id, { category: 'COMPLAINT', subject: `Dispute on booking ${b.code}`, bookingId: b.id, priority: 'HIGH' }, reason);
  const { messages: _m, ...row } = t;
  void _m;
  return row;
});

// ─── Sharing, evidence, custody report ────────────────────────────────

on('POST', '/bookings/:id/share-links', (c) => {
  const b = ownBooking(me(c.userId), c.params.id!);
  if (TERMINAL_STATUSES.includes(b.status)) fail(409, 'CONFLICT', 'Sharing is only available for active bookings');
  const hours = Math.min(24, Math.max(0.5, Number(c.body.hours) || 4));
  const token = `guest-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
  const link = { id: newId('sl'), token, expiresAt: new Date(Date.now() + hours * HOUR).toISOString(), revokedAt: null, viewCount: 0, createdAt: nowIso() };
  b.shareLinks.push(link);
  return { id: link.id, expiresAt: link.expiresAt, url: `${window.location.origin}${import.meta.env.BASE_URL}track/${token}` };
});

on('DELETE', '/bookings/:id/share-links/:linkId', (c) => {
  const b = ownBooking(me(c.userId), c.params.id!);
  const link = b.shareLinks.find((l) => l.id === c.params.linkId);
  if (!link) return notFound('Share link');
  link.revokedAt = nowIso();
  return { revoked: true };
});

on('POST', '/bookings/:id/attachments', (c) => {
  const u = me(c.userId);
  const { b, viewer } = visible(u, c.params.id!);
  if (viewer !== 'customer' && viewer !== 'field') notFound('Booking');
  const kind = String(c.body.kind ?? 'OTHER');
  if (viewer === 'customer' && !['DAMAGE_PHOTO', 'DAMAGE_VIDEO', 'OTHER'].includes(kind)) fail(400, 'BAD_REQUEST', 'Customers can upload damage photos and videos');
  if (TERMINAL_STATUSES.includes(b.status)) fail(409, 'CONFLICT', 'This booking is closed');
  const files = c.form ? c.form.getAll('files').filter((f): f is File => typeof f !== 'string') : [];
  const caption = str(c.body.caption) ?? null;
  const rows = (files.length ? files : [null]).map((f, i) => ({
    id: newId('att'),
    uploadedById: u.id,
    kind,
    mimeType: 'image/svg+xml',
    url: placeholderImage(f?.name ?? `${kind.replace(/_/g, ' ').toLowerCase()} ${i + 1}`, kind.includes('DAMAGE') ? '#b45309' : '#0f766e'),
    caption,
    createdAt: nowIso(),
  }));
  b.attachments.push(...rows);
  b.updatedAt = nowIso();
  return rows;
});

on('GET', '/bookings/:id/custody-report', (c) => {
  const u = me(c.userId);
  const { b, viewer } = visible(u, c.params.id!);
  if (viewer === 'offered') notFound('Booking');
  const v = vehicleById(b.vehicleId);
  const cat = categoryById(b.serviceCategoryId);
  const fmt = (s: string) => new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  return pdfFile(`Chain of custody — ${b.code}`, [
    `Service: ${cat.name}`,
    `Vehicle: ${v ? `${v.make} ${v.model} (${v.registrationNumber})` : '—'}`,
    `Status: ${STATUS_LABELS[b.status]}`,
    '',
    'Timeline:',
    ...b.statusHistory.map((h) => `  ${fmt(h.createdAt)}  ${STATUS_LABELS[h.toStatus]} (${h.actorRole.toLowerCase()})`),
    '',
    'Custody confirmations:',
    ...(b.custody.length ? b.custody.map((x) => `  ${x.stage} via ${x.method} — ${x.recipientName ?? '—'} ${x.recipientRelation ? `(${x.recipientRelation})` : ''} at ${fmt(x.createdAt)}`) : ['  None recorded yet']),
    '',
    'Condition reports:',
    ...(b.conditionReports.length ? b.conditionReports.map((r) => `  ${r.stage}: ${r.notes ?? '—'}; ${r.damageMarks.length} damage mark(s)`) : ['  None recorded yet']),
  ]);
});

