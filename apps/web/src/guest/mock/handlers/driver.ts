/**
 * Guest-mode handlers for the field app (/driver/*), following apps/api/src/modules/field.
 * The guest driver is Ravi Kumar; his live job is Priya's car tow. To keep the demo explorable
 * without a second person: any 4-digit pickup/handover code is accepted, code-override requests
 * are approved by "dispatch" straight away, and a revised quote is approved by the "customer"
 * after a short pause.
 */
import type { BookingStatus } from '@/api/types';
import type { EarningsResponse, PerformanceResponse } from '@/pages/driver/components/driverShared';
import type { GAssignment, GAttachment, GBooking, GEscalation, GExpense, GIncident, GUser } from '../model';
import { categoryById, db, DAY, fyLabel, HOUR, invoiceForBooking, MIN, newId, nowIso, pushNotification, quoteRecord, recordPayment, refreshInvoiceLedger, truckById, truckForDriver, userById, zoneById } from '../db';
import { NEEDS_PROVIDER_STATUSES, TERMINAL_STATUSES, transition } from '../bookingOps';
import { placeholderImage } from '../files';
import { fail, notFound, num, on, paged, str, type Ctx } from '../router';
import { projectBooking, resolveViewer } from '../serialize';

// ─── Helpers ──────────────────────────────────────────────────────────

const me = (c: Ctx): GUser => userById(c.userId) ?? fail(401, 'UNAUTHORIZED', 'Not signed in');
const actorRole = (u: GUser) => (u.roles.includes('driver') ? 'DRIVER' : 'WORKER') as 'DRIVER' | 'WORKER';
/** Rupees (number or string) from a request → integer paise. */
const paise = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

function view(b: GBooking, u: GUser) {
  const v = resolveViewer(u, b) ?? notFound('Booking');
  return projectBooking(b, v, u);
}

/** A booking the worker is actively on: accepted lead, or an active team member (loadFieldBooking). */
function loadField(c: Ctx, bookingId: string) {
  const u = me(c);
  const b = db.bookings.find((x) => x.id === bookingId);
  if (!b) return notFound('Job');
  const lead = b.assignments.find((a) => a.driverUserId === u.id && a.status === 'ACCEPTED');
  const member = b.teamMembers.find((t) => t.userId === u.id && t.active);
  if (!lead && !member) return notFound('Job');
  return { u, b, isLead: !!lead || member?.role === 'TEAM_LEADER', actor: actorRole(u) };
}

function raiseEscalation(bookingId: string, type: GEscalation['type'], detail: string) {
  db.escalations.unshift({ id: newId('esc'), bookingId, type, status: 'OPEN', detail, resolution: null, resolvedById: null, resolvedAt: null, createdAt: nowIso() });
}

function notifyOps(type: string, title: string, body: string, data: Record<string, unknown> | null = null) {
  for (const id of ['u_admin', 'u_dispatch']) pushNotification(id, type, title, body, data);
}

/** Ends this team's involvement (releaseLiveAssignment with a non-completed status). */
function releaseTeam(b: GBooking) {
  for (const t of b.teamMembers.filter((x) => x.active)) {
    t.active = false;
    const u = userById(t.userId);
    if (u?.availability && u.availability.status === 'ON_JOB') u.availability = { ...u.availability, status: 'AVAILABLE', statusSince: nowIso() };
  }
}

function activeJobFor(u: GUser) {
  const live = db.bookings.find((b) => b.assignments.some((a) => a.driverUserId === u.id && a.status === 'ACCEPTED'));
  // Disputed jobs are back-office work, not field work, so they never count as the active job.
  return live ?? db.bookings.find((b) => !TERMINAL_STATUSES.includes(b.status) && b.status !== 'DISPUTED' && b.teamMembers.some((t) => t.userId === u.id && t.active));
}

const custodyAt = (b: GBooking, stage: 'PICKUP' | 'HANDOVER') => b.custody.find((x) => x.stage === stage);

let tipShown = false;
/** One-off hint for guests: where to find the customer's codes. */
function guestTip(u: GUser) {
  if (tipShown || u.id !== 'u_drv_ravi') return;
  tipShown = true;
  const job = activeJobFor(u);
  if (!job) return;
  pushNotification(u.id, 'guest.tip', 'Guest mode tip: customer codes', `For ${job.code} the customer's pickup code is ${job.pickupOtp} and the handover code is ${job.handoverOtp}. In this demo any 4-digit code is accepted.`, { bookingId: job.id });
}

// ─── Profile, availability, location ─────────────────────────────────

on('GET', '/driver/me', (c) => {
  const u = me(c);
  guestTip(u);
  const wp = u.workerProfile;
  const t = truckForDriver(u.id);
  return {
    id: u.id,
    fullName: u.fullName,
    phone: u.phone,
    photoUrl: u.photoUrl,
    roles: u.roles,
    workerProfile: wp && {
      employeeCode: wp.employeeCode,
      verificationStatus: wp.verificationStatus,
      verificationNote: wp.verificationNote,
      employmentType: wp.employmentType,
      skills: wp.skills,
      partnerCompany: wp.partnerCompany,
      zones: wp.zoneIds.map((id) => zoneById(id)).filter((z) => !!z).map((z) => ({ id: z!.id, name: z!.name, city: z!.city })),
    },
    driverProfile: u.driverProfile && { licenceExpiry: u.driverProfile.licenceExpiry, licenceClass: u.driverProfile.licenceClass, canLeadTeam: u.driverProfile.canLeadTeam },
    availability: u.availability,
    assignedTruck: t ? { ...t, equipment: t.equipment.map((e) => ({ ...e })) } : null,
  };
});

on('PUT', '/driver/availability', (c) => {
  const u = me(c);
  const status = str(c.body.status) as 'AVAILABLE' | 'BUSY' | 'ON_BREAK' | 'OFF_DUTY' | undefined;
  if (!status || !['AVAILABLE', 'BUSY', 'ON_BREAK', 'OFF_DUTY'].includes(status)) fail(400, 'VALIDATION_ERROR', 'Choose a valid status');
  const wp = u.workerProfile ?? fail(403, 'FORBIDDEN', 'No worker profile');
  if (status === 'AVAILABLE' && wp.verificationStatus !== 'APPROVED') fail(403, 'FORBIDDEN', 'Your verification is not complete yet');
  const zoneId = c.body.zoneId === undefined ? undefined : ((c.body.zoneId as string | null) ?? null);
  if (zoneId && !wp.zoneIds.includes(zoneId)) fail(403, 'FORBIDDEN', 'You are not authorised for that service zone');
  const live = db.bookings.some((b) => b.assignments.some((a) => a.driverUserId === u.id && a.status === 'ACCEPTED'));
  if (live && status !== 'BUSY') fail(400, 'BAD_REQUEST', 'Finish or hand over your active job before changing availability');
  const now = nowIso();
  const prev = u.availability;
  if (!prev || prev.status !== status) {
    // Attendance log: close the open entry and start a new one.
    const open = db.availabilityLogs.find((l) => l.userId === u.id && !l.endedAt);
    if (open) open.endedAt = now;
    db.availabilityLogs.push({ id: newId('att'), userId: u.id, status, zoneId: zoneId ?? prev?.zoneId ?? null, startedAt: now, endedAt: null });
  }
  u.availability = {
    status,
    zoneId: zoneId === undefined ? (prev?.zoneId ?? wp.zoneIds[0] ?? null) : zoneId,
    lastLat: prev?.lastLat ?? null,
    lastLng: prev?.lastLng ?? null,
    lastAccuracyM: prev?.lastAccuracyM ?? null,
    lastLocationAt: status === 'OFF_DUTY' ? (prev?.lastLocationAt ?? null) : now,
    locationSharing: status !== 'OFF_DUTY',
    statusSince: prev?.status === status ? prev.statusSince : now,
  };
  return u.availability;
});

// The demo keeps sample GPS positions: the device's real location is never stored, even in memory.
on('POST', '/driver/location', (c) => {
  const u = me(c);
  if (!u.availability || u.availability.status === 'OFF_DUTY') fail(403, 'FORBIDDEN', 'Location sharing is off while you are off duty');
  const points = Array.isArray(c.body.points) ? c.body.points.length : 1;
  return { stored: points, onJob: !!activeJobFor(u) };
});

// ─── Offers ───────────────────────────────────────────────────────────

const declined = new Set<string>();

/** Offers the guest driver a waiting job once they are free, so the offer flow can be tried. */
function ensureGuestOffer(u: GUser) {
  if (u.id !== 'u_drv_ravi' || !u.availability || u.availability.status !== 'AVAILABLE' || activeJobFor(u)) return;
  if (db.bookings.some((b) => b.status === 'ASSIGNED' && b.assignments.some((a) => a.driverUserId === u.id && a.status === 'OFFERED'))) return;
  const candidates = db.bookings
    .filter((b) => NEEDS_PROVIDER_STATUSES.includes(b.status) && !declined.has(b.id) && (!b.requiresManualReview || b.reviewedAt) && !b.assignments.some((a) => a.status === 'OFFERED' || a.status === 'ACCEPTED'))
    .filter((b) => categoryById(b.serviceCategoryId).allowedTruckTypes.includes(truckForDriver(u.id)?.truckType ?? 'FLATBED'))
    .sort((a, b) => (a.id === 'bk_live_sneha' ? -1 : b.id === 'bk_live_sneha' ? 1 : b.createdAt.localeCompare(a.createdAt)));
  const b = candidates[0];
  if (!b) return;
  const truck = truckForDriver(u.id);
  const pickup = b.locations.find((l) => l.kind === 'PICKUP')!;
  const distanceKm = u.availability.lastLat != null && u.availability.lastLng != null ? Math.round(Math.hypot((pickup.lat - u.availability.lastLat) * 111, (pickup.lng - u.availability.lastLng) * 108.5) * 13) / 10 : 6.4;
  const a: GAssignment = { id: newId('asg'), bookingId: b.id, driverUserId: u.id, truckId: truck?.id ?? null, status: 'OFFERED', method: 'AUTO', attempt: b.assignments.length + 1, offeredAt: nowIso(), expiresAt: new Date(Date.now() + 90_000).toISOString(), respondedAt: null, rejectionReason: null, assignedById: null, etaMinutes: Math.max(6, Math.round(distanceKm * 2.6)), distanceKm, score: 0.86 };
  b.assignments.push(a);
  b.dispatchAttempts++;
  transition(b, 'ASSIGNED', 'SYSTEM', null, { reason: `Auto-dispatch offered to ${u.fullName}`, force: true });
  pushNotification(u.id, 'job.offer', 'New job offer', `${b.code}: ${categoryById(b.serviceCategoryId).name} near ${pickup.address ?? 'you'}.`, { bookingId: b.id });
}

on('GET', '/driver/offers', (c) => {
  const u = me(c);
  ensureGuestOffer(u);
  const now = Date.now();
  const out = [];
  for (const b of db.bookings) {
    for (const a of b.assignments) {
      if (a.driverUserId !== u.id || a.status !== 'OFFERED' || b.status !== 'ASSIGNED') continue;
      // Guest mode keeps offers open while someone is looking at them.
      if (new Date(a.expiresAt).getTime() < now + 20_000) a.expiresAt = new Date(now + 90_000).toISOString();
      out.push({ assignmentId: a.id, expiresAt: a.expiresAt, booking: view(b, u) });
    }
  }
  return out;
});

function findOffer(c: Ctx) {
  const u = me(c);
  for (const b of db.bookings) {
    const a = b.assignments.find((x) => x.id === c.params.id && x.driverUserId === u.id);
    if (a) return { u, b, a };
  }
  return fail(409, 'CONFLICT', 'This offer has expired or was withdrawn');
}

on('POST', '/driver/offers/:id/accept', (c) => {
  const { u, b, a } = findOffer(c);
  if (a.status !== 'OFFERED') fail(409, 'CONFLICT', 'This offer has expired or was withdrawn');
  if (b.status !== 'ASSIGNED') fail(409, 'CONFLICT', 'Booking is no longer awaiting acceptance');
  if (activeJobFor(u)) fail(409, 'CONFLICT', 'Finish your active job before accepting another');
  const truck = truckById(a.truckId);
  if (truck && truck.status !== 'AVAILABLE' && truck.status !== 'IN_USE') fail(422, 'UNPROCESSABLE', 'Your truck cannot be dispatched');
  const now = nowIso();
  a.status = 'ACCEPTED';
  a.respondedAt = now;
  if (truck) truck.status = 'IN_USE';
  if (u.availability) u.availability = { ...u.availability, status: 'ON_JOB', statusSince: now };
  const existing = b.teamMembers.find((t) => t.userId === u.id);
  if (existing) Object.assign(existing, { active: true, role: 'TEAM_LEADER' });
  else b.teamMembers.push({ id: newId('tm'), userId: u.id, role: 'TEAM_LEADER', responsibility: 'Driver and team leader', addedById: null, active: true, createdAt: now });
  b.etaAt = new Date(Date.now() + (a.etaMinutes ?? 20) * MIN).toISOString();
  transition(b, 'ACCEPTED', actorRole(u), u.id);
  for (const e of db.escalations) if (e.bookingId === b.id && e.type === 'NO_PROVIDER' && e.status !== 'RESOLVED') Object.assign(e, { status: 'RESOLVED', resolution: `Accepted by ${u.fullName}`, resolvedAt: now });
  return view(b, u);
});

on('POST', '/driver/offers/:id/reject', (c) => {
  const { u, b, a } = findOffer(c);
  if (a.status !== 'OFFERED') fail(409, 'CONFLICT', 'This offer is no longer open');
  const reason = str(c.body.reason);
  a.status = 'REJECTED';
  a.respondedAt = nowIso();
  a.rejectionReason = reason ?? 'Declined';
  declined.add(b.id);
  if (b.status === 'ASSIGNED') {
    transition(b, 'REJECTED', actorRole(u), u.id, { reason: reason ?? 'Driver declined' });
    // The API re-runs auto-dispatch; here the job goes back to the search queue.
    transition(b, 'SEARCHING_FOR_PROVIDER', 'SYSTEM', null, { reason: 'Re-dispatching after decline' });
  }
  raiseEscalation(b.id, 'DRIVER_REJECTED', `Driver declined${reason ? `: ${reason}` : ''}`);
  return { rejected: true };
});

// ─── Jobs ─────────────────────────────────────────────────────────────

on('GET', '/driver/jobs/active', (c) => {
  const u = me(c);
  const b = activeJobFor(u);
  return b ? view(b, u) : null;
});

on('GET', '/driver/jobs', (c) => {
  const u = me(c);
  const rows = db.bookings
    .filter((b) => b.teamMembers.some((t) => t.userId === u.id && t.active))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((b) => {
      const v = b.vehicleId ? db.vehicles.find((x) => x.id === b.vehicleId) : undefined;
      return {
        id: b.id,
        code: b.code,
        status: b.status,
        createdAt: b.createdAt,
        completedAt: b.completedAt,
        serviceCategory: { name: categoryById(b.serviceCategoryId).name },
        vehicle: v ? { registrationNumber: v.registrationNumber, make: v.make, model: v.model } : null,
        earnings: db.earnings.filter((e) => e.bookingId === b.id && e.userId === u.id && e.status !== 'VOID').map((e) => ({ amount: e.amount, kind: e.kind })),
      };
    });
  return paged(rows, c.query);
});

const FIELD_TARGETS: BookingStatus[] = ['EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'CUSTOMER_UNAVAILABLE', 'FAILED', 'SAFETY_HOLD', 'REASSIGNMENT_REQUIRED'];

on('POST', '/driver/jobs/:id/transition', (c) => {
  const { u, b, isLead, actor } = loadField(c, c.params.id!);
  const to = str(c.body.to) as BookingStatus | undefined;
  const reason = str(c.body.reason)?.trim();
  if (!to || !FIELD_TARGETS.includes(to)) fail(403, 'FORBIDDEN', 'This status cannot be set from the field app');
  if (!isLead && to !== 'SAFETY_HOLD') fail(403, 'FORBIDDEN', 'Only the team leader can update job progress');
  const towing = categoryById(b.serviceCategoryId).kind === 'TOWING';
  switch (to) {
    case 'INSPECTING':
      if (!b.pickupVerifiedAt) fail(422, 'UNPROCESSABLE', 'Verify the customer pickup code (or get an authorised override) before inspection');
      break;
    case 'RECOVERY_AUTHORIZED':
      if (b.quotes.some((q) => q.status === 'PENDING_CUSTOMER_APPROVAL' || q.status === 'PENDING_INTERNAL_APPROVAL')) fail(422, 'UNPROCESSABLE', 'A revised quote is awaiting approval');
      if (towing && !b.conditionReports.some((r) => r.stage === 'PICKUP')) fail(422, 'UNPROCESSABLE', 'Record the pickup condition report first');
      break;
    case 'LOADING':
    case 'IN_TRANSIT':
      if (!towing) fail(422, 'UNPROCESSABLE', 'This is an on-site service');
      break;
    case 'DELIVERED':
      if (towing && !b.conditionReports.some((r) => r.stage === 'DELIVERY')) fail(422, 'UNPROCESSABLE', 'Record the delivery condition report first');
      if (!custodyAt(b, 'HANDOVER')) fail(422, 'UNPROCESSABLE', 'Confirm handover with the handover code (or an authorised override) first');
      break;
    case 'CUSTOMER_UNAVAILABLE':
    case 'FAILED':
    case 'SAFETY_HOLD':
      if (!reason || reason.length < 3) fail(400, 'BAD_REQUEST', 'A reason is required');
      break;
  }
  const firstArrival = b.arrivedAt;
  transition(b, to, actor, u.id, { reason });
  if (to === 'ARRIVED' && firstArrival) b.arrivedAt = firstArrival; // resuming keeps the first arrival time
  if (to === 'SAFETY_HOLD') {
    raiseEscalation(b.id, 'SAFETY', `Safety hold by field team: ${reason}`);
    notifyOps('escalation.created', `${b.code}: safety hold`, reason ?? 'Safety hold', { bookingId: b.id });
  }
  if (to === 'REASSIGNMENT_REQUIRED' || to === 'FAILED') {
    releaseTeam(b);
    if (to === 'REASSIGNMENT_REQUIRED') raiseEscalation(b.id, 'VEHICLE_UNAVAILABLE', `Field team released the job: ${reason ?? 'no reason given'}`);
    return { id: b.id, status: to, released: true };
  }
  return view(b, u);
});

on('POST', '/driver/jobs/:id/verify-pickup', (c) => {
  const { u, b, actor } = loadField(c, c.params.id!);
  if (!/^\d{4}$/.test(String(c.body.code ?? ''))) fail(400, 'VALIDATION_ERROR', 'Enter the 4-digit code', [{ path: 'code', message: 'Enter the 4-digit code' }]);
  if (!['ARRIVED', 'CUSTOMER_UNAVAILABLE'].includes(b.status)) fail(409, 'CONFLICT', 'Mark arrival before verifying the pickup code');
  if (b.pickupVerifiedAt) {
    if (b.status === 'CUSTOMER_UNAVAILABLE') transition(b, 'ARRIVED', actor, u.id, { reason: 'Customer reached' });
    return { verified: true };
  }
  // Guest mode accepts any 4-digit code (the customer's real code is in the driver's notifications).
  const now = Date.now();
  const waiting = b.arrivedAt ? Math.max(0, Math.round((now - new Date(b.arrivedAt).getTime()) / MIN)) : 0;
  b.pickupVerifiedAt = new Date(now).toISOString();
  b.waitingMinutes = waiting;
  b.custody.push({ stage: 'PICKUP', method: 'OTP', recipientName: b.contactName, recipientRelation: 'Owner', confirmedById: u.id, overrideReason: null, createdAt: b.pickupVerifiedAt });
  b.updatedAt = b.pickupVerifiedAt;
  if (b.status === 'CUSTOMER_UNAVAILABLE') transition(b, 'ARRIVED', actor, u.id, { reason: 'Customer reached' });
  return { verified: true, waitingMinutes: waiting };
});

on('POST', '/driver/jobs/:id/handover', (c) => {
  const { u, b } = loadField(c, c.params.id!);
  if (!/^\d{4}$/.test(String(c.body.code ?? ''))) fail(400, 'VALIDATION_ERROR', 'Enter the 4-digit code', [{ path: 'code', message: 'Enter the 4-digit code' }]);
  const name = str(c.body.recipientName)?.trim();
  if (!name || name.length < 2) fail(400, 'VALIDATION_ERROR', 'Enter the recipient name', [{ path: 'recipientName', message: 'Enter the recipient name' }]);
  const allowed: BookingStatus[] = categoryById(b.serviceCategoryId).kind === 'TOWING' ? ['IN_TRANSIT'] : ['RECOVERY_AUTHORIZED'];
  if (!allowed.includes(b.status)) fail(409, 'CONFLICT', 'Handover is not possible at this stage');
  if (custodyAt(b, 'HANDOVER')) return { confirmed: true };
  b.custody.push({ stage: 'HANDOVER', method: 'OTP', recipientName: name, recipientRelation: str(c.body.recipientRelation) ?? null, confirmedById: u.id, overrideReason: null, createdAt: nowIso() });
  b.updatedAt = nowIso();
  return { confirmed: true };
});

on('POST', '/driver/jobs/:id/equipment-check', (c) => {
  const { u, b, isLead, actor } = loadField(c, c.params.id!);
  if (!isLead) fail(403, 'FORBIDDEN', 'Only the team leader can confirm equipment and crew');
  if (!['ARRIVED', 'INSPECTING'].includes(b.status)) fail(400, 'BAD_REQUEST', 'Confirm equipment and crew during inspection');
  const notes = str(c.body.notes);
  b.statusHistory.push({ id: newId('sh'), fromStatus: b.status, toStatus: b.status, actorUserId: u.id, actorRole: actor, reason: `Equipment & crew confirmed suitable${notes ? `: ${notes}` : ''}`, isOverride: false, metadata: null, createdAt: nowIso() });
  return { confirmed: true };
});

on('POST', '/driver/jobs/:id/override-request', (c) => {
  const { b } = loadField(c, c.params.id!);
  const stage = str(c.body.stage) as 'PICKUP' | 'HANDOVER' | undefined;
  const reason = str(c.body.reason)?.trim() ?? '';
  if (stage !== 'PICKUP' && stage !== 'HANDOVER') fail(400, 'VALIDATION_ERROR', 'Choose a stage');
  if (reason.length < 5) fail(400, 'VALIDATION_ERROR', 'Give a reason (at least 5 characters)', [{ path: 'reason', message: 'Give a reason (at least 5 characters)' }]);
  raiseEscalation(b.id, 'MANUAL_REVIEW', `Field team requests ${stage.toLowerCase()} code override: ${reason}`);
  notifyOps('escalation.created', `${b.code}: code override requested`, reason, { bookingId: b.id });
  // Guest mode: dispatch authorises the override immediately (authorizeCustodyOverride).
  if (!custodyAt(b, stage)) {
    const live = b.assignments.find((a) => a.status === 'ACCEPTED');
    const now = nowIso();
    b.custody.push({ stage, method: 'AUTHORIZED_OVERRIDE', recipientName: b.contactName, recipientRelation: null, confirmedById: live?.driverUserId ?? c.userId, overrideReason: reason, createdAt: now });
    if (stage === 'PICKUP') {
      b.pickupVerifiedAt = now;
      b.waitingMinutes = b.arrivedAt ? Math.max(0, Math.round((Date.now() - new Date(b.arrivedAt).getTime()) / MIN)) : 0;
    }
    b.statusHistory.push({ id: newId('sh'), fromStatus: b.status, toStatus: b.status, actorUserId: 'u_dispatch', actorRole: 'DISPATCHER', reason: `${stage} code override: ${reason}`, isOverride: true, metadata: null, createdAt: now });
    const esc = db.escalations[0];
    if (esc) Object.assign(esc, { status: 'RESOLVED', resolution: 'Override authorised by dispatch', resolvedById: 'u_dispatch', resolvedAt: now });
    pushNotification(c.userId, 'custody.override', `${b.code}: ${stage === 'PICKUP' ? 'pickup' : 'handover'} override approved`, 'Dispatch authorised the code override. You may continue.', { bookingId: b.id });
  }
  return { requested: true };
});

on('POST', '/driver/jobs/:id/condition-reports', (c) => {
  const { u, b } = loadField(c, c.params.id!);
  const stage = str(c.body.stage) as 'PICKUP' | 'DELIVERY' | undefined;
  if (stage !== 'PICKUP' && stage !== 'DELIVERY') fail(400, 'VALIDATION_ERROR', 'Choose a stage');
  const okStages: Record<string, BookingStatus[]> = { PICKUP: ['INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING'], DELIVERY: ['IN_TRANSIT'] };
  if (!okStages[stage]!.includes(b.status)) fail(409, 'CONFLICT', `A ${stage.toLowerCase()} report cannot be recorded now`);
  const attachmentIds = Array.isArray(c.body.attachmentIds) ? (c.body.attachmentIds as string[]) : [];
  if (attachmentIds.some((id) => !b.attachments.some((a) => a.id === id))) fail(400, 'BAD_REQUEST', 'Some photos do not belong to this booking');
  if (!attachmentIds.length) fail(400, 'BAD_REQUEST', 'At least one photo is required as evidence');
  const r = {
    id: newId('cr'),
    stage,
    reportedById: u.id,
    notes: str(c.body.notes) ?? null,
    damageMarks: Array.isArray(c.body.damageMarks) ? (c.body.damageMarks as { area: string; description: string }[]) : [],
    odometerKm: num(c.body.odometerKm) ?? null,
    fuelLevel: str(c.body.fuelLevel) ?? null,
    itemsInVehicle: str(c.body.itemsInVehicle) ?? null,
    attachmentIds,
    createdAt: nowIso(),
  };
  b.conditionReports.push(r);
  b.updatedAt = r.createdAt;
  return { ...r, bookingId: b.id, supersedesId: str(c.body.supersedesId) ?? null };
});

const ATTACHMENT_KINDS = ['PICKUP_EVIDENCE', 'DELIVERY_EVIDENCE', 'TOLL_RECEIPT', 'INCIDENT', 'DAMAGE_PHOTO', 'OTHER'];

on('POST', '/driver/jobs/:id/attachments', (c) => {
  const { u, b } = loadField(c, c.params.id!);
  if (TERMINAL_STATUSES.includes(b.status)) fail(400, 'BAD_REQUEST', 'This job is closed');
  const kind = str(c.body.kind) ?? 'OTHER';
  if (!ATTACHMENT_KINDS.includes(kind)) fail(400, 'VALIDATION_ERROR', 'Unknown attachment kind');
  const files = (c.form?.getAll('files') ?? []).filter((f): f is File => typeof f !== 'string');
  if (!files.length) fail(400, 'BAD_REQUEST', 'Attach at least one file');
  const caption = str(c.body.caption) ?? null;
  const rows: (GAttachment & { bookingId: string; sizeBytes: number })[] = files.map((f, i) => {
    // The picked photo stays in this browser tab only (object URL); nothing is uploaded.
    let url = placeholderImage(`${kind.replace(/_/g, ' ').toLowerCase()} ${i + 1}`);
    try {
      if (typeof URL.createObjectURL === 'function') url = URL.createObjectURL(f);
    } catch {
      /* keep the placeholder */
    }
    return { id: newId('att'), uploadedById: u.id, kind, mimeType: f.type || 'image/jpeg', url, caption, createdAt: nowIso(), bookingId: b.id, sizeBytes: f.size };
  });
  for (const r of rows) b.attachments.push({ id: r.id, uploadedById: r.uploadedById, kind: r.kind, mimeType: r.mimeType, url: r.url, caption: r.caption, createdAt: r.createdAt });
  b.updatedAt = nowIso();
  return rows;
});

on('POST', '/driver/jobs/:id/quote-revision', (c) => {
  const { u, b, isLead } = loadField(c, c.params.id!);
  if (!isLead) fail(403, 'FORBIDDEN', 'Only the team leader can request a revised quote');
  if (!['INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING'].includes(b.status)) fail(409, 'CONFLICT', 'Quote changes are only possible during inspection or recovery');
  const reason = str(c.body.reason)?.trim() ?? '';
  if (reason.length < 5) fail(400, 'VALIDATION_ERROR', 'Explain why the price changes', [{ path: 'reason', message: 'At least 5 characters' }]);
  const items = (Array.isArray(c.body.items) ? c.body.items : []) as { description: string; amount: number | string; reason: string }[];
  if (!items.length) fail(400, 'BAD_REQUEST', 'Add at least one item');
  const lines = items.map((it) => ({ description: String(it.description ?? '').trim(), amount: paise(it.amount), reason: String(it.reason ?? '').trim() }));
  if (lines.some((l) => !Number.isFinite(l.amount) || l.amount === 0)) fail(400, 'VALIDATION_ERROR', 'Amount cannot be zero');
  const current = [...b.quotes].sort((x, y) => y.version - x.version).find((q) => q.status === 'APPROVED') ?? fail(409, 'CONFLICT', 'No approved quote');
  const snap = current.pricingSnapshot;
  const extras = [...(snap.input.extras ?? []).map((x) => ({ ...x })), ...lines.map((l, i) => ({ code: `ADDL_${current.version}_${i + 1}`, description: l.description, amount: l.amount, reason: l.reason }))];
  const needsInternal = lines.some((l) => l.amount < 0);
  for (const q of b.quotes) if (q.status === 'PENDING_CUSTOMER_APPROVAL' || q.status === 'PENDING_INTERNAL_APPROVAL') q.status = 'SUPERSEDED';
  const version = Math.max(...b.quotes.map((q) => q.version)) + 1;
  const q = quoteRecord(b.id, version, 'REVISION', needsInternal ? 'PENDING_INTERNAL_APPROVAL' : 'PENDING_CUSTOMER_APPROVAL', categoryById(b.serviceCategoryId).key, { ...snap.input, extras }, Date.now(), { reason, requestedById: u.id });
  q.rateCardId = current.rateCardId;
  q.rateCardVersion = current.rateCardVersion;
  q.expiresAt = null;
  q.assumptions = { ...q.assumptions, previousTotal: current.total, difference: q.total - current.total };
  b.quotes.push(q);
  b.updatedAt = nowIso();
  const fmt = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (needsInternal) notifyOps('quote.override', `${b.code}: price change needs approval`, reason, { bookingId: b.id, quoteId: q.id });
  else pushNotification(b.customerUserId, 'quote.revision', `${b.code}: approval needed for extra work`, `${reason}. New total ${fmt(q.total)} (was ${fmt(current.total)}). Nothing extra is charged unless you approve.`, { bookingId: b.id, quoteId: q.id });
  // Guest mode: with no customer on the other end, the customer approves after a short pause.
  if (c.role === 'driver' && !needsInternal) {
    setTimeout(() => {
      if (q.status !== 'PENDING_CUSTOMER_APPROVAL') return;
      for (const x of b.quotes) if (x.status === 'APPROVED') x.status = 'SUPERSEDED';
      q.status = 'APPROVED';
      q.decidedById = b.customerUserId;
      q.decidedAt = nowIso();
      b.statusHistory.push({ id: newId('sh'), fromStatus: b.status, toStatus: b.status, actorUserId: b.customerUserId, actorRole: 'CUSTOMER', reason: `Revised quote v${q.version} approved`, isOverride: false, metadata: null, createdAt: nowIso() });
      pushNotification(u.id, 'quote.decision', `${b.code}: customer approved the revised quote`, 'You may proceed with the revised scope.', { bookingId: b.id });
    }, 12_000);
  }
  const { pricingSnapshot: _snap, ...rest } = q;
  void _snap;
  return rest;
});

on('POST', '/driver/jobs/:id/close', (c) => {
  const { u, b, isLead } = loadField(c, c.params.id!);
  if (!isLead) fail(403, 'FORBIDDEN', 'Only the team leader can close the job');
  if (b.status !== 'DELIVERED') fail(409, 'CONFLICT', 'Complete the handover before closing the job');
  const tolls = paise(c.body.tolls ?? 0);
  const parking = paise(c.body.parking ?? 0);
  if (!Number.isFinite(tolls) || !Number.isFinite(parking) || tolls < 0 || parking < 0) fail(400, 'VALIDATION_ERROR', 'Enter valid amounts');
  if (tolls + parking > 0 && !b.attachments.some((a) => a.kind === 'TOLL_RECEIPT')) fail(422, 'UNPROCESSABLE', 'Upload toll/parking receipts before adding these charges');
  const inv = invoiceForBooking(b.id) ?? fail(409, 'CONFLICT', 'The invoice has not been generated yet');
  // Pass-through actuals are added to the invoice issued at delivery (not taxed, not revenue).
  const pass = [
    ['TOLL', 'Tolls (at actuals, with receipts)', tolls],
    ['PARKING', 'Parking (at actuals, with receipts)', parking],
  ] as const;
  for (const [code, description, amount] of pass) {
    if (amount <= 0) continue;
    const existing = inv.items.find((i) => i.code === code);
    const delta = amount - (existing?.amount ?? 0);
    if (existing) Object.assign(existing, { unitAmount: amount, amount });
    else inv.items.push({ id: newId('ii'), code, description, quantity: 1, unitAmount: amount, amount, taxable: false, isPassThrough: true, isAdditional: false, reason: null, sortOrder: inv.items.length });
    inv.passThroughTotal += delta;
    inv.total += delta;
  }
  if (str(c.body.notes)) inv.notes = str(c.body.notes)!;
  refreshInvoiceLedger(inv);
  const odo = num(c.body.odometerKm);
  const truck = truckById(b.assignments.find((a) => a.driverUserId === u.id)?.truckId);
  if (truck && odo && odo >= truck.odometerKm) truck.odometerKm = odo;
  transition(b, 'COMPLETED', actorRole(u), u.id, { metadata: { invoiceId: inv.id } });
  // Reimbursable expense claims for finance to review.
  const expenses = (Array.isArray(c.body.expenses) ? c.body.expenses : []) as { category: GExpense['category']; amount: number | string; description: string }[];
  for (const e of expenses) {
    const amount = paise(e.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    db.expenses.unshift(expenseRecord(u, { category: e.category, amount, description: String(e.description ?? ''), bookingId: b.id, expenseDate: nowIso() }));
  }
  const cash = paise(c.body.cashCollected ?? 0);
  if (Number.isFinite(cash) && cash > 0) {
    const collectable = inv.outstanding;
    if (cash > collectable) fail(400, 'BAD_REQUEST', `Cash amount must be at most ₹${(collectable / 100).toFixed(2)}`);
    recordPayment(inv, cash, 'CASH', Date.now(), { collectedById: u.id, pendingCash: true });
    notifyOps('cash.pending', 'Cash awaiting confirmation', `${u.fullName} collected cash for ${b.code}.`, { invoiceId: inv.id });
  }
  return { invoiceId: inv.id, invoiceNumber: inv.number, total: inv.total };
});

on('POST', '/driver/jobs/:id/cash', (c) => {
  const u = me(c);
  const b = db.bookings.find((x) => x.id === c.params.id) ?? notFound('Job');
  const onTeam = b.assignments.some((a) => a.driverUserId === u.id && a.status === 'ACCEPTED') || b.teamMembers.some((t) => t.userId === u.id && (t.active || t.role === 'TEAM_LEADER'));
  if (!onTeam) notFound('Job');
  const inv = invoiceForBooking(b.id) ?? fail(400, 'BAD_REQUEST', 'The invoice has not been generated yet');
  const amount = paise(c.body.amount);
  const collectable = inv.outstanding;
  if (!Number.isFinite(amount) || amount <= 0 || amount > collectable) fail(400, 'BAD_REQUEST', `Cash amount must be between ₹0.01 and ₹${(collectable / 100).toFixed(2)}`);
  const pay = recordPayment(inv, amount, 'CASH', Date.now(), { collectedById: u.id, pendingCash: true });
  pay.initiatedById = u.id;
  pay.notes = str(c.body.note) ?? null;
  notifyOps('cash.pending', 'Cash awaiting confirmation', `${u.fullName} collected cash for ${b.code}.`, { invoiceId: inv.id });
  return pay;
});

// ─── Incidents & expenses ────────────────────────────────────────────

on('POST', '/driver/incidents', (c) => {
  const u = me(c);
  const bookingId = str(c.body.bookingId) ?? null;
  if (bookingId) loadField(c, bookingId);
  const type = (str(c.body.type) ?? 'OTHER') as GIncident['type'];
  const severity = (str(c.body.severity) ?? 'MEDIUM') as GIncident['severity'];
  const description = str(c.body.description)?.trim() ?? '';
  if (description.length < 5) fail(400, 'VALIDATION_ERROR', 'Describe what happened', [{ path: 'description', message: 'At least 5 characters' }]);
  const inc: GIncident = { id: newId('inc'), bookingId, reportedById: u.id, type, severity, description, lat: num(c.body.lat) ?? null, lng: num(c.body.lng) ?? null, status: 'OPEN', acknowledgedById: null, acknowledgedAt: null, resolution: null, resolvedAt: null, createdAt: nowIso() };
  db.incidents.unshift(inc);
  notifyOps('incident.created', `${severity} incident: ${type.replace(/_/g, ' ').toLowerCase()}`, description, { incidentId: inc.id, bookingId });
  return inc;
});

let expSeq = 900;
function expenseRecord(u: GUser, e: { category: GExpense['category']; amount: number; description: string; bookingId?: string | null; expenseDate: string; fuelLitres?: number | null; odometerKm?: number | null; hasAttachment?: boolean }): GExpense {
  const truck = truckForDriver(u.id);
  const now = nowIso();
  return {
    id: newId('exp'),
    number: `EXP-${fyLabel(Date.now())}-${String(++expSeq).padStart(5, '0')}`,
    category: e.category,
    source: 'EMPLOYEE_CLAIM',
    status: 'SUBMITTED',
    description: e.description,
    vendorName: null,
    vendorBillRef: null,
    amount: e.amount,
    taxAmount: 0,
    expenseDate: e.expenseDate,
    fuelLitres: e.fuelLitres ?? null,
    odometerKm: e.odometerKm ?? null,
    truckId: truck?.id ?? null,
    bookingId: e.bookingId ?? null,
    zoneId: truck?.zoneId ?? null,
    claimantUserId: u.id,
    reimbursable: true,
    hasAttachment: !!e.hasAttachment,
    submittedById: u.id,
    approvedById: null,
    approvedAt: null,
    rejectionReason: null,
    paidAt: null,
    paymentRef: null,
    isSample: true,
    createdAt: now,
    updatedAt: now,
  };
}

on('POST', '/driver/expenses', (c) => {
  const u = me(c);
  const category = str(c.body.category) as GExpense['category'] | undefined;
  if (!category || !['FUEL', 'MAINTENANCE', 'REPAIR', 'TOLLS_PARKING', 'OTHER'].includes(category)) fail(400, 'VALIDATION_ERROR', 'Choose a category');
  const amount = paise(c.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) fail(400, 'VALIDATION_ERROR', 'Enter an amount', [{ path: 'amount', message: 'Enter an amount' }]);
  const description = str(c.body.description)?.trim() ?? '';
  if (description.length < 3) fail(400, 'VALIDATION_ERROR', 'Describe the expense', [{ path: 'description', message: 'At least 3 characters' }]);
  const date = str(c.body.expenseDate);
  const expenseDate = date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toISOString() : nowIso();
  const receipt = c.form?.get('receipt');
  const e = expenseRecord(u, { category, amount, description, expenseDate, fuelLitres: num(c.body.fuelLitres) ?? null, odometerKm: num(c.body.odometerKm) ?? null, hasAttachment: !!receipt && typeof receipt !== 'string' });
  db.expenses.unshift(e);
  for (const id of ['u_admin', 'u_finance']) pushNotification(id, 'expense.submitted', 'Expense claim submitted', `${u.fullName}: ${description}`, { expenseId: e.id });
  return e;
});

on('GET', '/driver/expenses', (c) =>
  db.expenses
    .filter((e) => e.claimantUserId === c.userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100),
);

// ─── Earnings, performance, attendance ───────────────────────────────

const IST = 5.5 * HOUR;
/** UTC instant of IST midnight for a local calendar date. */
const istMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - IST);

function periodRange(period: string): { from: Date; to: Date } {
  const local = new Date(Date.now() + IST);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  switch (period) {
    case 'today':
      return { from: istMidnight(y, m, d), to: istMidnight(y, m, d + 1) };
    case 'this_week': {
      const back = (local.getUTCDay() + 6) % 7; // weeks start on Monday
      return { from: istMidnight(y, m, d - back), to: istMidnight(y, m, d - back + 7) };
    }
    case 'last_month':
      return { from: istMidnight(y, m - 1, 1), to: istMidnight(y, m, 1) };
    case 'this_fy': {
      const fy = m >= 3 ? y : y - 1;
      return { from: istMidnight(fy, 3, 1), to: istMidnight(fy + 1, 3, 1) };
    }
    default:
      return { from: istMidnight(y, m, 1), to: istMidnight(y, m + 1, 1) };
  }
}

on('GET', '/driver/earnings', (c) => {
  const u = me(c);
  const period = ['today', 'this_week', 'this_month', 'last_month', 'this_fy'].includes(String(c.query.period)) ? String(c.query.period) : 'this_month';
  const range = periodRange(period);
  const inRange = (iso: string | null) => !!iso && new Date(iso) >= range.from && new Date(iso) < range.to;
  const mine = db.earnings.filter((e) => e.userId === u.id && e.status !== 'VOID');
  const lines = mine
    .filter((e) => inRange(e.earnedAt))
    .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt))
    .map((e) => ({ ...e, booking: e.bookingId ? { code: db.bookings.find((b) => b.id === e.bookingId)?.code ?? '' } : null }));
  const sumKind = (...kinds: string[]) => lines.filter((l) => kinds.includes(l.kind)).reduce((a, l) => a + l.amount, 0);
  const assignments = db.bookings.flatMap((b) => b.assignments.filter((a) => a.driverUserId === u.id).map((a) => ({ a, b })));
  const res: EarningsResponse = {
    period,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    totals: {
      jobEarnings: sumKind('JOB_FIXED', 'JOB_COMMISSION'),
      incentives: sumKind('INCENTIVE'),
      deductions: sumKind('DEDUCTION'),
      reimbursements: sumKind('REIMBURSEMENT'),
      pendingPayout: mine.filter((e) => e.status === 'PENDING').reduce((a, e) => a + e.amount, 0),
    },
    jobs: {
      completed: assignments.filter(({ a, b }) => a.status === 'COMPLETED' && inRange(b.completedAt)).length,
      cancelled: assignments.filter(({ a }) => (a.status === 'CANCELLED' || a.status === 'RELEASED') && inRange(a.offeredAt)).length,
    },
    lines,
    payouts: db.payouts.filter((p) => p.userId === u.id).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).slice(0, 24),
    salary: db.salaries.filter((s) => s.userId === u.id).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).slice(0, 12),
  };
  return res;
});

on('GET', '/driver/performance', (c) => {
  const u = me(c);
  const days = 90;
  const since = Date.now() - days * DAY;
  const after = (iso: string) => new Date(iso).getTime() >= since;
  const assignments = db.bookings.flatMap((b) => b.assignments.filter((a) => a.driverUserId === u.id && after(a.offeredAt)));
  const jobs = db.bookings.filter((b) => b.teamMembers.some((t) => t.userId === u.id && after(t.createdAt)));
  const completed = jobs.filter((b) => b.status === 'COMPLETED' || b.status === 'DELIVERED');
  const arrivals = jobs.filter((b) => b.arrivedAt && b.etaAt);
  const grace = 10 * MIN;
  const onTime = arrivals.filter((b) => new Date(b.arrivedAt!).getTime() <= new Date(b.etaAt!).getTime() + grace);
  const checklist = completed.filter((b) => {
    const stages = new Set(b.conditionReports.map((r) => r.stage));
    const towing = categoryById(b.serviceCategoryId).kind === 'TOWING';
    return (!towing || (stages.has('PICKUP') && stages.has('DELIVERY'))) && b.custody.some((x) => x.stage === 'HANDOVER');
  });
  const ratings = db.ratings.filter((r) => r.rateeUserId === u.id && after(r.createdAt));
  const complaints = db.tickets.filter((t) => t.category === 'COMPLAINT' && t.verified === true && after(t.createdAt) && (t.subjectUserId === u.id || (t.bookingId && db.bookings.find((b) => b.id === t.bookingId)?.teamMembers.some((m) => m.userId === u.id && m.role === 'TEAM_LEADER')))).length;
  const inputs = {
    assignmentsOffered: assignments.length,
    accepted: assignments.filter((a) => ['ACCEPTED', 'COMPLETED', 'RELEASED', 'CANCELLED'].includes(a.status)).length,
    completed: completed.length,
    cancelledByWorker: assignments.filter((a) => a.status === 'RELEASED').length,
    arrivals: arrivals.length,
    onTimeArrivals: onTime.length,
    ratingsAvg: ratings.length ? Math.round((ratings.reduce((a, r) => a + r.score, 0) / ratings.length) * 100) / 100 : null,
    ratingsCount: ratings.length,
    verifiedComplaints: complaints,
    safetyIncidentsReported: db.incidents.filter((i) => i.reportedById === u.id && after(i.createdAt)).length,
    checklistComplete: checklist.length,
    difficultJobs: completed.filter((b) => b.requiresManualReview || b.safetyFlags.length > 0).length,
  };
  const weights = { punctuality: 0.25, completion: 0.25, safety: 0.2, feedback: 0.2, difficulty: 0.1 };
  const punctuality = inputs.arrivals ? inputs.onTimeArrivals / inputs.arrivals : null;
  const completion = inputs.accepted ? inputs.completed / inputs.accepted : null;
  const safety = inputs.completed ? Math.max(0, inputs.checklistComplete / inputs.completed - Math.min(0.5, inputs.verifiedComplaints * 0.1)) : null;
  const feedback = inputs.ratingsAvg != null && inputs.ratingsCount > 0 ? (inputs.ratingsAvg - 1) / 4 : null;
  const difficulty = inputs.completed ? Math.min(1, inputs.difficultJobs / inputs.completed) : 0;
  const parts: [number | null, number][] = [
    [punctuality, weights.punctuality],
    [completion, weights.completion],
    [safety, weights.safety],
    [feedback, weights.feedback],
  ];
  const known = parts.filter(([v]) => v != null) as [number, number][];
  const wsum = known.reduce((a, [, w]) => a + w, 0);
  const base = wsum ? known.reduce((a, [v, w]) => a + v * w, 0) / wsum : null;
  const score = base == null ? null : Math.min(1, base + difficulty * weights.difficulty);
  const pct = (v: number | null) => (v == null ? null : Math.round(v * 100));
  const res: PerformanceResponse = {
    windowDays: days,
    inputs,
    score: pct(score),
    sufficientData: inputs.completed >= 5,
    components: { punctuality: pct(punctuality), completion: pct(completion), safety: pct(safety), feedback: pct(feedback), difficulty: Math.round(difficulty * 100) },
    weights,
    explanation:
      'Score combines punctuality, completion, safety/evidence compliance and verified customer feedback. Difficult jobs add a bonus and never lower your score. Reporting incidents is never penalised. Disagree with a record? Raise a "Performance challenge" ticket.',
  };
  return res;
});

on('GET', '/driver/attendance', (c) =>
  paged(
    db.availabilityLogs.filter((l) => l.userId === c.userId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    c.query,
  ),
);
