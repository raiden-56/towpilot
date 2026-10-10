import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery, phoneSchema, rupeesToPaise } from '../../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { invalidatePrincipal, principal, requirePermission, can } from '../../middleware/auth.js';
import { ageingBucket } from '../../domain/finance.js';

export const customersRouter = Router();

customersRouter.get('/', requirePermission('customer:read'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ q: z.string().trim().max(60).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(), fleetAccountId: z.string().optional() }), req);
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    roles: { some: { role: { key: 'customer' } } },
    ...(q.status ? { status: q.status } : {}),
    ...(q.fleetAccountId ? { fleetMemberships: { some: { fleetAccountId: q.fleetAccountId } } } : {}),
    ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }, { email: { contains: q.q, mode: 'insensitive' } }, { vehicles: { some: { registrationNumber: { contains: q.q.toUpperCase().replace(/\s/g, '') } } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...pageArgs(q),
      select: { id: true, fullName: true, phone: true, email: true, status: true, createdAt: true, isSample: true, _count: { select: { bookings: true, vehicles: true } }, fleetMemberships: { select: { fleetAccount: { select: { id: true, name: true } } } } },
    }),
    prisma.user.count({ where }),
  ]);
  ok(res, items, pageMeta(q, total));
});

customersRouter.get('/:id', requirePermission('customer:read'), async (req, res) => {
  const finance = can(req, 'finance:read');
  const u = await prisma.user.findFirst({
    where: { id: idParam(req), roles: { some: { role: { key: 'customer' } } } },
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      isSample: true,
      customerProfile: true,
      vehicles: { where: { deletedAt: null } },
      savedAddresses: true,
      emergencyContacts: true,
      bookings: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, code: true, status: true, createdAt: true, serviceCategory: { select: { name: true } }, invoice: { select: { total: true, paymentStatus: true } } } },
      tickets: { orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, number: true, category: true, status: true, subject: true, createdAt: true } },
      subscriptions: { include: { membership: { select: { name: true } } } },
      fleetMemberships: { include: { fleetAccount: { select: { id: true, name: true } } } },
      notifications: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, channel: true, type: true, title: true, status: true, createdAt: true } },
    },
  });
  if (!u) throw notFound('Customer');
  const invoices = finance ? await prisma.invoice.findMany({ where: { customerUserId: u.id }, orderBy: { issuedAt: 'desc' }, take: 50 }) : null;
  const payments = finance ? await prisma.payment.findMany({ where: { invoice: { customerUserId: u.id } }, orderBy: { createdAt: 'desc' }, take: 50 }) : null;
  ok(res, { ...u, invoices, payments, communicationHistory: u.notifications });
});

customersRouter.post('/:id/status', requirePermission('customer:manage'), async (req, res) => {
  const b = parseBody(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']), reason: z.string().trim().min(3).max(500) }), req);
  const u = await prisma.user.findUnique({ where: { id: idParam(req) }, include: { roles: { include: { role: true } } } });
  if (!u || !u.roles.some((r) => r.role.key === 'customer')) throw notFound('Customer');
  if (u.roles.some((r) => ['admin', 'dispatcher', 'finance', 'driver', 'worker'].includes(r.role.key))) throw forbidden('Use employee management for staff accounts');
  await prisma.$transaction([prisma.user.update({ where: { id: u.id }, data: { status: b.status } }), ...(b.status !== 'ACTIVE' ? [prisma.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } })] : [])]);
  invalidatePrincipal(u.id);
  await audit(prisma, req, { action: `customer.status.${b.status.toLowerCase()}`, entityType: 'user', entityId: u.id, before: { status: u.status }, after: b });
  ok(res, { status: b.status });
});

/**
 * Right to erasure (DPDP): anonymises a customer's personal data. Invoices keep their legally
 * required billing snapshot; booking contact details, addresses and location precision are
 * scrubbed; tracking history, notifications, saved places and contacts are deleted.
 */
customersRouter.post('/:id/anonymize', requirePermission('customer:manage'), async (req, res) => {
  const { reason, ticketId } = parseBody(z.object({ reason: z.string().trim().min(5).max(500), ticketId: z.string().optional() }), req);
  const u = await prisma.user.findUnique({ where: { id: idParam(req) }, include: { roles: { include: { role: true } } } });
  if (!u || !u.roles.some((r) => r.role.key === 'customer')) throw notFound('Customer');
  if (u.roles.some((r) => r.role.key !== 'customer')) throw forbidden('Staff accounts must be offboarded through employee management');
  const active = await prisma.booking.count({ where: { customerUserId: u.id, status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] } } });
  if (active) throw conflict('The customer has an active booking. Complete or cancel it first.');
  const owed = await prisma.invoice.aggregate({ where: { customerUserId: u.id, status: 'ISSUED' }, _sum: { outstanding: true } });
  await prisma.$transaction(async (tx) => {
    const bookings = await tx.booking.findMany({ where: { customerUserId: u.id }, select: { id: true } });
    const ids = bookings.map((b) => b.id);
    await tx.trackingEvent.deleteMany({ where: { bookingId: { in: ids } } });
    await tx.bookingShareLink.deleteMany({ where: { bookingId: { in: ids } } });
    await tx.booking.updateMany({ where: { id: { in: ids } }, data: { contactName: 'Erased customer', contactPhone: '', instructions: null } });
    await tx.$executeRaw`UPDATE "booking_locations" SET "address" = NULL, "landmark" = NULL, "accessNotes" = NULL, "gateNumber" = NULL, "floor" = NULL, "parkingLevel" = NULL, "lat" = ROUND("lat"::numeric, 2), "lng" = ROUND("lng"::numeric, 2) WHERE "bookingId" = ANY(${ids})`;
    await tx.savedAddress.deleteMany({ where: { userId: u.id } });
    await tx.emergencyContact.deleteMany({ where: { userId: u.id } });
    await tx.notification.deleteMany({ where: { userId: u.id } });
    await tx.session.deleteMany({ where: { userId: u.id } });
    await tx.vehicle.updateMany({ where: { ownerUserId: u.id }, data: { photoKeys: [], deletedAt: new Date() } });
    await tx.customerProfile.updateMany({ where: { userId: u.id }, data: { marketingConsent: false, locationConsent: false, notifySms: false, notifyEmail: false, notifyPush: false } });
    await tx.user.update({ where: { id: u.id }, data: { fullName: 'Erased customer', phone: null, email: null, photoKey: null, status: 'DEACTIVATED', deletedAt: new Date() } });
    if (ticketId) await tx.supportTicket.updateMany({ where: { id: ticketId, userId: u.id, category: 'PRIVACY_REQUEST' }, data: { status: 'RESOLVED', resolution: `Personal data erased. ${reason}`, resolvedAt: new Date() } });
    await audit(tx, req, { action: 'customer.anonymized', entityType: 'user', entityId: u.id, after: { reason, ticketId, outstandingAtErasure: owed._sum.outstanding ?? 0 } });
  });
  invalidatePrincipal(u.id);
  ok(res, { anonymized: true, retained: 'Invoices, payments and their billing snapshots are retained as required by tax law.' });
});

// ─── Business / fleet accounts ───────────────────────────────────────

export const fleetAccountsRouter = Router();

fleetAccountsRouter.get('/', requirePermission('customer:read'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ q: z.string().max(60).optional() }), req);
  const where: Prisma.FleetAccountWhereInput = q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {};
  const [items, total] = await Promise.all([
    prisma.fleetAccount.findMany({ where, orderBy: { name: 'asc' }, ...pageArgs(q), include: { _count: { select: { members: true, vehicles: true, bookings: true } }, contracts: { where: { active: true } } } }),
    prisma.fleetAccount.count({ where }),
  ]);
  const owed = await prisma.invoice.groupBy({ by: ['fleetAccountId'], where: { fleetAccountId: { in: items.map((i) => i.id) }, status: 'ISSUED' }, _sum: { outstanding: true } });
  ok(res, items.map((i) => ({ ...i, outstanding: owed.find((o) => o.fleetAccountId === i.id)?._sum.outstanding ?? 0 })), pageMeta(q, total));
});

const accountInput = z.object({
  name: z.string().trim().min(2).max(120),
  gstin: z.string().trim().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN').optional(),
  billingEmail: z.string().email(),
  billingPhone: phoneSchema.optional(),
  billingAddress: z.string().max(500).optional(),
  creditLimit: rupeesToPaise.default(0),
  paymentTermsDays: z.number().int().min(0).max(120).default(30),
});

fleetAccountsRouter.post('/', requirePermission('customer:manage'), async (req, res) => {
  const b = parseBody(accountInput, req);
  const a = await prisma.fleetAccount.create({ data: b });
  await audit(prisma, req, { action: 'fleet_account.created', entityType: 'fleet_account', entityId: a.id, after: b });
  created(res, a);
});

/** All fleet contracts (for contract-specific rate cards and reporting). */
fleetAccountsRouter.get('/contracts', requirePermission('customer:read', 'pricing:read'), async (_req, res) => {
  ok(res, await prisma.fleetContract.findMany({ orderBy: [{ active: 'desc' }, { startsAt: 'desc' }], include: { fleetAccount: { select: { id: true, name: true } } } }));
});

fleetAccountsRouter.get('/:id', requirePermission('customer:read'), async (req, res) => {
  const a = await prisma.fleetAccount.findUnique({
    where: { id: idParam(req) },
    include: { members: { include: { user: { select: { id: true, fullName: true, phone: true } } } }, contracts: { orderBy: { startsAt: 'desc' }, include: { rateCards: { where: { isActive: true } } } }, vehicles: { where: { deletedAt: null } }, subscriptions: { include: { membership: true } } },
  });
  if (!a) throw notFound('Business account');
  const now = new Date();
  const invoices = await prisma.invoice.findMany({ where: { fleetAccountId: a.id }, orderBy: { issuedAt: 'desc' }, take: 100 });
  const ageing: Record<string, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const i of invoices) if (i.status === 'ISSUED' && i.outstanding > 0) {
    const k = ageingBucket(i.dueAt ?? i.issuedAt, now);
    ageing[k] = (ageing[k] ?? 0) + i.outstanding;
  }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const usageThisMonth = await prisma.booking.count({ where: { fleetAccountId: a.id, createdAt: { gte: monthStart }, status: { notIn: ['CANCELLED', 'REQUESTED', 'QUOTED'] } } });
  ok(res, { ...a, invoices, ageing, usageThisMonth });
});

fleetAccountsRouter.patch('/:id', requirePermission('customer:manage'), async (req, res) => {
  const { reason, ...b } = parseBody(accountInput.partial().extend({ gstin: accountInput.shape.gstin.unwrap().nullable().optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), reason: z.string().trim().min(3).max(500).optional() }), req);
  const before = await prisma.fleetAccount.findUnique({ where: { id: idParam(req) } });
  if (!before) throw notFound('Business account');
  if (b.status && b.status !== before.status && !reason) throw badRequest('A reason is required to change the account status');
  const a = await prisma.fleetAccount.update({ where: { id: before.id }, data: b });
  await audit(prisma, req, { action: b.status && b.status !== before.status ? `fleet_account.${b.status.toLowerCase()}` : 'fleet_account.updated', entityType: 'fleet_account', entityId: a.id, before, after: { ...b, reason } });
  ok(res, a);
});

fleetAccountsRouter.post('/:id/members', requirePermission('customer:manage'), async (req, res) => {
  const b = parseBody(z.object({ phone: phoneSchema, isManager: z.boolean().default(false) }), req);
  const u = await prisma.user.findUnique({ where: { phone: b.phone } });
  if (!u) throw notFound('No customer account with this phone. Ask them to sign up first.');
  const m = await prisma.fleetAccountMember.upsert({ where: { fleetAccountId_userId: { fleetAccountId: idParam(req), userId: u.id } }, create: { fleetAccountId: idParam(req), userId: u.id, isManager: b.isManager }, update: { isManager: b.isManager } });
  await audit(prisma, req, { action: 'fleet_account.member', entityType: 'fleet_account', entityId: idParam(req), after: { userId: u.id, isManager: b.isManager } });
  created(res, m);
});

fleetAccountsRouter.delete('/:id/members/:userId', requirePermission('customer:manage'), async (req, res) => {
  await prisma.fleetAccountMember.delete({ where: { fleetAccountId_userId: { fleetAccountId: idParam(req), userId: idParam(req, 'userId') } } });
  await audit(prisma, req, { action: 'fleet_account.member_removed', entityType: 'fleet_account', entityId: idParam(req), after: { userId: idParam(req, 'userId') } });
  ok(res, { removed: true });
});

/** Detach a vehicle from the business account (future bookings bill the owner personally). */
fleetAccountsRouter.delete('/:id/vehicles/:vehicleId', requirePermission('customer:manage'), async (req, res) => {
  const r = await prisma.vehicle.updateMany({ where: { id: idParam(req, 'vehicleId'), fleetAccountId: idParam(req) }, data: { fleetAccountId: null } });
  if (!r.count) throw notFound('Vehicle');
  await audit(prisma, req, { action: 'fleet_account.vehicle_detached', entityType: 'fleet_account', entityId: idParam(req), after: { vehicleId: idParam(req, 'vehicleId') } });
  ok(res, { detached: true });
});

/** Assign an existing customer vehicle to the business account (corporate billing). */
fleetAccountsRouter.post('/:id/vehicles', requirePermission('customer:manage'), async (req, res) => {
  const { vehicleId } = parseBody(z.object({ vehicleId: z.string() }), req);
  const v = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!v) throw notFound('Vehicle');
  const member = await prisma.fleetAccountMember.findUnique({ where: { fleetAccountId_userId: { fleetAccountId: idParam(req), userId: v.ownerUserId } } });
  if (!member) throw conflict('The vehicle owner must be a member of this business account');
  ok(res, await prisma.vehicle.update({ where: { id: v.id }, data: { fleetAccountId: idParam(req) } }));
});

const contractInput = z.object({
  name: z.string().trim().min(2).max(120),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  discountPct: z.number().min(0).max(60).default(0),
  slaResponseMinutes: z.number().int().positive().max(600).optional(),
  monthlyServiceLimit: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
  active: z.boolean().default(true),
});

fleetAccountsRouter.post('/:id/contracts', requirePermission('membership:manage'), async (req, res) => {
  const { discountPct, ...b } = parseBody(contractInput, req);
  if (b.endsAt <= b.startsAt) throw conflict('Contract end must be after start');
  const c = await prisma.fleetContract.create({ data: { ...b, discountBps: Math.round(discountPct * 100), fleetAccountId: idParam(req) } });
  await audit(prisma, req, { action: 'fleet_contract.created', entityType: 'fleet_contract', entityId: c.id, after: c });
  created(res, c);
});

fleetAccountsRouter.patch('/:id/contracts/:contractId', requirePermission('membership:manage'), async (req, res) => {
  const { discountPct, ...b } = parseBody(contractInput.partial(), req);
  const before = await prisma.fleetContract.findFirst({ where: { id: idParam(req, 'contractId'), fleetAccountId: idParam(req) } });
  if (!before) throw notFound('Contract');
  const c = await prisma.fleetContract.update({ where: { id: before.id }, data: { ...b, ...(discountPct != null ? { discountBps: Math.round(discountPct * 100) } : {}) } });
  await audit(prisma, req, { action: 'fleet_contract.updated', entityType: 'fleet_contract', entityId: c.id, before, after: c, actorUserId: principal(req).userId });
  ok(res, c);
});
