import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery, rupeesToPaise, queryBool } from '../../lib/http.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { principal, requirePermission } from '../../middleware/auth.js';
import { computePrice } from '../../domain/pricing.js';
import { rulesFromRateCard } from '../pricing/service.js';

export const pricingRouter = Router();

const truckTypes = z.enum(['FLATBED', 'WHEEL_LIFT', 'HEAVY_DUTY', 'BIKE_CARRIER', 'SERVICE_VAN']);
const vehicleClasses = z.enum(['TWO_WHEELER', 'HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'LCV', 'HCV']);
const equipmentTypes = z.enum(['WINCH', 'DOLLIES', 'GO_JACKS', 'WHEEL_SKATES', 'WHEEL_LIFT', 'FLATBED_DECK', 'JUMP_STARTER', 'TYRE_KIT', 'FUEL_CAN', 'LOCKOUT_KIT', 'EV_SAFE_KIT', 'RECOVERY_STRAPS', 'SAFETY_CONES']);

// ─── Service categories ──────────────────────────────────────────────

const categoryInput = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z_]{3,40}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500),
  kind: z.enum(['TOWING', 'ONSITE']),
  allowedTruckTypes: z.array(truckTypes).min(1),
  requiredEquipment: z.array(equipmentTypes).default([]),
  vehicleClasses: z.array(vehicleClasses).default([]),
  defaultCrew: z.number().int().min(1).max(6).default(1),
  icon: z.string().max(40).optional(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

pricingRouter.get('/categories', requirePermission('pricing:read'), async (_req, res) => {
  ok(res, await prisma.serviceCategory.findMany({ orderBy: { sortOrder: 'asc' }, include: { zones: true } }));
});
pricingRouter.post('/categories', requirePermission('pricing:manage'), async (req, res) => {
  const b = parseBody(categoryInput, req);
  const c = await prisma.serviceCategory.create({ data: b });
  await audit(prisma, req, { action: 'service_category.created', entityType: 'service_category', entityId: c.id, after: b });
  created(res, c);
});
pricingRouter.patch('/categories/:id', requirePermission('pricing:manage'), async (req, res) => {
  const b = parseBody(categoryInput.partial().omit({ key: true }), req);
  const before = await prisma.serviceCategory.findUnique({ where: { id: idParam(req) } });
  if (!before) throw notFound('Service');
  const c = await prisma.serviceCategory.update({ where: { id: before.id }, data: b });
  await audit(prisma, req, { action: 'service_category.updated', entityType: 'service_category', entityId: c.id, before, after: b });
  ok(res, c);
});

// ─── Zones ───────────────────────────────────────────────────────────

const zoneInput = z.object({
  name: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  radiusKm: z.number().positive().max(300),
  polygon: z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(4)) }).nullable().optional(),
  active: z.boolean().default(true),
  categoryIds: z.array(z.string()).optional(),
});

pricingRouter.get('/zones', requirePermission('pricing:read'), async (_req, res) => {
  ok(res, await prisma.serviceZone.findMany({ orderBy: { name: 'asc' }, include: { categories: { include: { category: { select: { id: true, name: true } } } }, _count: { select: { trucks: true, workers: true } } } }));
});
pricingRouter.post('/zones', requirePermission('pricing:manage'), async (req, res) => {
  const { categoryIds, polygon, ...b } = parseBody(zoneInput, req);
  const z0 = await prisma.serviceZone.create({ data: { ...b, polygon: polygon ?? undefined, categories: categoryIds ? { create: categoryIds.map((categoryId) => ({ categoryId })) } : undefined } });
  await audit(prisma, req, { action: 'zone.created', entityType: 'service_zone', entityId: z0.id, after: b });
  created(res, z0);
});
pricingRouter.patch('/zones/:id', requirePermission('pricing:manage'), async (req, res) => {
  const { categoryIds, polygon, ...b } = parseBody(zoneInput.partial(), req);
  const id = idParam(req);
  const zone = await prisma.$transaction(async (tx) => {
    const z0 = await tx.serviceZone.update({ where: { id }, data: { ...b, ...(polygon !== undefined ? { polygon: polygon === null ? Prisma.DbNull : polygon } : {}) } });
    if (categoryIds) {
      await tx.serviceZoneCategory.deleteMany({ where: { zoneId: id, categoryId: { notIn: categoryIds } } });
      for (const categoryId of categoryIds) await tx.serviceZoneCategory.upsert({ where: { zoneId_categoryId: { zoneId: id, categoryId } }, create: { zoneId: id, categoryId }, update: { active: true } });
    }
    await audit(tx, req, { action: 'zone.updated', entityType: 'service_zone', entityId: id, after: { ...b, categoryIds } });
    return z0;
  });
  ok(res, zone);
});

// ─── Rate cards (versioned, immutable) ───────────────────────────────

const rateCardInput = z.object({
  name: z.string().trim().min(2).max(100),
  serviceCategoryId: z.string(),
  zoneId: z.string().nullable().optional(),
  vehicleClass: vehicleClasses.nullable().optional(),
  fleetContractId: z.string().nullable().optional(),
  baseFee: rupeesToPaise,
  includedKm: z.number().nonnegative().max(500),
  perKm: rupeesToPaise,
  pickupFreeKm: z.number().nonnegative().max(200).default(10),
  pickupPerKm: rupeesToPaise.default(0),
  includedCrew: z.number().int().min(1).max(6).default(1),
  crewChargePerWorker: rupeesToPaise.default(0),
  waitingFreeMinutes: z.number().int().min(0).max(240).default(15),
  waitingPer15Min: rupeesToPaise.default(0),
  nightSurchargePct: z.number().min(0).max(100).default(0),
  nightStartHour: z.number().int().min(0).max(23).default(22),
  nightEndHour: z.number().int().min(0).max(23).default(6),
  holidaySurchargePct: z.number().min(0).max(100).default(0),
  minimumCharge: rupeesToPaise.default(0),
  scheduledBookingFee: rupeesToPaise.default(0),
  equipmentSurcharges: z.partialRecord(equipmentTypes, rupeesToPaise).default({}),
  taxRatePct: z.number().min(0).max(28).default(18),
  tollTreatment: z.enum(['PASS_THROUGH_ACTUALS', 'INCLUDED']).default('PASS_THROUGH_ACTUALS'),
  quoteValidityMin: z.number().int().min(5).max(1440).default(30),
  cancellationAcceptedFee: rupeesToPaise.default(0),
  cancellationArrivedFee: rupeesToPaise.default(0),
  changeReason: z.string().trim().min(3).max(500),
});

function toRateCardData(b: z.infer<typeof rateCardInput>) {
  const { nightSurchargePct, holidaySurchargePct, taxRatePct, cancellationAcceptedFee, cancellationArrivedFee, ...rest } = b;
  return {
    ...rest,
    nightSurchargeBps: Math.round(nightSurchargePct * 100),
    holidaySurchargeBps: Math.round(holidaySurchargePct * 100),
    taxRateBps: Math.round(taxRatePct * 100),
    cancellationPolicy: {
      acceptedFee: cancellationAcceptedFee,
      arrivedFee: cancellationArrivedFee,
      description: cancellationAcceptedFee || cancellationArrivedFee ? `Free until a driver accepts; ₹${cancellationAcceptedFee / 100} after acceptance; ₹${cancellationArrivedFee / 100} after arrival (GST incl.)` : 'Free cancellation',
    },
  };
}

pricingRouter.get('/rate-cards', requirePermission('pricing:read'), async (req, res) => {
  const q = parseQuery(z.object({ includeHistory: queryBool.default(false), serviceCategoryId: z.string().optional() }), req);
  ok(
    res,
    await prisma.rateCard.findMany({
      where: { ...(q.includeHistory ? {} : { isActive: true }), ...(q.serviceCategoryId ? { serviceCategoryId: q.serviceCategoryId } : {}) },
      orderBy: [{ serviceCategoryId: 'asc' }, { version: 'desc' }],
      include: { serviceCategory: { select: { name: true } }, zone: { select: { name: true } }, fleetContract: { select: { name: true } } },
    }),
  );
});

pricingRouter.get('/rate-cards/:id/history', requirePermission('pricing:read'), async (req, res) => {
  const rc = await prisma.rateCard.findUnique({ where: { id: idParam(req) } });
  if (!rc) throw notFound('Rate card');
  ok(res, await prisma.rateCard.findMany({ where: { lineageId: rc.lineageId }, orderBy: { version: 'desc' } }));
});

pricingRouter.post('/rate-cards', requirePermission('pricing:manage'), async (req, res) => {
  const b = parseBody(rateCardInput, req);
  const rc = await prisma.rateCard.create({ data: { ...toRateCardData(b), lineageId: randomUUID(), version: 1, createdById: principal(req).userId } as Prisma.RateCardUncheckedCreateInput });
  await audit(prisma, req, { action: 'rate_card.created', entityType: 'rate_card', entityId: rc.id, after: rc });
  created(res, rc);
});

/** "Editing" creates a new version and deactivates the previous one. Old quotes keep their snapshot. */
pricingRouter.post('/rate-cards/:id/versions', requirePermission('pricing:manage'), async (req, res) => {
  const b = parseBody(rateCardInput, req);
  const prev = await prisma.rateCard.findUnique({ where: { id: idParam(req) } });
  if (!prev) throw notFound('Rate card');
  if (!prev.isActive) throw badRequest('Create new versions from the active version');
  const rc = await prisma.$transaction(async (tx) => {
    const latest = await tx.rateCard.findFirst({ where: { lineageId: prev.lineageId }, orderBy: { version: 'desc' } });
    await tx.rateCard.updateMany({ where: { lineageId: prev.lineageId, isActive: true }, data: { isActive: false } });
    const next = await tx.rateCard.create({ data: { ...toRateCardData(b), lineageId: prev.lineageId, version: latest!.version + 1, createdById: principal(req).userId } as Prisma.RateCardUncheckedCreateInput });
    await audit(tx, req, { action: 'rate_card.versioned', entityType: 'rate_card', entityId: next.id, before: prev, after: next });
    return next;
  });
  created(res, rc);
});

pricingRouter.post('/rate-cards/:id/deactivate', requirePermission('pricing:manage'), async (req, res) => {
  const { reason } = parseBody(z.object({ reason: z.string().min(3).max(300) }), req);
  const rc = await prisma.rateCard.update({ where: { id: idParam(req) }, data: { isActive: false } });
  await audit(prisma, req, { action: 'rate_card.deactivated', entityType: 'rate_card', entityId: rc.id, after: { reason } });
  ok(res, rc);
});

/** Price simulator for admins: see exactly what a customer would be quoted. */
pricingRouter.post('/rate-cards/:id/simulate', requirePermission('pricing:read'), async (req, res) => {
  const rc = await prisma.rateCard.findUnique({ where: { id: idParam(req) }, include: { serviceCategory: true } });
  if (!rc) throw notFound('Rate card');
  const b = parseBody(z.object({ towDistanceKm: z.number().min(0).max(1000).default(10), pickupDistanceKm: z.number().min(0).max(200).nullable().default(5), crew: z.number().int().min(1).max(6).default(1), equipment: z.array(equipmentTypes).default([]), localHour: z.number().int().min(0).max(23).default(12), isHoliday: z.boolean().default(false), scheduled: z.boolean().default(false), waitingMinutes: z.number().int().min(0).default(0) }), req);
  ok(res, computePrice(rulesFromRateCard(rc), { serviceKind: rc.serviceCategory.kind, ...b }));
});

// ─── Promo codes ─────────────────────────────────────────────────────

pricingRouter.get('/promo-codes', requirePermission('pricing:read'), async (_req, res) => ok(res, await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } })));
pricingRouter.post('/promo-codes', requirePermission('pricing:manage'), async (req, res) => {
  const b = parseBody(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/), description: z.string().max(200), discountPct: z.number().min(1).max(100), maxDiscount: rupeesToPaise, validFrom: z.coerce.date(), validTo: z.coerce.date(), maxUses: z.number().int().positive().optional() }), req);
  const { discountPct, ...rest } = b;
  const pc = await prisma.promoCode.create({ data: { ...rest, discountBps: Math.round(discountPct * 100) } });
  await audit(prisma, req, { action: 'promo.created', entityType: 'promo_code', entityId: pc.id, after: pc });
  created(res, pc);
});
pricingRouter.patch('/promo-codes/:id', requirePermission('pricing:manage'), async (req, res) => {
  const b = parseBody(z.object({ active: z.boolean() }), req);
  const pc = await prisma.promoCode.update({ where: { id: idParam(req) }, data: b });
  await audit(prisma, req, { action: 'promo.updated', entityType: 'promo_code', entityId: pc.id, after: b });
  ok(res, pc);
});

// ─── Membership plans ────────────────────────────────────────────────

const planInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,30}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(1000),
  price: rupeesToPaise,
  durationMonths: z.number().int().refine((v) => [1, 3, 6, 12].includes(v), 'Use 1, 3, 6 or 12 months'),
  includedServices: z.number().int().min(0).max(50),
  includedKmPerService: z.number().min(0).max(200).default(0),
  discountPct: z.number().min(0).max(50).default(0),
  coveredCategoryKeys: z.array(z.string()).min(1),
  exclusions: z.string().min(3).max(2000),
  renewalTerms: z.string().min(3).max(1000),
  forFleet: z.boolean().default(false),
  active: z.boolean().default(true),
});

pricingRouter.get('/memberships', requirePermission('pricing:read', 'membership:manage'), async (_req, res) => {
  ok(res, await prisma.membership.findMany({ orderBy: { price: 'asc' }, include: { _count: { select: { subscriptions: true } } } }));
});
pricingRouter.post('/memberships', requirePermission('membership:manage'), async (req, res) => {
  const { discountPct, ...b } = parseBody(planInput, req);
  const m = await prisma.membership.create({ data: { ...b, discountBps: Math.round(discountPct * 100) } });
  await audit(prisma, req, { action: 'membership.created', entityType: 'membership', entityId: m.id, after: m });
  created(res, m);
});
pricingRouter.patch('/memberships/:id', requirePermission('membership:manage'), async (req, res) => {
  // Existing subscribers keep their plan snapshot; changes apply to new subscriptions.
  const { discountPct, ...b } = parseBody(planInput.partial().omit({ code: true }), req);
  const m = await prisma.membership.update({ where: { id: idParam(req) }, data: { ...b, ...(discountPct != null ? { discountBps: Math.round(discountPct * 100) } : {}) } });
  await audit(prisma, req, { action: 'membership.updated', entityType: 'membership', entityId: m.id, after: b });
  ok(res, m);
});
pricingRouter.get('/subscriptions', requirePermission('membership:manage', 'finance:read'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ status: z.enum(['PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED']).optional() }), req);
  const where: Prisma.MembershipSubscriptionWhereInput = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([prisma.membershipSubscription.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), include: { membership: { select: { name: true } }, user: { select: { fullName: true, phone: true } }, fleetAccount: { select: { name: true } }, invoice: { select: { number: true, paymentStatus: true } } } }), prisma.membershipSubscription.count({ where })]);
  ok(res, items, pageMeta(q, total));
});
