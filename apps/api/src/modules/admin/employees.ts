import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery, phoneSchema, rupeesToPaise } from '../../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { mask } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { invalidatePrincipal, principal, requirePermission, can } from '../../middleware/auth.js';
import { storeUploads, uploadMiddleware } from '../../lib/upload.js';
import { signedFileUrl } from '../../integrations/storage.js';
import { ROLE_DEFINITIONS } from '../../domain/permissions.js';
import { workerPerformance } from './performance.js';
import { setAvailability } from '../dispatch/service.js';
import { notify } from '../notifications/service.js';
import { toCsv } from './csv.js';

export const employeesRouter = Router();

const employeeSelect = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  status: true,
  photoKey: true,
  isSample: true,
  createdAt: true,
  lastLoginAt: true,
  roles: { select: { role: { select: { key: true, name: true } } } },
  workerProfile: { include: { zones: { select: { id: true, name: true } } } },
  driverProfile: true,
  availability: true,
  assignedTruck: { select: { id: true, registrationNumber: true, truckType: true, status: true } },
} satisfies Prisma.UserSelect;

/** Compensation fields are restricted to employee:manage / payroll:manage. */
function shape(u: Prisma.UserGetPayload<{ select: typeof employeeSelect }>, showComp: boolean) {
  const wp = u.workerProfile;
  return {
    ...u,
    roles: u.roles.map((r) => r.role.key),
    photoUrl: u.photoKey ? signedFileUrl(u.photoKey) : null,
    photoKey: undefined,
    workerProfile: wp && (showComp ? wp : { ...wp, baseSalary: undefined, commissionBps: undefined, perJobAmount: undefined, payoutDetailsMasked: undefined }),
  };
}

employeesRouter.get('/', requirePermission('employee:read'), async (req, res) => {
  const q = parseQuery(
    paginationSchema.extend({
      q: z.string().trim().max(60).optional(),
      role: z.string().optional(),
      verification: z.enum(['PENDING', 'DOCUMENTS_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
      status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
      zoneId: z.string().optional(),
      availability: z.enum(['AVAILABLE', 'BUSY', 'ON_JOB', 'ON_BREAK', 'OFF_DUTY']).optional(),
    }),
    req,
  );
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    roles: { some: { role: { key: q.role ? q.role : { in: ['driver', 'worker', 'dispatcher', 'finance', 'admin'] } } } },
    ...(q.status ? { status: q.status } : {}),
    ...(q.verification || q.zoneId ? { workerProfile: { ...(q.verification ? { verificationStatus: q.verification } : {}), ...(q.zoneId ? { zones: { some: { id: q.zoneId } } } : {}) } } : {}),
    ...(q.availability ? { availability: { status: q.availability } } : {}),
    ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }, { email: { contains: q.q, mode: 'insensitive' } }, { workerProfile: { employeeCode: { contains: q.q, mode: 'insensitive' } } }] } : {}),
  };
  const [items, total] = await Promise.all([prisma.user.findMany({ where, select: employeeSelect, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }), prisma.user.count({ where })]);
  ok(res, items.map((u) => shape(u, can(req, 'employee:manage') || can(req, 'payroll:manage'))), pageMeta(q, total));
});

employeesRouter.get('/export.csv', requirePermission('employee:manage'), async (req, res) => {
  const users = await prisma.user.findMany({ where: { deletedAt: null, workerProfile: { isNot: null } }, select: employeeSelect, orderBy: { fullName: 'asc' } });
  await audit(prisma, req, { action: 'employee.export', entityType: 'employee' });
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', 'attachment; filename="employees.csv"');
  res.send(
    toCsv(
      users.map((u) => ({
        employeeCode: u.workerProfile?.employeeCode,
        name: u.fullName,
        phone: u.phone,
        roles: u.roles.map((r) => r.role.key).join('|'),
        status: u.status,
        verification: u.workerProfile?.verificationStatus,
        employmentType: u.workerProfile?.employmentType,
        zones: u.workerProfile?.zones.map((z) => z.name).join('|'),
        licenceExpiry: u.driverProfile?.licenceExpiry?.toISOString().slice(0, 10),
        truck: u.assignedTruck?.registrationNumber,
      })),
    ),
  );
});

const createInput = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone: phoneSchema,
  email: z.string().email().toLowerCase().optional(),
  password: z.string().min(10).max(200).optional(),
  roles: z.array(z.enum(['driver', 'worker', 'dispatcher', 'finance', 'admin'])).min(1),
  employmentType: z.enum(['SALARIED', 'COMMISSION', 'JOB_BASED', 'PARTNER']).default('SALARIED'),
  payFrequency: z.enum(['WEEKLY', 'MONTHLY', 'ANNUAL']).optional(),
  baseSalary: rupeesToPaise.optional(),
  commissionPct: z.number().min(0).max(100).optional(),
  perJobAmount: rupeesToPaise.optional(),
  partnerCompany: z.string().max(100).optional(),
  zoneIds: z.array(z.string()).default([]),
  skills: z.array(z.string().max(40)).max(20).default([]),
  emergencyContactName: z.string().max(100).optional(),
  emergencyContactPhone: phoneSchema.optional(),
  payoutMethod: z.enum(['BANK', 'UPI', 'CASH']).optional(),
  payoutDetails: z.string().max(60).optional(),
  licenceNumber: z.string().trim().min(6).max(20).optional(),
  licenceClass: z.string().max(40).optional(),
  licenceExpiry: z.coerce.date().optional(),
  heavyVehicleCert: z.boolean().default(false),
});

employeesRouter.post('/', requirePermission('employee:manage'), async (req, res) => {
  const p = principal(req);
  const b = parseBody(createInput, req);
  if (b.roles.includes('admin') && !p.roles.includes('admin')) throw forbidden('Only administrators can create administrators');
  if (b.roles.some((r) => ['admin', 'dispatcher', 'finance'].includes(r)) && (!b.email || !b.password)) throw badRequest('Office staff need an email and password to sign in');
  if (b.roles.includes('driver') && (!b.licenceNumber || !b.licenceExpiry || !b.licenceClass)) throw badRequest('Driving licence details are required for drivers');
  const field = b.roles.includes('driver') || b.roles.includes('worker');
  const roles = await prisma.role.findMany({ where: { key: { in: b.roles } } });
  const count = await prisma.workerProfile.count();

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        fullName: b.fullName,
        phone: b.phone,
        email: b.email,
        passwordHash: b.password ? await bcrypt.hash(b.password, 12) : null,
        roles: { create: roles.map((r) => ({ roleId: r.id, grantedBy: p.userId })) },
        workerProfile: {
          create: {
            employeeCode: `EMP${String(count + 1).padStart(4, '0')}`,
            employmentType: b.employmentType,
            payFrequency: b.payFrequency,
            baseSalary: b.baseSalary,
            commissionBps: b.commissionPct != null ? Math.round(b.commissionPct * 100) : null,
            perJobAmount: b.perJobAmount,
            partnerCompany: b.partnerCompany,
            skills: b.skills,
            emergencyContactName: b.emergencyContactName,
            emergencyContactPhone: b.emergencyContactPhone,
            payoutMethod: b.payoutMethod,
            payoutDetailsMasked: b.payoutDetails ? mask(b.payoutDetails) : null,
            verificationStatus: field ? 'PENDING' : 'APPROVED',
            zones: { connect: b.zoneIds.map((id) => ({ id })) },
          },
        },
        ...(b.roles.includes('driver') ? { driverProfile: { create: { licenceNumberMask: mask(b.licenceNumber!), licenceClass: b.licenceClass!, licenceExpiry: b.licenceExpiry!, heavyVehicleCert: b.heavyVehicleCert } } } : {}),
      },
    });
    if (field) await tx.driverAvailability.create({ data: { userId: u.id, status: 'OFF_DUTY' } });
    await audit(tx, req, { action: 'employee.created', entityType: 'user', entityId: u.id, after: { ...b, password: undefined, payoutDetails: undefined, licenceNumber: undefined } });
    return u;
  });
  created(res, shape(await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: employeeSelect }), true));
});

employeesRouter.get('/:id', requirePermission('employee:read'), async (req, res) => {
  const u = await prisma.user.findFirst({ where: { id: idParam(req), workerProfile: { isNot: null } }, select: employeeSelect });
  if (!u) throw notFound('Employee');
  const [assignments, incidents, docs, attendance] = await Promise.all([
    prisma.bookingAssignment.findMany({ where: { driverUserId: u.id }, orderBy: { offeredAt: 'desc' }, take: 50, include: { booking: { select: { code: true, status: true } } } }),
    prisma.incident.findMany({ where: { reportedById: u.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    can(req, 'employee:documents') ? prisma.employeeDocument.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } }) : Promise.resolve(null),
    prisma.availabilityLog.findMany({ where: { userId: u.id }, orderBy: { startedAt: 'desc' }, take: 60 }),
  ]);
  ok(res, {
    ...shape(u, can(req, 'employee:manage') || can(req, 'payroll:manage')),
    assignments,
    incidents,
    documents: docs?.map((d) => ({ ...d, storageKey: undefined, url: signedFileUrl(d.storageKey, 120) })) ?? null,
    attendance,
    performance: await workerPerformance(u.id),
  });
});

employeesRouter.patch('/:id', requirePermission('employee:manage'), async (req, res) => {
  const b = parseBody(createInput.omit({ phone: true, roles: true, password: true }).partial().extend({ phone: phoneSchema.optional(), canLeadTeam: z.boolean().optional() }), req);
  const before = await prisma.user.findUnique({ where: { id: idParam(req) }, select: employeeSelect });
  if (!before?.workerProfile) throw notFound('Employee');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: before.id }, data: { fullName: b.fullName, phone: b.phone, email: b.email } });
    await tx.workerProfile.update({
      where: { userId: before.id },
      data: {
        employmentType: b.employmentType,
        payFrequency: b.payFrequency,
        baseSalary: b.baseSalary,
        commissionBps: b.commissionPct != null ? Math.round(b.commissionPct * 100) : undefined,
        perJobAmount: b.perJobAmount,
        partnerCompany: b.partnerCompany,
        skills: b.skills,
        emergencyContactName: b.emergencyContactName,
        emergencyContactPhone: b.emergencyContactPhone,
        payoutMethod: b.payoutMethod,
        payoutDetailsMasked: b.payoutDetails ? mask(b.payoutDetails) : undefined,
        ...(b.zoneIds ? { zones: { set: b.zoneIds.map((id) => ({ id })) } } : {}),
      },
    });
    if (before.driverProfile && (b.licenceExpiry || b.licenceNumber || b.licenceClass || b.heavyVehicleCert != null || b.canLeadTeam != null))
      await tx.driverProfile.update({
        where: { userId: before.id },
        data: { licenceExpiry: b.licenceExpiry, licenceClass: b.licenceClass, licenceNumberMask: b.licenceNumber ? mask(b.licenceNumber) : undefined, heavyVehicleCert: b.heavyVehicleCert, canLeadTeam: b.canLeadTeam },
      });
    await audit(tx, req, { action: 'employee.updated', entityType: 'user', entityId: before.id, before: shape(before, true), after: { ...b, payoutDetails: b.payoutDetails ? '[masked]' : undefined, licenceNumber: undefined } });
  });
  invalidatePrincipal(before.id);
  ok(res, shape(await prisma.user.findUniqueOrThrow({ where: { id: before.id }, select: employeeSelect }), true));
});

/** Verification decision: approve, reject, request documents, or suspend. */
employeesRouter.post('/:id/verification', requirePermission('employee:verify'), async (req, res) => {
  const p = principal(req);
  const b = parseBody(z.object({ decision: z.enum(['APPROVED', 'REJECTED', 'DOCUMENTS_REQUESTED', 'SUSPENDED']), note: z.string().trim().min(3).max(1000) }), req);
  const wp = await prisma.workerProfile.findUnique({ where: { userId: idParam(req) }, include: { user: { include: { driverProfile: true } } } });
  if (!wp) throw notFound('Employee');
  if (b.decision === 'APPROVED') {
    const docs = await prisma.employeeDocument.findMany({ where: { userId: wp.userId } });
    const approvedTypes = new Set(docs.filter((d) => d.status === 'APPROVED' && (!d.expiresAt || d.expiresAt > new Date())).map((d) => d.type));
    const needed = ['ID_PROOF', 'PHOTO', ...(wp.user.driverProfile ? ['DRIVING_LICENCE'] : [])];
    const missing = needed.filter((t) => !approvedTypes.has(t as never));
    if (missing.length) throw badRequest(`Approve these documents first: ${missing.join(', ').toLowerCase().replace(/_/g, ' ')}`);
    if (wp.user.driverProfile && wp.user.driverProfile.licenceExpiry < new Date()) throw badRequest('Driving licence has expired');
  }
  await prisma.workerProfile.update({ where: { id: wp.id }, data: { verificationStatus: b.decision, verificationNote: b.note, verifiedById: p.userId, verifiedAt: new Date() } });
  if (b.decision !== 'APPROVED') await setAvailability(prisma, wp.userId, 'OFF_DUTY');
  await audit(prisma, req, { action: `employee.verification.${b.decision.toLowerCase()}`, entityType: 'user', entityId: wp.userId, before: { status: wp.verificationStatus }, after: b });
  await notify(prisma, wp.userId, { type: 'verification', title: `Verification ${b.decision.replace('_', ' ').toLowerCase()}`, body: b.note, channels: ['SMS'] });
  ok(res, { verificationStatus: b.decision });
});

/** Account status: activate, suspend, deactivate (revokes sessions immediately). */
employeesRouter.post('/:id/status', requirePermission('employee:manage'), async (req, res) => {
  const p = principal(req);
  const b = parseBody(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']), reason: z.string().trim().min(3).max(500) }), req);
  if (idParam(req) === p.userId) throw forbidden('You cannot change your own account status');
  const u = await prisma.user.findUnique({ where: { id: idParam(req) } });
  if (!u) throw notFound('Employee');
  const live = await prisma.bookingAssignment.count({ where: { driverUserId: u.id, status: { in: ['OFFERED', 'ACCEPTED'] } } });
  if (live && b.status !== 'ACTIVE') throw conflict('Reassign this employee’s active job first');
  await prisma.$transaction([
    prisma.user.update({ where: { id: u.id }, data: { status: b.status } }),
    ...(b.status !== 'ACTIVE' ? [prisma.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } })] : []),
  ]);
  if (b.status !== 'ACTIVE') await prisma.driverAvailability.updateMany({ where: { userId: u.id }, data: { status: 'OFF_DUTY', locationSharing: false } });
  invalidatePrincipal(u.id);
  await audit(prisma, req, { action: `employee.status.${b.status.toLowerCase()}`, entityType: 'user', entityId: u.id, before: { status: u.status }, after: b });
  ok(res, { status: b.status });
});

employeesRouter.put('/:id/roles', requirePermission('roles:manage'), async (req, res) => {
  const p = principal(req);
  const { roles } = parseBody(z.object({ roles: z.array(z.enum(['driver', 'worker', 'dispatcher', 'finance', 'admin'])).min(1) }), req);
  if (idParam(req) === p.userId && !roles.includes('admin')) throw forbidden('You cannot remove your own administrator role');
  const u = await prisma.user.findUnique({ where: { id: idParam(req) }, include: { roles: { include: { role: true } } } });
  if (!u) throw notFound('Employee');
  const roleRows = await prisma.role.findMany({ where: { key: { in: roles } } });
  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: u.id, role: { key: { not: 'customer' } } } }),
    ...roleRows.map((r) => prisma.userRole.create({ data: { userId: u.id, roleId: r.id, grantedBy: p.userId } })),
  ]);
  invalidatePrincipal(u.id);
  await audit(prisma, req, { action: 'employee.roles', entityType: 'user', entityId: u.id, before: u.roles.map((r) => r.role.key), after: roles });
  ok(res, { roles, available: Object.keys(ROLE_DEFINITIONS) });
});

employeesRouter.put('/:id/truck', requirePermission('fleet:manage'), async (req, res) => {
  const { truckId } = parseBody(z.object({ truckId: z.string().nullable() }), req);
  const u = await prisma.user.findUnique({ where: { id: idParam(req) }, include: { driverProfile: true } });
  if (!u?.driverProfile) throw notFound('Driver');
  const live = await prisma.bookingAssignment.count({ where: { driverUserId: u.id, status: 'ACCEPTED' } });
  if (live) throw conflict('Driver is on a job');
  await prisma.$transaction(async (tx) => {
    await tx.towTruck.updateMany({ where: { assignedDriverUserId: u.id }, data: { assignedDriverUserId: null } });
    if (truckId) {
      const t = await tx.towTruck.findUnique({ where: { id: truckId } });
      if (!t) throw notFound('Truck');
      if (t.status === 'IN_USE') throw conflict('Truck is on a job');
      await tx.towTruck.update({ where: { id: truckId }, data: { assignedDriverUserId: u.id } });
    }
    await audit(tx, req, { action: 'driver.truck_assigned', entityType: 'user', entityId: u.id, after: { truckId } });
  });
  ok(res, { truckId });
});

// ─── Documents (private) ─────────────────────────────────────────────

employeesRouter.post('/:id/documents', requirePermission('employee:documents'), uploadMiddleware.single('file'), async (req, res) => {
  const b = z.object({ type: z.enum(['ID_PROOF', 'DRIVING_LICENCE', 'PHOTO', 'ADDRESS_PROOF', 'TRAINING_CERTIFICATE', 'OTHER']), number: z.string().max(40).optional(), expiresAt: z.coerce.date().optional() }).parse(req.body);
  const u = await prisma.user.findUnique({ where: { id: idParam(req) } });
  if (!u) throw notFound('Employee');
  const [f] = await storeUploads(req, `employees/${u.id}`, ['document']);
  const doc = await prisma.employeeDocument.create({ data: { userId: u.id, type: b.type, numberMasked: b.number ? mask(b.number) : null, storageKey: f!.storageKey, mimeType: f!.mimeType, expiresAt: b.expiresAt } });
  if (b.type === 'PHOTO' && f!.mimeType.startsWith('image/')) await prisma.user.update({ where: { id: u.id }, data: { photoKey: f!.storageKey } });
  await audit(prisma, req, { action: 'employee.document.uploaded', entityType: 'employee_document', entityId: doc.id, after: { type: b.type } });
  created(res, { ...doc, storageKey: undefined });
});

employeesRouter.post('/:id/documents/:docId/review', requirePermission('employee:verify'), async (req, res) => {
  const b = parseBody(z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().max(500).optional() }), req);
  const doc = await prisma.employeeDocument.findFirst({ where: { id: idParam(req, 'docId'), userId: idParam(req) } });
  if (!doc) throw notFound('Document');
  const updated = await prisma.employeeDocument.update({ where: { id: doc.id }, data: { status: b.status, reviewNote: b.note, reviewedById: principal(req).userId, reviewedAt: new Date() } });
  await audit(prisma, req, { action: `employee.document.${b.status.toLowerCase()}`, entityType: 'employee_document', entityId: doc.id, after: b });
  ok(res, { ...updated, storageKey: undefined });
});

employeesRouter.get('/:id/documents/:docId/url', requirePermission('employee:documents'), async (req, res) => {
  const doc = await prisma.employeeDocument.findFirst({ where: { id: idParam(req, 'docId'), userId: idParam(req) } });
  if (!doc) throw notFound('Document');
  await audit(prisma, req, { action: 'employee.document.viewed', entityType: 'employee_document', entityId: doc.id });
  ok(res, { url: signedFileUrl(doc.storageKey, 120) });
});

/** Licence and document expiry tracker. */
employeesRouter.get('/compliance/expiring', requirePermission('employee:read'), async (req, res) => {
  const { days } = parseQuery(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req);
  const until = new Date(Date.now() + days * 86_400_000);
  const [licences, documents] = await Promise.all([
    prisma.driverProfile.findMany({ where: { licenceExpiry: { lt: until } }, include: { user: { select: { id: true, fullName: true, status: true } } }, orderBy: { licenceExpiry: 'asc' } }),
    prisma.employeeDocument.findMany({ where: { expiresAt: { lt: until }, status: 'APPROVED' }, include: { user: { select: { id: true, fullName: true } } }, orderBy: { expiresAt: 'asc' } }),
  ]);
  ok(res, { licences, documents: documents.map((d) => ({ ...d, storageKey: undefined })) });
});
