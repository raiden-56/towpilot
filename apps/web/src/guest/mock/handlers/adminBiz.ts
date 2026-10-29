/**
 * Guest-mode handlers for the admin commercial screens: services & zones, rate cards, promo codes
 * and membership plans (apps/api/src/modules/admin/pricing.ts). Finance and reports live in
 * adminBizFinance.ts and adminBizReports.ts.
 */
import type { PlanRow, PromoRow, RateCardRow, ServiceCategoryRow, SubscriptionRow, ZoneRow } from '@/pages/admin/biz/types';
import type { VehicleClass } from '@/api/types';
import type { GCategory, GZone, TruckType } from '../model';
import { DAY, db, nowIso } from '../db';
import { computePrice, rateCards, type RateCardRules } from '../pricing';
import { fail, notFound, num, on, paged, str, type Ctx } from '../router';
import { bool, paise } from './adminBizUtil';
import './adminBizFinance';
import './adminBizReports';

// ─── Service categories ──────────────────────────────────────────────

function categoryRow(c: GCategory): ServiceCategoryRow {
  return {
    id: c.id,
    key: c.key,
    name: c.name,
    description: c.description,
    kind: c.kind,
    allowedTruckTypes: c.allowedTruckTypes,
    requiredEquipment: c.requiredEquipment,
    vehicleClasses: c.vehicleClasses,
    defaultCrew: c.defaultCrew,
    icon: c.icon || null,
    sortOrder: c.sortOrder,
    active: c.active,
    zones: db.zones.filter((z) => z.categoryKeys.includes(c.key)).map((z) => ({ zoneId: z.id, categoryId: c.id, active: true })),
  };
}

function applyCategory(c: GCategory, b: Record<string, unknown>) {
  if (b.name !== undefined) c.name = String(b.name);
  if (b.description !== undefined) c.description = String(b.description);
  if (b.kind === 'TOWING' || b.kind === 'ONSITE') c.kind = b.kind;
  if (Array.isArray(b.allowedTruckTypes)) c.allowedTruckTypes = b.allowedTruckTypes as TruckType[];
  if (Array.isArray(b.requiredEquipment)) c.requiredEquipment = b.requiredEquipment as string[];
  if (Array.isArray(b.vehicleClasses)) c.vehicleClasses = b.vehicleClasses as VehicleClass[];
  if (b.defaultCrew !== undefined) c.defaultCrew = Number(b.defaultCrew) || 1;
  if (b.icon !== undefined) c.icon = String(b.icon ?? '');
  if (b.sortOrder !== undefined) c.sortOrder = Number(b.sortOrder) || 0;
  if (b.active !== undefined) c.active = !!b.active;
}

on('GET', '/admin/pricing/categories', () => [...db.categories].sort((a, b) => a.sortOrder - b.sortOrder).map(categoryRow));
on('POST', '/admin/pricing/categories', (c) => {
  const key = String(c.body.key ?? '').trim().toUpperCase();
  if (!/^[A-Z_]{3,40}$/.test(key)) fail(400, 'VALIDATION_ERROR', 'Key must be 3–40 capital letters or underscores', [{ path: 'key', message: 'Use A–Z and _' }]);
  if (db.categories.some((x) => x.key === key)) fail(409, 'CONFLICT', 'A service with this key already exists');
  const cat: GCategory = { id: `cat_${key.toLowerCase()}`, key, name: '', description: '', kind: 'TOWING', allowedTruckTypes: ['FLATBED'], requiredEquipment: [], vehicleClasses: [], defaultCrew: 1, icon: '', sortOrder: db.categories.length + 1, active: true };
  applyCategory(cat, c.body);
  db.categories.push(cat);
  return categoryRow(cat);
});
on('PATCH', '/admin/pricing/categories/:id', (c) => {
  const cat = db.categories.find((x) => x.id === c.params.id) ?? notFound('Service');
  applyCategory(cat, c.body);
  return categoryRow(cat);
});

// ─── Zones ───────────────────────────────────────────────────────────

/** GeoJSON polygons set from the zone dialog (the shared zone model keeps polygon null). */
const polygons = new Map<string, ZoneRow['polygon']>();

export function zoneRow(z: GZone): ZoneRow {
  return {
    id: z.id,
    name: z.name,
    city: z.city,
    centerLat: z.centerLat,
    centerLng: z.centerLng,
    radiusKm: z.radiusKm,
    polygon: polygons.get(z.id) ?? null,
    active: z.active,
    categories: db.categories.filter((c) => z.categoryKeys.includes(c.key)).map((c) => ({ zoneId: z.id, categoryId: c.id, active: true, category: { id: c.id, name: c.name } })),
    _count: { trucks: db.trucks.filter((t) => t.zoneId === z.id).length, workers: db.users.filter((u) => u.workerProfile?.zoneIds.includes(z.id) && (u.roles.includes('driver') || u.roles.includes('worker'))).length },
  };
}

function applyZone(z: GZone, b: Record<string, unknown>) {
  if (b.name !== undefined) z.name = String(b.name);
  if (b.city !== undefined) z.city = String(b.city);
  if (b.centerLat !== undefined) z.centerLat = Number(b.centerLat);
  if (b.centerLng !== undefined) z.centerLng = Number(b.centerLng);
  if (b.radiusKm !== undefined) z.radiusKm = Number(b.radiusKm);
  if (b.active !== undefined) z.active = !!b.active;
  if (b.polygon !== undefined) polygons.set(z.id, (b.polygon as ZoneRow['polygon']) ?? null);
  if (Array.isArray(b.categoryIds)) z.categoryKeys = db.categories.filter((c) => (b.categoryIds as string[]).includes(c.id)).map((c) => c.key);
  z.updatedAt = nowIso();
}

on('GET', '/admin/pricing/zones', () => [...db.zones].sort((a, b) => a.name.localeCompare(b.name)).map(zoneRow));
on('POST', '/admin/pricing/zones', (c) => {
  const z: GZone = { id: `zn_${String(c.body.name ?? 'zone').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}_${db.zones.length + 1}`, name: '', city: 'Bengaluru', centerLat: 12.97, centerLng: 77.59, radiusKm: 10, polygon: null, active: true, categoryKeys: [], createdAt: nowIso(), updatedAt: nowIso() };
  applyZone(z, c.body);
  db.zones.push(z);
  return zoneRow(z);
});
on('PATCH', '/admin/pricing/zones/:id', (c) => {
  const z = db.zones.find((x) => x.id === c.params.id) ?? notFound('Zone');
  applyZone(z, c.body);
  return zoneRow(z);
});

// ─── Rate cards (versioned) ──────────────────────────────────────────

interface CardMeta {
  isActive: boolean;
  vehicleClass: VehicleClass | null;
  fleetContractId: string | null;
  effectiveFrom: string;
  changeReason: string | null;
  createdAt: string;
}
/** Every version ever published (the shared `rateCards` array holds what quotes use). */
const allCards: RateCardRules[] = [...rateCards];
const meta = new Map<string, CardMeta>();
for (const rc of rateCards) meta.set(rc.id, { isActive: true, vehicleClass: null, fleetContractId: null, effectiveFrom: new Date(Date.now() - 180 * DAY).toISOString(), changeReason: 'Initial standard rate card', createdAt: new Date(Date.now() - 180 * DAY).toISOString() });

const categoryForKey = (key: string) => db.categories.find((c) => c.key === key);

function cardRow(rc: RateCardRules): RateCardRow {
  const m = meta.get(rc.id)!;
  const cat = categoryForKey(rc.serviceKey);
  const zone = rc.zoneId ? db.zones.find((z) => z.id === rc.zoneId) : null;
  const contract = m.fleetContractId ? db.fleetAccounts.flatMap((f) => f.contracts).find((x) => x.id === m.fleetContractId) : null;
  return {
    id: rc.id,
    lineageId: rc.lineageId,
    version: rc.version,
    isActive: m.isActive,
    name: rc.name,
    serviceCategoryId: cat?.id ?? `cat_${rc.serviceKey.toLowerCase()}`,
    zoneId: rc.zoneId,
    vehicleClass: m.vehicleClass,
    fleetContractId: m.fleetContractId,
    baseFee: rc.baseFee,
    includedKm: rc.includedKm,
    perKm: rc.perKm,
    pickupFreeKm: rc.pickupFreeKm,
    pickupPerKm: rc.pickupPerKm,
    includedCrew: rc.includedCrew,
    crewChargePerWorker: rc.crewChargePerWorker,
    waitingFreeMinutes: rc.waitingFreeMinutes,
    waitingPer15Min: rc.waitingPer15Min,
    nightSurchargeBps: rc.nightSurchargeBps,
    nightStartHour: rc.nightStartHour,
    nightEndHour: rc.nightEndHour,
    holidaySurchargeBps: rc.holidaySurchargeBps,
    minimumCharge: rc.minimumCharge,
    scheduledBookingFee: rc.scheduledBookingFee,
    equipmentSurcharges: rc.equipmentSurcharges,
    taxRateBps: rc.taxRateBps,
    tollTreatment: rc.tollTreatment === 'INCLUDED' ? 'INCLUDED' : 'PASS_THROUGH_ACTUALS',
    quoteValidityMin: rc.quoteValidityMin,
    cancellationPolicy: rc.cancellationPolicy,
    effectiveFrom: m.effectiveFrom,
    changeReason: m.changeReason,
    createdAt: m.createdAt,
    serviceCategory: { name: cat?.name ?? rc.serviceKey },
    zone: zone ? { name: zone.name } : null,
    fleetContract: contract ? { name: contract.name } : null,
  };
}

/** Body of the rate-card dialog (rupees / percentages) → engine rules (paise / bps). */
function rulesFromBody(b: Record<string, unknown>, ids: { id: string; lineageId: string; version: number }): RateCardRules {
  const cat = db.categories.find((c) => c.id === b.serviceCategoryId) ?? fail(400, 'VALIDATION_ERROR', 'Choose a service', [{ path: 'serviceCategoryId', message: 'Required' }]);
  const name = String(b.name ?? '').trim();
  if (name.length < 2) fail(400, 'VALIDATION_ERROR', 'Name is required', [{ path: 'name', message: 'Required' }]);
  if (String(b.changeReason ?? '').trim().length < 3) fail(400, 'VALIDATION_ERROR', 'Give a reason for this change', [{ path: 'changeReason', message: 'At least 3 characters' }]);
  const accepted = paise(b.cancellationAcceptedFee);
  const arrived = paise(b.cancellationArrivedFee);
  const eq = (b.equipmentSurcharges ?? {}) as Record<string, number>;
  return {
    ...ids,
    name,
    serviceKey: cat.key,
    zoneId: str(b.zoneId) ?? null,
    baseFee: paise(b.baseFee),
    includedKm: Number(b.includedKm) || 0,
    perKm: paise(b.perKm),
    pickupFreeKm: num(b.pickupFreeKm) ?? 10,
    pickupPerKm: paise(b.pickupPerKm),
    includedCrew: num(b.includedCrew) ?? 1,
    crewChargePerWorker: paise(b.crewChargePerWorker),
    waitingFreeMinutes: num(b.waitingFreeMinutes) ?? 15,
    waitingPer15Min: paise(b.waitingPer15Min),
    nightSurchargeBps: Math.round((Number(b.nightSurchargePct) || 0) * 100),
    nightStartHour: num(b.nightStartHour) ?? 22,
    nightEndHour: num(b.nightEndHour) ?? 6,
    holidaySurchargeBps: Math.round((Number(b.holidaySurchargePct) || 0) * 100),
    minimumCharge: paise(b.minimumCharge),
    scheduledBookingFee: paise(b.scheduledBookingFee),
    equipmentSurcharges: Object.fromEntries(Object.entries(eq).map(([k, v]) => [k, paise(v)])),
    taxRateBps: Math.round((num(b.taxRatePct) ?? 18) * 100),
    tollTreatment: b.tollTreatment === 'INCLUDED' ? 'INCLUDED' : 'PASS_THROUGH_ACTUALS',
    quoteValidityMin: num(b.quoteValidityMin) ?? 30,
    cancellationPolicy: { acceptedFee: accepted, arrivedFee: arrived, description: accepted || arrived ? `Free until a driver accepts; ₹${accepted / 100} after acceptance; ₹${arrived / 100} after arrival (GST incl.)` : 'Free cancellation' },
  };
}

function metaFromBody(b: Record<string, unknown>): CardMeta {
  const now = nowIso();
  return { isActive: true, vehicleClass: (str(b.vehicleClass) as VehicleClass | undefined) ?? null, fleetContractId: str(b.fleetContractId) ?? null, effectiveFrom: now, changeReason: String(b.changeReason ?? '').trim(), createdAt: now };
}

const cardById = (id: string) => allCards.find((r) => r.id === id) ?? notFound('Rate card');

on('GET', '/admin/pricing/rate-cards', (c) => {
  const history = bool(c.query.includeHistory);
  const catId = str(c.query.serviceCategoryId);
  return allCards
    .map(cardRow)
    .filter((r) => (history || r.isActive) && (!catId || r.serviceCategoryId === catId))
    .sort((a, b) => a.serviceCategoryId.localeCompare(b.serviceCategoryId) || b.version - a.version);
});

on('GET', '/admin/pricing/rate-cards/:id/history', (c) => {
  const rc = cardById(c.params.id);
  return allCards.filter((r) => r.lineageId === rc.lineageId).sort((a, b) => b.version - a.version).map(cardRow);
});

on('POST', '/admin/pricing/rate-cards', (c) => {
  const n = allCards.length + 1;
  const rc = rulesFromBody(c.body, { id: `rc_guest_${n}_v1`, lineageId: `rcl_guest_${n}`, version: 1 });
  meta.set(rc.id, metaFromBody(c.body));
  allCards.push(rc);
  rateCards.push(rc);
  return cardRow(rc);
});

on('POST', '/admin/pricing/rate-cards/:id/versions', (c) => {
  const prev = cardById(c.params.id);
  if (!meta.get(prev.id)!.isActive) fail(400, 'BAD_REQUEST', 'Create new versions from the active version');
  const latest = Math.max(...allCards.filter((r) => r.lineageId === prev.lineageId).map((r) => r.version));
  const next = rulesFromBody(c.body, { id: `${prev.lineageId}_v${latest + 1}`, lineageId: prev.lineageId, version: latest + 1 });
  for (const r of allCards) if (r.lineageId === prev.lineageId) meta.get(r.id)!.isActive = false;
  meta.set(next.id, metaFromBody(c.body));
  allCards.push(next);
  // New quotes use the new version; existing quotes keep their frozen snapshot.
  const i = rateCards.findIndex((r) => r.lineageId === prev.lineageId);
  if (i >= 0) rateCards[i] = next;
  else rateCards.push(next);
  return cardRow(next);
});

on('POST', '/admin/pricing/rate-cards/:id/deactivate', (c) => {
  const rc = cardById(c.params.id);
  if (String(c.body.reason ?? '').trim().length < 3) fail(400, 'VALIDATION_ERROR', 'Give a reason', [{ path: 'reason', message: 'At least 3 characters' }]);
  const m = meta.get(rc.id)!;
  m.isActive = false;
  m.changeReason = `Deactivated: ${String(c.body.reason)}`;
  return cardRow(rc);
});

on('POST', '/admin/pricing/rate-cards/:id/simulate', (c: Ctx) => {
  const rc = cardById(c.params.id);
  const cat = categoryForKey(rc.serviceKey);
  const b = c.body;
  return computePrice(rc, {
    serviceKind: cat?.kind ?? 'TOWING',
    towDistanceKm: num(b.towDistanceKm) ?? 10,
    pickupDistanceKm: b.pickupDistanceKm === null ? null : (num(b.pickupDistanceKm) ?? 5),
    crew: num(b.crew) ?? 1,
    equipment: Array.isArray(b.equipment) ? (b.equipment as string[]) : [],
    localHour: num(b.localHour) ?? 12,
    isHoliday: !!b.isHoliday,
    scheduled: !!b.scheduled,
    waitingMinutes: num(b.waitingMinutes) ?? 0,
  });
});

// ─── Promo codes ─────────────────────────────────────────────────────

on('GET', '/admin/pricing/promo-codes', () => [...db.promos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) satisfies PromoRow[]);
on('POST', '/admin/pricing/promo-codes', (c) => {
  const code = String(c.body.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(code)) fail(400, 'VALIDATION_ERROR', 'Code must be 4–20 letters or digits', [{ path: 'code', message: '4–20 letters or digits' }]);
  if (db.promos.some((p) => p.code === code)) fail(409, 'CONFLICT', 'This promo code already exists');
  const p: PromoRow = { id: `promo_${code.toLowerCase()}`, code, description: String(c.body.description ?? ''), discountBps: Math.round((Number(c.body.discountPct) || 0) * 100), maxDiscount: paise(c.body.maxDiscount), validFrom: new Date(String(c.body.validFrom ?? nowIso())).toISOString(), validTo: new Date(String(c.body.validTo ?? nowIso())).toISOString(), maxUses: num(c.body.maxUses) ?? null, usedCount: 0, active: true, createdAt: nowIso() };
  db.promos.push(p);
  return p;
});
on('PATCH', '/admin/pricing/promo-codes/:id', (c) => {
  const p = db.promos.find((x) => x.id === c.params.id) ?? notFound('Promo code');
  if (c.body.active !== undefined) p.active = !!c.body.active;
  return p;
});

// ─── Membership plans & subscriptions ────────────────────────────────

const planRow = (m: (typeof db.memberships)[number]): PlanRow => ({ ...m, _count: { subscriptions: db.subscriptions.filter((s) => s.membershipId === m.id).length } });

function applyPlan(m: (typeof db.memberships)[number], b: Record<string, unknown>) {
  if (b.name !== undefined) m.name = String(b.name);
  if (b.description !== undefined) m.description = String(b.description);
  if (b.price !== undefined) m.price = paise(b.price);
  if (b.durationMonths !== undefined) m.durationMonths = Number(b.durationMonths) || 12;
  if (b.includedServices !== undefined) m.includedServices = Number(b.includedServices) || 0;
  if (b.includedKmPerService !== undefined) m.includedKmPerService = Number(b.includedKmPerService) || 0;
  if (b.discountPct !== undefined) m.discountBps = Math.round((Number(b.discountPct) || 0) * 100);
  if (Array.isArray(b.coveredCategoryKeys)) m.coveredCategoryKeys = b.coveredCategoryKeys as string[];
  if (b.exclusions !== undefined) m.exclusions = String(b.exclusions);
  if (b.renewalTerms !== undefined) m.renewalTerms = String(b.renewalTerms);
  if (b.forFleet !== undefined) m.forFleet = !!b.forFleet;
  if (b.active !== undefined) m.active = !!b.active;
  m.updatedAt = nowIso();
}

on('GET', '/admin/pricing/memberships', () => [...db.memberships].sort((a, b) => a.price - b.price).map(planRow));
on('POST', '/admin/pricing/memberships', (c) => {
  const code = String(c.body.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{3,30}$/.test(code)) fail(400, 'VALIDATION_ERROR', 'Code must be 3–30 letters, digits or _', [{ path: 'code', message: 'Use A–Z, 0–9 and _' }]);
  if (db.memberships.some((m) => m.code === code)) fail(409, 'CONFLICT', 'A plan with this code already exists');
  const m = { id: `mem_${code.toLowerCase()}`, code, name: '', description: '', price: 0, durationMonths: 12, includedServices: 0, includedKmPerService: 0, discountBps: 0, coveredCategoryKeys: [] as string[], exclusions: '', renewalTerms: '', forFleet: false, active: true, createdAt: nowIso(), updatedAt: nowIso() };
  applyPlan(m, c.body);
  db.memberships.push(m);
  return planRow(m);
});
on('PATCH', '/admin/pricing/memberships/:id', (c) => {
  const m = db.memberships.find((x) => x.id === c.params.id) ?? notFound('Membership');
  applyPlan(m, c.body);
  return planRow(m);
});

on('GET', '/admin/pricing/subscriptions', (c) => {
  const status = str(c.query.status);
  const rows: SubscriptionRow[] = db.subscriptions
    .filter((s) => !status || s.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => {
      const m = db.memberships.find((x) => x.id === s.membershipId);
      const u = s.userId ? db.users.find((x) => x.id === s.userId) : undefined;
      const f = s.fleetAccountId ? db.fleetAccounts.find((x) => x.id === s.fleetAccountId) : undefined;
      const inv = db.invoices.find((i) => i.subscriptionId === s.id);
      return {
        id: s.id,
        membershipId: s.membershipId,
        status: s.status,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        servicesUsed: s.servicesUsed,
        planSnapshot: m ? { includedServices: m.includedServices, name: m.name, price: m.price } : null,
        cancelledAt: s.cancelledAt,
        createdAt: s.createdAt,
        membership: { name: m?.name ?? 'Plan' },
        user: u ? { fullName: u.fullName, phone: u.phone } : null,
        fleetAccount: f ? { name: f.name } : null,
        invoice: inv ? { number: inv.number, paymentStatus: inv.paymentStatus } : null,
      };
    });
  return paged(rows, c.query);
});
