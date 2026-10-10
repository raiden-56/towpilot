import { applyBps, sum } from '../lib/money.js';

/** The pricing rules frozen into every quote's snapshot. */
export interface RateCardRules {
  id: string;
  lineageId: string;
  version: number;
  name: string;
  baseFee: number;
  includedKm: number;
  perKm: number;
  pickupFreeKm: number;
  pickupPerKm: number;
  includedCrew: number;
  crewChargePerWorker: number;
  waitingFreeMinutes: number;
  waitingPer15Min: number;
  nightSurchargeBps: number;
  nightStartHour: number;
  nightEndHour: number;
  holidaySurchargeBps: number;
  minimumCharge: number;
  scheduledBookingFee: number;
  equipmentSurcharges: Record<string, number>;
  taxRateBps: number;
  tollTreatment: string;
  quoteValidityMin: number;
  cancellationPolicy: CancellationPolicy;
}

export interface CancellationPolicy {
  /** Fee once a driver has accepted / is en route (paise). */
  acceptedFee: number;
  /** Fee once the driver has arrived at the location (paise). */
  arrivedFee: number;
  description: string;
}

export interface QuoteDiscounts {
  membership?: { label: string; waiveBaseFee: boolean; extraFreeKm: number; discountBps: number } | null;
  contract?: { label: string; discountBps: number } | null;
  promo?: { code: string; discountBps: number; maxDiscount: number } | null;
}

export interface QuoteInput {
  serviceKind: 'TOWING' | 'ONSITE';
  towDistanceKm: number;
  pickupDistanceKm: number | null;
  crew: number;
  equipment: string[];
  waitingMinutes?: number;
  localHour: number;
  isHoliday: boolean;
  scheduled: boolean;
  tolls?: number;
  parking?: number;
  discounts?: QuoteDiscounts;
  /** Additional, individually justified charges (quote revisions / final invoice). */
  extras?: { code: string; description: string; amount: number; reason: string; taxable?: boolean }[];
  /** True when distances/times are actuals rather than estimates (final invoice). */
  final?: boolean;
}

export interface PriceLine {
  code: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  taxable: boolean;
  isPassThrough: boolean;
  isEstimate: boolean;
  isAdditional: boolean;
  reason?: string;
}

export interface PriceBreakdown {
  lines: PriceLine[];
  /** Gross service value before discounts (taxable service lines only). */
  subtotal: number;
  discountTotal: number;
  taxableValue: number;
  taxRateBps: number;
  taxTotal: number;
  /** Tolls/parking collected at actuals and passed through — not revenue, not taxed. */
  passThroughTotal: number;
  total: number;
  chargeableKm: number;
  notes: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function isNightHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function computePrice(rc: RateCardRules, input: QuoteInput): PriceBreakdown {
  const est = !input.final;
  const lines: PriceLine[] = [];
  const notes: string[] = [];
  const line = (l: Omit<PriceLine, 'isEstimate' | 'isAdditional' | 'isPassThrough' | 'taxable'> & Partial<PriceLine>) =>
    lines.push({ taxable: true, isPassThrough: false, isEstimate: est, isAdditional: false, ...l });

  const m = input.discounts?.membership ?? null;

  // Base fee
  line({ code: 'BASE', description: `Base service charge (${rc.name})`, quantity: 1, unitAmount: rc.baseFee, amount: rc.baseFee, isEstimate: false });

  // Towing distance
  let chargeableKm = 0;
  if (input.serviceKind === 'TOWING') {
    const included = rc.includedKm + (m?.extraFreeKm ?? 0);
    chargeableKm = round1(Math.max(0, input.towDistanceKm - included));
    if (chargeableKm > 0) {
      line({
        code: 'TOW_KM',
        description: `Towing distance beyond ${included} km included`,
        quantity: chargeableKm,
        unitAmount: rc.perKm,
        amount: Math.round(chargeableKm * rc.perKm),
      });
    }
  }

  // Pickup distance (provider travel to the breakdown point)
  if (input.pickupDistanceKm != null && rc.pickupPerKm > 0) {
    const pk = round1(Math.max(0, input.pickupDistanceKm - rc.pickupFreeKm));
    if (pk > 0)
      line({
        code: 'PICKUP_KM',
        description: `Pickup travel beyond ${rc.pickupFreeKm} km`,
        quantity: pk,
        unitAmount: rc.pickupPerKm,
        amount: Math.round(pk * rc.pickupPerKm),
      });
  }

  // Equipment
  for (const eq of [...new Set(input.equipment)]) {
    const fee = rc.equipmentSurcharges[eq];
    if (fee && fee > 0) line({ code: `EQUIP_${eq}`, description: `Equipment surcharge: ${eq.replace(/_/g, ' ').toLowerCase()}`, quantity: 1, unitAmount: fee, amount: fee });
  }

  // Additional crew
  const extraCrew = Math.max(0, input.crew - rc.includedCrew);
  if (extraCrew > 0 && rc.crewChargePerWorker > 0)
    line({ code: 'CREW', description: `Additional recovery crew (${extraCrew})`, quantity: extraCrew, unitAmount: rc.crewChargePerWorker, amount: extraCrew * rc.crewChargePerWorker });

  // Waiting time
  const waiting = Math.max(0, (input.waitingMinutes ?? 0) - rc.waitingFreeMinutes);
  if (waiting > 0 && rc.waitingPer15Min > 0) {
    const blocks = Math.ceil(waiting / 15);
    line({ code: 'WAITING', description: `Waiting time beyond ${rc.waitingFreeMinutes} min (${blocks} × 15 min)`, quantity: blocks, unitAmount: rc.waitingPer15Min, amount: blocks * rc.waitingPer15Min });
  }

  if (input.scheduled && rc.scheduledBookingFee > 0)
    line({ code: 'SCHEDULED', description: 'Scheduled booking fee', quantity: 1, unitAmount: rc.scheduledBookingFee, amount: rc.scheduledBookingFee, isEstimate: false });

  // Justified additional charges
  for (const x of input.extras ?? []) {
    line({ code: x.code, description: x.description, quantity: 1, unitAmount: x.amount, amount: x.amount, taxable: x.taxable ?? true, isAdditional: true, reason: x.reason, isEstimate: false });
  }

  // Time-based surcharge: the higher of night or holiday applies (they never stack).
  const preSurcharge = sum(lines.filter((l) => l.taxable).map((l) => l.amount));
  const night = isNightHour(input.localHour, rc.nightStartHour, rc.nightEndHour) ? rc.nightSurchargeBps : 0;
  const holiday = input.isHoliday ? rc.holidaySurchargeBps : 0;
  if (night > 0 || holiday > 0) {
    const useHoliday = holiday >= night;
    const bps = useHoliday ? holiday : night;
    const amt = applyBps(preSurcharge, bps);
    if (amt > 0)
      line({ code: useHoliday ? 'HOLIDAY' : 'NIGHT', description: `${useHoliday ? 'Holiday' : 'Night'} surcharge (${bps / 100}%)`, quantity: 1, unitAmount: amt, amount: amt });
  }

  let subtotal = sum(lines.filter((l) => l.taxable).map((l) => l.amount));
  if (subtotal < rc.minimumCharge) {
    const diff = rc.minimumCharge - subtotal;
    line({ code: 'MIN_CHARGE', description: 'Minimum charge adjustment', quantity: 1, unitAmount: diff, amount: diff, isEstimate: false });
    subtotal = rc.minimumCharge;
  }

  // Discounts — applied in a fixed order on the remaining value, never below zero.
  let remaining = subtotal;
  const discount = (code: string, description: string, amt: number) => {
    const a = Math.min(remaining, Math.max(0, amt));
    if (a <= 0) return;
    remaining -= a;
    lines.push({ code, description, quantity: 1, unitAmount: -a, amount: -a, taxable: true, isPassThrough: false, isEstimate: false, isAdditional: false });
  };
  if (m?.waiveBaseFee) discount('MEMBERSHIP_BASE', `${m.label}: base charge covered`, rc.baseFee);
  if (input.discounts?.contract?.discountBps)
    discount('CONTRACT_DISCOUNT', `${input.discounts.contract.label} (${input.discounts.contract.discountBps / 100}%)`, applyBps(remaining, input.discounts.contract.discountBps));
  if (m?.discountBps) discount('MEMBERSHIP_DISCOUNT', `${m.label} discount (${m.discountBps / 100}%)`, applyBps(remaining, m.discountBps));
  const promo = input.discounts?.promo;
  if (promo) discount('PROMO', `Promo ${promo.code} (${promo.discountBps / 100}%)`, Math.min(promo.maxDiscount, applyBps(remaining, promo.discountBps)));

  const discountTotal = subtotal - remaining;
  const taxableValue = remaining;
  const taxTotal = applyBps(taxableValue, rc.taxRateBps);

  // Pass-through actuals
  const passLines: PriceLine[] = [];
  if (input.tolls && input.tolls > 0)
    passLines.push({ code: 'TOLL', description: 'Tolls (at actuals, with receipts)', quantity: 1, unitAmount: input.tolls, amount: input.tolls, taxable: false, isPassThrough: true, isEstimate: est, isAdditional: false });
  if (input.parking && input.parking > 0)
    passLines.push({ code: 'PARKING', description: 'Parking (at actuals, with receipts)', quantity: 1, unitAmount: input.parking, amount: input.parking, taxable: false, isPassThrough: true, isEstimate: est, isAdditional: false });
  lines.push(...passLines);
  const passThroughTotal = sum(passLines.map((l) => l.amount));

  if (rc.tollTreatment === 'PASS_THROUGH_ACTUALS' && !input.final) notes.push('Tolls and parking, if any, are charged at actuals against receipts.');
  if (est) notes.push('Distances are estimates; the final invoice uses actual distances within the approved scope.');

  return {
    lines,
    subtotal,
    discountTotal,
    taxableValue,
    taxRateBps: rc.taxRateBps,
    taxTotal,
    passThroughTotal,
    total: taxableValue + taxTotal + passThroughTotal,
    chargeableKm,
    notes,
  };
}

/** Cancellation fee per the policy disclosed at quote time. */
export function cancellationFee(policy: CancellationPolicy, stage: 'FREE' | 'ACCEPTED' | 'ARRIVED'): number {
  if (stage === 'ARRIVED') return policy.arrivedFee;
  if (stage === 'ACCEPTED') return policy.acceptedFee;
  return 0;
}

/**
 * Price-difference protection: compares the approved quote with the proposed final charges and
 * lists every line that increased or is new. Each must carry a reason, and increases beyond the
 * approved total require customer approval (except disclosed pass-through actuals).
 */
export function diffAgainstApproved(approved: PriceBreakdown, final: PriceBreakdown) {
  const byCode = new Map(approved.lines.map((l) => [l.code, l]));
  const changes = final.lines
    .map((l) => {
      const prev = byCode.get(l.code);
      const delta = l.amount - (prev?.amount ?? 0);
      return { code: l.code, description: l.description, approved: prev?.amount ?? 0, final: l.amount, delta, isPassThrough: l.isPassThrough, reason: l.reason };
    })
    .filter((c) => c.delta !== 0);
  for (const prev of approved.lines) {
    if (!final.lines.some((l) => l.code === prev.code)) changes.push({ code: prev.code, description: prev.description, approved: prev.amount, final: 0, delta: -prev.amount, isPassThrough: prev.isPassThrough, reason: undefined });
  }
  const totalDelta = final.total - approved.total;
  const chargeableIncrease = sum(changes.filter((c) => c.delta > 0 && !c.isPassThrough).map((c) => c.delta));
  return { changes, totalDelta, chargeableIncrease };
}
