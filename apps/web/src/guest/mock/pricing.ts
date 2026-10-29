/** Guest-mode copy of the API's transparent pricing engine (apps/api/src/domain/pricing.ts). Paise throughout. */

export interface CancellationPolicy {
  acceptedFee: number;
  arrivedFee: number;
  description: string;
}

export interface RateCardRules {
  id: string;
  lineageId: string;
  version: number;
  name: string;
  serviceKey: string;
  zoneId: string | null;
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
  extras?: { code: string; description: string; amount: number; reason: string; taxable?: boolean }[];
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
  subtotal: number;
  discountTotal: number;
  taxableValue: number;
  taxRateBps: number;
  taxTotal: number;
  passThroughTotal: number;
  total: number;
  chargeableKm: number;
  notes: string[];
}

export const applyBps = (amount: number, bps: number) => {
  const n = (amount * bps) / 10000;
  return n >= 0 ? Math.floor(n + 0.5) : -Math.floor(-n + 0.5);
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

function isNightHour(hour: number, start: number, end: number) {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function computePrice(rc: RateCardRules, input: QuoteInput): PriceBreakdown {
  const est = !input.final;
  const lines: PriceLine[] = [];
  const notes: string[] = [];
  const line = (l: Omit<PriceLine, 'isEstimate' | 'isAdditional' | 'isPassThrough' | 'taxable'> & Partial<PriceLine>) => lines.push({ taxable: true, isPassThrough: false, isEstimate: est, isAdditional: false, ...l });
  const m = input.discounts?.membership ?? null;

  line({ code: 'BASE', description: `Base service charge (${rc.name})`, quantity: 1, unitAmount: rc.baseFee, amount: rc.baseFee, isEstimate: false });
  let chargeableKm = 0;
  if (input.serviceKind === 'TOWING') {
    const included = rc.includedKm + (m?.extraFreeKm ?? 0);
    chargeableKm = round1(Math.max(0, input.towDistanceKm - included));
    if (chargeableKm > 0) line({ code: 'TOW_KM', description: `Towing distance beyond ${included} km included`, quantity: chargeableKm, unitAmount: rc.perKm, amount: Math.round(chargeableKm * rc.perKm) });
  }
  if (input.pickupDistanceKm != null && rc.pickupPerKm > 0) {
    const pk = round1(Math.max(0, input.pickupDistanceKm - rc.pickupFreeKm));
    if (pk > 0) line({ code: 'PICKUP_KM', description: `Pickup travel beyond ${rc.pickupFreeKm} km`, quantity: pk, unitAmount: rc.pickupPerKm, amount: Math.round(pk * rc.pickupPerKm) });
  }
  for (const eq of [...new Set(input.equipment)]) {
    const fee = rc.equipmentSurcharges[eq];
    if (fee && fee > 0) line({ code: `EQUIP_${eq}`, description: `Equipment surcharge: ${eq.replace(/_/g, ' ').toLowerCase()}`, quantity: 1, unitAmount: fee, amount: fee });
  }
  const extraCrew = Math.max(0, input.crew - rc.includedCrew);
  if (extraCrew > 0 && rc.crewChargePerWorker > 0) line({ code: 'CREW', description: `Additional recovery crew (${extraCrew})`, quantity: extraCrew, unitAmount: rc.crewChargePerWorker, amount: extraCrew * rc.crewChargePerWorker });
  const waiting = Math.max(0, (input.waitingMinutes ?? 0) - rc.waitingFreeMinutes);
  if (waiting > 0 && rc.waitingPer15Min > 0) {
    const blocks = Math.ceil(waiting / 15);
    line({ code: 'WAITING', description: `Waiting time beyond ${rc.waitingFreeMinutes} min (${blocks} × 15 min)`, quantity: blocks, unitAmount: rc.waitingPer15Min, amount: blocks * rc.waitingPer15Min });
  }
  if (input.scheduled && rc.scheduledBookingFee > 0) line({ code: 'SCHEDULED', description: 'Scheduled booking fee', quantity: 1, unitAmount: rc.scheduledBookingFee, amount: rc.scheduledBookingFee, isEstimate: false });
  for (const x of input.extras ?? []) line({ code: x.code, description: x.description, quantity: 1, unitAmount: x.amount, amount: x.amount, taxable: x.taxable ?? true, isAdditional: true, reason: x.reason, isEstimate: false });

  const preSurcharge = sum(lines.filter((l) => l.taxable).map((l) => l.amount));
  const night = isNightHour(input.localHour, rc.nightStartHour, rc.nightEndHour) ? rc.nightSurchargeBps : 0;
  const holiday = input.isHoliday ? rc.holidaySurchargeBps : 0;
  if (night > 0 || holiday > 0) {
    const useHoliday = holiday >= night;
    const bps = useHoliday ? holiday : night;
    const amt = applyBps(preSurcharge, bps);
    if (amt > 0) line({ code: useHoliday ? 'HOLIDAY' : 'NIGHT', description: `${useHoliday ? 'Holiday' : 'Night'} surcharge (${bps / 100}%)`, quantity: 1, unitAmount: amt, amount: amt });
  }

  let subtotal = sum(lines.filter((l) => l.taxable).map((l) => l.amount));
  if (subtotal < rc.minimumCharge) {
    const diff = rc.minimumCharge - subtotal;
    line({ code: 'MIN_CHARGE', description: 'Minimum charge adjustment', quantity: 1, unitAmount: diff, amount: diff, isEstimate: false });
    subtotal = rc.minimumCharge;
  }

  let remaining = subtotal;
  const discount = (code: string, description: string, amt: number) => {
    const a = Math.min(remaining, Math.max(0, amt));
    if (a <= 0) return;
    remaining -= a;
    lines.push({ code, description, quantity: 1, unitAmount: -a, amount: -a, taxable: true, isPassThrough: false, isEstimate: false, isAdditional: false });
  };
  if (m?.waiveBaseFee) discount('MEMBERSHIP_BASE', `${m.label}: base charge covered`, rc.baseFee);
  if (input.discounts?.contract?.discountBps) discount('CONTRACT_DISCOUNT', `${input.discounts.contract.label} (${input.discounts.contract.discountBps / 100}%)`, applyBps(remaining, input.discounts.contract.discountBps));
  if (m?.discountBps) discount('MEMBERSHIP_DISCOUNT', `${m.label} discount (${m.discountBps / 100}%)`, applyBps(remaining, m.discountBps));
  const promo = input.discounts?.promo;
  if (promo) discount('PROMO', `Promo ${promo.code} (${promo.discountBps / 100}%)`, Math.min(promo.maxDiscount, applyBps(remaining, promo.discountBps)));

  const discountTotal = subtotal - remaining;
  const taxableValue = remaining;
  const taxTotal = applyBps(taxableValue, rc.taxRateBps);
  const passLines: PriceLine[] = [];
  if (input.tolls && input.tolls > 0) passLines.push({ code: 'TOLL', description: 'Tolls (at actuals, with receipts)', quantity: 1, unitAmount: input.tolls, amount: input.tolls, taxable: false, isPassThrough: true, isEstimate: est, isAdditional: false });
  if (input.parking && input.parking > 0) passLines.push({ code: 'PARKING', description: 'Parking (at actuals, with receipts)', quantity: 1, unitAmount: input.parking, amount: input.parking, taxable: false, isPassThrough: true, isEstimate: est, isAdditional: false });
  lines.push(...passLines);
  const passThroughTotal = sum(passLines.map((l) => l.amount));
  if (rc.tollTreatment === 'PASS_THROUGH_ACTUALS' && !input.final) notes.push('Tolls and parking, if any, are charged at actuals against receipts.');
  if (est) notes.push('Distances are estimates; the final invoice uses actual distances within the approved scope.');
  return { lines, subtotal, discountTotal, taxableValue, taxRateBps: rc.taxRateBps, taxTotal, passThroughTotal, total: taxableValue + taxTotal + passThroughTotal, chargeableKm, notes };
}

const policy = (a: number, b: number): CancellationPolicy => ({ acceptedFee: a, arrivedFee: b, description: `Free until a driver accepts; ₹${a / 100} after acceptance; ₹${b / 100} after arrival (GST incl.)` });

const TOW_BASE = {
  pickupFreeKm: 10,
  pickupPerKm: 1500,
  includedCrew: 1,
  crewChargePerWorker: 40000,
  waitingFreeMinutes: 15,
  waitingPer15Min: 15000,
  nightSurchargeBps: 2000,
  nightStartHour: 22,
  nightEndHour: 6,
  holidaySurchargeBps: 1500,
  scheduledBookingFee: 10000,
  taxRateBps: 1800,
  tollTreatment: 'PASS_THROUGH_ACTUALS',
  quoteValidityMin: 30,
  equipmentSurcharges: { WINCH: 50000, WHEEL_SKATES: 30000, EV_SAFE_KIT: 40000, GO_JACKS: 25000, RECOVERY_STRAPS: 20000 } as Record<string, number>,
};

const CARD_SPECS: [string, string, Partial<RateCardRules>][] = [
  ['CAR_TOW', 'Car towing', { baseFee: 150000, includedKm: 10, perKm: 3500, minimumCharge: 150000, cancellationPolicy: policy(30000, 60000) }],
  ['BIKE_TOW', 'Motorcycle towing', { baseFee: 80000, includedKm: 10, perKm: 2000, minimumCharge: 80000, cancellationPolicy: policy(20000, 40000) }],
  ['PREMIUM_TOW', 'SUV & premium towing', { baseFee: 250000, includedKm: 10, perKm: 5000, minimumCharge: 250000, cancellationPolicy: policy(50000, 100000) }],
  ['FLATBED_TOW', 'Flatbed towing', { baseFee: 200000, includedKm: 10, perKm: 4000, minimumCharge: 200000, cancellationPolicy: policy(40000, 80000) }],
  ['WHEEL_LIFT_TOW', 'Wheel-lift towing', { baseFee: 130000, includedKm: 10, perKm: 3000, minimumCharge: 130000, cancellationPolicy: policy(30000, 50000) }],
  ['ACCIDENT_RECOVERY', 'Accident recovery', { baseFee: 350000, includedKm: 10, perKm: 5000, minimumCharge: 350000, includedCrew: 2, cancellationPolicy: policy(50000, 150000) }],
  ['COMMERCIAL_RECOVERY', 'Commercial vehicle recovery', { baseFee: 600000, includedKm: 10, perKm: 9000, minimumCharge: 600000, includedCrew: 2, cancellationPolicy: policy(100000, 250000) }],
  ['JUMP_START', 'Battery jump-start', { baseFee: 60000, includedKm: 0, perKm: 0, minimumCharge: 60000, cancellationPolicy: policy(15000, 30000) }],
  ['FLAT_TYRE', 'Flat-tyre assistance', { baseFee: 70000, includedKm: 0, perKm: 0, minimumCharge: 70000, cancellationPolicy: policy(15000, 30000) }],
  ['FUEL_DELIVERY', 'Fuel delivery', { baseFee: 50000, includedKm: 0, perKm: 0, minimumCharge: 50000, cancellationPolicy: policy(15000, 30000) }],
  ['LOCKOUT', 'Lockout assistance', { baseFee: 90000, includedKm: 0, perKm: 0, minimumCharge: 90000, cancellationPolicy: policy(20000, 40000) }],
];

/** Active standard rate card (version 1, all zones) per service key. */
export const rateCards: RateCardRules[] = CARD_SPECS.map(([key, name, c], i) => ({
  ...TOW_BASE,
  ...c,
  id: `rc_${key.toLowerCase()}_v1`,
  lineageId: `rcl_${String(i + 1).padStart(2, '0')}`,
  version: 1,
  name: `${name} — standard`,
  serviceKey: key,
  zoneId: null,
}) as RateCardRules);

export const rateCardFor = (serviceKey: string) => rateCards.find((r) => r.serviceKey === serviceKey) ?? rateCards[0]!;
