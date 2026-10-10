import type { BookingStatus, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { withTx, type AfterCommit } from '../../lib/tx.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { safeEqual } from '../../lib/crypto.js';
import { applyBps, formatInr } from '../../lib/money.js';
import { nextDocumentNumber } from '../../lib/numbering.js';
import { getSettings } from '../../lib/settings.js';
import { minutesBetween } from '../../lib/time.js';
import { computePrice, diffAgainstApproved, type PriceBreakdown, type QuoteInput, type RateCardRules } from '../../domain/pricing.js';
import { FIELD_ACTIVE_STATUSES, LIVE_TRACKING_STATUSES } from '../../domain/bookingStateMachine.js';
import type { Principal } from '../../middleware/auth.js';
import { transition, type Actor } from '../bookings/transitions.js';
import { approvedQuote, quoteItemsData } from '../pricing/service.js';
import { issueServiceInvoice, recordCashCollection } from '../billing/service.js';
import { raiseEscalation, releaseLiveAssignment } from '../dispatch/service.js';
import { notify, notifyOps } from '../notifications/service.js';
import { emitToBooking, emitToOps } from '../../realtime/socket.js';
import { routeEstimate } from '../../integrations/maps.js';

interface Snapshot {
  rules: RateCardRules;
  input: QuoteInput;
  breakdown: PriceBreakdown;
}

/** Load a booking the principal is actively working on (accepted lead or active team member). */
export async function loadFieldBooking(db: Tx | typeof prisma, p: Principal, bookingId: string) {
  const b = await db.booking.findUnique({ where: { id: bookingId }, include: { serviceCategory: true, locations: true } });
  if (!b) throw notFound('Job');
  const lead = await db.bookingAssignment.findFirst({ where: { bookingId, driverUserId: p.userId, status: 'ACCEPTED' } });
  const member = await db.bookingTeamMember.findFirst({ where: { bookingId, userId: p.userId, active: true } });
  if (!lead && !member) throw notFound('Job');
  const actor: Actor = { userId: p.userId, role: p.roles.includes('driver') ? 'DRIVER' : 'WORKER' };
  return { booking: b, isLead: !!lead || member?.role === 'TEAM_LEADER', actor };
}

// ─── Guarded transitions ─────────────────────────────────────────────

export async function fieldTransition(p: Principal, bookingId: string, to: BookingStatus, reason?: string) {
  return withTx(async (tx, after) => {
    const { booking: b, isLead, actor } = await loadFieldBooking(tx, p, bookingId);
    if (!isLead && !['SAFETY_HOLD'].includes(to)) throw forbidden('Only the team leader can update job progress');
    const towing = b.serviceCategory.kind === 'TOWING';
    const data: Prisma.BookingUpdateManyMutationInput = {};

    switch (to) {
      case 'ARRIVED':
        // Keep the first arrival time (resuming after "customer unavailable" must not reset waiting time).
        if (!b.arrivedAt) data.arrivedAt = new Date();
        break;
      case 'INSPECTING':
        if (!b.pickupVerifiedAt) throw unprocessable('Verify the customer pickup code (or get an authorised override) before inspection');
        break;
      case 'RECOVERY_AUTHORIZED': {
        const pending = await tx.bookingQuote.findFirst({ where: { bookingId, status: { in: ['PENDING_CUSTOMER_APPROVAL', 'PENDING_INTERNAL_APPROVAL'] } } });
        if (pending) throw unprocessable('A revised quote is awaiting approval');
        await approvedQuote(tx, bookingId);
        if (towing && !(await tx.vehicleConditionReport.count({ where: { bookingId, stage: 'PICKUP' } }))) throw unprocessable('Record the pickup condition report first');
        break;
      }
      case 'LOADING':
      case 'IN_TRANSIT':
        if (!towing) throw unprocessable('This is an on-site service');
        break;
      case 'DELIVERED':
        if (towing && !(await tx.vehicleConditionReport.count({ where: { bookingId, stage: 'DELIVERY' } }))) throw unprocessable('Record the delivery condition report first');
        if (!(await tx.custodyConfirmation.count({ where: { bookingId, stage: 'HANDOVER' } }))) throw unprocessable('Confirm handover with the handover code (or an authorised override) first');
        break;
      case 'CUSTOMER_UNAVAILABLE':
      case 'FAILED':
      case 'SAFETY_HOLD':
        if (!reason || reason.trim().length < 3) throw badRequest('A reason is required');
        break;
      case 'EN_ROUTE':
      case 'REASSIGNMENT_REQUIRED':
        break;
      default:
        throw forbidden('This status cannot be set from the field app');
    }

    await transition(tx, after, b, to, actor, { reason, data });
    if (to === 'SAFETY_HOLD') await raiseEscalation(tx, after, bookingId, 'SAFETY', `Safety hold by field team: ${reason}`, String(Date.now()));
    if (to === 'REASSIGNMENT_REQUIRED') {
      await releaseLiveAssignment(tx, after, bookingId, 'RELEASED', reason ?? 'Driver released the job');
      await raiseEscalation(tx, after, bookingId, 'VEHICLE_UNAVAILABLE', `Field team released the job: ${reason ?? 'no reason given'}`, String(Date.now()));
    }
    if (to === 'FAILED') {
      await tx.booking.update({ where: { id: bookingId }, data: { failureReason: reason } });
      await releaseLiveAssignment(tx, after, bookingId, 'RELEASED', reason!);
    }
    return { status: to };
  });
}

// ─── Custody: OTP verification ───────────────────────────────────────

export async function verifyPickupCode(p: Principal, bookingId: string, code: string, pos?: { lat: number; lng: number }) {
  return withTx(async (tx, after) => {
    const { booking: b, actor } = await loadFieldBooking(tx, p, bookingId);
    if (!['ARRIVED', 'CUSTOMER_UNAVAILABLE'].includes(b.status)) throw conflict('Mark arrival before verifying the pickup code');
    if (b.pickupVerifiedAt) {
      if (b.status === 'CUSTOMER_UNAVAILABLE') await transition(tx, after, b, 'ARRIVED', actor, { reason: 'Customer reached' });
      return { verified: true };
    }
    const attempts = await tx.auditLog.count({ where: { entityType: 'booking', entityId: bookingId, action: 'custody.pickup_otp_failed' } });
    if (attempts >= 5) throw forbidden('Too many incorrect codes. Ask dispatch for an authorised override.');
    if (!safeEqual(code, b.pickupOtp)) {
      await tx.auditLog.create({ data: { actorUserId: p.userId, action: 'custody.pickup_otp_failed', entityType: 'booking', entityId: bookingId } });
      throw badRequest('Incorrect pickup code');
    }
    const now = new Date();
    const waiting = b.arrivedAt ? Math.max(0, Math.round(minutesBetween(b.arrivedAt, now))) : 0;
    await tx.booking.update({ where: { id: bookingId }, data: { pickupVerifiedAt: now, waitingMinutes: waiting } });
    await tx.custodyConfirmation.create({ data: { bookingId, stage: 'PICKUP', method: 'OTP', confirmedById: p.userId, recipientName: b.contactName, lat: pos?.lat, lng: pos?.lng } });
    if (b.status === 'CUSTOMER_UNAVAILABLE') await transition(tx, after, b, 'ARRIVED', actor, { reason: 'Customer reached' });
    after(() => emitToBooking(bookingId, 'booking.custody', { stage: 'PICKUP' }));
    return { verified: true, waitingMinutes: waiting };
  });
}

export async function confirmHandover(p: Principal, bookingId: string, input: { code: string; recipientName: string; recipientRelation?: string; lat?: number; lng?: number }) {
  return withTx(async (tx, after) => {
    const { booking: b } = await loadFieldBooking(tx, p, bookingId);
    const allowed: BookingStatus[] = b.serviceCategory.kind === 'TOWING' ? ['IN_TRANSIT'] : ['RECOVERY_AUTHORIZED'];
    if (!allowed.includes(b.status)) throw conflict('Handover is not possible at this stage');
    const attempts = await tx.auditLog.count({ where: { entityType: 'booking', entityId: bookingId, action: 'custody.handover_otp_failed' } });
    if (attempts >= 5) throw forbidden('Too many incorrect codes. Ask dispatch for an authorised override.');
    if (!safeEqual(input.code, b.handoverOtp)) {
      await tx.auditLog.create({ data: { actorUserId: p.userId, action: 'custody.handover_otp_failed', entityType: 'booking', entityId: bookingId } });
      throw badRequest('Incorrect handover code');
    }
    await tx.custodyConfirmation.create({ data: { bookingId, stage: 'HANDOVER', method: 'OTP', confirmedById: p.userId, recipientName: input.recipientName, recipientRelation: input.recipientRelation, lat: input.lat, lng: input.lng } });
    after(() => emitToBooking(bookingId, 'booking.custody', { stage: 'HANDOVER' }));
    return { confirmed: true };
  });
}

/** Field team asks dispatch to authorise an OTP bypass (customer phone dead, recipient absent, etc.). */
export async function requestOverride(p: Principal, bookingId: string, stage: 'PICKUP' | 'HANDOVER', reason: string) {
  await loadFieldBooking(prisma, p, bookingId);
  await raiseEscalation(prisma, null, bookingId, 'MANUAL_REVIEW', `Field team requests ${stage.toLowerCase()} code override: ${reason}`, `override:${stage}:${Date.now()}`);
  return { requested: true };
}

/** Dispatcher/admin authorised override, recorded with reason and approver. */
export async function authorizeCustodyOverride(staff: Principal, bookingId: string, input: { stage: 'PICKUP' | 'HANDOVER'; reason: string; recipientName?: string; recipientRelation?: string }) {
  return withTx(async (tx, after) => {
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) throw notFound('Booking');
    const live = await tx.bookingAssignment.findFirst({ where: { bookingId, status: 'ACCEPTED' } });
    if (!live) throw conflict('No active field team on this booking');
    const exists = await tx.custodyConfirmation.findUnique({ where: { bookingId_stage: { bookingId, stage: input.stage } } });
    if (exists) throw conflict('Custody already confirmed for this stage');
    await tx.custodyConfirmation.create({
      data: { bookingId, stage: input.stage, method: 'AUTHORIZED_OVERRIDE', confirmedById: live.driverUserId, overrideReason: input.reason, overrideApprovedById: staff.userId, recipientName: input.recipientName ?? b.contactName, recipientRelation: input.recipientRelation },
    });
    if (input.stage === 'PICKUP') {
      const waiting = b.arrivedAt ? Math.max(0, Math.round(minutesBetween(b.arrivedAt, new Date()))) : 0;
      await tx.booking.update({ where: { id: bookingId }, data: { pickupVerifiedAt: new Date(), waitingMinutes: waiting } });
    }
    await tx.bookingStatusHistory.create({ data: { bookingId, fromStatus: b.status, toStatus: b.status, actorUserId: staff.userId, actorRole: staff.roles.includes('admin') ? 'ADMIN' : 'DISPATCHER', reason: `${input.stage} code override: ${input.reason}`, isOverride: true } });
    await tx.auditLog.create({ data: { actorUserId: staff.userId, action: `custody.${input.stage.toLowerCase()}_override`, entityType: 'booking', entityId: bookingId, after: input } });
    await notify(tx, b.customerUserId, { type: 'custody.override', title: `${b.code}: ${input.stage === 'PICKUP' ? 'pickup' : 'handover'} confirmed by operations`, body: `Reason: ${input.reason}`, data: { bookingId } });
    after(() => emitToBooking(bookingId, 'booking.custody', { stage: input.stage, override: true }));
    return { confirmed: true };
  });
}

// ─── Evidence ────────────────────────────────────────────────────────

export async function addConditionReport(
  p: Principal,
  bookingId: string,
  input: { stage: 'PICKUP' | 'DELIVERY'; notes?: string; damageMarks: { area: string; description: string }[]; odometerKm?: number; fuelLevel?: string; itemsInVehicle?: string; attachmentIds: string[]; supersedesId?: string },
) {
  return withTx(async (tx, after) => {
    const { booking: b } = await loadFieldBooking(tx, p, bookingId);
    const okStages: Record<string, BookingStatus[]> = { PICKUP: ['INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING'], DELIVERY: ['IN_TRANSIT'] };
    if (!okStages[input.stage]!.includes(b.status)) throw conflict(`A ${input.stage.toLowerCase()} report cannot be recorded now`);
    if (input.attachmentIds.length) {
      const n = await tx.bookingAttachment.count({ where: { id: { in: input.attachmentIds }, bookingId } });
      if (n !== input.attachmentIds.length) throw badRequest('Some photos do not belong to this booking');
    }
    if (input.attachmentIds.length === 0) throw badRequest('At least one photo is required as evidence');
    const r = await tx.vehicleConditionReport.create({ data: { bookingId, reportedById: p.userId, ...input, damageMarks: input.damageMarks } });
    after(() => emitToBooking(bookingId, 'booking.evidence', { stage: input.stage }));
    return r;
  });
}

// ─── Scope / price revision ──────────────────────────────────────────

export async function proposeRevision(p: Principal, bookingId: string, input: { reason: string; items: { description: string; amount: number; reason: string }[] }) {
  return withTx(async (tx, after) => {
    const { booking: b, isLead } = await loadFieldBooking(tx, p, bookingId);
    if (!isLead) throw forbidden('Only the team leader can request a revised quote');
    if (!['INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING'].includes(b.status)) throw conflict('Quote changes are only possible during inspection or recovery');
    if (!input.items.length) throw badRequest('Add at least one item');
    const current = await approvedQuote(tx, bookingId);
    const snap = current.pricingSnapshot as unknown as Snapshot;
    const carried = (snap.input.extras ?? []).map((x) => ({ ...x }));
    const extras = [...carried, ...input.items.map((it, i) => ({ code: `ADDL_${current.version}_${i + 1}`, description: it.description, amount: it.amount, reason: it.reason }))];
    const breakdown = computePrice(snap.rules, { ...snap.input, extras });
    const needsInternal = input.items.some((i) => i.amount < 0);

    await tx.bookingQuote.updateMany({ where: { bookingId, status: { in: ['PENDING_CUSTOMER_APPROVAL', 'PENDING_INTERNAL_APPROVAL'] } }, data: { status: 'SUPERSEDED' } });
    const q = await tx.bookingQuote.create({
      data: {
        bookingId,
        version: current.version + 1,
        kind: 'REVISION',
        status: needsInternal ? 'PENDING_INTERNAL_APPROVAL' : 'PENDING_CUSTOMER_APPROVAL',
        rateCardId: current.rateCardId,
        rateCardVersion: current.rateCardVersion,
        pricingSnapshot: { rules: snap.rules, input: { ...snap.input, extras }, breakdown } as unknown as Prisma.InputJsonValue,
        assumptions: { previousQuoteId: current.id, previousTotal: current.total, difference: breakdown.total - current.total } as Prisma.InputJsonValue,
        subtotal: breakdown.subtotal,
        discountTotal: breakdown.discountTotal,
        taxableValue: breakdown.taxableValue,
        taxTotal: breakdown.taxTotal,
        passThroughTotal: breakdown.passThroughTotal,
        total: breakdown.total,
        reason: input.reason,
        requestedById: p.userId,
        items: { create: quoteItemsData(breakdown) },
      },
    });
    if (needsInternal) await notifyOps(tx, { type: 'quote.override', title: `${b.code}: price change needs approval`, body: input.reason, data: { bookingId, quoteId: q.id } });
    else
      await notify(tx, b.customerUserId, {
        type: 'quote.revision',
        title: `${b.code}: approval needed for extra work`,
        body: `${input.reason}. New total ${formatInr(breakdown.total)} (was ${formatInr(current.total)}). Nothing extra is charged unless you approve.`,
        data: { bookingId, quoteId: q.id },
        channels: ['SMS', 'PUSH'],
      });
    after(() => emitToBooking(bookingId, 'quote.revision', { quoteId: q.id, total: q.total, status: q.status }));
    return q;
  });
}

/** Customer (or ops on their documented instruction) decides on a revised quote. */
export async function decideRevision(p: Principal, bookingId: string, quoteId: string, approve: boolean, note?: string) {
  return withTx(async (tx, after) => {
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b || b.customerUserId !== p.userId) throw notFound('Booking');
    const q = await tx.bookingQuote.findUnique({ where: { id: quoteId } });
    if (!q || q.bookingId !== bookingId || q.kind !== 'REVISION' || q.status !== 'PENDING_CUSTOMER_APPROVAL') throw conflict('This revision is no longer awaiting your decision');
    if (approve) {
      await tx.bookingQuote.updateMany({ where: { bookingId, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
      await tx.bookingQuote.update({ where: { id: q.id }, data: { status: 'APPROVED', decidedById: p.userId, decidedAt: new Date() } });
    } else {
      await tx.bookingQuote.update({ where: { id: q.id }, data: { status: 'REJECTED', decidedById: p.userId, decidedAt: new Date(), reason: `${q.reason ?? ''} | Customer: ${note ?? 'declined'}` } });
    }
    await tx.bookingStatusHistory.create({ data: { bookingId, fromStatus: b.status, toStatus: b.status, actorUserId: p.userId, actorRole: 'CUSTOMER', reason: `Revised quote v${q.version} ${approve ? 'approved' : 'declined'}${note ? `: ${note}` : ''}` } });
    const lead = await tx.bookingAssignment.findFirst({ where: { bookingId, status: 'ACCEPTED' } });
    if (lead) await notify(tx, lead.driverUserId, { type: 'quote.decision', title: `${b.code}: customer ${approve ? 'approved' : 'declined'} the revised quote`, body: approve ? 'You may proceed with the revised scope.' : 'Continue only with the originally approved scope, or contact dispatch.', data: { bookingId } });
    after(() => emitToBooking(bookingId, 'quote.decision', { quoteId, approved: approve }));
    return { approved: approve };
  });
}

export async function decideInternalOverride(staff: Principal, quoteId: string, approve: boolean, note: string) {
  return withTx(async (tx, after) => {
    const q = await tx.bookingQuote.findUnique({ where: { id: quoteId }, include: { booking: true } });
    if (!q || q.status !== 'PENDING_INTERNAL_APPROVAL') throw conflict('Quote is not awaiting internal approval');
    const increases = (q.assumptions as { difference?: number }).difference ?? 0;
    await tx.bookingQuote.update({
      where: { id: q.id },
      data: approve ? { status: increases > 0 ? 'PENDING_CUSTOMER_APPROVAL' : 'APPROVED', internalApprovedById: staff.userId, ...(increases > 0 ? {} : { decidedById: staff.userId, decidedAt: new Date() }) } : { status: 'REJECTED', decidedById: staff.userId, decidedAt: new Date() },
    });
    if (approve && increases <= 0) await tx.bookingQuote.updateMany({ where: { bookingId: q.bookingId, status: 'APPROVED', id: { not: q.id } }, data: { status: 'SUPERSEDED' } });
    await tx.auditLog.create({ data: { actorUserId: staff.userId, action: approve ? 'quote.override.approved' : 'quote.override.rejected', entityType: 'booking_quote', entityId: q.id, after: { note, total: q.total } } });
    after(() => emitToBooking(q.bookingId, 'quote.decision', { quoteId, approved: approve }));
    return { status: approve ? (increases > 0 ? 'PENDING_CUSTOMER_APPROVAL' : 'APPROVED') : 'REJECTED' };
  });
}

// ─── Close job: final invoice, earnings, membership usage ────────────

export async function closeJob(
  p: Principal,
  bookingId: string,
  input: { tolls: number; parking: number; odometerKm?: number; notes?: string; cashCollected?: number; expenses: { category: 'FUEL' | 'TOLLS_PARKING' | 'OTHER'; amount: number; description: string; attachmentId?: string }[] },
) {
  const result = await withTx(async (tx, after) => {
    const { booking: b, isLead, actor } = await loadFieldBooking(tx, p, bookingId);
    if (!isLead) throw forbidden('Only the team leader can close the job');
    if (b.status !== 'DELIVERED') throw conflict('Complete the handover before closing the job');
    if (input.tolls + input.parking > 0 && !(await tx.bookingAttachment.count({ where: { bookingId, kind: 'TOLL_RECEIPT' } })))
      throw unprocessable('Upload toll/parking receipts before adding these charges');

    const approved = await approvedQuote(tx, bookingId);
    const snap = approved.pricingSnapshot as unknown as Snapshot;
    // Final invoice uses the frozen pricing snapshot — later rate-card changes never alter it.
    const final = computePrice(snap.rules, { ...snap.input, final: true, waitingMinutes: b.waitingMinutes, tolls: input.tolls, parking: input.parking });
    const diff = diffAgainstApproved(snap.breakdown, final);
    const unexplained = diff.changes.filter((c) => c.delta > 0 && !c.isPassThrough && c.code !== 'WAITING' && !/NIGHT|HOLIDAY/.test(c.code));
    if (unexplained.length) throw unprocessable('Final charges exceed the approved scope. Request a revised quote first.', { changes: unexplained });

    const s = await getSettings(tx);
    const invoice = await issueServiceInvoice(tx, b, final, { id: approved.id, total: approved.total }, { rules: snap.rules, input: { ...snap.input, final: true }, breakdown: final, diff, closedBy: p.userId, notes: input.notes, timezone: s.locale.timezone }, b.isSample);

    await releaseLiveAssignment(tx, after, bookingId, 'COMPLETED', 'Job closed');
    await transition(tx, after, b, 'COMPLETED', actor, { metadata: { invoiceId: invoice.id } });

    // Membership usage
    if (b.membershipSubscriptionId && final.lines.some((l) => l.code === 'MEMBERSHIP_BASE')) {
      const benefit = -final.lines.filter((l) => l.code.startsWith('MEMBERSHIP')).reduce((a, l) => a + l.amount, 0);
      await tx.membershipUsage.create({ data: { subscriptionId: b.membershipSubscriptionId, bookingId, benefitAmount: benefit } });
      await tx.membershipSubscription.update({ where: { id: b.membershipSubscriptionId }, data: { servicesUsed: { increment: 1 } } });
    }

    // Earnings for the field team according to each member's compensation rule.
    const team = await tx.bookingTeamMember.findMany({ where: { bookingId, active: true }, include: { user: { include: { workerProfile: true } } } });
    for (const t of team) {
      const wp = t.user.workerProfile;
      if (!wp) continue;
      let amount = 0;
      let kind: 'JOB_COMMISSION' | 'JOB_FIXED' | null = null;
      if (wp.employmentType === 'COMMISSION' && wp.commissionBps && t.role === 'TEAM_LEADER') {
        amount = applyBps(invoice.taxableValue, wp.commissionBps);
        kind = 'JOB_COMMISSION';
      } else if ((wp.employmentType === 'JOB_BASED' || wp.employmentType === 'PARTNER') && wp.perJobAmount) {
        amount = wp.perJobAmount;
        kind = 'JOB_FIXED';
      }
      if (kind && amount > 0) await tx.driverEarning.create({ data: { userId: t.userId, bookingId, kind, amount, note: `${b.code} (${t.role.replace('_', ' ').toLowerCase()})` } });
    }

    // Truck odometer
    const live = await tx.bookingAssignment.findFirst({ where: { bookingId, status: 'COMPLETED' }, orderBy: { respondedAt: 'desc' } });
    if (live?.truckId && input.odometerKm) await tx.towTruck.updateMany({ where: { id: live.truckId, odometerKm: { lte: input.odometerKm } }, data: { odometerKm: input.odometerKm } });

    // Reimbursable expense claims (reviewed by finance)
    for (const e of input.expenses) {
      let attachmentKey: string | null = null;
      if (e.attachmentId) attachmentKey = (await tx.bookingAttachment.findFirst({ where: { id: e.attachmentId, bookingId } }))?.storageKey ?? null;
      await tx.expense.create({
        data: { number: await nextDocumentNumber(tx, 'EXP'), category: e.category, source: 'EMPLOYEE_CLAIM', status: 'SUBMITTED', description: e.description, amount: e.amount, expenseDate: new Date(), truckId: live?.truckId, bookingId, zoneId: b.zoneId, claimantUserId: p.userId, reimbursable: true, attachmentKey, submittedById: p.userId },
      });
    }
    after(() => emitOpsRefresh(bookingId));
    return invoice;
  });
  if (input.cashCollected && input.cashCollected > 0) await recordCashCollection(p.userId, result.id, input.cashCollected, 'Collected at job close');
  return result;
}

function emitOpsRefresh(bookingId: string) {
  emitToOps('booking.completed', {}, bookingId);
}

// ─── Location ────────────────────────────────────────────────────────

export interface LocationPoint {
  lat: number;
  lng: number;
  accuracyM?: number;
  speedKmh?: number;
  heading?: number;
  recordedAt: Date;
}

/**
 * Driver location updates (single or buffered batch after reconnect). Stored as tracking events
 * only while on an active job; otherwise only the latest position is kept for dispatch.
 */
export async function recordLocation(p: Principal, points: LocationPoint[]) {
  const now = Date.now();
  const valid = points.filter((pt) => pt.recordedAt.getTime() <= now + 120_000 && pt.recordedAt.getTime() > now - 24 * 3600_000).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  if (!valid.length) throw badRequest('No valid location points');
  const av = await prisma.driverAvailability.findUnique({ where: { userId: p.userId } });
  if (!av || av.status === 'OFF_DUTY') throw forbidden('Location sharing is off while you are off duty');
  const latest = valid[valid.length - 1]!;

  const live = await prisma.bookingAssignment.findFirst({ where: { driverUserId: p.userId, status: 'ACCEPTED' }, include: { booking: { include: { locations: true } } } });
  const activeBooking = live && FIELD_ACTIVE_STATUSES.includes(live.booking.status) ? live.booking : null;

  if (!av.lastLocationAt || latest.recordedAt > av.lastLocationAt)
    await prisma.driverAvailability.update({ where: { userId: p.userId }, data: { lastLat: latest.lat, lastLng: latest.lng, lastAccuracyM: latest.accuracyM, lastLocationAt: latest.recordedAt, locationSharing: true } });
  if (activeBooking) {
    await prisma.trackingEvent.createMany({ data: valid.map((pt) => ({ bookingId: activeBooking.id, driverUserId: p.userId, lat: pt.lat, lng: pt.lng, accuracyM: pt.accuracyM, speedKmh: pt.speedKmh, heading: pt.heading, recordedAt: pt.recordedAt })) });
    if (LIVE_TRACKING_STATUSES.includes(activeBooking.status)) {
      const payload = { lat: latest.lat, lng: latest.lng, accuracyM: latest.accuracyM, at: latest.recordedAt };
      emitToBooking(activeBooking.id, 'driver.location', payload, payload);
    }
    if (['ACCEPTED', 'EN_ROUTE'].includes(activeBooking.status)) {
      const pickup = activeBooking.locations.find((l) => l.kind === 'PICKUP')!;
      const r = await routeEstimate(latest, pickup);
      const eta = new Date(Date.now() + r.durationMin * 60_000);
      if (!activeBooking.etaAt || Math.abs(eta.getTime() - activeBooking.etaAt.getTime()) > 2 * 60_000) {
        await prisma.booking.update({ where: { id: activeBooking.id }, data: { etaAt: eta } });
        emitToBooking(activeBooking.id, 'booking.eta', { etaAt: eta, source: r.source }, { etaAt: eta });
      }
    }
  } else {
    emitToOps('driver.location', { userId: p.userId, lat: latest.lat, lng: latest.lng, at: latest.recordedAt });
  }
  return { stored: valid.length, onJob: !!activeBooking };
}

export const ensureLeadFor = loadFieldBooking;
export type { AfterCommit };
