import { describe, expect, it } from 'vitest';
import { cancellationFee, computePrice, diffAgainstApproved, isNightHour, type RateCardRules } from '../../src/domain/pricing.js';

const rc: RateCardRules = {
  id: 'rc',
  lineageId: 'l',
  version: 1,
  name: 'Test',
  baseFee: 150000,
  includedKm: 10,
  perKm: 3000,
  pickupFreeKm: 10,
  pickupPerKm: 1000,
  includedCrew: 1,
  crewChargePerWorker: 40000,
  waitingFreeMinutes: 15,
  waitingPer15Min: 10000,
  nightSurchargeBps: 2000,
  nightStartHour: 22,
  nightEndHour: 6,
  holidaySurchargeBps: 1500,
  minimumCharge: 0,
  scheduledBookingFee: 10000,
  equipmentSurcharges: { WINCH: 50000 },
  taxRateBps: 1800,
  tollTreatment: 'PASS_THROUGH_ACTUALS',
  quoteValidityMin: 30,
  cancellationPolicy: { acceptedFee: 30000, arrivedFee: 60000, description: 'x' },
};

const base = { serviceKind: 'TOWING' as const, towDistanceKm: 10, pickupDistanceKm: 5, crew: 1, equipment: [], localHour: 12, isHoliday: false, scheduled: false };

describe('computePrice', () => {
  it('charges only the base fee inside included distance', () => {
    const p = computePrice(rc, base);
    expect(p.subtotal).toBe(150000);
    expect(p.taxTotal).toBe(27000);
    expect(p.total).toBe(177000);
    expect(p.chargeableKm).toBe(0);
  });

  it('charges towing km beyond included distance and pickup km beyond free radius', () => {
    const p = computePrice(rc, { ...base, towDistanceKm: 22.4, pickupDistanceKm: 13 });
    const tow = p.lines.find((l) => l.code === 'TOW_KM')!;
    expect(tow.quantity).toBe(12.4);
    expect(tow.amount).toBe(37200);
    expect(p.lines.find((l) => l.code === 'PICKUP_KM')!.amount).toBe(3000);
    expect(p.subtotal).toBe(150000 + 37200 + 3000);
  });

  it('adds equipment, crew, waiting and scheduled fees', () => {
    const p = computePrice(rc, { ...base, equipment: ['WINCH', 'WINCH', 'GO_JACKS'], crew: 3, waitingMinutes: 40, scheduled: true, final: true });
    expect(p.lines.filter((l) => l.code === 'EQUIP_WINCH')).toHaveLength(1); // deduplicated
    expect(p.lines.find((l) => l.code === 'CREW')!.amount).toBe(80000);
    expect(p.lines.find((l) => l.code === 'WAITING')!.quantity).toBe(2); // 25 min → 2 blocks
    expect(p.lines.find((l) => l.code === 'SCHEDULED')!.amount).toBe(10000);
  });

  it('applies the higher of night/holiday surcharges, never both', () => {
    const night = computePrice(rc, { ...base, localHour: 23 });
    expect(night.lines.find((l) => l.code === 'NIGHT')!.amount).toBe(30000);
    const both = computePrice(rc, { ...base, localHour: 23, isHoliday: true });
    expect(both.lines.some((l) => l.code === 'HOLIDAY')).toBe(false);
    expect(both.lines.filter((l) => ['NIGHT', 'HOLIDAY'].includes(l.code))).toHaveLength(1);
  });

  it('wraps night hours across midnight', () => {
    expect(isNightHour(23, 22, 6)).toBe(true);
    expect(isNightHour(3, 22, 6)).toBe(true);
    expect(isNightHour(12, 22, 6)).toBe(false);
  });

  it('enforces the minimum charge', () => {
    const p = computePrice({ ...rc, baseFee: 50000, minimumCharge: 120000 }, base);
    expect(p.subtotal).toBe(120000);
    expect(p.lines.find((l) => l.code === 'MIN_CHARGE')!.amount).toBe(70000);
  });

  it('applies discounts in order and never below zero; GST is on the discounted value', () => {
    const p = computePrice(rc, {
      ...base,
      discounts: { membership: { label: 'Plan', waiveBaseFee: true, extraFreeKm: 5, discountBps: 1000 }, contract: { label: 'C', discountBps: 1000 }, promo: { code: 'X', discountBps: 5000, maxDiscount: 100 } },
      towDistanceKm: 20,
    });
    // 5 km beyond 10+5 included
    expect(p.lines.find((l) => l.code === 'TOW_KM')!.quantity).toBe(5);
    expect(p.lines.find((l) => l.code === 'MEMBERSHIP_BASE')!.amount).toBe(-150000);
    expect(p.taxableValue).toBeGreaterThanOrEqual(0);
    expect(p.taxTotal).toBe(Math.round(p.taxableValue * 0.18));
    expect(p.discountTotal).toBe(p.subtotal - p.taxableValue);
  });

  it('treats tolls and parking as untaxed pass-through', () => {
    const p = computePrice(rc, { ...base, tolls: 6500, parking: 3000, final: true });
    expect(p.passThroughTotal).toBe(9500);
    expect(p.taxTotal).toBe(27000);
    expect(p.total).toBe(177000 + 9500);
  });

  it('on-site services ignore towing distance', () => {
    const p = computePrice(rc, { ...base, serviceKind: 'ONSITE', towDistanceKm: 50 });
    expect(p.lines.some((l) => l.code === 'TOW_KM')).toBe(false);
  });
});

describe('diffAgainstApproved', () => {
  it('flags only chargeable increases (pass-through excluded)', () => {
    const approved = computePrice(rc, base);
    const final = computePrice(rc, { ...base, final: true, waitingMinutes: 30, tolls: 5000 });
    const d = diffAgainstApproved(approved, final);
    expect(d.changes.find((c) => c.code === 'WAITING')!.delta).toBe(10000);
    expect(d.chargeableIncrease).toBe(10000);
    expect(d.totalDelta).toBe(final.total - approved.total);
  });
});

describe('cancellationFee', () => {
  it('follows the disclosed policy by stage', () => {
    expect(cancellationFee(rc.cancellationPolicy, 'FREE')).toBe(0);
    expect(cancellationFee(rc.cancellationPolicy, 'ACCEPTED')).toBe(30000);
    expect(cancellationFee(rc.cancellationPolicy, 'ARRIVED')).toBe(60000);
  });
});
