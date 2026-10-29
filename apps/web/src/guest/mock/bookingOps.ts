/**
 * Booking lifecycle for guest mode: the API's state machine (apps/api/src/domain/bookingStateMachine.ts)
 * plus the side effects of a transition (history, timestamps, invoice, driver availability, notifications).
 */
import type { BookingStatus } from '@/api/types';
import type { ActorRole, GBooking } from './model';
import { addJobEarning, db, HOUR, invoiceForBooking, issueServiceInvoice, MIN, newId, nowIso, pushNotification, truckById, userById } from './db';
import { fail } from './router';

type Rule = { to: BookingStatus; actors: ActorRole[] };
const OPS: ActorRole[] = ['DISPATCHER', 'ADMIN'];
const SYS_OPS: ActorRole[] = ['SYSTEM', 'DISPATCHER', 'ADMIN'];
const FIELD: ActorRole[] = ['DRIVER', 'WORKER'];
const FIELD_OPS: ActorRole[] = [...FIELD, ...OPS];
const CANCEL_BY_CUSTOMER_OR_OPS: Rule = { to: 'CANCELLED', actors: ['CUSTOMER', ...OPS] };
const CANCEL_BY_OPS: Rule = { to: 'CANCELLED', actors: OPS };
const HOLD: Rule = { to: 'SAFETY_HOLD', actors: FIELD_OPS };

export const TRANSITIONS: Record<BookingStatus, Rule[]> = {
  REQUESTED: [{ to: 'QUOTED', actors: ['SYSTEM', ...OPS] }, CANCEL_BY_CUSTOMER_OR_OPS],
  QUOTED: [{ to: 'CONFIRMED', actors: ['CUSTOMER', ...OPS] }, { to: 'QUOTED', actors: ['SYSTEM', 'CUSTOMER', ...OPS] }, CANCEL_BY_CUSTOMER_OR_OPS],
  CONFIRMED: [{ to: 'SEARCHING_FOR_PROVIDER', actors: SYS_OPS }, { to: 'ASSIGNED', actors: OPS }, CANCEL_BY_CUSTOMER_OR_OPS],
  SEARCHING_FOR_PROVIDER: [{ to: 'ASSIGNED', actors: SYS_OPS }, { to: 'REASSIGNMENT_REQUIRED', actors: SYS_OPS }, { to: 'FAILED', actors: OPS }, CANCEL_BY_CUSTOMER_OR_OPS],
  ASSIGNED: [{ to: 'ACCEPTED', actors: FIELD }, { to: 'REJECTED', actors: [...FIELD, 'SYSTEM'] }, { to: 'REASSIGNMENT_REQUIRED', actors: SYS_OPS }, CANCEL_BY_CUSTOMER_OR_OPS],
  REJECTED: [{ to: 'SEARCHING_FOR_PROVIDER', actors: SYS_OPS }, { to: 'REASSIGNMENT_REQUIRED', actors: SYS_OPS }, { to: 'ASSIGNED', actors: OPS }, CANCEL_BY_CUSTOMER_OR_OPS],
  REASSIGNMENT_REQUIRED: [{ to: 'SEARCHING_FOR_PROVIDER', actors: SYS_OPS }, { to: 'ASSIGNED', actors: SYS_OPS }, { to: 'FAILED', actors: OPS }, CANCEL_BY_CUSTOMER_OR_OPS],
  ACCEPTED: [{ to: 'EN_ROUTE', actors: FIELD_OPS }, { to: 'REASSIGNMENT_REQUIRED', actors: FIELD_OPS }, HOLD, CANCEL_BY_CUSTOMER_OR_OPS],
  EN_ROUTE: [{ to: 'ARRIVED', actors: FIELD_OPS }, { to: 'REASSIGNMENT_REQUIRED', actors: FIELD_OPS }, HOLD, CANCEL_BY_CUSTOMER_OR_OPS],
  ARRIVED: [{ to: 'INSPECTING', actors: FIELD_OPS }, { to: 'CUSTOMER_UNAVAILABLE', actors: FIELD_OPS }, { to: 'REASSIGNMENT_REQUIRED', actors: FIELD_OPS }, HOLD, CANCEL_BY_CUSTOMER_OR_OPS],
  CUSTOMER_UNAVAILABLE: [{ to: 'ARRIVED', actors: FIELD_OPS }, { to: 'FAILED', actors: OPS }, CANCEL_BY_CUSTOMER_OR_OPS],
  INSPECTING: [{ to: 'RECOVERY_AUTHORIZED', actors: FIELD_OPS }, { to: 'REASSIGNMENT_REQUIRED', actors: FIELD_OPS }, { to: 'FAILED', actors: FIELD_OPS }, HOLD, CANCEL_BY_CUSTOMER_OR_OPS],
  RECOVERY_AUTHORIZED: [{ to: 'LOADING', actors: FIELD_OPS }, { to: 'DELIVERED', actors: FIELD_OPS }, { to: 'FAILED', actors: FIELD_OPS }, HOLD, CANCEL_BY_OPS],
  LOADING: [{ to: 'IN_TRANSIT', actors: FIELD_OPS }, { to: 'FAILED', actors: FIELD_OPS }, HOLD],
  IN_TRANSIT: [{ to: 'DELIVERED', actors: FIELD_OPS }, HOLD],
  DELIVERED: [{ to: 'COMPLETED', actors: [...FIELD, ...SYS_OPS] }, { to: 'DISPUTED', actors: ['CUSTOMER', ...OPS] }],
  COMPLETED: [{ to: 'DISPUTED', actors: ['CUSTOMER', ...OPS] }],
  DISPUTED: [{ to: 'COMPLETED', actors: OPS }],
  SAFETY_HOLD: [
    { to: 'ACCEPTED', actors: OPS },
    { to: 'EN_ROUTE', actors: OPS },
    { to: 'ARRIVED', actors: OPS },
    { to: 'INSPECTING', actors: OPS },
    { to: 'RECOVERY_AUTHORIZED', actors: OPS },
    { to: 'LOADING', actors: OPS },
    { to: 'IN_TRANSIT', actors: OPS },
    { to: 'REASSIGNMENT_REQUIRED', actors: OPS },
    { to: 'FAILED', actors: OPS },
    CANCEL_BY_OPS,
  ],
  CANCELLED: [],
  FAILED: [],
};

export const TERMINAL_STATUSES: BookingStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED'];
export const FIELD_ACTIVE_STATUSES: BookingStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'CUSTOMER_UNAVAILABLE', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT', 'SAFETY_HOLD'];
export const LIVE_TRACKING_STATUSES: BookingStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT'];
export const NEEDS_PROVIDER_STATUSES: BookingStatus[] = ['CONFIRMED', 'SEARCHING_FOR_PROVIDER', 'REJECTED', 'REASSIGNMENT_REQUIRED'];

export const STATUS_LABELS: Record<BookingStatus, string> = {
  REQUESTED: 'Request submitted',
  QUOTED: 'Quote ready for approval',
  CONFIRMED: 'Booking confirmed',
  SEARCHING_FOR_PROVIDER: 'Finding an available provider',
  ASSIGNED: 'Driver assigned — awaiting acceptance',
  ACCEPTED: 'Driver accepted',
  EN_ROUTE: 'Driver heading to pickup',
  ARRIVED: 'Driver arrived',
  INSPECTING: 'Vehicle inspection',
  RECOVERY_AUTHORIZED: 'Recovery authorised',
  LOADING: 'Loading vehicle',
  IN_TRANSIT: 'Vehicle in transit',
  DELIVERED: 'Vehicle handover completed',
  COMPLETED: 'Booking completed',
  REJECTED: 'Driver declined — finding another',
  REASSIGNMENT_REQUIRED: 'Reassigning provider',
  CANCELLED: 'Cancelled',
  FAILED: 'Unable to complete',
  CUSTOMER_UNAVAILABLE: 'Driver could not reach you',
  SAFETY_HOLD: 'On safety hold',
  DISPUTED: 'Under dispute',
};

export const statusGroups: Record<string, BookingStatus[]> = {
  active: (Object.keys(STATUS_LABELS) as BookingStatus[]).filter((s) => !TERMINAL_STATUSES.includes(s)),
  completed: ['COMPLETED', 'DELIVERED'],
  cancelled: ['CANCELLED', 'FAILED'],
  unassigned: NEEDS_PROVIDER_STATUSES,
};

export function allowedNext(from: BookingStatus, actor: ActorRole): BookingStatus[] {
  return TRANSITIONS[from].filter((r) => r.actors.includes(actor)).map((r) => r.to);
}

export function cancellationStage(status: BookingStatus): 'FREE' | 'ACCEPTED' | 'ARRIVED' {
  if (['ACCEPTED', 'EN_ROUTE'].includes(status)) return 'ACCEPTED';
  if (['ARRIVED', 'CUSTOMER_UNAVAILABLE', 'INSPECTING', 'RECOVERY_AUTHORIZED'].includes(status)) return 'ARRIVED';
  return 'FREE';
}

/** Actor role of the signed-in guest for booking transitions. */
export function actorFor(roles: string[]): ActorRole {
  if (roles.includes('admin')) return 'ADMIN';
  if (roles.includes('dispatcher')) return 'DISPATCHER';
  if (roles.includes('driver')) return 'DRIVER';
  if (roles.includes('worker')) return 'WORKER';
  if (roles.includes('customer')) return 'CUSTOMER';
  return 'SYSTEM';
}

const PUSH_TO_CUSTOMER: Partial<Record<BookingStatus, string>> = {
  ASSIGNED: 'A driver has been assigned',
  ACCEPTED: 'Your driver accepted the job',
  EN_ROUTE: 'Your driver is on the way',
  ARRIVED: 'Your driver has arrived',
  LOADING: 'Your vehicle is being loaded',
  IN_TRANSIT: 'Your vehicle is on its way',
  DELIVERED: 'Vehicle handed over',
  COMPLETED: 'Booking completed',
  CANCELLED: 'Booking cancelled',
  FAILED: 'We could not complete your booking',
  SAFETY_HOLD: 'Your booking is on a safety hold',
};

/**
 * Applies a status transition with the same rules as the API. `force` skips the actor check
 * (authorised overrides by operations staff).
 */
export function transition(b: GBooking, to: BookingStatus, actor: ActorRole, actorUserId: string | null, opts: { reason?: string | null; force?: boolean; metadata?: Record<string, unknown> } = {}) {
  const from = b.status;
  const ok = TRANSITIONS[from].some((r) => r.to === to && (opts.force || r.actors.includes(actor)));
  if (!ok) fail(409, 'INVALID_TRANSITION', `Transition ${from} → ${to} is not allowed for ${actor}`);
  if (from === 'SAFETY_HOLD' && !['FAILED', 'CANCELLED', 'REASSIGNMENT_REQUIRED'].includes(to) && b.holdReturnStatus && b.holdReturnStatus !== to && !opts.force)
    fail(409, 'INVALID_TRANSITION', `A held booking can only resume to ${b.holdReturnStatus}`);
  const now = Date.now();
  const at = nowIso();
  b.statusHistory.push({ id: newId('sh'), fromStatus: from, toStatus: to, actorUserId, actorRole: actor, reason: opts.reason ?? null, isOverride: !!opts.force, metadata: opts.metadata ?? null, createdAt: at });
  b.status = to;
  b.version++;
  b.updatedAt = at;
  if (to === 'SAFETY_HOLD') b.holdReturnStatus = from;
  if (from === 'SAFETY_HOLD') b.holdReturnStatus = null;

  const live = b.assignments.find((a) => a.status === 'ACCEPTED');
  const driver = live ? userById(live.driverUserId) : undefined;
  const setCrew = (status: 'AVAILABLE' | 'ON_JOB') => {
    for (const m of b.teamMembers.filter((x) => x.active)) {
      const u = userById(m.userId);
      if (u?.availability) u.availability = { ...u.availability, status, statusSince: at };
    }
    if (driver?.availability) driver.availability = { ...driver.availability, status, statusSince: at };
    const t = truckById(live?.truckId);
    if (t) t.status = status === 'ON_JOB' ? 'IN_USE' : 'AVAILABLE';
  };

  switch (to) {
    case 'EN_ROUTE':
      if (!b.etaAt || new Date(b.etaAt).getTime() < now) b.etaAt = new Date(now + 20 * MIN).toISOString();
      break;
    case 'ARRIVED':
      b.arrivedAt = at;
      break;
    case 'RECOVERY_AUTHORIZED':
      b.pickupVerifiedAt ??= at;
      break;
    case 'DELIVERED': {
      if (!invoiceForBooking(b.id)) {
        const inv = issueServiceInvoice(b, now);
        pushNotification(b.customerUserId, 'invoice.issued', 'Invoice ready', `Invoice ${inv.number} for ${b.code} is ready to pay.`, { invoiceId: inv.id, bookingId: b.id });
        if (live) addJobEarning(live.driverUserId, b, inv, now);
      }
      if (live) live.status = 'COMPLETED';
      setCrew('AVAILABLE');
      break;
    }
    case 'COMPLETED':
      b.completedAt ??= at;
      if (live) live.status = 'COMPLETED';
      setCrew('AVAILABLE');
      break;
    case 'CANCELLED':
    case 'FAILED':
      if (to === 'CANCELLED') {
        b.cancellationReason = opts.reason ?? 'Cancelled';
        b.cancelledById = actorUserId;
      } else b.failureReason = opts.reason ?? 'Unable to complete';
      setCrew('AVAILABLE');
      for (const a of b.assignments) if (a.status === 'OFFERED' || a.status === 'ACCEPTED') a.status = to === 'CANCELLED' ? 'CANCELLED' : 'RELEASED';
      break;
    case 'REASSIGNMENT_REQUIRED':
    case 'SEARCHING_FOR_PROVIDER':
      setCrew('AVAILABLE');
      for (const a of b.assignments) if (a.status === 'OFFERED' || a.status === 'ACCEPTED') a.status = 'RELEASED';
      break;
  }
  if (actor !== 'CUSTOMER' && PUSH_TO_CUSTOMER[to]) pushNotification(b.customerUserId, 'booking.status', PUSH_TO_CUSTOMER[to]!, `${b.code}: ${STATUS_LABELS[to]}.`, { bookingId: b.id });
  return b;
}

/**
 * Moves drivers on live jobs along their route so maps and tracking feel alive: approaching the
 * pickup while EN_ROUTE, and towards the drop-off while IN_TRANSIT. Called on every request.
 */
export function refreshLivePositions() {
  const now = Date.now();
  for (const b of db.bookings) {
    if (!LIVE_TRACKING_STATUSES.includes(b.status)) continue;
    const a = b.assignments.find((x) => x.status === 'ACCEPTED');
    const u = a && userById(a.driverUserId);
    if (!u?.availability) continue;
    const pickup = b.locations.find((l) => l.kind === 'PICKUP')!;
    const drop = b.locations.find((l) => l.kind === 'DROPOFF');
    const since = new Date([...b.statusHistory].reverse().find((h) => h.toStatus === b.status)?.createdAt ?? b.updatedAt).getTime();
    let lat = pickup.lat;
    let lng = pickup.lng;
    if (b.status === 'EN_ROUTE' || b.status === 'ACCEPTED') {
      // Start ~4 km north-east of the pickup and close in over 20 minutes.
      const k = b.status === 'ACCEPTED' ? 0 : Math.min(0.92, (now - since) / (20 * MIN));
      lat = pickup.lat + 0.028 * (1 - k);
      lng = pickup.lng + 0.022 * (1 - k);
    } else if (b.status === 'IN_TRANSIT' && drop) {
      const k = Math.min(0.95, (now - since) / (35 * MIN));
      lat = pickup.lat + (drop.lat - pickup.lat) * k;
      lng = pickup.lng + (drop.lng - pickup.lng) * k;
    } else {
      lat = pickup.lat + 0.0004;
      lng = pickup.lng - 0.0003;
    }
    u.availability = { ...u.availability, lastLat: lat, lastLng: lng, lastLocationAt: new Date(now - 8_000).toISOString(), locationSharing: true };
    if (b.status === 'EN_ROUTE' && b.etaAt && new Date(b.etaAt).getTime() < now + 2 * MIN) b.etaAt = new Date(now + 3 * MIN).toISOString();
  }
  // Idle drivers report fresh pings too, so the dispatch map never shows them as stale.
  for (const u of db.users) {
    const av = u.availability;
    if (av && av.status !== 'OFF_DUTY' && av.locationSharing && av.lastLocationAt && now - new Date(av.lastLocationAt).getTime() > 2 * MIN && now - new Date(av.lastLocationAt).getTime() < 6 * HOUR) av.lastLocationAt = new Date(now - 20_000).toISOString();
  }
}
