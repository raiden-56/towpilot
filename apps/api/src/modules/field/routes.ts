import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery, rupeesToPaise } from '../../lib/http.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import { resolvePeriod, type PeriodKey } from '../../lib/time.js';
import { principal, requireAuth, requirePermission } from '../../middleware/auth.js';
import { acceptOffer, rejectOffer, setAvailability } from '../dispatch/service.js';
import { getBookingFor } from '../bookings/service.js';
import {
  addConditionReport,
  closeJob,
  confirmHandover,
  fieldTransition,
  loadFieldBooking,
  proposeRevision,
  recordLocation,
  requestOverride,
  verifyPickupCode,
} from './service.js';
import { recordCashCollection } from '../billing/service.js';
import { workerPerformance } from '../admin/performance.js';
import { notifyOps } from '../notifications/service.js';
import { emitToBooking, emitToOps } from '../../realtime/socket.js';
import { signedFileUrl } from '../../integrations/storage.js';
import { nextDocumentNumber } from '../../lib/numbering.js';
import { storeUploads, uploadMiddleware } from '../../lib/upload.js';

export const EQUIPMENT_CONFIRMED = 'Equipment & crew confirmed suitable';

export const fieldRouter = Router();
fieldRouter.use(requireAuth, requirePermission('driver:self'));

fieldRouter.get('/me', async (req, res) => {
  const p = principal(req);
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: p.userId },
    select: {
      id: true,
      fullName: true,
      phone: true,
      photoKey: true,
      workerProfile: { select: { employeeCode: true, verificationStatus: true, verificationNote: true, employmentType: true, skills: true, partnerCompany: true, zones: { select: { id: true, name: true, city: true } } } },
      driverProfile: { select: { licenceExpiry: true, licenceClass: true, canLeadTeam: true } },
      availability: true,
      assignedTruck: { include: { equipment: true } },
    },
  });
  ok(res, { ...u, photoKey: undefined, photoUrl: u.photoKey ? signedFileUrl(u.photoKey) : null, roles: p.roles });
});

fieldRouter.put('/availability', async (req, res) => {
  const p = principal(req);
  const body = parseBody(z.object({ status: z.enum(['AVAILABLE', 'BUSY', 'ON_BREAK', 'OFF_DUTY']), zoneId: z.string().nullable().optional() }), req);
  const wp = await prisma.workerProfile.findUnique({ where: { userId: p.userId }, include: { zones: { select: { id: true } } } });
  if (!wp) throw forbidden('No worker profile');
  if (body.status === 'AVAILABLE' && wp.verificationStatus !== 'APPROVED') throw forbidden('Your verification is not complete yet');
  if (body.zoneId && !wp.zones.some((z) => z.id === body.zoneId)) throw forbidden('You are not authorised for that service zone');
  const live = await prisma.bookingAssignment.findFirst({ where: { driverUserId: p.userId, status: 'ACCEPTED' } });
  if (live && body.status !== 'BUSY') throw badRequest('Finish or hand over your active job before changing availability');
  const av = await setAvailability(prisma, p.userId, body.status, body.zoneId === undefined ? undefined : body.zoneId);
  emitToOps('driver.availability', { userId: p.userId, status: av.status, zoneId: av.zoneId });
  ok(res, av);
});

const point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().max(100_000).optional(),
  speedKmh: z.number().min(0).max(300).optional(),
  heading: z.number().min(0).max(360).optional(),
  recordedAt: z.coerce.date(),
});

fieldRouter.post('/location', async (req, res) => {
  const body = parseBody(z.union([point, z.object({ points: z.array(point).min(1).max(500) })]), req);
  ok(res, await recordLocation(principal(req), 'points' in body ? body.points : [body]));
});

// ─── Offers & jobs ───────────────────────────────────────────────────

fieldRouter.get('/offers', async (req, res) => {
  const p = principal(req);
  const offers = await prisma.bookingAssignment.findMany({ where: { driverUserId: p.userId, status: 'OFFERED', expiresAt: { gt: new Date() } }, select: { id: true, bookingId: true, expiresAt: true } });
  const out = [];
  for (const o of offers) out.push({ assignmentId: o.id, expiresAt: o.expiresAt, booking: await getBookingFor(p, o.bookingId) });
  ok(res, out);
});

fieldRouter.post('/offers/:id/accept', async (req, res) => {
  const bookingId = await acceptOffer(principal(req).userId, idParam(req));
  ok(res, await getBookingFor(principal(req), bookingId));
});

fieldRouter.post('/offers/:id/reject', async (req, res) => {
  const { reason } = parseBody(z.object({ reason: z.string().trim().max(300).optional() }), req);
  await rejectOffer(principal(req).userId, idParam(req), reason);
  ok(res, { rejected: true });
});

fieldRouter.get('/jobs/active', async (req, res) => {
  const p = principal(req);
  const live = await prisma.bookingAssignment.findFirst({ where: { driverUserId: p.userId, status: 'ACCEPTED' }, select: { bookingId: true } });
  const team = live ? null : await prisma.bookingTeamMember.findFirst({ where: { userId: p.userId, active: true, booking: { status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] } } }, select: { bookingId: true } });
  const id = live?.bookingId ?? team?.bookingId;
  ok(res, id ? await getBookingFor(p, id) : null);
});

fieldRouter.get('/jobs', async (req, res) => {
  const p = principal(req);
  const q = parseQuery(paginationSchema, req);
  // Jobs this worker still belongs to (released/reassigned jobs drop out of their history).
  const where = { teamMembers: { some: { userId: p.userId, active: true } } };
  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...pageArgs(q),
      select: { id: true, code: true, status: true, createdAt: true, completedAt: true, serviceCategory: { select: { name: true } }, vehicle: { select: { registrationNumber: true, make: true, model: true } }, earnings: { where: { userId: p.userId }, select: { amount: true, kind: true } } },
    }),
    prisma.booking.count({ where }),
  ]);
  ok(res, items, pageMeta(q, total));
});

fieldRouter.post('/jobs/:id/transition', async (req, res) => {
  const body = parseBody(z.object({ to: z.enum(['EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'CUSTOMER_UNAVAILABLE', 'FAILED', 'SAFETY_HOLD', 'REASSIGNMENT_REQUIRED']), reason: z.string().trim().max(500).optional() }), req);
  await fieldTransition(principal(req), idParam(req), body.to, body.reason);
  // Releasing or failing a job ends this worker's access to it; return a minimal acknowledgement.
  if (body.to === 'FAILED' || body.to === 'REASSIGNMENT_REQUIRED') return ok(res, { id: idParam(req), status: body.to, released: true });
  ok(res, await getBookingFor(principal(req), idParam(req)));
});

fieldRouter.post('/jobs/:id/verify-pickup', async (req, res) => {
  const body = parseBody(z.object({ code: z.string().regex(/^\d{4}$/), lat: z.number().optional(), lng: z.number().optional() }), req);
  ok(res, await verifyPickupCode(principal(req), idParam(req), body.code, body.lat != null && body.lng != null ? { lat: body.lat, lng: body.lng } : undefined));
});

fieldRouter.post('/jobs/:id/handover', async (req, res) => {
  const body = parseBody(z.object({ code: z.string().regex(/^\d{4}$/), recipientName: z.string().trim().min(2).max(100), recipientRelation: z.string().trim().max(60).optional(), lat: z.number().optional(), lng: z.number().optional() }), req);
  ok(res, await confirmHandover(principal(req), idParam(req), body));
});

/** Team leader confirms equipment and crew suit the recovery (checklist step 5) — recorded in the job history. */
fieldRouter.post('/jobs/:id/equipment-check', async (req, res) => {
  const p = principal(req);
  const { notes } = parseBody(z.object({ notes: z.string().trim().max(500).optional() }), req);
  const { booking, isLead, actor } = await loadFieldBooking(prisma, p, idParam(req));
  if (!isLead) throw forbidden('Only the team leader can confirm equipment and crew');
  if (!['ARRIVED', 'INSPECTING'].includes(booking.status)) throw badRequest('Confirm equipment and crew during inspection');
  await prisma.bookingStatusHistory.create({ data: { bookingId: booking.id, fromStatus: booking.status, toStatus: booking.status, actorUserId: p.userId, actorRole: actor.role, reason: `${EQUIPMENT_CONFIRMED}${notes ? `: ${notes}` : ''}` } });
  await prisma.auditLog.create({ data: { actorUserId: p.userId, action: 'job.equipment_confirmed', entityType: 'booking', entityId: booking.id, after: { notes } } });
  ok(res, { confirmed: true });
});

fieldRouter.post('/jobs/:id/override-request', async (req, res) => {
  const body = parseBody(z.object({ stage: z.enum(['PICKUP', 'HANDOVER']), reason: z.string().trim().min(5).max(500) }), req);
  ok(res, await requestOverride(principal(req), idParam(req), body.stage, body.reason));
});

fieldRouter.post('/jobs/:id/condition-reports', async (req, res) => {
  const body = parseBody(
    z.object({
      stage: z.enum(['PICKUP', 'DELIVERY']),
      notes: z.string().max(2000).optional(),
      damageMarks: z.array(z.object({ area: z.string().max(60), description: z.string().max(300) })).max(30).default([]),
      odometerKm: z.number().int().nonnegative().optional(),
      fuelLevel: z.string().max(20).optional(),
      itemsInVehicle: z.string().max(500).optional(),
      attachmentIds: z.array(z.string()).max(20).default([]),
      supersedesId: z.string().optional(),
    }),
    req,
  );
  created(res, await addConditionReport(principal(req), idParam(req), body));
});

fieldRouter.post('/jobs/:id/quote-revision', async (req, res) => {
  const body = parseBody(
    z.object({
      reason: z.string().trim().min(5).max(500),
      items: z.array(z.object({ description: z.string().trim().min(3).max(200), amount: z.coerce.number().refine((v) => v !== 0, 'Amount cannot be zero').transform((v) => Math.round(v * 100)), reason: z.string().trim().min(3).max(300) })).min(1).max(10),
    }),
    req,
  );
  const q = await proposeRevision(principal(req), idParam(req), body);
  created(res, { ...q, pricingSnapshot: undefined });
});

fieldRouter.post('/jobs/:id/close', async (req, res) => {
  const body = parseBody(
    z.object({
      tolls: rupeesToPaise.default(0),
      parking: rupeesToPaise.default(0),
      odometerKm: z.number().int().nonnegative().optional(),
      notes: z.string().max(1000).optional(),
      cashCollected: rupeesToPaise.optional(),
      expenses: z.array(z.object({ category: z.enum(['FUEL', 'TOLLS_PARKING', 'OTHER']), amount: rupeesToPaise.refine((v) => v > 0), description: z.string().trim().min(3).max(200), attachmentId: z.string().optional() })).max(10).default([]),
    }),
    req,
  );
  const invoice = await closeJob(principal(req), idParam(req), body);
  ok(res, { invoiceId: invoice.id, invoiceNumber: invoice.number, total: invoice.total });
});

fieldRouter.post('/jobs/:id/cash', async (req, res) => {
  const p = principal(req);
  const body = parseBody(z.object({ amount: rupeesToPaise.refine((v) => v > 0), note: z.string().max(300).optional() }), req);
  const { booking } = await loadFieldBooking(prisma, p, idParam(req)).catch(async () => {
    // Job may already be completed (assignment no longer ACCEPTED) — allow the lead who completed it.
    const b = await prisma.booking.findFirst({ where: { id: idParam(req), teamMembers: { some: { userId: p.userId, role: 'TEAM_LEADER' } } } });
    if (!b) throw notFound('Job');
    return { booking: b };
  });
  const inv = await prisma.invoice.findUnique({ where: { bookingId: booking.id } });
  if (!inv) throw badRequest('The invoice has not been generated yet');
  created(res, await recordCashCollection(p.userId, inv.id, body.amount, body.note));
});

fieldRouter.post('/jobs/:id/attachments', uploadMiddleware.array('files', 6), async (req, res) => {
  const p = principal(req);
  const { booking } = await loadFieldBooking(prisma, p, idParam(req));
  if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(booking.status)) throw badRequest('This job is closed');
  const { kind, caption } = z.object({ kind: z.enum(['PICKUP_EVIDENCE', 'DELIVERY_EVIDENCE', 'TOLL_RECEIPT', 'INCIDENT', 'DAMAGE_PHOTO', 'OTHER']), caption: z.string().max(200).optional() }).parse(req.body);
  const files = await storeUploads(req, `bookings/${idParam(req)}`, kind === 'TOLL_RECEIPT' ? ['document'] : ['image']);
  const rows = await prisma.$transaction(files.map((f) => prisma.bookingAttachment.create({ data: { bookingId: idParam(req), uploadedById: p.userId, kind, storageKey: f.storageKey, mimeType: f.mimeType, sizeBytes: f.sizeBytes, sha256: f.sha256, caption } })));
  emitToBooking(idParam(req), 'booking.evidence', { kind });
  created(res, rows.map((r) => ({ ...r, storageKey: undefined, url: signedFileUrl(r.storageKey) })));
});

// ─── Incidents & expenses ────────────────────────────────────────────

fieldRouter.post('/incidents', async (req, res) => {
  const p = principal(req);
  const body = parseBody(
    z.object({
      bookingId: z.string().optional(),
      type: z.enum(['UNSAFE_LOCATION', 'ACCIDENT', 'EQUIPMENT_DAMAGE', 'DISPUTE', 'CUSTOMER_UNAVAILABLE', 'INJURY', 'OTHER']),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
      description: z.string().trim().min(5).max(2000),
      lat: z.number().optional(),
      lng: z.number().optional(),
    }),
    req,
  );
  if (body.bookingId) await loadFieldBooking(prisma, p, body.bookingId);
  const inc = await prisma.incident.create({ data: { ...body, reportedById: p.userId } });
  await notifyOps(prisma, { type: 'incident', title: `${body.severity} incident: ${body.type.replace(/_/g, ' ').toLowerCase()}`, body: body.description, data: { incidentId: inc.id, bookingId: body.bookingId } });
  emitToOps('incident.created', { id: inc.id, severity: inc.severity }, body.bookingId);
  created(res, inc);
});

fieldRouter.post('/expenses', uploadMiddleware.single('receipt'), async (req, res) => {
  const p = principal(req);
  const body = z
    .object({ category: z.enum(['FUEL', 'MAINTENANCE', 'REPAIR', 'TOLLS_PARKING', 'OTHER']), amount: rupeesToPaise.refine((v) => v > 0), description: z.string().trim().min(3).max(200), fuelLitres: z.coerce.number().positive().optional(), odometerKm: z.coerce.number().int().optional(), expenseDate: z.coerce.date() })
    .parse(req.body);
  const truck = await prisma.towTruck.findUnique({ where: { assignedDriverUserId: p.userId } });
  const receipt = req.file ? (await storeUploads(req, `expenses/${p.userId}`, ['document']))[0] : null;
  created(
    res,
    await prisma.expense.create({
      data: { number: await nextDocumentNumber(prisma, 'EXP'), ...body, source: 'EMPLOYEE_CLAIM', status: 'SUBMITTED', reimbursable: true, claimantUserId: p.userId, submittedById: p.userId, truckId: truck?.id, zoneId: truck?.zoneId, attachmentKey: receipt?.storageKey },
    }),
  );
});

fieldRouter.get('/expenses', async (req, res) => {
  ok(res, await prisma.expense.findMany({ where: { claimantUserId: principal(req).userId }, orderBy: { createdAt: 'desc' }, take: 100 }));
});

// ─── Earnings & performance (own records only) ───────────────────────

fieldRouter.get('/earnings', async (req, res) => {
  const p = principal(req);
  const s = await getSettings();
  const { period } = parseQuery(z.object({ period: z.enum(['today', 'this_week', 'this_month', 'last_month', 'this_fy']).default('this_month') }), req);
  const range = resolvePeriod(period as PeriodKey, { tz: s.locale.timezone, fyStartMonth: s.locale.fyStartMonth });
  const [lines, payouts, byKind, completed, cancelled, salary] = await Promise.all([
    prisma.driverEarning.findMany({ where: { userId: p.userId, earnedAt: { gte: range.from, lt: range.to }, status: { not: 'VOID' } }, orderBy: { earnedAt: 'desc' }, include: { booking: { select: { code: true } } } }),
    prisma.driverPayout.findMany({ where: { userId: p.userId }, orderBy: { periodEnd: 'desc' }, take: 24 }),
    prisma.driverEarning.groupBy({ by: ['kind'], where: { userId: p.userId, earnedAt: { gte: range.from, lt: range.to }, status: { not: 'VOID' } }, _sum: { amount: true } }),
    prisma.bookingAssignment.count({ where: { driverUserId: p.userId, status: 'COMPLETED', booking: { completedAt: { gte: range.from, lt: range.to } } } }),
    prisma.bookingAssignment.count({ where: { driverUserId: p.userId, status: { in: ['CANCELLED', 'RELEASED'] }, offeredAt: { gte: range.from, lt: range.to } } }),
    prisma.salaryRecord.findMany({ where: { userId: p.userId }, orderBy: { periodEnd: 'desc' }, take: 12 }),
  ]);
  const sumKind = (k: string) => byKind.find((x) => x.kind === k)?._sum.amount ?? 0;
  const pending = await prisma.driverEarning.aggregate({ where: { userId: p.userId, status: 'PENDING' }, _sum: { amount: true } });
  ok(res, {
    period,
    range,
    totals: {
      jobEarnings: sumKind('JOB_FIXED') + sumKind('JOB_COMMISSION'),
      incentives: sumKind('INCENTIVE'),
      deductions: sumKind('DEDUCTION'),
      reimbursements: sumKind('REIMBURSEMENT'),
      pendingPayout: pending._sum.amount ?? 0,
    },
    jobs: { completed, cancelled },
    lines,
    payouts,
    salary,
  });
});

fieldRouter.get('/performance', async (req, res) => {
  ok(res, await workerPerformance(principal(req).userId));
});

fieldRouter.get('/attendance', async (req, res) => {
  const q = parseQuery(paginationSchema, req);
  const where = { userId: principal(req).userId };
  const [items, total] = await Promise.all([prisma.availabilityLog.findMany({ where, orderBy: { startedAt: 'desc' }, ...pageArgs(q) }), prisma.availabilityLog.count({ where })]);
  ok(res, items, pageMeta(q, total));
});
