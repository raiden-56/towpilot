import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, cancellationStage, TransitionError } from '../../src/domain/bookingStateMachine.js';
import { derivePaymentStatus, outstandingAmount, refundableAmount, type InvoiceLedger } from '../../src/domain/paymentStatus.js';
import { ageingBucket, computeCashFlow, computeOperatingResults } from '../../src/domain/finance.js';
import { hasAny, permissionsForRoles } from '../../src/domain/permissions.js';
import { evaluateDriver, scoreCandidate, type DriverCandidate, type DispatchRequest } from '../../src/domain/dispatch.js';
import { recommendRecovery, type AssessmentInput } from '../../src/domain/recommendation.js';
import { maintenanceReminders } from '../../src/domain/maintenance.js';
import { performanceScore } from '../../src/domain/performance.js';
import { financialYearLabel, resolvePeriod } from '../../src/lib/time.js';
import { parseLocationLink } from '../../src/integrations/maps.js';
import { pointInPolygon, resolveZone } from '../../src/lib/geo.js';

describe('booking state machine', () => {
  it('allows the happy path for the right actors', () => {
    expect(canTransition('QUOTED', 'CONFIRMED', 'CUSTOMER')).toBe(true);
    expect(canTransition('ASSIGNED', 'ACCEPTED', 'DRIVER')).toBe(true);
    expect(canTransition('IN_TRANSIT', 'DELIVERED', 'DRIVER')).toBe(true);
    expect(canTransition('RECOVERY_AUTHORIZED', 'DELIVERED', 'DRIVER')).toBe(true); // on-site service
  });
  it('rejects skipping steps and wrong actors', () => {
    expect(canTransition('REQUESTED', 'ACCEPTED', 'DRIVER')).toBe(false);
    expect(canTransition('ASSIGNED', 'ACCEPTED', 'CUSTOMER')).toBe(false);
    expect(canTransition('IN_TRANSIT', 'CANCELLED', 'CUSTOMER')).toBe(false); // vehicle on the truck
    expect(() => assertTransition('COMPLETED', 'IN_TRANSIT', 'ADMIN')).toThrow(TransitionError);
  });
  it('terminal states have no exits', () => {
    expect(canTransition('CANCELLED', 'CONFIRMED', 'ADMIN')).toBe(false);
    expect(canTransition('FAILED', 'COMPLETED', 'ADMIN')).toBe(false);
  });
  it('safety hold resumes only to the held status, by ops', () => {
    expect(canTransition('SAFETY_HOLD', 'LOADING', 'DRIVER')).toBe(false);
    expect(() => assertTransition('SAFETY_HOLD', 'EN_ROUTE', 'DISPATCHER', { holdReturnStatus: 'LOADING' })).toThrow();
    expect(() => assertTransition('SAFETY_HOLD', 'LOADING', 'DISPATCHER', { holdReturnStatus: 'LOADING' })).not.toThrow();
  });
  it('cancellation stage drives fees', () => {
    expect(cancellationStage('SEARCHING_FOR_PROVIDER')).toBe('FREE');
    expect(cancellationStage('EN_ROUTE')).toBe('ACCEPTED');
    expect(cancellationStage('ARRIVED')).toBe('ARRIVED');
  });
});

const ledger = (o: Partial<InvoiceLedger>): InvoiceLedger => ({ total: 10000, paid: 0, pendingCash: 0, credited: 0, refunded: 0, refundPending: 0, writtenOff: 0, hasPendingOnlineAttempt: false, lastAttemptFailed: false, disputed: false, ...o });

describe('payment status', () => {
  it('derives each lifecycle status', () => {
    expect(derivePaymentStatus(ledger({}))).toBe('UNPAID');
    expect(derivePaymentStatus(ledger({ hasPendingOnlineAttempt: true }))).toBe('PAYMENT_PENDING');
    expect(derivePaymentStatus(ledger({ paid: 4000 }))).toBe('PARTIALLY_PAID');
    expect(derivePaymentStatus(ledger({ paid: 10000 }))).toBe('PAID');
    expect(derivePaymentStatus(ledger({ lastAttemptFailed: true }))).toBe('PAYMENT_FAILED');
    expect(derivePaymentStatus(ledger({ paid: 10000, refundPending: 2000 }))).toBe('REFUND_PENDING');
    expect(derivePaymentStatus(ledger({ paid: 10000, refunded: 2000, credited: 2000 }))).toBe('PARTIALLY_REFUNDED');
    expect(derivePaymentStatus(ledger({ paid: 10000, refunded: 10000, credited: 10000 }))).toBe('REFUNDED');
    expect(derivePaymentStatus(ledger({ paid: 10000, disputed: true }))).toBe('DISPUTED');
  });
  it('outstanding accounts for credits, write-offs and refunds; never negative', () => {
    expect(outstandingAmount(ledger({ paid: 3000, credited: 2000 }))).toBe(5000);
    expect(outstandingAmount(ledger({ paid: 10000, refunded: 2000, credited: 2000 }))).toBe(0);
    expect(outstandingAmount(ledger({ paid: 10000, refunded: 2000 }))).toBe(2000); // refund without credit re-opens the amount
    expect(outstandingAmount(ledger({ paid: 12000 }))).toBe(0);
    expect(outstandingAmount(ledger({ writtenOff: 10000 }))).toBe(0);
  });
  it('prevents double refunds', () => {
    expect(refundableAmount({ paid: 10000, refunded: 3000, refundPending: 5000 })).toBe(2000);
    expect(refundableAmount({ paid: 10000, refunded: 10000, refundPending: 0 })).toBe(0);
  });
});

describe('finance composition', () => {
  it('excludes GST and pass-through from revenue and nets credit notes', () => {
    const r = computeOperatingResults(
      { grossServiceValue: 120000, discounts: 20000, invoicedTaxableValue: 100000, invoicedTax: 18000, passThrough: 5000, creditNoteTaxable: 10000, creditNoteTax: 1800 },
      { driverEarnings: 25000, salaries: 30000, expensesByCategory: { FUEL: 10000, MARKETING: 5000 }, gatewayFees: 2000, writeOffs: 1000 },
    );
    expect(r.recognizedRevenue).toBe(90000);
    expect(r.taxesCollected).toBe(16200);
    expect(r.totalCosts).toBe(73000);
    expect(r.operatingProfit).toBe(17000);
    expect(r.profitMarginPct).toBeCloseTo(18.89, 1);
  });
  it('cash flow is separate from accrual results', () => {
    const c = computeCashFlow({ onlineReceived: 50000, cashReceived: 10000, bankReceived: 0, refundsPaid: 5000, payoutsPaid: 20000, salariesPaid: 30000, expensesPaid: 8000 });
    expect(c.netCashFlow).toBe(-3000);
  });
  it('buckets invoice ageing by days past due', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    expect(ageingBucket(new Date('2026-10-11T00:00:00Z'), now)).toBe('current');
    expect(ageingBucket(new Date('2026-09-20T00:00:00Z'), now)).toBe('1-30');
    expect(ageingBucket(new Date('2026-06-01T00:00:00Z'), now)).toBe('90+');
  });
});

describe('permissions', () => {
  it('customers cannot reach admin capabilities', () => {
    const p = permissionsForRoles(['customer']);
    expect(hasAny(p, ['finance:read', 'booking:read_any', 'dispatch:manage'])).toBe(false);
  });
  it('dispatchers manage bookings but not finance or settings', () => {
    const p = permissionsForRoles(['dispatcher']);
    expect(p.has('dispatch:manage')).toBe(true);
    expect(p.has('finance:manage')).toBe(false);
    expect(p.has('settings:manage')).toBe(false);
  });
  it('admins have everything', () => {
    expect(permissionsForRoles(['admin']).has('roles:manage')).toBe(true);
  });
});

const now = new Date('2026-10-10T06:00:00Z');
const driver = (o: Partial<DriverCandidate> = {}): DriverCandidate => ({
  userId: 'd1',
  name: 'D',
  userStatus: 'ACTIVE',
  verificationStatus: 'APPROVED',
  availability: 'AVAILABLE',
  availabilityZoneId: 'z',
  zoneIds: ['z'],
  lastLocation: { lat: 12.98, lng: 77.6 },
  lastLocationAt: new Date(now.getTime() - 60_000),
  licenceExpiry: new Date('2030-01-01'),
  heavyVehicleCert: false,
  hasLiveAssignment: false,
  previouslyDeclined: false,
  jobsToday: 0,
  rating: 4.5,
  truck: { id: 't', registrationNumber: 'KA01', status: 'AVAILABLE', truckType: 'FLATBED', maxVehicleClass: 'PREMIUM', zoneId: 'z', equipment: [{ type: 'WINCH', status: 'OK' }], insuranceExpiry: new Date('2030-01-01'), fitnessExpiry: null, permitExpiry: null, pucExpiry: null },
  ...o,
});
const req: DispatchRequest = { zoneId: 'z', pickup: { lat: 12.97, lng: 77.59 }, truckTypes: ['FLATBED'], equipment: ['WINCH'], vehicleClass: 'SEDAN', now, staleMinutes: 5, radiusKm: 30, avgSpeedKmh: 25 };

describe('dispatch eligibility', () => {
  it('accepts a suitable, verified, available driver', () => {
    const r = evaluateDriver(driver(), req);
    expect(r.eligible).toBe(true);
    expect(r.distanceKm).toBeGreaterThan(0);
  });
  it.each([
    [{ verificationStatus: 'PENDING' as const }, 'not verified'],
    [{ availability: 'ON_BREAK' as const }, 'on break'],
    [{ zoneIds: ['other'] }, 'zone'],
    [{ licenceExpiry: new Date('2020-01-01') }, 'licence expired'],
    [{ lastLocationAt: new Date(now.getTime() - 30 * 60_000) }, 'min old'],
    [{ previouslyDeclined: true }, 'declined'],
    [{ truck: null }, 'No truck'],
  ])('rejects %o', (o, reason) => {
    const r = evaluateDriver(driver(o), req);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ').toLowerCase()).toContain(reason.toLowerCase());
  });
  it('blocks unsuitable or non-compliant trucks', () => {
    const bad = driver({ truck: { ...driver().truck!, status: 'MAINTENANCE', truckType: 'WHEEL_LIFT', equipment: [{ type: 'WINCH', status: 'DAMAGED' }], insuranceExpiry: new Date('2020-01-01') } });
    const reasons = evaluateDriver(bad, req).reasons.join('|');
    expect(reasons).toMatch(/maintenance/);
    expect(reasons).toMatch(/not suitable/);
    expect(reasons).toMatch(/Missing working equipment/);
    expect(reasons).toMatch(/insurance expired/);
  });
  it('scores closer, less-loaded drivers higher, but rating and workload matter', () => {
    const w = { eta: 0.6, workload: 0.2, rating: 0.2 };
    expect(scoreCandidate(10, 0, 4.5, w).total).toBeGreaterThan(scoreCandidate(40, 0, 4.5, w).total);
    expect(scoreCandidate(15, 0, 5, w).total).toBeGreaterThan(scoreCandidate(12, 8, 2, w).total);
  });
});

const assess = (o: Partial<AssessmentInput> = {}): AssessmentInput => ({ breakdownType: 'ENGINE', engineStarts: 'NO', wheelsRotate: 'YES', steeringWorks: 'YES', brakesWork: 'YES', isStuck: 'NO', isOverturned: 'NO', isSubmerged: 'NO', blockingTraffic: 'NO', majorDamage: 'NO', isEvOrHybrid: false, accessRestriction: 'NONE', hasChildren: false, hasElderly: false, needsAccessibility: false, passengersNeedingTransport: 0, ...o });
const carTow = { key: 'CAR_TOW', kind: 'TOWING' as const, allowedTruckTypes: ['FLATBED' as const, 'WHEEL_LIFT' as const], requiredEquipment: [], defaultCrew: 1 };

describe('smart recovery recommendation', () => {
  it('requires a flatbed and EV kit for electric vehicles', () => {
    const r = recommendRecovery(carTow, 'SUV', assess({ isEvOrHybrid: true }), 1);
    expect(r.truckTypes).toEqual(['FLATBED']);
    expect(r.equipment).toContain('EV_SAFE_KIT');
  });
  it('flags overturned vehicles for manual review with extra crew', () => {
    const r = recommendRecovery(carTow, 'SEDAN', assess({ isOverturned: 'YES' }), 1);
    expect(r.manualReviewReasons.length).toBeGreaterThan(0);
    expect(r.crew).toBeGreaterThanOrEqual(3);
    expect(r.priority).toBe('CRITICAL');
  });
  it('treats "not sure" as a reason for caution without blocking dispatch', () => {
    const r = recommendRecovery(carTow, 'SEDAN', assess({ isSubmerged: 'NOT_SURE', isOverturned: 'NOT_SURE' }), 1);
    expect(r.safetyFlags).toContain('CONDITION_UNCONFIRMED');
    expect(r.manualReviewReasons).toHaveLength(0);
    expect(r.reasons.join()).toMatch(/driver must confirm/i);
    const flood = recommendRecovery(carTow, 'SEDAN', assess({ isSubmerged: 'YES' }), 1);
    expect(flood.manualReviewReasons.join()).toMatch(/flood|submerged/i);
  });
  it('suggests towing when an on-site service does not fit the condition', () => {
    const jump = { key: 'JUMP_START', kind: 'ONSITE' as const, allowedTruckTypes: ['SERVICE_VAN' as const], requiredEquipment: ['JUMP_STARTER' as const], defaultCrew: 1 };
    const r = recommendRecovery(jump, 'SEDAN', assess({ breakdownType: 'COLLISION', majorDamage: 'YES' }), 1);
    expect(r.suggestedCategoryKey).toBe('FLATBED_TOW');
  });
  it('explains that requested crew is not guaranteed', () => {
    const r = recommendRecovery(carTow, 'SEDAN', assess(), 4);
    expect(r.reasons.join()).toMatch(/final staffing/i);
  });
});

describe('maintenance reminders (rule-based)', () => {
  it('flags overdue service and expired documents', () => {
    const r = maintenanceReminders({ odometerKm: 50000, lastServiceOdometerKm: 38000, serviceIntervalKm: 10000, serviceIntervalDays: 180, lastServiceAt: new Date('2026-01-01'), insuranceExpiry: new Date('2026-09-01'), fitnessExpiry: null, permitExpiry: null, pucExpiry: null, nextInspectionDue: null }, now);
    expect(r.some((x) => x.kind === 'SERVICE_KM' && x.severity === 'OVERDUE')).toBe(true);
    expect(r.some((x) => x.kind === 'DOCUMENT' && x.severity === 'OVERDUE')).toBe(true);
    expect(r.every((x) => x.basis.startsWith('RULE_BASED'))).toBe(true);
  });
});

describe('fair performance', () => {
  it('difficult jobs never lower the score and missing data is not penalised', () => {
    const w = { punctuality: 0.25, completion: 0.25, safety: 0.2, feedback: 0.2, difficulty: 0.1 };
    const base = { assignmentsOffered: 10, accepted: 10, completed: 10, cancelledByWorker: 0, arrivals: 10, onTimeArrivals: 8, ratingsAvg: 4.5, ratingsCount: 5, verifiedComplaints: 0, safetyIncidentsReported: 2, checklistComplete: 10, difficultJobs: 0 };
    const easy = performanceScore(base, w).score!;
    const hard = performanceScore({ ...base, difficultJobs: 5 }, w).score!;
    expect(hard).toBeGreaterThanOrEqual(easy);
    expect(performanceScore({ ...base, ratingsAvg: null, ratingsCount: 0 }, w).components.feedback).toBeNull();
  });
});

describe('time & geo helpers', () => {
  it('resolves IST periods and Indian financial years', () => {
    const at = new Date('2026-10-10T20:00:00Z'); // 11 Oct 01:30 IST
    const today = resolvePeriod('today', { tz: 'Asia/Kolkata', fyStartMonth: 4, now: at });
    expect(today.from.toISOString()).toBe('2026-10-10T18:30:00.000Z');
    const fy = resolvePeriod('this_fy', { tz: 'Asia/Kolkata', fyStartMonth: 4, now: at });
    expect(fy.from.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(financialYearLabel(at, 'Asia/Kolkata', 4)).toBe('2026-27');
    const q = resolvePeriod('this_quarter', { tz: 'Asia/Kolkata', fyStartMonth: 4, now: at });
    expect(q.from.toISOString()).toBe('2026-09-30T18:30:00.000Z'); // Q3 FY: Oct–Dec
  });
  it('parses common map links', () => {
    expect(parseLocationLink('https://www.google.com/maps/@12.9716,77.5946,15z')).toEqual({ lat: 12.9716, lng: 77.5946 });
    expect(parseLocationLink('https://maps.google.com/?q=12.97,77.59')).toEqual({ lat: 12.97, lng: 77.59 });
    expect(parseLocationLink('geo:19.07,72.87')).toEqual({ lat: 19.07, lng: 72.87 });
    expect(parseLocationLink('12.9,77.6')).toEqual({ lat: 12.9, lng: 77.6 });
    expect(parseLocationLink('hello')).toBeNull();
  });
  it('resolves zones by polygon then radius', () => {
    const poly = { type: 'Polygon', coordinates: [[[77.5, 12.9], [77.7, 12.9], [77.7, 13.1], [77.5, 13.1], [77.5, 12.9]]] };
    expect(pointInPolygon({ lat: 13, lng: 77.6 }, poly)).toBe(true);
    const zones = [
      { id: 'a', centerLat: 12.97, centerLng: 77.59, radiusKm: 5, polygon: null, active: true },
      { id: 'b', centerLat: 19.1, centerLng: 72.87, radiusKm: 10, polygon: null, active: true },
    ];
    expect(resolveZone({ lat: 12.98, lng: 77.6 }, zones)?.id).toBe('a');
    expect(resolveZone({ lat: 15, lng: 75 }, zones)).toBeNull();
  });
});
