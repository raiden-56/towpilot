import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { principal, requireAuth, requirePermission, type Principal } from '../../middleware/auth.js';
import { OPEN_STATUSES, STATUS_LABELS } from '../../domain/bookingStateMachine.js';
import { completeReview, loadCandidates, manualAssign, reassign, runAutoDispatch } from './service.js';
import { getBookingFor } from '../bookings/service.js';
import { withTx } from '../../lib/tx.js';
import { transition, type Actor } from '../bookings/transitions.js';
import { authorizeCustodyOverride, decideInternalOverride } from '../field/service.js';
import { emitToOps } from '../../realtime/socket.js';
import { releaseLiveAssignment, setAvailability } from './service.js';
import { getSettings } from '../../lib/settings.js';

export const dispatchRouter = Router();
dispatchRouter.use(requireAuth);

const opsActor = (p: Principal): Actor => ({ userId: p.userId, role: p.roles.includes('admin') ? 'ADMIN' : 'DISPATCHER' });

/** Everything the live dispatch centre needs in one call; sockets then push deltas. */
dispatchRouter.get('/board', requirePermission('dispatch:manage', 'booking:read_any'), async (_req, res) => {
  const s = await getSettings();
  const [bookings, drivers, trucks, zones, escalations, incidents] = await Promise.all([
    prisma.booking.findMany({
      where: { status: { in: [...OPEN_STATUSES, 'DELIVERED'] } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 300,
      select: {
        id: true,
        code: true,
        status: true,
        type: true,
        priority: true,
        scheduledFor: true,
        safetyFlags: true,
        requiresManualReview: true,
        reviewedAt: true,
        manualReviewReasons: true,
        etaAt: true,
        createdAt: true,
        updatedAt: true,
        dispatchAttempts: true,
        zoneId: true,
        serviceCategory: { select: { name: true, kind: true } },
        vehicle: { select: { registrationNumber: true, vehicleClass: true } },
        locations: { select: { kind: true, lat: true, lng: true, address: true, placeName: true } },
        assignments: { orderBy: { offeredAt: 'desc' }, take: 5, select: { id: true, status: true, driverUserId: true, offeredAt: true, expiresAt: true, rejectionReason: true, method: true, driver: { select: { fullName: true } } } },
      },
    }),
    prisma.user.findMany({
      where: { deletedAt: null, workerProfile: { isNot: null }, availability: { isNot: null } },
      select: {
        id: true,
        fullName: true,
        status: true,
        roles: { select: { role: { select: { key: true } } } },
        workerProfile: { select: { verificationStatus: true, zones: { select: { id: true, name: true } } } },
        availability: true,
        assignedTruck: { select: { id: true, registrationNumber: true, truckType: true, status: true } },
      },
    }),
    prisma.towTruck.findMany({ select: { id: true, registrationNumber: true, truckType: true, status: true, zoneId: true, assignedDriverUserId: true } }),
    prisma.serviceZone.findMany({ where: { active: true } }),
    prisma.escalation.findMany({ where: { status: { not: 'RESOLVED' } }, orderBy: { createdAt: 'desc' }, take: 100, include: { booking: { select: { code: true } } } }),
    prisma.incident.findMany({ where: { status: { not: 'RESOLVED' } }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  const staleMs = s.dispatch.locationStaleMinutes * 60_000;
  ok(res, {
    serverTime: new Date(),
    bookings: bookings.map((b) => ({ ...b, statusLabel: STATUS_LABELS[b.status] })),
    drivers: drivers.map((d) => ({
      id: d.id,
      name: d.fullName,
      roles: d.roles.map((r) => r.role.key),
      verification: d.workerProfile?.verificationStatus,
      zones: d.workerProfile?.zones,
      status: d.availability?.status,
      lat: d.availability?.lastLat,
      lng: d.availability?.lastLng,
      lastLocationAt: d.availability?.lastLocationAt,
      locationStale: !d.availability?.lastLocationAt || Date.now() - d.availability.lastLocationAt.getTime() > staleMs,
      truck: d.assignedTruck,
    })),
    trucks,
    zones,
    escalations,
    incidents,
  });
});

dispatchRouter.get('/bookings/:id/candidates', requirePermission('dispatch:manage'), async (req, res) => {
  const { ranked, request } = await loadCandidates(prisma, idParam(req));
  ok(res, {
    request,
    candidates: ranked.map((r) => ({ driverUserId: r.driver.userId, name: r.driver.name, eligible: r.eligible, reasons: r.reasons, distanceKm: r.distanceKm, etaMinutes: r.etaMinutes, score: r.score, truck: r.driver.truck && { id: r.driver.truck.id, registrationNumber: r.driver.truck.registrationNumber, truckType: r.driver.truck.truckType }, jobsToday: r.driver.jobsToday, rating: r.driver.rating })),
  });
});

dispatchRouter.post('/bookings/:id/assign', requirePermission('dispatch:manage'), async (req, res) => {
  const body = parseBody(z.object({ driverUserId: z.string(), note: z.string().max(500).optional(), force: z.boolean().optional() }), req);
  await manualAssign(opsActor(principal(req)), idParam(req), body);
  ok(res, await getBookingFor(principal(req), idParam(req)));
});

dispatchRouter.post('/bookings/:id/auto-dispatch', requirePermission('dispatch:manage'), async (req, res) => {
  ok(res, await runAutoDispatch(idParam(req)));
});

dispatchRouter.post('/bookings/:id/reassign', requirePermission('dispatch:manage'), async (req, res) => {
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(3).max(500) }), req);
  await reassign(opsActor(principal(req)), idParam(req), reason);
  ok(res, await getBookingFor(principal(req), idParam(req)));
});

dispatchRouter.post('/bookings/:id/review', requirePermission('dispatch:manage'), async (req, res) => {
  const body = parseBody(
    z.object({ approve: z.boolean(), notes: z.string().trim().min(5).max(1000), crew: z.number().int().min(1).max(8).optional(), truckTypes: z.array(z.enum(['FLATBED', 'WHEEL_LIFT', 'HEAVY_DUTY', 'BIKE_CARRIER', 'SERVICE_VAN'])).optional(), equipment: z.array(z.string()).optional() }),
    req,
  );
  ok(res, await completeReview(opsActor(principal(req)), idParam(req), body));
});

/** Ops transitions: safety hold/resume, fail, etc. Every use is logged with reason. */
dispatchRouter.post('/bookings/:id/transition', requirePermission('booking:manage'), async (req, res) => {
  const p = principal(req);
  const body = parseBody(z.object({ to: z.enum(['SAFETY_HOLD', 'FAILED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT', 'COMPLETED', 'SEARCHING_FOR_PROVIDER']), reason: z.string().trim().min(3).max(500) }), req);
  await withTx(async (tx, after) => {
    const b = await tx.booking.findUnique({ where: { id: idParam(req) } });
    if (!b) throw notFound('Booking');
    if (body.to === 'FAILED') {
      await releaseLiveAssignment(tx, after, b.id, 'RELEASED', body.reason);
      await tx.booking.update({ where: { id: b.id }, data: { failureReason: body.reason } });
    }
    await transition(tx, after, b, body.to, opsActor(p), { reason: body.reason, isOverride: true });
    await tx.auditLog.create({ data: { actorUserId: p.userId, action: 'booking.ops_transition', entityType: 'booking', entityId: b.id, after: body } });
  });
  ok(res, await getBookingFor(p, idParam(req)));
});

dispatchRouter.post('/bookings/:id/team', requirePermission('dispatch:manage'), async (req, res) => {
  const p = principal(req);
  const body = parseBody(z.object({ userId: z.string(), role: z.enum(['DRIVER', 'RECOVERY_WORKER']), responsibility: z.string().trim().max(200).optional() }), req);
  const worker = await prisma.workerProfile.findUnique({ where: { userId: body.userId }, include: { user: true } });
  if (!worker || worker.verificationStatus !== 'APPROVED' || worker.user.status !== 'ACTIVE') throw notFound('Verified worker');
  await prisma.bookingTeamMember.upsert({
    where: { bookingId_userId: { bookingId: idParam(req), userId: body.userId } },
    create: { bookingId: idParam(req), userId: body.userId, role: body.role, responsibility: body.responsibility, addedById: p.userId },
    update: { active: true, role: body.role, responsibility: body.responsibility },
  });
  await setAvailability(prisma, body.userId, 'ON_JOB');
  emitToOps('booking.team', {}, idParam(req));
  ok(res, await getBookingFor(p, idParam(req)));
});

dispatchRouter.delete('/bookings/:id/team/:userId', requirePermission('dispatch:manage'), async (req, res) => {
  const p = principal(req);
  const m = await prisma.bookingTeamMember.findUnique({ where: { bookingId_userId: { bookingId: idParam(req), userId: idParam(req, 'userId') } } });
  if (!m || m.role === 'TEAM_LEADER') throw notFound('Team member');
  await prisma.bookingTeamMember.update({ where: { id: m.id }, data: { active: false } });
  await setAvailability(prisma, m.userId, 'AVAILABLE');
  ok(res, await getBookingFor(p, idParam(req)));
});

dispatchRouter.post('/bookings/:id/custody-override', requirePermission('booking:override'), async (req, res) => {
  const body = parseBody(z.object({ stage: z.enum(['PICKUP', 'HANDOVER']), reason: z.string().trim().min(10).max(500), recipientName: z.string().max(100).optional(), recipientRelation: z.string().max(60).optional() }), req);
  ok(res, await authorizeCustodyOverride(principal(req), idParam(req), body));
});

dispatchRouter.post('/quotes/:id/internal-decision', requirePermission('pricing:approve_override'), async (req, res) => {
  const body = parseBody(z.object({ approve: z.boolean(), note: z.string().trim().min(3).max(500) }), req);
  ok(res, await decideInternalOverride(principal(req), idParam(req), body.approve, body.note));
});

// ─── Escalations & incidents ─────────────────────────────────────────

dispatchRouter.get('/escalations', requirePermission('dispatch:manage', 'incident:manage'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional() }), req);
  const where = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([prisma.escalation.findMany({ where, orderBy: { createdAt: 'desc' }, include: { booking: { select: { code: true, status: true } } }, ...pageArgs(q) }), prisma.escalation.count({ where })]);
  ok(res, items, pageMeta(q, total));
});

dispatchRouter.post('/escalations/:id/:action', requirePermission('dispatch:manage', 'incident:manage'), async (req, res) => {
  const p = principal(req);
  const action = z.enum(['ack', 'resolve']).parse(req.params.action);
  const { resolution } = parseBody(z.object({ resolution: z.string().trim().max(2000).optional() }), req);
  const e = await prisma.escalation.update({ where: { id: idParam(req) }, data: action === 'ack' ? { status: 'ACKNOWLEDGED' } : { status: 'RESOLVED', resolution, resolvedById: p.userId, resolvedAt: new Date() } });
  await prisma.auditLog.create({ data: { actorUserId: p.userId, action: `escalation.${action}`, entityType: 'escalation', entityId: e.id, after: { resolution } } });
  emitToOps('escalation.updated', { id: e.id, status: e.status }, e.bookingId);
  ok(res, e);
});

dispatchRouter.get('/incidents', requirePermission('incident:manage'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional() }), req);
  const where = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([prisma.incident.findMany({ where, orderBy: { createdAt: 'desc' }, include: { booking: { select: { code: true } } }, ...pageArgs(q) }), prisma.incident.count({ where })]);
  ok(res, items, pageMeta(q, total));
});

dispatchRouter.post('/incidents/:id/:action', requirePermission('incident:manage'), async (req, res) => {
  const p = principal(req);
  const action = z.enum(['ack', 'resolve']).parse(req.params.action);
  const body = parseBody(z.object({ resolution: z.string().max(2000).optional() }), req);
  const inc = await prisma.incident.update({
    where: { id: idParam(req) },
    data: action === 'ack' ? { status: 'ACKNOWLEDGED', acknowledgedById: p.userId, acknowledgedAt: new Date() } : { status: 'RESOLVED', resolution: body.resolution, resolvedAt: new Date() },
  });
  await prisma.auditLog.create({ data: { actorUserId: p.userId, action: `incident.${action}`, entityType: 'incident', entityId: inc.id, after: body } });
  ok(res, inc);
});

dispatchRouter.get('/assignments/history', requirePermission('dispatch:manage'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ status: z.enum(['REJECTED', 'TIMED_OUT']).optional() }), req);
  const where = { status: q.status ? q.status : { in: ['REJECTED' as const, 'TIMED_OUT' as const] } };
  const [items, total] = await Promise.all([
    prisma.bookingAssignment.findMany({ where, orderBy: { offeredAt: 'desc' }, include: { driver: { select: { fullName: true } }, booking: { select: { code: true } } }, ...pageArgs(q) }),
    prisma.bookingAssignment.count({ where }),
  ]);
  ok(res, items, pageMeta(q, total));
});
