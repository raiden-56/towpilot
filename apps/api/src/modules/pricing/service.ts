import type { Booking, Prisma, RateCard, ServiceCategory, VehicleClass } from '@prisma/client';
import type { Db, Tx } from '../../lib/prisma.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import { localParts } from '../../lib/time.js';
import { computePrice, type CancellationPolicy, type PriceBreakdown, type QuoteDiscounts, type RateCardRules } from '../../domain/pricing.js';
import type { Recommendation } from '../../domain/recommendation.js';

export function rulesFromRateCard(rc: RateCard): RateCardRules {
  return {
    id: rc.id,
    lineageId: rc.lineageId,
    version: rc.version,
    name: rc.name,
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
    equipmentSurcharges: (rc.equipmentSurcharges ?? {}) as Record<string, number>,
    taxRateBps: rc.taxRateBps,
    tollTreatment: rc.tollTreatment,
    quoteValidityMin: rc.quoteValidityMin,
    cancellationPolicy: rc.cancellationPolicy as unknown as CancellationPolicy,
  };
}

/**
 * Most specific active rate card wins:
 *   contract > (zone + vehicle class) > zone > vehicle class > default.
 */
export async function selectRateCard(db: Db, p: { serviceCategoryId: string; zoneId: string | null; vehicleClass: VehicleClass | null; fleetContractId?: string | null }) {
  const cards = await db.rateCard.findMany({ where: { serviceCategoryId: p.serviceCategoryId, isActive: true } });
  const score = (c: RateCard) => {
    if (c.fleetContractId && c.fleetContractId !== p.fleetContractId) return -1;
    if (c.zoneId && c.zoneId !== p.zoneId) return -1;
    if (c.vehicleClass && c.vehicleClass !== p.vehicleClass) return -1;
    return (c.fleetContractId ? 8 : 0) + (c.zoneId ? 4 : 0) + (c.vehicleClass ? 2 : 0);
  };
  const best = cards.map((c) => ({ c, s: score(c) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0];
  if (!best) throw unprocessable('Pricing is not configured for this service in your area. Please call support.');
  return best.c;
}

/** Resolve discounts the customer is entitled to: membership, fleet contract and promo code. */
export async function resolveDiscounts(
  db: Db,
  p: { customerUserId: string; fleetAccountId: string | null; categoryKey: string; promoCode?: string | null; useMembership: boolean; now: Date },
): Promise<{ discounts: QuoteDiscounts; subscriptionId: string | null; contractId: string | null; notes: string[] }> {
  const notes: string[] = [];
  const discounts: QuoteDiscounts = {};
  let subscriptionId: string | null = null;
  let contractId: string | null = null;

  if (p.useMembership) {
    const sub = await db.membershipSubscription.findFirst({
      where: {
        status: 'ACTIVE',
        endsAt: { gt: p.now },
        OR: [{ userId: p.customerUserId }, ...(p.fleetAccountId ? [{ fleetAccountId: p.fleetAccountId }] : [])],
      },
      include: { membership: true },
      orderBy: { endsAt: 'desc' },
    });
    if (sub) {
      const plan = sub.planSnapshot as { name: string; includedServices: number; includedKmPerService: number; discountBps: number; coveredCategoryKeys: string[] };
      if (plan.coveredCategoryKeys.includes(p.categoryKey)) {
        const remaining = plan.includedServices - sub.servicesUsed;
        discounts.membership = { label: plan.name, waiveBaseFee: remaining > 0, extraFreeKm: remaining > 0 ? plan.includedKmPerService : 0, discountBps: plan.discountBps };
        subscriptionId = sub.id;
        notes.push(remaining > 0 ? `${plan.name}: ${remaining} covered service(s) remaining this term.` : `${plan.name}: covered services used up — member discount still applies.`);
      } else notes.push(`${plan.name} does not cover this service.`);
    }
  }

  if (p.fleetAccountId) {
    const c = await db.fleetContract.findFirst({ where: { fleetAccountId: p.fleetAccountId, active: true, startsAt: { lte: p.now }, endsAt: { gt: p.now } } });
    if (c) {
      contractId = c.id;
      if (c.discountBps > 0) discounts.contract = { label: `Contract ${c.name}`, discountBps: c.discountBps };
    }
  }

  if (p.promoCode) {
    const promo = await db.promoCode.findUnique({ where: { code: p.promoCode.toUpperCase() } });
    const valid = promo && promo.active && promo.validFrom <= p.now && promo.validTo > p.now && (promo.maxUses == null || promo.usedCount < promo.maxUses);
    if (valid) discounts.promo = { code: promo.code, discountBps: promo.discountBps, maxDiscount: promo.maxDiscount };
    else notes.push(`Promo code ${p.promoCode.toUpperCase()} is not valid.`);
  }
  return { discounts, subscriptionId, contractId, notes };
}

export interface PriceContext {
  booking: Pick<Booking, 'id' | 'customerUserId' | 'fleetAccountId' | 'zoneId' | 'type' | 'scheduledFor' | 'towDistanceKm' | 'pickupDistanceKm' | 'crewRequested' | 'crewRecommended' | 'promoCode' | 'waitingMinutes'>;
  category: Pick<ServiceCategory, 'id' | 'key' | 'kind'>;
  vehicleClass: VehicleClass;
  recommendation: Recommendation | null;
  useMembership: boolean;
}

export async function priceBooking(db: Db, ctx: PriceContext, extra: { final?: boolean; tolls?: number; parking?: number; extras?: { code: string; description: string; amount: number; reason: string }[]; rateCard?: RateCard } = {}) {
  const s = await getSettings();
  const now = new Date();
  const when = ctx.booking.scheduledFor ?? now;
  const local = localParts(when, s.locale.timezone);
  const localDate = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;

  const disc = await resolveDiscounts(db, {
    customerUserId: ctx.booking.customerUserId,
    fleetAccountId: ctx.booking.fleetAccountId,
    categoryKey: ctx.category.key,
    promoCode: ctx.booking.promoCode,
    useMembership: ctx.useMembership,
    now,
  });
  const rc = extra.rateCard ?? (await selectRateCard(db, { serviceCategoryId: ctx.category.id, zoneId: ctx.booking.zoneId, vehicleClass: ctx.vehicleClass, fleetContractId: disc.contractId }));
  const rules = rulesFromRateCard(rc);
  const crew = Math.max(ctx.booking.crewRequested, ctx.booking.crewRecommended);

  const input = {
    serviceKind: ctx.category.kind,
    towDistanceKm: ctx.booking.towDistanceKm ?? 0,
    pickupDistanceKm: ctx.booking.pickupDistanceKm,
    crew,
    equipment: ctx.recommendation?.equipment ?? [],
    waitingMinutes: extra.final ? ctx.booking.waitingMinutes : 0,
    localHour: local.hour,
    isHoliday: s.pricing.holidays.includes(localDate),
    scheduled: ctx.booking.type === 'SCHEDULED',
    tolls: extra.tolls,
    parking: extra.parking,
    discounts: disc.discounts,
    extras: extra.extras,
    final: extra.final,
  } as const;
  const breakdown = computePrice(rules, { ...input, equipment: [...input.equipment], extras: input.extras ? [...input.extras] : undefined });
  return { rateCard: rc, rules, input, breakdown, subscriptionId: disc.subscriptionId, notes: [...disc.notes, ...breakdown.notes] };
}

export function quoteItemsData(b: PriceBreakdown): Prisma.BookingQuoteItemCreateWithoutQuoteInput[] {
  return b.lines.map((l, i) => ({
    code: l.code,
    description: l.description,
    quantity: l.quantity,
    unitAmount: l.unitAmount,
    amount: l.amount,
    taxable: l.taxable,
    isPassThrough: l.isPassThrough,
    isEstimate: l.isEstimate,
    isAdditional: l.isAdditional,
    reason: l.reason,
    sortOrder: i,
  }));
}

/** Creates a quote with a frozen pricing snapshot (rules + inputs + breakdown). */
export async function createQuote(
  tx: Tx,
  bookingId: string,
  priced: Awaited<ReturnType<typeof priceBooking>>,
  meta: { kind: 'INITIAL' | 'REVISION'; status: 'PENDING_CUSTOMER_APPROVAL' | 'PENDING_INTERNAL_APPROVAL' | 'APPROVED'; reason?: string; requestedById?: string | null; assumptions?: Record<string, unknown> },
) {
  // Supersede any quote still awaiting a decision.
  await tx.bookingQuote.updateMany({ where: { bookingId, status: { in: ['PENDING_CUSTOMER_APPROVAL', 'PENDING_INTERNAL_APPROVAL'] } }, data: { status: 'SUPERSEDED' } });
  const last = await tx.bookingQuote.findFirst({ where: { bookingId }, orderBy: { version: 'desc' }, select: { version: true } });
  const b = priced.breakdown;
  return tx.bookingQuote.create({
    data: {
      bookingId,
      version: (last?.version ?? 0) + 1,
      kind: meta.kind,
      status: meta.status,
      rateCardId: priced.rateCard.id,
      rateCardVersion: priced.rateCard.version,
      pricingSnapshot: { rules: priced.rules, input: priced.input, breakdown: b } as unknown as Prisma.InputJsonValue,
      assumptions: { notes: priced.notes, ...(meta.assumptions ?? {}) } as Prisma.InputJsonValue,
      subtotal: b.subtotal,
      discountTotal: b.discountTotal,
      taxableValue: b.taxableValue,
      taxTotal: b.taxTotal,
      passThroughTotal: b.passThroughTotal,
      total: b.total,
      expiresAt: meta.kind === 'INITIAL' ? new Date(Date.now() + priced.rules.quoteValidityMin * 60_000) : null,
      reason: meta.reason,
      requestedById: meta.requestedById ?? null,
      items: { create: quoteItemsData(b) },
    },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
}

export async function approvedQuote(db: Db, bookingId: string) {
  const q = await db.bookingQuote.findFirst({ where: { bookingId, status: 'APPROVED' }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  if (!q) throw notFound('Approved quote');
  return q;
}
