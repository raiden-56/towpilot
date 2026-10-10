import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery, rupeesToPaise } from '../../lib/http.js';
import { conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { nextDocumentNumber } from '../../lib/numbering.js';
import { principal, requirePermission } from '../../middleware/auth.js';
import { maintenanceReminders } from '../../domain/maintenance.js';
import { toCsv, paiseToRupees } from './csv.js';

export const fleetRouter = Router();

const truckTypes = z.enum(['FLATBED', 'WHEEL_LIFT', 'HEAVY_DUTY', 'BIKE_CARRIER', 'SERVICE_VAN']);
const vehicleClasses = z.enum(['TWO_WHEELER', 'HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'LCV', 'HCV']);
const equipmentTypes = z.enum(['WINCH', 'DOLLIES', 'GO_JACKS', 'WHEEL_SKATES', 'WHEEL_LIFT', 'FLATBED_DECK', 'JUMP_STARTER', 'TYRE_KIT', 'FUEL_CAN', 'LOCKOUT_KIT', 'EV_SAFE_KIT', 'RECOVERY_STRAPS', 'SAFETY_CONES']);

const truckInput = z.object({
  registrationNumber: z.string().trim().toUpperCase().transform((v) => v.replace(/[\s-]/g, '')).pipe(z.string().min(6).max(13)),
  truckType: truckTypes,
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  maxLoadKg: z.number().int().positive().max(60000),
  maxVehicleClass: vehicleClasses,
  zoneId: z.string().nullable().optional(),
  odometerKm: z.number().int().nonnegative().optional(),
  serviceIntervalKm: z.number().int().positive().optional(),
  serviceIntervalDays: z.number().int().positive().optional(),
  lastServiceAt: z.coerce.date().nullable().optional(),
  lastServiceOdometerKm: z.number().int().nonnegative().nullable().optional(),
  insuranceExpiry: z.coerce.date().nullable().optional(),
  fitnessExpiry: z.coerce.date().nullable().optional(),
  permitExpiry: z.coerce.date().nullable().optional(),
  pucExpiry: z.coerce.date().nullable().optional(),
  nextInspectionDue: z.coerce.date().nullable().optional(),
  notes: z.string().max(1000).optional(),
  equipment: z.array(equipmentTypes).optional(),
});

async function avgKmPerDay(truckId: string) {
  const recs = await prisma.maintenanceRecord.findMany({ where: { truckId, odometerKm: { not: null } }, orderBy: { performedAt: 'asc' }, select: { odometerKm: true, performedAt: true } });
  if (recs.length < 2) return null;
  const a = recs[0]!;
  const b = recs[recs.length - 1]!;
  const days = (b.performedAt.getTime() - a.performedAt.getTime()) / 86_400_000;
  return days >= 14 ? (b.odometerKm! - a.odometerKm!) / days : null;
}

fleetRouter.get('/trucks', requirePermission('fleet:read'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ status: z.enum(['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'RETIRED']).optional(), zoneId: z.string().optional(), truckType: truckTypes.optional(), q: z.string().max(30).optional() }), req);
  const where: Prisma.TowTruckWhereInput = { ...(q.status ? { status: q.status } : { status: { not: 'RETIRED' } }), ...(q.zoneId ? { zoneId: q.zoneId } : {}), ...(q.truckType ? { truckType: q.truckType } : {}), ...(q.q ? { registrationNumber: { contains: q.q.toUpperCase() } } : {}) };
  const [items, total] = await Promise.all([
    prisma.towTruck.findMany({ where, orderBy: { registrationNumber: 'asc' }, include: { zone: { select: { name: true } }, assignedDriver: { select: { id: true, fullName: true } }, equipment: true }, ...pageArgs(q) }),
    prisma.towTruck.count({ where }),
  ]);
  ok(res, items.map((t) => ({ ...t, reminders: maintenanceReminders(t) })), pageMeta(q, total));
});

fleetRouter.post('/trucks', requirePermission('fleet:manage'), async (req, res) => {
  const { equipment, ...b } = parseBody(truckInput, req);
  const t = await prisma.towTruck.create({ data: { ...b, equipment: equipment ? { create: equipment.map((type) => ({ type })) } : undefined } });
  await audit(prisma, req, { action: 'truck.created', entityType: 'tow_truck', entityId: t.id, after: b });
  created(res, t);
});

fleetRouter.get('/trucks/:id', requirePermission('fleet:read'), async (req, res) => {
  const t = await prisma.towTruck.findUnique({
    where: { id: idParam(req) },
    include: { zone: true, assignedDriver: { select: { id: true, fullName: true, phone: true } }, equipment: true, maintenance: { orderBy: { performedAt: 'desc' }, take: 50 }, expenses: { orderBy: { expenseDate: 'desc' }, take: 50 } },
  });
  if (!t) throw notFound('Truck');
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [jobs30, fuel, repairs] = await Promise.all([
    prisma.bookingAssignment.count({ where: { truckId: t.id, status: 'COMPLETED', offeredAt: { gte: since } } }),
    prisma.expense.aggregate({ where: { truckId: t.id, category: 'FUEL', status: { in: ['APPROVED', 'PAID'] } }, _sum: { amount: true, fuelLitres: true } }),
    prisma.expense.aggregate({ where: { truckId: t.id, category: { in: ['MAINTENANCE', 'REPAIR'] }, status: { in: ['APPROVED', 'PAID'] } }, _sum: { amount: true } }),
  ]);
  ok(res, {
    ...t,
    reminders: maintenanceReminders({ ...t, avgKmPerDay: await avgKmPerDay(t.id) }),
    remindersBasis: 'Rule-based: configured service intervals, document expiry dates and a linear projection of recorded odometer readings. Not a predictive model.',
    utilisation: { completedJobsLast30Days: jobs30 },
    costs: { fuel: fuel._sum.amount ?? 0, fuelLitres: fuel._sum.fuelLitres ?? 0, maintenanceAndRepairs: repairs._sum.amount ?? 0 },
    breakdowns: t.maintenance.filter((m) => m.type === 'BREAKDOWN').length,
  });
});

fleetRouter.patch('/trucks/:id', requirePermission('fleet:manage'), async (req, res) => {
  const { equipment, ...b } = parseBody(truckInput.partial().extend({ status: z.enum(['AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'RETIRED']).optional() }), req);
  const before = await prisma.towTruck.findUnique({ where: { id: idParam(req) } });
  if (!before) throw notFound('Truck');
  if (b.status && before.status === 'IN_USE') throw conflict('Truck is on a job. Change status after the job ends.');
  const t = await prisma.$transaction(async (tx) => {
    const t = await tx.towTruck.update({ where: { id: before.id }, data: b });
    if (equipment) {
      await tx.truckEquipment.deleteMany({ where: { truckId: t.id, type: { notIn: equipment } } });
      for (const type of equipment) await tx.truckEquipment.upsert({ where: { truckId_type: { truckId: t.id, type } }, create: { truckId: t.id, type }, update: {} });
    }
    await audit(tx, req, { action: 'truck.updated', entityType: 'tow_truck', entityId: t.id, before, after: b });
    return t;
  });
  ok(res, t);
});

fleetRouter.patch('/trucks/:id/equipment/:type', requirePermission('fleet:manage'), async (req, res) => {
  const type = equipmentTypes.parse(req.params.type);
  const b = parseBody(z.object({ status: z.enum(['OK', 'DAMAGED', 'MISSING']), notes: z.string().max(300).optional() }), req);
  const e = await prisma.truckEquipment.upsert({ where: { truckId_type: { truckId: idParam(req), type } }, create: { truckId: idParam(req), type, ...b }, update: b });
  await audit(prisma, req, { action: 'truck.equipment', entityType: 'tow_truck', entityId: idParam(req), after: { type, ...b } });
  ok(res, e);
});

/** Maintenance/inspection/breakdown record; optionally books the cost as an expense. */
fleetRouter.post('/trucks/:id/maintenance', requirePermission('fleet:manage'), async (req, res) => {
  const p = principal(req);
  const b = parseBody(
    z.object({ type: z.enum(['SERVICE', 'REPAIR', 'INSPECTION', 'BREAKDOWN']), description: z.string().trim().min(3).max(1000), odometerKm: z.number().int().nonnegative().optional(), cost: rupeesToPaise.default(0), performedAt: z.coerce.date(), nextDueAt: z.coerce.date().optional(), vendorName: z.string().max(100).optional(), setStatus: z.enum(['AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE']).optional() }),
    req,
  );
  const truck = await prisma.towTruck.findUnique({ where: { id: idParam(req) } });
  if (!truck) throw notFound('Truck');
  const rec = await prisma.$transaction(async (tx) => {
    let expenseId: string | undefined;
    if (b.cost > 0) {
      const e = await tx.expense.create({
        data: { number: await nextDocumentNumber(tx, 'EXP'), category: b.type === 'INSPECTION' ? 'MAINTENANCE' : b.type === 'SERVICE' ? 'MAINTENANCE' : 'REPAIR', source: b.vendorName ? 'VENDOR_BILL' : 'DIRECT', status: 'APPROVED', description: `${truck.registrationNumber}: ${b.description}`, vendorName: b.vendorName, amount: b.cost, expenseDate: b.performedAt, odometerKm: b.odometerKm, truckId: truck.id, zoneId: truck.zoneId, submittedById: p.userId, approvedById: p.userId, approvedAt: new Date() },
      });
      expenseId = e.id;
    }
    const r = await tx.maintenanceRecord.create({ data: { truckId: truck.id, type: b.type, description: b.description, odometerKm: b.odometerKm, cost: b.cost, performedAt: b.performedAt, nextDueAt: b.nextDueAt, expenseId, createdById: p.userId } });
    const upd: Prisma.TowTruckUpdateInput = {};
    if (b.type === 'SERVICE') Object.assign(upd, { lastServiceAt: b.performedAt, lastServiceOdometerKm: b.odometerKm ?? truck.odometerKm });
    if (b.type === 'INSPECTION' && b.nextDueAt) upd.nextInspectionDue = b.nextDueAt;
    if (b.odometerKm && b.odometerKm > truck.odometerKm) upd.odometerKm = b.odometerKm;
    if (b.setStatus && truck.status !== 'IN_USE') upd.status = b.setStatus;
    await tx.towTruck.update({ where: { id: truck.id }, data: upd });
    await audit(tx, req, { action: 'truck.maintenance', entityType: 'tow_truck', entityId: truck.id, after: b });
    return r;
  });
  created(res, rec);
});

fleetRouter.get('/reminders', requirePermission('fleet:read'), async (_req, res) => {
  const trucks = await prisma.towTruck.findMany({ where: { status: { not: 'RETIRED' } }, select: { id: true, registrationNumber: true, truckType: true, status: true, odometerKm: true, lastServiceAt: true, lastServiceOdometerKm: true, serviceIntervalKm: true, serviceIntervalDays: true, insuranceExpiry: true, fitnessExpiry: true, permitExpiry: true, pucExpiry: true, nextInspectionDue: true } });
  const out = [];
  for (const t of trucks) {
    const r = maintenanceReminders({ ...t, avgKmPerDay: await avgKmPerDay(t.id) });
    if (r.length) out.push({ truck: { id: t.id, registrationNumber: t.registrationNumber, truckType: t.truckType, status: t.status }, reminders: r });
  }
  ok(res, { items: out, basis: 'RULE_BASED' });
});

fleetRouter.get('/trucks.csv', requirePermission('fleet:read'), async (_req, res) => {
  const trucks = await prisma.towTruck.findMany({ include: { zone: true, assignedDriver: true } });
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', 'attachment; filename="fleet.csv"');
  res.send(
    toCsv(
      trucks.map((t) => ({
        registration: t.registrationNumber,
        type: t.truckType,
        status: t.status,
        zone: t.zone?.name,
        driver: t.assignedDriver?.fullName,
        odometerKm: t.odometerKm,
        insuranceExpiry: t.insuranceExpiry?.toISOString().slice(0, 10),
        fitnessExpiry: t.fitnessExpiry?.toISOString().slice(0, 10),
        lastService: t.lastServiceAt?.toISOString().slice(0, 10),
        sample: t.isSample,
      })),
    ),
  );
});

export { paiseToRupees };
