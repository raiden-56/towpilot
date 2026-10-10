import type { ActorRole, Booking, BookingStatus, Prisma } from '@prisma/client';
import type { Tx } from '../../lib/prisma.js';
import type { AfterCommit } from '../../lib/tx.js';
import { conflict } from '../../lib/errors.js';
import { assertTransition, STATUS_LABELS } from '../../domain/bookingStateMachine.js';
import { emitToBooking } from '../../realtime/socket.js';
import { notify, notifyOps } from '../notifications/service.js';

export interface Actor {
  userId: string | null;
  role: ActorRole;
}

export const SYSTEM: Actor = { userId: null, role: 'SYSTEM' };

const CUSTOMER_MESSAGES: Partial<Record<BookingStatus, string>> = {
  QUOTED: 'Your quote is ready. Review and approve it to continue.',
  CONFIRMED: 'Booking confirmed.',
  SEARCHING_FOR_PROVIDER: 'We are finding an available provider near you.',
  ACCEPTED: 'A driver has accepted your request.',
  EN_ROUTE: 'Your driver is on the way.',
  ARRIVED: 'Your driver has arrived. Share the pickup code only with your driver.',
  RECOVERY_AUTHORIZED: 'Recovery work has been authorised.',
  IN_TRANSIT: 'Your vehicle is on its way to the destination.',
  DELIVERED: 'Your vehicle has been handed over.',
  COMPLETED: 'Your booking is complete. Your invoice is ready.',
  REASSIGNMENT_REQUIRED: 'We are arranging a different provider. We will update you as soon as one accepts.',
  CANCELLED: 'Your booking was cancelled.',
  FAILED: 'We were unable to complete this service. Our team will contact you.',
  CUSTOMER_UNAVAILABLE: 'Your driver could not reach you at the pickup point. Please call them or update your location.',
  SAFETY_HOLD: 'Your job is paused for a safety check. Our operations team is on it.',
};

/**
 * Applies a validated state transition with optimistic concurrency. Every change writes a
 * status-history row (who, when, why). Emits/notifications run after commit.
 */
export async function transition(
  tx: Tx,
  after: AfterCommit,
  booking: Pick<Booking, 'id' | 'status' | 'version' | 'customerUserId' | 'code' | 'holdReturnStatus'>,
  to: BookingStatus,
  actor: Actor,
  opts: { reason?: string; isOverride?: boolean; metadata?: Record<string, unknown>; data?: Prisma.BookingUpdateManyMutationInput; quiet?: boolean } = {},
) {
  const from = booking.status;
  assertTransition(from, to, actor.role, { holdReturnStatus: booking.holdReturnStatus });
  const data: Prisma.BookingUpdateManyMutationInput = { ...opts.data, status: to, version: { increment: 1 } };
  if (to === 'SAFETY_HOLD') data.holdReturnStatus = booking.status;
  if (booking.status === 'SAFETY_HOLD') data.holdReturnStatus = null;
  if (to === 'COMPLETED') data.completedAt = new Date();

  const res = await tx.booking.updateMany({ where: { id: booking.id, version: booking.version, status: booking.status }, data });
  if (res.count !== 1) throw conflict('This booking was updated by someone else. Refresh and try again.');

  await tx.bookingStatusHistory.create({
    data: {
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: to,
      actorUserId: actor.userId,
      actorRole: actor.role,
      reason: opts.reason,
      isOverride: opts.isOverride ?? false,
      metadata: (opts.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  // Keep the in-memory object consistent for chained transitions in the same transaction.
  booking.status = to;
  booking.version += 1;
  if (to === 'SAFETY_HOLD') booking.holdReturnStatus = data.holdReturnStatus as BookingStatus;

  const msg = CUSTOMER_MESSAGES[to];
  if (!opts.quiet && msg) await notify(tx, booking.customerUserId, { type: 'booking.status', title: `${booking.code}: ${STATUS_LABELS[to]}`, body: opts.reason && to === 'CANCELLED' ? `${msg} Reason: ${opts.reason}` : msg, data: { bookingId: booking.id, status: to }, channels: ['SMS', 'PUSH'] });
  if (to === 'SAFETY_HOLD' || to === 'FAILED')
    await notifyOps(tx, { type: 'booking.alert', title: `${booking.code}: ${STATUS_LABELS[to]}`, body: opts.reason ?? '', data: { bookingId: booking.id, status: to } });

  after(() => emitToBooking(booking.id, 'booking.status', { status: to, from, reason: opts.reason }, { status: to, label: STATUS_LABELS[to] }));
  return booking;
}
