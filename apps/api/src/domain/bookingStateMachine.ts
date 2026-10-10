import type { ActorRole, BookingStatus } from '@prisma/client';

/**
 * Explicit booking lifecycle. Every transition lists the actor roles allowed to make it.
 * The happy path:
 *   REQUESTED → QUOTED → CONFIRMED → SEARCHING_FOR_PROVIDER → ASSIGNED → ACCEPTED → EN_ROUTE
 *   → ARRIVED → INSPECTING → RECOVERY_AUTHORIZED → LOADING → IN_TRANSIT → DELIVERED → COMPLETED
 * On-site services (jump-start, tyre, fuel, lockout) skip LOADING/IN_TRANSIT:
 *   RECOVERY_AUTHORIZED → DELIVERED ("service completed on site").
 */
type Rule = { to: BookingStatus; actors: ActorRole[] };

const OPS: ActorRole[] = ['DISPATCHER', 'ADMIN'];
const SYS_OPS: ActorRole[] = ['SYSTEM', 'DISPATCHER', 'ADMIN'];
const FIELD: ActorRole[] = ['DRIVER', 'WORKER'];
const FIELD_OPS: ActorRole[] = [...FIELD, ...OPS];

const CANCEL_BY_CUSTOMER_OR_OPS: Rule = { to: 'CANCELLED', actors: ['CUSTOMER', ...OPS] };
const CANCEL_BY_OPS: Rule = { to: 'CANCELLED', actors: OPS };
const HOLD: Rule = { to: 'SAFETY_HOLD', actors: FIELD_OPS };

export const TRANSITIONS: Record<BookingStatus, Rule[]> = {
  REQUESTED: [{ to: 'QUOTED', actors: ['SYSTEM', ...OPS] }, CANCEL_BY_CUSTOMER_OR_OPS, { to: 'CANCELLED', actors: ['SYSTEM'] }],
  QUOTED: [
    { to: 'CONFIRMED', actors: ['CUSTOMER', ...OPS] },
    { to: 'QUOTED', actors: ['SYSTEM', 'CUSTOMER', ...OPS] }, // re-quote (e.g. destination changed / quote expired)
    CANCEL_BY_CUSTOMER_OR_OPS,
    { to: 'CANCELLED', actors: ['SYSTEM'] },
  ],
  CONFIRMED: [{ to: 'SEARCHING_FOR_PROVIDER', actors: SYS_OPS }, { to: 'ASSIGNED', actors: OPS }, CANCEL_BY_CUSTOMER_OR_OPS],
  SEARCHING_FOR_PROVIDER: [
    { to: 'ASSIGNED', actors: SYS_OPS },
    { to: 'REASSIGNMENT_REQUIRED', actors: SYS_OPS },
    { to: 'FAILED', actors: OPS },
    CANCEL_BY_CUSTOMER_OR_OPS,
  ],
  ASSIGNED: [
    { to: 'ACCEPTED', actors: FIELD },
    { to: 'REJECTED', actors: [...FIELD, 'SYSTEM'] }, // explicit rejection or acceptance timeout
    { to: 'REASSIGNMENT_REQUIRED', actors: SYS_OPS },
    CANCEL_BY_CUSTOMER_OR_OPS,
  ],
  REJECTED: [
    { to: 'SEARCHING_FOR_PROVIDER', actors: SYS_OPS },
    { to: 'REASSIGNMENT_REQUIRED', actors: SYS_OPS },
    { to: 'ASSIGNED', actors: OPS },
    CANCEL_BY_CUSTOMER_OR_OPS,
  ],
  REASSIGNMENT_REQUIRED: [
    { to: 'SEARCHING_FOR_PROVIDER', actors: SYS_OPS },
    { to: 'ASSIGNED', actors: SYS_OPS },
    { to: 'FAILED', actors: OPS },
    CANCEL_BY_CUSTOMER_OR_OPS,
  ],
  ACCEPTED: [{ to: 'EN_ROUTE', actors: FIELD_OPS }, { to: 'REASSIGNMENT_REQUIRED', actors: FIELD_OPS }, HOLD, CANCEL_BY_CUSTOMER_OR_OPS],
  EN_ROUTE: [{ to: 'ARRIVED', actors: FIELD_OPS }, { to: 'REASSIGNMENT_REQUIRED', actors: FIELD_OPS }, HOLD, CANCEL_BY_CUSTOMER_OR_OPS],
  ARRIVED: [
    { to: 'INSPECTING', actors: FIELD_OPS },
    { to: 'CUSTOMER_UNAVAILABLE', actors: FIELD_OPS },
    { to: 'REASSIGNMENT_REQUIRED', actors: FIELD_OPS }, // truck/crew unsuitable on arrival
    HOLD,
    CANCEL_BY_CUSTOMER_OR_OPS,
  ],
  CUSTOMER_UNAVAILABLE: [
    { to: 'ARRIVED', actors: FIELD_OPS }, // customer reached
    { to: 'FAILED', actors: OPS },
    CANCEL_BY_CUSTOMER_OR_OPS,
  ],
  INSPECTING: [
    { to: 'RECOVERY_AUTHORIZED', actors: FIELD_OPS },
    { to: 'REASSIGNMENT_REQUIRED', actors: FIELD_OPS }, // equipment/crew check failed
    { to: 'FAILED', actors: FIELD_OPS }, // unsuccessful recovery / vehicle refused
    HOLD,
    CANCEL_BY_CUSTOMER_OR_OPS,
  ],
  RECOVERY_AUTHORIZED: [
    { to: 'LOADING', actors: FIELD_OPS },
    { to: 'DELIVERED', actors: FIELD_OPS }, // on-site service completed
    { to: 'FAILED', actors: FIELD_OPS },
    HOLD,
    CANCEL_BY_OPS,
  ],
  LOADING: [{ to: 'IN_TRANSIT', actors: FIELD_OPS }, { to: 'FAILED', actors: FIELD_OPS }, HOLD],
  IN_TRANSIT: [{ to: 'DELIVERED', actors: FIELD_OPS }, HOLD],
  DELIVERED: [{ to: 'COMPLETED', actors: [...FIELD, ...SYS_OPS] }, { to: 'DISPUTED', actors: ['CUSTOMER', ...OPS] }],
  COMPLETED: [{ to: 'DISPUTED', actors: ['CUSTOMER', ...OPS] }],
  DISPUTED: [{ to: 'COMPLETED', actors: OPS }],
  SAFETY_HOLD: [
    // Resume is restricted to operations staff and only to the status the booking was held from.
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

/** Statuses where a field team is actively working the job. */
export const FIELD_ACTIVE_STATUSES: BookingStatus[] = [
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'CUSTOMER_UNAVAILABLE',
  'INSPECTING',
  'RECOVERY_AUTHORIZED',
  'LOADING',
  'IN_TRANSIT',
  'SAFETY_HOLD',
];

/** Statuses during which the customer may see the driver's live location. */
export const LIVE_TRACKING_STATUSES: BookingStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT'];

export const OPEN_STATUSES: BookingStatus[] = (Object.keys(TRANSITIONS) as BookingStatus[]).filter(
  (s) => !TERMINAL_STATUSES.includes(s) && s !== 'DELIVERED' && s !== 'DISPUTED',
);

export const NEEDS_PROVIDER_STATUSES: BookingStatus[] = ['CONFIRMED', 'SEARCHING_FOR_PROVIDER', 'REJECTED', 'REASSIGNMENT_REQUIRED'];

export class TransitionError extends Error {
  constructor(
    public from: BookingStatus,
    public to: BookingStatus,
    public actor: ActorRole,
    message?: string,
  ) {
    super(message ?? `Transition ${from} → ${to} is not allowed for ${actor}`);
  }
}

export function canTransition(from: BookingStatus, to: BookingStatus, actor: ActorRole): boolean {
  return TRANSITIONS[from].some((r) => r.to === to && r.actors.includes(actor));
}

export function assertTransition(from: BookingStatus, to: BookingStatus, actor: ActorRole, ctx?: { holdReturnStatus?: BookingStatus | null }) {
  if (!canTransition(from, to, actor)) throw new TransitionError(from, to, actor);
  if (from === 'SAFETY_HOLD' && !['FAILED', 'CANCELLED', 'REASSIGNMENT_REQUIRED'].includes(to) && ctx?.holdReturnStatus && ctx.holdReturnStatus !== to) {
    throw new TransitionError(from, to, actor, `A held booking can only resume to ${ctx.holdReturnStatus}`);
  }
}

export function allowedNext(from: BookingStatus, actor: ActorRole): BookingStatus[] {
  return TRANSITIONS[from].filter((r) => r.actors.includes(actor)).map((r) => r.to);
}

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

/**
 * Cancellation fee stage, used with the rate card's disclosed cancellation policy.
 *  FREE      – before a driver has accepted
 *  ACCEPTED  – driver accepted / en route
 *  ARRIVED   – driver at the location
 */
export function cancellationStage(status: BookingStatus): 'FREE' | 'ACCEPTED' | 'ARRIVED' {
  if (['ACCEPTED', 'EN_ROUTE'].includes(status)) return 'ACCEPTED';
  if (['ARRIVED', 'CUSTOMER_UNAVAILABLE', 'INSPECTING', 'RECOVERY_AUTHORIZED'].includes(status)) return 'ARRIVED';
  return 'FREE';
}
