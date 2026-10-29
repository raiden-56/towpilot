/**
 * Guest-mode handlers: admin operations — live dispatch, escalations & incidents, support desk and
 * system settings/audit. Employees, fleet, customers and business accounts live in adminOpsResources.ts.
 * Mirrors apps/api/src/modules/dispatch/* and admin/system.ts.
 */
import type { BookingStatus } from '@/api/types';
import type { CandidatesResponse, DispatchBoard, Escalation, Incident, StaffBooking, TicketSummary } from '@/pages/admin/ops/types';
import type { GAssignment, GBooking, GTicket } from '../model';
import { bookingById, db, MIN, newId, nowIso, pushNotification, refreshInvoiceLedger, ROLE_PERMISSIONS, truckById, truckForDriver, userById, vehicleById } from '../db';
import { NEEDS_PROVIDER_STATUSES, STATUS_LABELS, TERMINAL_STATUSES, transition } from '../bookingOps';
import { fail, notFound, num, on, paged, str, type Ctx } from '../router';
import { projectBooking } from '../serialize';
import { appendAudit, auditRows, DEFAULT_SETTINGS, dispatchSetting, mergeDeep, opsRole, requirePerm, settings } from './adminOpsShared';
import './adminOpsResources';

const OPEN_STATUSES = (Object.keys(STATUS_LABELS) as BookingStatus[]).filter((s) => !TERMINAL_STATUSES.includes(s) && s !== 'DELIVERED' && s !== 'DISPUTED');
const PRIORITY_RANK = { NORMAL: 0, HIGH: 1, CRITICAL: 2 } as const;
const ENUM_ORDER_TICKET = ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED'];

const getBooking = (id: string) => bookingById(id) ?? notFound('Booking');
const staffView = (b: GBooking, c: Ctx) => projectBooking(b, 'staff', userById(c.userId)!) as unknown as StaffBooking;
const pickupOf = (b: GBooking) => b.locations.find((l) => l.kind === 'PICKUP')!;
const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const minutesAgo = (iso: string) => (Date.now() - new Date(iso).getTime()) / MIN;

// ─── Simulated field responses ───────────────────────────────────────

const scheduled = new Set<string>();

/** The offered driver accepts after a few seconds and heads out, so dispatch feels alive. */
function simulateAcceptance(bookingId: string, assignmentId: string, delayMs = 6_000 + Math.random() * 4_000) {
  if (scheduled.has(assignmentId)) return;
  scheduled.add(assignmentId);
  setTimeout(() => {
    const b = bookingById(bookingId);
    const a = b?.assignments.find((x) => x.id === assignmentId);
    if (!b || !a || a.status !== 'OFFERED' || b.status !== 'ASSIGNED') return;
    const now = nowIso();
    a.status = 'ACCEPTED';
    a.respondedAt = now;
    if (!b.teamMembers.some((t) => t.userId === a.driverUserId && t.active)) b.teamMembers.push({ id: newId('tm'), userId: a.driverUserId, role: 'TEAM_LEADER', responsibility: 'Driver and team leader', addedById: null, active: true, createdAt: now });
    const u = userById(a.driverUserId);
    if (u?.availability) u.availability = { ...u.availability, status: 'ON_JOB', statusSince: now };
    const t = truckById(a.truckId);
    if (t) t.status = 'IN_USE';
    b.etaAt = new Date(Date.now() + (a.etaMinutes ?? 20) * MIN).toISOString();
    transition(b, 'ACCEPTED', 'DRIVER', a.driverUserId);
    setTimeout(() => {
      if (b.status === 'ACCEPTED') transition(b, 'EN_ROUTE', 'DRIVER', a.driverUserId);
    }, 12_000 + Math.random() * 6_000);
  }, delayMs);
}

/** Seeded offers (made before the page loaded) get answered shortly after operations first look. */
function wakeSeededOffers() {
  for (const b of db.bookings)
    for (const a of b.assignments)
      if (a.status === 'OFFERED' && b.status === 'ASSIGNED') {
        if (new Date(a.expiresAt).getTime() < Date.now() + 60_000) a.expiresAt = new Date(Date.now() + 75_000).toISOString();
        simulateAcceptance(b.id, a.id, 15_000 + Math.random() * 10_000);
      }
}

// ─── Candidates (apps/api/src/domain/dispatch.ts) ────────────────────

const CLASS_ORDER = ['TWO_WHEELER', 'HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'LCV', 'HCV'];
const HARD = /Driver is (off duty|on break|busy)|not verified|not active|expired|holds an assignment|No truck|not suitable|capacity|Missing working equipment|maintenance|out of service|retired|heavy-vehicle/i;

function dispatchRequest(b: GBooking) {
  const p = pickupOf(b);
  return {
    zoneId: b.zoneId,
    pickup: { lat: p.lat, lng: p.lng },
    truckTypes: b.recommendation?.truckTypes ?? [],
    equipment: b.recommendation?.equipment ?? [],
    vehicleClass: vehicleById(b.vehicleId)?.vehicleClass ?? 'SEDAN',
    radiusKm: dispatchSetting<number>('searchRadiusKm'),
    staleMinutes: dispatchSetting<number>('locationStaleMinutes'),
    avgSpeedKmh: dispatchSetting<number>('avgSpeedKmh'),
  };
}

const liveAssignmentOf = (userId: string) => db.bookings.some((b) => b.assignments.some((a) => a.driverUserId === userId && (a.status === 'OFFERED' || a.status === 'ACCEPTED')));
const jobsToday = (userId: string) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return db.bookings.reduce((n, b) => n + b.assignments.filter((a) => a.driverUserId === userId && a.status === 'COMPLETED' && new Date(a.offeredAt) >= start).length, 0);
};
export const avgRating = (userId: string) => {
  const rs = db.ratings.filter((r) => r.rateeUserId === userId);
  return rs.length ? Math.round((rs.reduce((a, r) => a + r.score, 0) / rs.length) * 100) / 100 : null;
};

function rankCandidates(b: GBooking) {
  const req = dispatchRequest(b);
  const declined = new Set(b.assignments.filter((a) => ['REJECTED', 'TIMED_OUT', 'RELEASED'].includes(a.status)).map((a) => a.driverUserId));
  const w = dispatchSetting<{ eta: number; workload: number; rating: number }>('weights');
  const now = Date.now();
  return db.users
    .filter((u) => u.roles.includes('driver') && u.driverProfile && u.workerProfile && !u.deletedAt)
    .map((u) => {
      const reasons: string[] = [];
      const av = u.availability;
      const status = av?.status ?? 'OFF_DUTY';
      if (u.status !== 'ACTIVE') reasons.push('Account not active');
      if (u.workerProfile!.verificationStatus !== 'APPROVED') reasons.push('Driver not verified');
      if (status !== 'AVAILABLE') reasons.push(`Driver is ${status.toLowerCase().replace('_', ' ')}`);
      if (liveAssignmentOf(u.id)) reasons.push('Driver already holds an assignment');
      if (declined.has(u.id)) reasons.push('Driver already declined or timed out on this booking');
      if (req.zoneId && !u.workerProfile!.zoneIds.includes(req.zoneId)) reasons.push('Not authorised for this service zone');
      if (new Date(u.driverProfile!.licenceExpiry).getTime() < now) reasons.push('Driving licence expired');
      if ((req.vehicleClass === 'HCV' || req.vehicleClass === 'LCV') && !u.driverProfile!.heavyVehicleCert) reasons.push('No heavy-vehicle certification');
      const t = truckForDriver(u.id);
      if (!t) reasons.push('No truck assigned');
      else {
        if (t.status !== 'AVAILABLE' && t.status !== 'IN_USE') reasons.push(`Truck ${t.registrationNumber} is ${t.status.toLowerCase().replace('_', ' ')}`);
        if (req.truckTypes.length && !req.truckTypes.includes(t.truckType)) reasons.push(`Truck type ${t.truckType} not suitable (needs ${req.truckTypes.join(' or ')})`);
        if (CLASS_ORDER.indexOf(t.maxVehicleClass) < CLASS_ORDER.indexOf(req.vehicleClass)) reasons.push(`Truck capacity (${t.maxVehicleClass}) below vehicle class ${req.vehicleClass}`);
        const ok = new Set(t.equipment.filter((e) => e.status === 'OK').map((e) => e.type));
        const missing = req.equipment.filter((e) => !ok.has(e));
        if (missing.length) reasons.push(`Missing working equipment: ${missing.join(', ')}`);
        for (const [label, d] of [['insurance', t.insuranceExpiry], ['fitness certificate', t.fitnessExpiry], ['permit', t.permitExpiry], ['PUC certificate', t.pucExpiry]] as const)
          if (d && new Date(d).getTime() < now) reasons.push(`Truck ${label} expired`);
      }
      let distanceKm: number | null = null;
      let etaMinutes: number | null = null;
      if (av?.lastLat == null || av.lastLng == null || !av.lastLocationAt) reasons.push('No recent location');
      else {
        const age = minutesAgo(av.lastLocationAt);
        if (age > req.staleMinutes) reasons.push(`Location is ${Math.round(age)} min old`);
        distanceKm = Math.round(haversineKm({ lat: av.lastLat, lng: av.lastLng }, req.pickup) * 10) / 10;
        etaMinutes = Math.max(5, Math.round((distanceKm / req.avgSpeedKmh) * 60));
        if (distanceKm > req.radiusKm) reasons.push(`Outside search radius (${distanceKm} km)`);
      }
      const eligible = reasons.length === 0;
      const jt = jobsToday(u.id);
      const rating = avgRating(u.id);
      let score: { total: number; etaScore: number; workloadScore: number; ratingScore: number } | null = null;
      if (eligible && etaMinutes != null) {
        const etaScore = 1 - Math.min(etaMinutes, 90) / 90;
        const workloadScore = 1 - Math.min(jt, 8) / 8;
        const ratingScore = rating == null ? 0.75 : (rating - 1) / 4;
        score = { total: Math.round((w.eta * etaScore + w.workload * workloadScore + w.rating * ratingScore) * 1000) / 1000, etaScore, workloadScore, ratingScore };
      }
      return { user: u, truck: t ?? null, eligible, reasons, distanceKm, etaMinutes, score, jobsToday: jt, rating };
    })
    .sort((a, b) => (a.eligible !== b.eligible ? (a.eligible ? -1 : 1) : (b.score?.total ?? 0) - (a.score?.total ?? 0)));
}

/** Creates an OFFERED assignment and moves the booking to ASSIGNED (offerProvider in the API). */
function offer(b: GBooking, c: ReturnType<typeof rankCandidates>[number], method: 'AUTO' | 'MANUAL', actorUserId: string | null, actor: 'ADMIN' | 'DISPATCHER', note?: string) {
  const a: GAssignment = {
    id: newId('asg'),
    bookingId: b.id,
    driverUserId: c.user.id,
    truckId: c.truck?.id ?? null,
    status: 'OFFERED',
    method,
    attempt: b.assignments.length + 1,
    offeredAt: nowIso(),
    expiresAt: new Date(Date.now() + dispatchSetting<number>('offerTimeoutSec') * 1000).toISOString(),
    respondedAt: null,
    rejectionReason: null,
    assignedById: actorUserId,
    etaMinutes: c.etaMinutes,
    distanceKm: c.distanceKm,
    score: c.score?.total ?? null,
  };
  b.assignments.push(a);
  transition(b, 'ASSIGNED', actor, actorUserId, { reason: note ?? null, metadata: { assignmentId: a.id, driverUserId: c.user.id, method } });
  b.dispatchAttempts++;
  pushNotification(c.user.id, 'job.offer', `New job ${b.code}`, `Pickup ~${c.distanceKm ?? '?'} km away. Respond within ${dispatchSetting<number>('offerTimeoutSec')} seconds.`, { bookingId: b.id, assignmentId: a.id });
  simulateAcceptance(b.id, a.id);
  return a;
}

/** Releases the live (offered/accepted) assignment and returns crew and truck to availability. */
function releaseLive(b: GBooking, status: 'RELEASED' | 'CANCELLED', reason: string) {
  const live = b.assignments.find((a) => a.status === 'OFFERED' || a.status === 'ACCEPTED');
  if (!live) return null;
  const wasAccepted = live.status === 'ACCEPTED';
  live.status = status;
  live.respondedAt ??= nowIso();
  live.rejectionReason = reason;
  const now = nowIso();
  if (wasAccepted) {
    const u = userById(live.driverUserId);
    if (u?.availability) u.availability = { ...u.availability, status: 'AVAILABLE', statusSince: now };
    const t = truckById(live.truckId);
    if (t?.status === 'IN_USE') t.status = 'AVAILABLE';
  }
  for (const m of b.teamMembers.filter((x) => x.active)) {
    m.active = false;
    const u = userById(m.userId);
    if (u?.availability && u.id !== live.driverUserId) u.availability = { ...u.availability, status: 'AVAILABLE', statusSince: now };
  }
  return live.driverUserId;
}

// ─── Dispatch board ──────────────────────────────────────────────────

on('GET', '/dispatch/board', (c) => {
  requirePerm(c, 'dispatch:manage', 'booking:read_any');
  wakeSeededOffers();
  const staleMs = dispatchSetting<number>('locationStaleMinutes') * MIN;
  const board: DispatchBoard = {
    serverTime: nowIso(),
    bookings: db.bookings
      .filter((b) => OPEN_STATUSES.includes(b.status) || b.status === 'DELIVERED')
      .sort((x, y) => PRIORITY_RANK[y.priority] - PRIORITY_RANK[x.priority] || x.createdAt.localeCompare(y.createdAt))
      .slice(0, 300)
      .map((b) => {
        const v = vehicleById(b.vehicleId);
        const cat = db.categories.find((x) => x.id === b.serviceCategoryId)!;
        return {
          id: b.id,
          code: b.code,
          status: b.status,
          statusLabel: STATUS_LABELS[b.status],
          type: b.type,
          priority: b.priority,
          scheduledFor: b.scheduledFor,
          safetyFlags: b.safetyFlags,
          requiresManualReview: b.requiresManualReview,
          reviewedAt: b.reviewedAt,
          manualReviewReasons: b.manualReviewReasons,
          etaAt: b.etaAt,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
          dispatchAttempts: b.dispatchAttempts,
          zoneId: b.zoneId,
          serviceCategory: { name: cat.name, kind: cat.kind },
          vehicle: v ? { registrationNumber: v.registrationNumber, vehicleClass: v.vehicleClass } : null,
          locations: b.locations.map((l) => ({ kind: l.kind, lat: l.lat, lng: l.lng, address: l.address, placeName: l.placeName })),
          assignments: [...b.assignments]
            .sort((x, y) => y.offeredAt.localeCompare(x.offeredAt))
            .slice(0, 5)
            .map((a) => ({ id: a.id, status: a.status, driverUserId: a.driverUserId, offeredAt: a.offeredAt, expiresAt: a.expiresAt, rejectionReason: a.rejectionReason, method: a.method, driver: { fullName: userById(a.driverUserId)?.fullName ?? 'Driver' } })),
        };
      }),
    drivers: db.users
      .filter((u) => !u.deletedAt && u.workerProfile && u.availability)
      .map((u) => {
        const av = u.availability!;
        const t = truckForDriver(u.id);
        return {
          id: u.id,
          name: u.fullName,
          roles: u.roles,
          verification: u.workerProfile!.verificationStatus,
          zones: u.workerProfile!.zoneIds.map((id) => ({ id, name: db.zones.find((z) => z.id === id)?.name ?? id })),
          status: av.status,
          lat: av.lastLat,
          lng: av.lastLng,
          lastLocationAt: av.lastLocationAt,
          locationStale: !av.lastLocationAt || Date.now() - new Date(av.lastLocationAt).getTime() > staleMs,
          truck: t ? { id: t.id, registrationNumber: t.registrationNumber, truckType: t.truckType, status: t.status } : null,
        };
      }),
    trucks: db.trucks.map((t) => ({ id: t.id, registrationNumber: t.registrationNumber, truckType: t.truckType, status: t.status, zoneId: t.zoneId, assignedDriverUserId: t.assignedDriverUserId })),
    zones: db.zones.filter((z) => z.active).map((z) => ({ id: z.id, name: z.name, city: z.city, centerLat: z.centerLat, centerLng: z.centerLng, radiusKm: z.radiusKm, active: z.active })),
    escalations: db.escalations
      .filter((e) => e.status !== 'RESOLVED')
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
      .slice(0, 100)
      .map((e) => ({ ...e, booking: { code: bookingById(e.bookingId)?.code ?? '—' } })),
    incidents: db.incidents
      .filter((i) => i.status !== 'RESOLVED')
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
      .slice(0, 50)
      .map((i) => ({ ...i })),
  };
  return board;
});

// ─── Booking dispatch actions ────────────────────────────────────────

on('GET', '/dispatch/bookings/:id/candidates', (c) => {
  requirePerm(c, 'dispatch:manage');
  const b = getBooking(c.params.id!);
  const req = dispatchRequest(b);
  const res: CandidatesResponse = {
    request: { zoneId: req.zoneId, truckTypes: req.truckTypes, equipment: req.equipment, vehicleClass: req.vehicleClass, radiusKm: req.radiusKm, staleMinutes: req.staleMinutes },
    candidates: rankCandidates(b).map((r) => ({
      driverUserId: r.user.id,
      name: r.user.fullName,
      eligible: r.eligible,
      reasons: r.reasons,
      distanceKm: r.distanceKm,
      etaMinutes: r.etaMinutes,
      score: r.score,
      truck: r.truck && { id: r.truck.id, registrationNumber: r.truck.registrationNumber, truckType: r.truck.truckType },
      jobsToday: r.jobsToday,
      rating: r.rating,
    })),
  };
  return res;
});

on('POST', '/dispatch/bookings/:id/assign', (c) => {
  requirePerm(c, 'dispatch:manage');
  const b = getBooking(c.params.id!);
  const driverUserId = String(c.body.driverUserId ?? '');
  const note = str(c.body.note);
  if (!NEEDS_PROVIDER_STATUSES.includes(b.status)) fail(409, 'CONFLICT', `Cannot assign while booking is ${b.status}`);
  if (b.requiresManualReview && !b.reviewedAt) fail(422, 'UNPROCESSABLE', 'Complete the manual safety review before assigning');
  const cand = rankCandidates(b).find((r) => r.user.id === driverUserId) ?? notFound('Driver');
  const hard = cand.reasons.filter((r) => HARD.test(r));
  if (hard.length) fail(422, 'UNPROCESSABLE', `Driver is not eligible: ${hard.join('; ')}`);
  if (!cand.eligible && !c.body.force) fail(422, 'UNPROCESSABLE', `Driver has warnings: ${cand.reasons.join('; ')}. Confirm to assign anyway.`, { warnings: cand.reasons });
  if (!cand.eligible && !note) fail(422, 'UNPROCESSABLE', 'A reason is required when overriding dispatch warnings');
  const a = offer(b, cand, 'MANUAL', c.userId, opsRole(c), note);
  appendAudit(c.userId, 'dispatch.manual_assign', 'booking', b.id, { driverUserId, assignmentId: a.id, note, overrideWarnings: !cand.eligible ? cand.reasons : undefined });
  return staffView(b, c);
});

on('POST', '/dispatch/bookings/:id/auto-dispatch', (c) => {
  requirePerm(c, 'dispatch:manage');
  const b = getBooking(c.params.id!);
  if (!NEEDS_PROVIDER_STATUSES.includes(b.status)) return { offered: false, reason: 'not awaiting provider' };
  if (b.requiresManualReview && !b.reviewedAt) return { offered: false, reason: 'awaiting manual review' };
  const best = rankCandidates(b).find((r) => r.eligible);
  if (!best) {
    if (!db.escalations.some((e) => e.bookingId === b.id && e.type === 'NO_PROVIDER' && e.status !== 'RESOLVED'))
      db.escalations.push({ id: newId('esc'), bookingId: b.id, type: 'NO_PROVIDER', status: 'OPEN', detail: 'Automatic dispatch found no eligible provider within the search radius.', resolution: null, resolvedById: null, resolvedAt: null, createdAt: nowIso() });
    return { offered: false, reason: 'no eligible provider' };
  }
  offer(b, best, 'AUTO', null, opsRole(c));
  return { offered: true, driverUserId: best.user.id };
});

on('POST', '/dispatch/bookings/:id/reassign', (c) => {
  requirePerm(c, 'dispatch:manage');
  const b = getBooking(c.params.id!);
  const reason = String(c.body.reason ?? '').trim();
  if (reason.length < 3) fail(400, 'VALIDATION_ERROR', 'Enter a reason', [{ path: 'reason', message: 'Enter a reason' }]);
  const released = releaseLive(b, 'RELEASED', reason);
  transition(b, 'REASSIGNMENT_REQUIRED', opsRole(c), c.userId, { reason });
  if (released) pushNotification(released, 'job.cancelled', `${b.code} reassigned`, `Operations withdrew this job: ${reason}`, { bookingId: b.id });
  appendAudit(c.userId, 'dispatch.reassign', 'booking', b.id, { reason, releasedDriver: released });
  return staffView(b, c);
});

on('POST', '/dispatch/bookings/:id/review', (c) => {
  requirePerm(c, 'dispatch:manage');
  const b = getBooking(c.params.id!);
  if (!b.requiresManualReview) fail(409, 'CONFLICT', 'This booking does not require review');
  if (b.reviewedAt) fail(409, 'CONFLICT', 'Review already completed');
  const approve = !!c.body.approve;
  const notes = String(c.body.notes ?? '').trim();
  const before = structuredClone(b.recommendation);
  if (Array.isArray(c.body.truckTypes)) b.recommendation.truckTypes = c.body.truckTypes as string[];
  if (Array.isArray(c.body.equipment)) b.recommendation.equipment = c.body.equipment as string[];
  if (num(c.body.crew)) b.recommendation.crew = num(c.body.crew)!;
  b.crewRecommended = b.recommendation.crew;
  b.reviewedById = c.userId;
  b.reviewedAt = nowIso();
  for (const e of db.escalations.filter((x) => x.bookingId === b.id && x.type === 'MANUAL_REVIEW' && x.status !== 'RESOLVED')) {
    e.status = 'RESOLVED';
    e.resolvedById = c.userId;
    e.resolvedAt = nowIso();
    e.resolution = notes;
  }
  appendAudit(c.userId, approve ? 'booking.review.approved' : 'booking.review.declined', 'booking', b.id, { ...b.recommendation, reviewNotes: notes }, before);
  if (!approve) {
    transition(b, 'CANCELLED', opsRole(c), c.userId, { reason: `Recovery declined after safety review: ${notes}` });
    return { approved: false };
  }
  if (b.status === 'CONFIRMED' && b.type === 'EMERGENCY') transition(b, 'SEARCHING_FOR_PROVIDER', opsRole(c), c.userId, { reason: 'Safety review approved' });
  return { approved: true };
});

on('POST', '/dispatch/bookings/:id/transition', (c) => {
  requirePerm(c, 'booking:manage');
  const b = getBooking(c.params.id!);
  const to = String(c.body.to) as BookingStatus;
  const reason = String(c.body.reason ?? '').trim();
  if (reason.length < 3) fail(400, 'VALIDATION_ERROR', 'Enter a reason', [{ path: 'reason', message: 'Enter a reason' }]);
  if (to === 'FAILED') releaseLive(b, 'RELEASED', reason);
  if (to === 'SEARCHING_FOR_PROVIDER') releaseLive(b, 'RELEASED', reason);
  transition(b, to, opsRole(c), c.userId, { reason });
  b.statusHistory[b.statusHistory.length - 1]!.isOverride = true;
  if (to === 'FAILED') b.failureReason = reason;
  appendAudit(c.userId, 'booking.ops_transition', 'booking', b.id, { to, reason });
  return staffView(b, c);
});

on('POST', '/dispatch/bookings/:id/team', (c) => {
  requirePerm(c, 'dispatch:manage');
  const b = getBooking(c.params.id!);
  const userId = String(c.body.userId ?? '');
  const role = c.body.role === 'DRIVER' ? 'DRIVER' : 'RECOVERY_WORKER';
  const w = userById(userId);
  if (!w?.workerProfile || w.workerProfile.verificationStatus !== 'APPROVED' || w.status !== 'ACTIVE') notFound('Verified worker');
  const existing = b.teamMembers.find((t) => t.userId === userId);
  if (existing) Object.assign(existing, { active: true, role, responsibility: str(c.body.responsibility) ?? null });
  else b.teamMembers.push({ id: newId('tm'), userId, role, responsibility: str(c.body.responsibility) ?? null, addedById: c.userId, active: true, createdAt: nowIso() });
  if (w!.availability) w!.availability = { ...w!.availability, status: 'ON_JOB', statusSince: nowIso() };
  appendAudit(c.userId, 'booking.team_added', 'booking', b.id, { userId, role });
  return staffView(b, c);
});

on('DELETE', '/dispatch/bookings/:id/team/:userId', (c) => {
  requirePerm(c, 'dispatch:manage');
  const b = getBooking(c.params.id!);
  const m = b.teamMembers.find((t) => t.userId === c.params.userId && t.active);
  if (!m || m.role === 'TEAM_LEADER') notFound('Team member');
  m!.active = false;
  const u = userById(m!.userId);
  if (u?.availability) u.availability = { ...u.availability, status: 'AVAILABLE', statusSince: nowIso() };
  appendAudit(c.userId, 'booking.team_removed', 'booking', b.id, { userId: m!.userId });
  return staffView(b, c);
});

on('POST', '/dispatch/bookings/:id/custody-override', (c) => {
  requirePerm(c, 'booking:override');
  const b = getBooking(c.params.id!);
  const stage = c.body.stage === 'HANDOVER' ? 'HANDOVER' : 'PICKUP';
  const reason = String(c.body.reason ?? '').trim();
  const live = b.assignments.find((a) => a.status === 'ACCEPTED');
  if (!live) fail(409, 'CONFLICT', 'No active field team on this booking');
  if (b.custody.some((x) => x.stage === stage)) fail(409, 'CONFLICT', 'Custody already confirmed for this stage');
  const at = nowIso();
  b.custody.push({ stage, method: 'AUTHORIZED_OVERRIDE', recipientName: str(c.body.recipientName) ?? b.contactName, recipientRelation: str(c.body.recipientRelation) ?? null, confirmedById: live!.driverUserId, overrideReason: reason, createdAt: at });
  if (stage === 'PICKUP') {
    b.pickupVerifiedAt = at;
    b.waitingMinutes = b.arrivedAt ? Math.max(0, Math.round(minutesAgo(b.arrivedAt))) : 0;
  }
  b.statusHistory.push({ id: newId('sh'), fromStatus: b.status, toStatus: b.status, actorUserId: c.userId, actorRole: opsRole(c), reason: `${stage} code override: ${reason}`, isOverride: true, metadata: null, createdAt: at });
  b.updatedAt = at;
  pushNotification(b.customerUserId, 'custody.override', `${b.code}: ${stage === 'PICKUP' ? 'pickup' : 'handover'} confirmed by operations`, `Reason: ${reason}`, { bookingId: b.id });
  appendAudit(c.userId, `custody.${stage.toLowerCase()}_override`, 'booking', b.id, c.body);
  return { confirmed: true };
});

on('POST', '/dispatch/quotes/:id/internal-decision', (c) => {
  requirePerm(c, 'pricing:approve_override');
  const b = db.bookings.find((x) => x.quotes.some((q) => q.id === c.params.id)) ?? notFound('Quote');
  const q = b.quotes.find((x) => x.id === c.params.id)!;
  if (q.status !== 'PENDING_INTERNAL_APPROVAL') fail(409, 'CONFLICT', 'Quote is not awaiting internal approval');
  const approve = !!c.body.approve;
  const approved = b.quotes.find((x) => x.status === 'APPROVED');
  const increases = approved ? q.total - approved.total : q.total;
  q.status = approve ? (increases > 0 ? 'PENDING_CUSTOMER_APPROVAL' : 'APPROVED') : 'REJECTED';
  q.internalApprovedById = approve ? c.userId : null;
  q.reason = q.reason ?? str(c.body.note) ?? null;
  if (q.status === 'APPROVED' && approved) approved.status = 'SUPERSEDED';
  if (q.status === 'PENDING_CUSTOMER_APPROVAL') pushNotification(b.customerUserId, 'quote.revision', `${b.code}: revised quote needs your approval`, 'The field team proposed additional charges. Review and approve or decline them.', { bookingId: b.id, quoteId: q.id });
  b.updatedAt = nowIso();
  appendAudit(c.userId, approve ? 'quote.internal_approved' : 'quote.internal_rejected', 'booking_quote', q.id, { note: c.body.note });
  return { status: q.status };
});

// ─── Escalations & incidents ─────────────────────────────────────────

on('GET', '/dispatch/escalations', (c) => {
  requirePerm(c, 'dispatch:manage', 'incident:manage');
  const status = str(c.query.status);
  const rows: Escalation[] = db.escalations
    .filter((e) => !status || e.status === status)
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
    .map((e) => {
      const b = bookingById(e.bookingId);
      return { ...e, booking: { code: b?.code ?? '—', status: b?.status } };
    });
  return paged(rows, c.query);
});

on('POST', '/dispatch/escalations/:id/:action', (c) => {
  requirePerm(c, 'dispatch:manage', 'incident:manage');
  const e = db.escalations.find((x) => x.id === c.params.id) ?? notFound('Escalation');
  const action = c.params.action;
  if (action !== 'ack' && action !== 'resolve') notFound('Action');
  if (action === 'ack') e.status = 'ACKNOWLEDGED';
  else Object.assign(e, { status: 'RESOLVED', resolution: str(c.body.resolution) ?? null, resolvedById: c.userId, resolvedAt: nowIso() });
  appendAudit(c.userId, `escalation.${action}`, 'escalation', e.id, { resolution: c.body.resolution });
  return e;
});

on('GET', '/dispatch/incidents', (c) => {
  requirePerm(c, 'incident:manage');
  const status = str(c.query.status);
  const rows: Incident[] = db.incidents
    .filter((i) => !status || i.status === status)
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
    .map((i) => ({ ...i, booking: i.bookingId ? { code: bookingById(i.bookingId)?.code ?? '—' } : null }));
  return paged(rows, c.query);
});

on('POST', '/dispatch/incidents/:id/:action', (c) => {
  requirePerm(c, 'incident:manage');
  const i = db.incidents.find((x) => x.id === c.params.id) ?? notFound('Incident');
  const action = c.params.action;
  if (action !== 'ack' && action !== 'resolve') notFound('Action');
  if (action === 'ack') Object.assign(i, { status: 'ACKNOWLEDGED', acknowledgedById: c.userId, acknowledgedAt: nowIso() });
  else Object.assign(i, { status: 'RESOLVED', resolution: str(c.body.resolution) ?? null, resolvedAt: nowIso() });
  appendAudit(c.userId, `incident.${action}`, 'incident', i.id, c.body);
  return i;
});

// Past declined / timed-out offers so the rejection history has some depth.
{
  const done = db.bookings.filter((b) => b.status === 'COMPLETED' && b.assignments.length === 1).slice(-40);
  const others: Record<string, string> = { u_drv_ravi: 'u_drv_imran', u_drv_imran: 'u_drv_suresh', u_drv_suresh: 'u_drv_ravi', u_drv_prakash: 'u_drv_ravi', u_drv_anil: 'u_drv_imran', u_drv_kiran: 'u_drv_farhan', u_drv_manju: 'u_drv_farhan', u_drv_farhan: 'u_drv_manju' };
  const reasons = ['Truck low on fuel', 'Too far from current location', 'On a break', 'Vehicle class too large for my truck', null];
  done.forEach((b, i) => {
    if (i % 5 !== 0) return;
    const final = b.assignments[0]!;
    const other = others[final.driverUserId];
    if (!other) return;
    const offeredAt = new Date(new Date(final.offeredAt).getTime() - 2 * MIN).toISOString();
    const timedOut = i % 10 === 5;
    const reason = timedOut ? 'No response before timeout' : (reasons[i % reasons.length] ?? 'Declined');
    b.assignments.unshift({ id: `${b.id}_a0`, bookingId: b.id, driverUserId: other, truckId: truckForDriver(other)?.id ?? null, status: timedOut ? 'TIMED_OUT' : 'REJECTED', method: 'AUTO', attempt: 1, offeredAt, expiresAt: new Date(new Date(offeredAt).getTime() + 90_000).toISOString(), respondedAt: new Date(new Date(offeredAt).getTime() + (timedOut ? 90_000 : 35_000)).toISOString(), rejectionReason: reason, assignedById: null, etaMinutes: 22, distanceKm: 7.4, score: 0.66 });
    final.attempt = 2;
  });
}

on('GET', '/dispatch/assignments/history', (c) => {
  requirePerm(c, 'dispatch:manage');
  const status = str(c.query.status);
  const rows = db.bookings
    .flatMap((b) => b.assignments.filter((a) => (status ? a.status === status : a.status === 'REJECTED' || a.status === 'TIMED_OUT')).map((a) => ({ ...a, driver: { fullName: userById(a.driverUserId)?.fullName ?? 'Driver' }, booking: { code: b.code } })))
    .sort((x, y) => y.offeredAt.localeCompare(x.offeredAt));
  return paged(rows, c.query);
});

// ─── System: settings, roles, audit, support desk ────────────────────

on('GET', '/admin/system/settings', (c) => {
  requirePerm(c, 'settings:manage', 'pricing:read');
  return { values: settings, defaults: DEFAULT_SETTINGS };
});

on('PUT', '/admin/system/settings/:key', (c) => {
  requirePerm(c, 'settings:manage');
  const key = c.params.key!;
  if (!(key in DEFAULT_SETTINGS)) fail(400, 'VALIDATION_ERROR', `Unknown settings section ${key}`);
  const before = structuredClone(settings[key]);
  mergeDeep(settings[key]!, c.body);
  appendAudit(c.userId, `settings.${key}`, 'application_setting', key, structuredClone(settings[key]), before);
  return settings[key];
});

const PERMISSIONS: Record<string, string> = {
  'customer:self': 'Use customer features for own account (vehicles, bookings, invoices)',
  'driver:self': 'Use field-worker features for own assignments, availability and earnings',
  'booking:read_any': 'View any booking, including exact locations',
  'booking:manage': 'Cancel, hold, or modify any booking',
  'booking:override': 'Perform authorised workflow overrides (OTP bypass, forced transitions)',
  'dispatch:manage': 'Assign and reassign drivers, manage dispatch queue',
  'employee:read': 'View employee directory and assignments',
  'employee:manage': 'Create, edit, suspend employees and set compensation',
  'employee:verify': 'Approve or reject employee verification',
  'employee:documents': 'View private employee documents',
  'fleet:read': 'View fleet registry',
  'fleet:manage': 'Create and edit trucks, equipment and maintenance',
  'customer:read': 'View customer profiles',
  'customer:manage': 'Suspend customers and manage business accounts',
  'pricing:read': 'View rate cards and service configuration',
  'pricing:manage': 'Edit rate cards, services and zones',
  'pricing:approve_override': 'Approve exceptional price overrides',
  'finance:read': 'View invoices, payments, expenses and financial reports',
  'finance:manage': 'Confirm cash, approve refunds and expenses, issue credit notes',
  'payroll:manage': 'Manage salary records and driver payouts',
  'reports:read': 'View operational analytics',
  'support:manage': 'Handle support tickets and complaints',
  'incident:manage': 'Handle incidents and escalations',
  'membership:manage': 'Manage membership plans and fleet contracts',
  'settings:manage': 'Change business settings',
  'audit:read': 'Read audit logs',
  'roles:manage': 'Grant and revoke staff roles',
};
const ROLE_DEFS = {
  customer: { name: 'Customer', description: 'Vehicle owner requesting assistance' },
  driver: { name: 'Driver', description: 'Tow-truck driver; can lead a recovery team' },
  worker: { name: 'Recovery worker', description: 'Field recovery crew member' },
  dispatcher: { name: 'Dispatcher', description: 'Operations staff running live dispatch' },
  finance: { name: 'Finance', description: 'Accounts staff' },
  admin: { name: 'Administrator', description: 'Business owner with full access' },
};

on('GET', '/admin/system/roles', (c) => {
  requirePerm(c, 'roles:manage', 'employee:read');
  return { roles: Object.fromEntries(Object.entries(ROLE_DEFS).map(([k, v]) => [k, { ...v, permissions: ROLE_PERMISSIONS[k as keyof typeof ROLE_PERMISSIONS] }])), permissions: PERMISSIONS };
});

on('GET', '/admin/system/audit-logs', (c) => {
  requirePerm(c, 'audit:read');
  const { entityType, entityId, actorUserId, action } = c.query;
  const rows = auditRows().filter((a) => (!entityType || a.entityType === entityType) && (!entityId || a.entityId === entityId) && (!actorUserId || a.actorUserId === actorUserId) && (!action || a.action.includes(String(action))));
  return paged(rows, c.query);
});

const ticketSummary = (t: GTicket): TicketSummary => {
  const { messages: _m, ...rest } = t;
  void _m;
  const u = userById(t.userId);
  const b = t.bookingId ? bookingById(t.bookingId) : undefined;
  const inv = t.invoiceId ? db.invoices.find((i) => i.id === t.invoiceId) : undefined;
  return { ...rest, user: { fullName: u?.fullName ?? 'Unknown', phone: u?.phone ?? null }, booking: b ? { id: b.id, code: b.code } : null, invoice: inv ? { id: inv.id, number: inv.number } : null };
};

on('GET', '/admin/system/tickets', (c) => {
  requirePerm(c, 'support:manage');
  const statuses = str(c.query.status)?.split(',');
  const cats = str(c.query.category)?.split(',');
  const mine = c.query.assignedToMe === 'true' || c.query.assignedToMe === true;
  const rows = db.tickets
    .filter((t) => (!statuses || statuses.includes(t.status)) && (!cats || cats.includes(t.category)) && (!mine || t.assignedToId === c.userId))
    .sort((x, y) => ENUM_ORDER_TICKET.indexOf(x.status) - ENUM_ORDER_TICKET.indexOf(y.status) || y.updatedAt.localeCompare(x.updatedAt))
    .map(ticketSummary);
  return paged(rows, c.query);
});

on('PATCH', '/admin/system/tickets/:id', (c) => {
  requirePerm(c, 'support:manage');
  const t = db.tickets.find((x) => x.id === c.params.id) ?? notFound('Ticket');
  const before = ticketSummary(t);
  const b = c.body;
  if (b.status) t.status = b.status as GTicket['status'];
  if (b.priority) t.priority = b.priority as GTicket['priority'];
  if (b.resolution !== undefined) t.resolution = str(b.resolution) ?? null;
  if (b.verified !== undefined) t.verified = !!b.verified;
  if (b.subjectUserId !== undefined) t.subjectUserId = (b.subjectUserId as string | null) ?? null;
  if (b.assignToMe) t.assignedToId = c.userId;
  if (t.status === 'RESOLVED' || t.status === 'CLOSED') t.resolvedAt = nowIso();
  t.updatedAt = nowIso();
  if ((t.status === 'RESOLVED' || t.status === 'CLOSED') && t.category === 'BILLING_DISPUTE' && t.invoiceId) {
    const inv = db.invoices.find((i) => i.id === t.invoiceId);
    if (inv?.disputed) {
      inv.disputed = false;
      refreshInvoiceLedger(inv);
    }
  }
  if (b.status === 'RESOLVED') pushNotification(t.userId, 'support.resolved', `${t.number} resolved`, str(b.resolution) ?? 'Your request has been resolved.', { ticketId: t.id });
  appendAudit(c.userId, 'ticket.updated', 'support_ticket', t.id, b, before);
  return ticketSummary(t);
});

