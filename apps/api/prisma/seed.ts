/**
 * Seed script.
 *   - Always: roles, permissions and the service catalogue (reference data).
 *   - Only when ALLOW_SAMPLE_DATA=true and NODE_ENV != production: clearly labelled SAMPLE data
 *     (zones, rate cards, staff, drivers, trucks, customers, 90 days of history).
 * Sample records carry isSample=true and use "Sample" names and +91 90000xxxxx phone numbers.
 */
import 'dotenv/config';
import { PrismaClient, type BookingStatus, type BreakdownType, type Prisma, type VehicleClass } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { syncCatalogue, syncRoles } from '../src/lib/reference.js';
import { computePrice, type RateCardRules } from '../src/domain/pricing.js';
import { recommendRecovery } from '../src/domain/recommendation.js';
import { derivePaymentStatus, outstandingAmount } from '../src/domain/paymentStatus.js';
import { applyBps } from '../src/lib/money.js';
import { storage } from '../src/integrations/storage.js';

const prisma = new PrismaClient();

/** Minimal single-page PDF used for clearly labelled sample employee documents. */
function samplePdf(text: string): Buffer {
  const content = `BT /F1 18 Tf 60 760 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const SAMPLE_PASSWORD = 'Sample@12345';
const DAY = 86_400_000;

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}
const rand = rng(42);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
const between = (a: number, b: number) => a + rand() * (b - a);

async function main() {
  await syncRoles(prisma);
  await syncCatalogue(prisma);
  console.log('✔ Reference data synced (roles, permissions, service catalogue)');

  const allow = process.env.ALLOW_SAMPLE_DATA === 'true' && process.env.NODE_ENV !== 'production';
  if (!allow) {
    console.log('Sample data skipped (set ALLOW_SAMPLE_DATA=true outside production to load it).');
    return;
  }
  if (await prisma.user.findFirst({ where: { isSample: true } })) {
    console.log('Sample data already present — skipping. Use `npm run db:reset` then seed to rebuild.');
    return;
  }
  await seedSample();
}

async function seedSample() {
  const role = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
  const cats = Object.fromEntries((await prisma.serviceCategory.findMany()).map((c) => [c.key, c]));

  // ─── Zones ───
  const zones = {
    blrC: await prisma.serviceZone.create({ data: { name: 'Bengaluru Central (Sample)', city: 'Bengaluru', centerLat: 12.9716, centerLng: 77.5946, radiusKm: 18 } }),
    blrE: await prisma.serviceZone.create({ data: { name: 'Bengaluru East (Sample)', city: 'Bengaluru', centerLat: 12.9698, centerLng: 77.75, radiusKm: 12 } }),
    mum: await prisma.serviceZone.create({ data: { name: 'Mumbai Western Suburbs (Sample)', city: 'Mumbai', centerLat: 19.1136, centerLng: 72.8697, radiusKm: 15 } }),
  };
  for (const z of Object.values(zones)) {
    await prisma.serviceZoneCategory.createMany({ data: Object.values(cats).filter((c) => z !== zones.mum || c.key !== 'COMMERCIAL_RECOVERY').map((c) => ({ zoneId: z.id, categoryId: c.id })) });
  }

  // ─── Rate cards (INR in paise) ───
  const policy = (a: number, b: number) => ({ acceptedFee: a, arrivedFee: b, description: `Free until a driver accepts; ₹${a / 100} after acceptance; ₹${b / 100} after arrival (GST incl.)` });
  const towBase = { pickupFreeKm: 10, pickupPerKm: 1500, includedCrew: 1, crewChargePerWorker: 40000, waitingFreeMinutes: 15, waitingPer15Min: 15000, nightSurchargeBps: 2000, nightStartHour: 22, nightEndHour: 6, holidaySurchargeBps: 1500, scheduledBookingFee: 10000, taxRateBps: 1800, quoteValidityMin: 30, equipmentSurcharges: { WINCH: 50000, WHEEL_SKATES: 30000, EV_SAFE_KIT: 40000, GO_JACKS: 25000, RECOVERY_STRAPS: 20000 } };
  const cards: [string, Partial<Prisma.RateCardUncheckedCreateInput>][] = [
    ['CAR_TOW', { baseFee: 150000, includedKm: 10, perKm: 3500, minimumCharge: 150000, cancellationPolicy: policy(30000, 60000) }],
    ['BIKE_TOW', { baseFee: 80000, includedKm: 10, perKm: 2000, minimumCharge: 80000, cancellationPolicy: policy(20000, 40000) }],
    ['PREMIUM_TOW', { baseFee: 250000, includedKm: 10, perKm: 5000, minimumCharge: 250000, cancellationPolicy: policy(50000, 100000) }],
    ['FLATBED_TOW', { baseFee: 200000, includedKm: 10, perKm: 4000, minimumCharge: 200000, cancellationPolicy: policy(40000, 80000) }],
    ['WHEEL_LIFT_TOW', { baseFee: 130000, includedKm: 10, perKm: 3000, minimumCharge: 130000, cancellationPolicy: policy(30000, 50000) }],
    ['ACCIDENT_RECOVERY', { baseFee: 350000, includedKm: 10, perKm: 5000, minimumCharge: 350000, includedCrew: 2, cancellationPolicy: policy(50000, 150000) }],
    ['COMMERCIAL_RECOVERY', { baseFee: 600000, includedKm: 10, perKm: 9000, minimumCharge: 600000, includedCrew: 2, cancellationPolicy: policy(100000, 250000) }],
    ['JUMP_START', { baseFee: 60000, includedKm: 0, perKm: 0, minimumCharge: 60000, cancellationPolicy: policy(15000, 30000) }],
    ['FLAT_TYRE', { baseFee: 70000, includedKm: 0, perKm: 0, minimumCharge: 70000, cancellationPolicy: policy(15000, 30000) }],
    ['FUEL_DELIVERY', { baseFee: 50000, includedKm: 0, perKm: 0, minimumCharge: 50000, cancellationPolicy: policy(15000, 30000) }],
    ['LOCKOUT', { baseFee: 90000, includedKm: 0, perKm: 0, minimumCharge: 90000, cancellationPolicy: policy(20000, 40000) }],
  ];
  const rateCards: Record<string, Awaited<ReturnType<typeof prisma.rateCard.create>>> = {};
  for (const [key, c] of cards) {
    rateCards[key] = await prisma.rateCard.create({
      data: { ...towBase, ...c, lineageId: randomUUID(), version: 1, name: `${cats[key]!.name} — standard (Sample)`, serviceCategoryId: cats[key]!.id, changeReason: 'Initial sample rate card' } as Prisma.RateCardUncheckedCreateInput,
    });
  }

  // ─── Memberships & promo ───
  await prisma.membership.createMany({
    data: [
      { code: 'ROADSAFE_ANNUAL', name: 'RoadSafe Annual', description: 'Up to 3 covered towing or on-site services a year with extra free kilometres and 10% off.', price: 199900, durationMonths: 12, includedServices: 3, includedKmPerService: 15, discountBps: 1000, coveredCategoryKeys: ['CAR_TOW', 'BIKE_TOW', 'FLATBED_TOW', 'WHEEL_LIFT_TOW', 'JUMP_START', 'FLAT_TYRE', 'FUEL_DELIVERY', 'LOCKOUT'], exclusions: 'Accident recovery, commercial vehicles, fuel cost, tolls and parking. Services outside active zones.', renewalTerms: 'Does not auto-renew. Renew any time before expiry.' },
      { code: 'ROADSAFE_MONTHLY', name: 'RoadSafe Monthly', description: 'One covered on-site service per month and 5% off towing.', price: 24900, durationMonths: 1, includedServices: 1, includedKmPerService: 0, discountBps: 500, coveredCategoryKeys: ['JUMP_START', 'FLAT_TYRE', 'FUEL_DELIVERY', 'LOCKOUT', 'CAR_TOW', 'BIKE_TOW'], exclusions: 'Accident and commercial recovery, tolls and parking.', renewalTerms: 'Monthly; does not auto-renew.' },
    ],
  });
  await prisma.promoCode.create({ data: { code: 'WELCOME10', description: '10% off your first booking (Sample)', discountBps: 1000, maxDiscount: 30000, validFrom: new Date(Date.now() - 30 * DAY), validTo: new Date(Date.now() + 365 * DAY), maxUses: 1000 } });

  // ─── Staff ───
  const hash = await bcrypt.hash(SAMPLE_PASSWORD, 10);
  let emp = 0;
  const staff = async (name: string, email: string, phone: string, roles: string[]) =>
    prisma.user.create({
      data: {
        fullName: name,
        email,
        phone,
        passwordHash: hash,
        isSample: true,
        roles: { create: await Promise.all(roles.map(async (r) => ({ roleId: await role(r) }))) },
        workerProfile: { create: { employeeCode: `EMP${String(++emp).padStart(4, '0')}`, employmentType: 'SALARIED', payFrequency: 'MONTHLY', baseSalary: 4500000, verificationStatus: 'APPROVED', isSample: true } },
      },
    });
  const admin = await staff('Sample Admin', 'admin@towpilot.local', '+919000000001', ['admin']);
  await staff('Sample Dispatcher', 'dispatch@towpilot.local', '+919000000002', ['dispatcher']);
  await staff('Sample Finance', 'finance@towpilot.local', '+919000000003', ['finance']);

  // ─── Fleet & drivers ───
  const truckSpecs = [
    { reg: 'KA01TP1001', type: 'FLATBED' as const, max: 'PREMIUM' as VehicleClass, zone: zones.blrC, eq: ['FLATBED_DECK', 'WINCH', 'WHEEL_SKATES', 'SAFETY_CONES', 'RECOVERY_STRAPS', 'EV_SAFE_KIT', 'JUMP_STARTER', 'TYRE_KIT'] },
    { reg: 'KA01TP1002', type: 'WHEEL_LIFT' as const, max: 'SUV' as VehicleClass, zone: zones.blrC, eq: ['WHEEL_LIFT', 'DOLLIES', 'GO_JACKS', 'SAFETY_CONES', 'JUMP_STARTER', 'TYRE_KIT', 'RECOVERY_STRAPS'] },
    { reg: 'KA03TP2001', type: 'FLATBED' as const, max: 'PREMIUM' as VehicleClass, zone: zones.blrE, eq: ['FLATBED_DECK', 'WINCH', 'WHEEL_SKATES', 'SAFETY_CONES', 'GO_JACKS', 'RECOVERY_STRAPS'] },
    { reg: 'KA01TP3001', type: 'BIKE_CARRIER' as const, max: 'TWO_WHEELER' as VehicleClass, zone: zones.blrC, eq: ['SAFETY_CONES', 'RECOVERY_STRAPS'] },
    { reg: 'KA01TP4001', type: 'SERVICE_VAN' as const, max: 'TWO_WHEELER' as VehicleClass, zone: zones.blrC, eq: ['JUMP_STARTER', 'TYRE_KIT', 'FUEL_CAN', 'LOCKOUT_KIT', 'SAFETY_CONES'] },
    { reg: 'KA01TP5001', type: 'HEAVY_DUTY' as const, max: 'HCV' as VehicleClass, zone: zones.blrC, eq: ['WINCH', 'RECOVERY_STRAPS', 'SAFETY_CONES', 'WHEEL_LIFT'] },
    { reg: 'MH02TP1001', type: 'FLATBED' as const, max: 'PREMIUM' as VehicleClass, zone: zones.mum, eq: ['FLATBED_DECK', 'WINCH', 'WHEEL_SKATES', 'SAFETY_CONES', 'RECOVERY_STRAPS'] },
  ];
  const now = new Date();
  const trucks = [];
  for (const t of truckSpecs) {
    trucks.push(
      await prisma.towTruck.create({
        data: {
          registrationNumber: t.reg,
          truckType: t.type,
          make: t.type === 'SERVICE_VAN' ? 'Mahindra' : 'Tata',
          model: t.type === 'SERVICE_VAN' ? 'Supro Service Van' : t.type === 'HEAVY_DUTY' ? 'Signa 2823 Recovery' : 'Ultra 1518 Tow',
          maxLoadKg: t.type === 'HEAVY_DUTY' ? 18000 : t.type === 'BIKE_CARRIER' || t.type === 'SERVICE_VAN' ? 600 : 3500,
          maxVehicleClass: t.max,
          zoneId: t.zone.id,
          odometerKm: Math.round(between(20000, 90000)),
          lastServiceAt: new Date(now.getTime() - between(20, 200) * DAY),
          serviceIntervalKm: 10000,
          serviceIntervalDays: 180,
          insuranceExpiry: new Date(now.getTime() + between(-10, 300) * DAY),
          fitnessExpiry: new Date(now.getTime() + between(60, 500) * DAY),
          permitExpiry: new Date(now.getTime() + between(60, 500) * DAY),
          pucExpiry: new Date(now.getTime() + between(5, 180) * DAY),
          nextInspectionDue: new Date(now.getTime() + between(-5, 60) * DAY),
          isSample: true,
          equipment: { create: t.eq.map((type) => ({ type: type as never })) },
        },
      }),
    );
  }
  for (const t of trucks) await prisma.towTruck.update({ where: { id: t.id }, data: { lastServiceOdometerKm: t.odometerKm - Math.round(between(1000, 9800)) } });

  const driverSpecs = [
    { name: 'Sample Driver Ravi', phone: '+919000000011', truck: 0, zone: [zones.blrC, zones.blrE], emp: 'COMMISSION' as const, lat: 12.975, lng: 77.6 },
    { name: 'Sample Driver Imran', phone: '+919000000012', truck: 1, zone: [zones.blrC], emp: 'JOB_BASED' as const, lat: 12.93, lng: 77.62 },
    { name: 'Sample Driver Suresh', phone: '+919000000013', truck: 2, zone: [zones.blrE, zones.blrC], emp: 'SALARIED' as const, lat: 12.97, lng: 77.74 },
    { name: 'Sample Driver Anil', phone: '+919000000014', truck: 3, zone: [zones.blrC], emp: 'PARTNER' as const, lat: 12.99, lng: 77.57 },
    { name: 'Sample Driver Kiran', phone: '+919000000015', truck: 4, zone: [zones.blrC, zones.blrE], emp: 'JOB_BASED' as const, lat: 12.96, lng: 77.58 },
    { name: 'Sample Driver Manjunath', phone: '+919000000016', truck: 5, zone: [zones.blrC], emp: 'SALARIED' as const, lat: 13.0, lng: 77.55, heavy: true },
    { name: 'Sample Driver Prakash', phone: '+919000000017', truck: 6, zone: [zones.mum], emp: 'COMMISSION' as const, lat: 19.11, lng: 72.86 },
  ];
  const drivers = [];
  for (const d of driverSpecs) {
    const u = await prisma.user.create({
      data: {
        fullName: d.name,
        phone: d.phone,
        isSample: true,
        roles: { create: [{ roleId: await role('driver') }] },
        workerProfile: {
          create: {
            employeeCode: `EMP${String(++emp).padStart(4, '0')}`,
            employmentType: d.emp,
            payFrequency: d.emp === 'SALARIED' ? 'MONTHLY' : null,
            baseSalary: d.emp === 'SALARIED' ? 2800000 : null,
            commissionBps: d.emp === 'COMMISSION' ? 2500 : null,
            perJobAmount: d.emp === 'JOB_BASED' || d.emp === 'PARTNER' ? 45000 : null,
            partnerCompany: d.emp === 'PARTNER' ? 'Sample Partner Towing Co.' : null,
            verificationStatus: 'APPROVED',
            verifiedById: admin.id,
            verifiedAt: now,
            skills: ['flatbed', 'winching', ...(d.heavy ? ['heavy recovery'] : [])],
            emergencyContactName: 'Sample Contact',
            emergencyContactPhone: '+919000009999',
            payoutMethod: 'UPI',
            payoutDetailsMasked: '*****@upi',
            isSample: true,
            zones: { connect: d.zone.map((z) => ({ id: z.id })) },
          },
        },
        driverProfile: { create: { licenceNumberMask: '**********1234', licenceClass: d.heavy ? 'LMV, HGMV' : 'LMV, MGV', licenceExpiry: new Date(now.getTime() + between(200, 2000) * DAY), heavyVehicleCert: !!d.heavy } },
        // Sample drivers start OFF DUTY; they go Available from the driver app, which shares live GPS.
        availability: { create: { status: 'OFF_DUTY', zoneId: d.zone[0]!.id, lastLat: d.lat, lastLng: d.lng, lastLocationAt: new Date(now.getTime() - 3600_000) } },
      },
    });
    await prisma.towTruck.update({ where: { id: trucks[d.truck]!.id }, data: { assignedDriverUserId: u.id } });
    for (const t of ['ID_PROOF', 'PHOTO', 'DRIVING_LICENCE'] as const) {
      const key = `samples/placeholder-${t.toLowerCase()}.pdf`;
      if (!(await storage.exists(key))) await storage.put(key, samplePdf(`SAMPLE ${t.replace("_", " ")} - not a real document`), 'application/pdf');
      await prisma.employeeDocument.create({ data: { userId: u.id, type: t, numberMasked: '****1234', storageKey: `samples/placeholder-${t.toLowerCase()}.pdf`, mimeType: 'application/pdf', status: 'APPROVED', reviewedById: admin.id, reviewedAt: now, expiresAt: t === 'DRIVING_LICENCE' ? new Date(now.getTime() + 900 * DAY) : null } });
    }
    drivers.push(u);
  }
  const worker = await prisma.user.create({
    data: {
      fullName: 'Sample Worker Lokesh',
      phone: '+919000000021',
      isSample: true,
      roles: { create: [{ roleId: await role('worker') }] },
      workerProfile: { create: { employeeCode: `EMP${String(++emp).padStart(4, '0')}`, employmentType: 'JOB_BASED', perJobAmount: 25000, verificationStatus: 'APPROVED', isSample: true, zones: { connect: [{ id: zones.blrC.id }] } } },
      availability: { create: { status: 'OFF_DUTY', zoneId: zones.blrC.id } },
    },
  });

  // ─── Customers & business account ───
  const custRole = await role('customer');
  const customerSpecs = [
    { name: 'Sample Customer Priya', phone: '+919000000101', vehicles: [{ cls: 'SEDAN', reg: 'KA05MN4321', make: 'Honda', model: 'City', fuel: 'PETROL' }, { cls: 'TWO_WHEELER', reg: 'KA05HJ8899', make: 'Royal Enfield', model: 'Classic 350', fuel: 'PETROL' }] },
    { name: 'Sample Customer Arjun', phone: '+919000000102', vehicles: [{ cls: 'SUV', reg: 'KA03PQ7788', make: 'Tata', model: 'Nexon EV', fuel: 'ELECTRIC' }] },
    { name: 'Sample Customer Meera', phone: '+919000000103', vehicles: [{ cls: 'HATCHBACK', reg: 'KA51AB1122', make: 'Maruti Suzuki', model: 'Swift', fuel: 'PETROL' }] },
    { name: 'Sample Fleet Manager Rahul', phone: '+919000000104', vehicles: [{ cls: 'LCV', reg: 'KA01FL0001', make: 'Tata', model: 'Ace Gold', fuel: 'DIESEL' }, { cls: 'SEDAN', reg: 'KA01FL0002', make: 'Toyota', model: 'Etios', fuel: 'DIESEL' }] },
  ];
  const customers = [];
  for (const c of customerSpecs) {
    const u = await prisma.user.create({
      data: {
        fullName: c.name,
        phone: c.phone,
        isSample: true,
        roles: { create: [{ roleId: custRole }] },
        customerProfile: { create: { termsAcceptedAt: now, privacyConsentAt: now, consentVersion: '2026-10', locationConsent: true } },
        vehicles: { create: c.vehicles.map((v) => ({ vehicleClass: v.cls as VehicleClass, registrationNumber: v.reg, make: v.make, model: v.model, fuelType: v.fuel as never, isSample: true })) },
        savedAddresses: { create: [{ label: 'Home', address: 'Sample address, Indiranagar, Bengaluru', lat: 12.9784, lng: 77.6408 }] },
        emergencyContacts: { create: [{ name: 'Sample Emergency Contact', phone: '+919000009998', relationship: 'Family' }] },
      },
      include: { vehicles: true },
    });
    customers.push(u);
  }
  const fleet = await prisma.fleetAccount.create({ data: { name: 'Sample Logistics Pvt Ltd', gstin: '29ABCDE1234F1Z5', billingEmail: 'accounts@sample-logistics.example', billingAddress: 'Sample Industrial Area, Peenya, Bengaluru', creditLimit: 5000000, paymentTermsDays: 30, isSample: true } });
  const fleetMgr = customers[3]!;
  await prisma.fleetAccountMember.create({ data: { fleetAccountId: fleet.id, userId: fleetMgr.id, isManager: true } });
  await prisma.vehicle.updateMany({ where: { ownerUserId: fleetMgr.id }, data: { fleetAccountId: fleet.id } });
  await prisma.fleetContract.create({ data: { fleetAccountId: fleet.id, name: 'Sample FY26 Fleet Contract', startsAt: new Date(now.getTime() - 90 * DAY), endsAt: new Date(now.getTime() + 275 * DAY), discountBps: 1200, slaResponseMinutes: 45, monthlyServiceLimit: 20 } });

  // ─── 90 days of history ───
  const blrPoints = [
    [12.9352, 77.6245, 'Koramangala'],
    [12.9719, 77.6412, 'Indiranagar'],
    [12.9141, 77.6411, 'HSR Layout'],
    [13.0358, 77.597, 'Hebbal'],
    [12.9592, 77.6974, 'Marathahalli'],
    [12.9698, 77.75, 'Whitefield'],
    [12.9063, 77.5857, 'JP Nagar'],
    [12.9784, 77.5718, 'Rajajinagar'],
    [12.8452, 77.6602, 'Electronic City'],
  ] as const;
  const garages = [
    [12.9611, 77.6387, 'Sample Honda Service, Domlur'],
    [12.9279, 77.6271, 'Sample Multi-brand Garage, Koramangala'],
    [12.9895, 77.7208, 'Sample Tata Motors Service, Whitefield'],
    [13.0108, 77.5545, 'Sample Car Care, Yeshwanthpur'],
  ] as const;
  let invoiceSeq = 0;
  let bookingSeq = 0;
  const towKeys = ['CAR_TOW', 'FLATBED_TOW', 'PREMIUM_TOW', 'WHEEL_LIFT_TOW', 'BIKE_TOW', 'JUMP_START', 'FLAT_TYRE', 'ACCIDENT_RECOVERY'];
  const fyLabel = (d: Date) => {
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  };

  for (let i = 0; i < 70; i++) {
    const daysAgo = Math.floor(between(1, 90));
    const created = new Date(now.getTime() - daysAgo * DAY - between(0, 20) * 3600_000);
    const cust = pick(customers.slice(0, 4));
    const vehicle = pick(cust.vehicles);
    let key = pick(towKeys);
    if (vehicle.vehicleClass === 'TWO_WHEELER') key = pick(['BIKE_TOW', 'JUMP_START', 'FLAT_TYRE']);
    if (vehicle.vehicleClass === 'LCV') key = 'COMMERCIAL_RECOVERY';
    if (key === 'PREMIUM_TOW' && !['SUV', 'PREMIUM', 'SEDAN'].includes(vehicle.vehicleClass)) key = 'CAR_TOW';
    if (key === 'WHEEL_LIFT_TOW' && !['HATCHBACK', 'SEDAN'].includes(vehicle.vehicleClass)) key = 'FLATBED_TOW';
    const cat = cats[key]!;
    const rc = rateCards[key]!;
    const p = pick([...blrPoints]);
    const g = pick([...garages]);
    const pickup = { lat: p[0] + between(-0.01, 0.01), lng: p[1] + between(-0.01, 0.01) };
    const towKm = cat.kind === 'TOWING' ? Math.round(between(4, 28) * 10) / 10 : 0;
    const pickupKm = Math.round(between(2, 14) * 10) / 10;
    const assessment = { breakdownType: (cat.kind === 'ONSITE' ? (key === 'JUMP_START' ? 'BATTERY' : 'TYRE') : key === 'ACCIDENT_RECOVERY' ? 'COLLISION' : pick(['MECHANICAL', 'ENGINE', 'TRANSMISSION'])) as BreakdownType, engineStarts: 'NO', wheelsRotate: key === 'ACCIDENT_RECOVERY' ? 'NOT_SURE' : 'YES', steeringWorks: 'YES', brakesWork: 'YES', isStuck: 'NO', isOverturned: 'NO', isSubmerged: 'NO', blockingTraffic: rand() < 0.15 ? 'YES' : 'NO', majorDamage: key === 'ACCIDENT_RECOVERY' ? 'YES' : 'NO', isEvOrHybrid: vehicle.fuelType === 'ELECTRIC', accessRestriction: 'NONE', hasChildren: false, hasElderly: false, needsAccessibility: false, passengersNeedingTransport: rand() < 0.3 ? 1 : 0 } as const;
    const rec = recommendRecovery({ key, kind: cat.kind, allowedTruckTypes: cat.allowedTruckTypes, requiredEquipment: cat.requiredEquipment, defaultCrew: cat.defaultCrew }, vehicle.vehicleClass, assessment, 1);
    const rules: RateCardRules = { ...(rc as unknown as RateCardRules), equipmentSurcharges: rc.equipmentSurcharges as Record<string, number>, cancellationPolicy: rc.cancellationPolicy as never };
    const fleetBooking = cust.id === fleetMgr.id;
    const hour = created.getHours();
    const input = { serviceKind: cat.kind, towDistanceKm: towKm, pickupDistanceKm: pickupKm, crew: rec.crew, equipment: rec.equipment, localHour: hour, isHoliday: false, scheduled: false, discounts: fleetBooking ? { contract: { label: 'Contract Sample FY26 Fleet Contract', discountBps: 1200 } } : {} };
    const quote = computePrice(rules, input);

    const outcome = rand();
    const status: BookingStatus = outcome < 0.08 ? 'CANCELLED' : outcome < 0.11 ? 'FAILED' : 'COMPLETED';
    const driverIdx = key === 'BIKE_TOW' ? 3 : cat.kind === 'ONSITE' ? 4 : key === 'COMMERCIAL_RECOVERY' ? 5 : pick([0, 1, 2]);
    const driver = drivers[driverIdx]!;
    const truck = trucks[driverSpecs[driverIdx]!.truck]!;
    const tConfirmed = new Date(created.getTime() + between(1, 4) * 60_000);
    const tAccepted = new Date(tConfirmed.getTime() + between(1, 9) * 60_000);
    const tArrived = new Date(tAccepted.getTime() + between(12, 45) * 60_000);
    const tDone = new Date(tArrived.getTime() + between(30, 110) * 60_000);
    const code = `TP-${created.toISOString().slice(2, 10).replace(/-/g, '')}-S${String(++bookingSeq).padStart(3, '0')}`;
    const timeline: [BookingStatus, Date, string][] =
      status === 'CANCELLED'
        ? [['REQUESTED', created, 'CUSTOMER'], ['QUOTED', created, 'SYSTEM'], ['CONFIRMED', tConfirmed, 'CUSTOMER'], ['SEARCHING_FOR_PROVIDER', tConfirmed, 'SYSTEM'], ['CANCELLED', new Date(tConfirmed.getTime() + 5 * 60_000), 'CUSTOMER']]
        : status === 'FAILED'
          ? [['REQUESTED', created, 'CUSTOMER'], ['QUOTED', created, 'SYSTEM'], ['CONFIRMED', tConfirmed, 'CUSTOMER'], ['SEARCHING_FOR_PROVIDER', tConfirmed, 'SYSTEM'], ['ASSIGNED', tConfirmed, 'SYSTEM'], ['ACCEPTED', tAccepted, 'DRIVER'], ['EN_ROUTE', tAccepted, 'DRIVER'], ['ARRIVED', tArrived, 'DRIVER'], ['INSPECTING', tArrived, 'DRIVER'], ['FAILED', new Date(tArrived.getTime() + 20 * 60_000), 'DRIVER']]
          : [
              ['REQUESTED', created, 'CUSTOMER'],
              ['QUOTED', created, 'SYSTEM'],
              ['CONFIRMED', tConfirmed, 'CUSTOMER'],
              ['SEARCHING_FOR_PROVIDER', tConfirmed, 'SYSTEM'],
              ['ASSIGNED', tConfirmed, 'SYSTEM'],
              ['ACCEPTED', tAccepted, 'DRIVER'],
              ['EN_ROUTE', tAccepted, 'DRIVER'],
              ['ARRIVED', tArrived, 'DRIVER'],
              ['INSPECTING', new Date(tArrived.getTime() + 3 * 60_000), 'DRIVER'],
              ['RECOVERY_AUTHORIZED', new Date(tArrived.getTime() + 10 * 60_000), 'DRIVER'],
              ...(cat.kind === 'TOWING'
                ? ([
                    ['LOADING', new Date(tArrived.getTime() + 12 * 60_000), 'DRIVER'],
                    ['IN_TRANSIT', new Date(tArrived.getTime() + 25 * 60_000), 'DRIVER'],
                  ] as [BookingStatus, Date, string][])
                : []),
              ['DELIVERED', tDone, 'DRIVER'],
              ['COMPLETED', new Date(tDone.getTime() + 60_000), 'DRIVER'],
            ];

    const booking = await prisma.booking.create({
      data: {
        code,
        customerUserId: cust.id,
        vehicleId: vehicle.id,
        fleetAccountId: fleetBooking ? fleet.id : null,
        serviceCategoryId: cat.id,
        zoneId: p[2] === 'Whitefield' || p[2] === 'Marathahalli' ? zones.blrE.id : zones.blrC.id,
        status,
        priority: rec.priority,
        safetyFlags: rec.safetyFlags,
        recommendation: rec as unknown as Prisma.InputJsonValue,
        crewRecommended: rec.crew,
        contactName: cust.fullName,
        contactPhone: cust.phone!,
        pickupOtp: '0000',
        handoverOtp: '0000',
        pickupVerifiedAt: status !== 'CANCELLED' ? tArrived : null,
        pickupDistanceKm: pickupKm,
        towDistanceKm: towKm || null,
        distanceSource: 'estimate',
        etaAt: status !== 'CANCELLED' ? new Date(tAccepted.getTime() + 30 * 60_000) : null,
        arrivedAt: status !== 'CANCELLED' ? tArrived : null,
        cancellationReason: status === 'CANCELLED' ? 'Vehicle started on its own' : null,
        failureReason: status === 'FAILED' ? 'Vehicle could not be safely recovered from the location' : null,
        completedAt: status === 'COMPLETED' ? new Date(tDone.getTime() + 60_000) : null,
        isSample: true,
        createdAt: created,
        locations: {
          create: [
            { kind: 'PICKUP', lat: pickup.lat, lng: pickup.lng, accuracyM: 12, capturedAt: created, source: 'GPS', address: `Sample location near ${p[2]}, Bengaluru`, landmark: 'Main road junction', isSafeLocation: true },
            ...(cat.kind === 'TOWING' ? [{ kind: 'DROPOFF' as const, lat: g[0], lng: g[1], source: 'MAP_PIN' as const, address: g[2], placeName: g[2], destinationType: 'GARAGE' as const }] : []),
          ],
        },
        assessment: { create: assessment },
        statusHistory: { create: timeline.map(([s, at, actor], idx) => ({ fromStatus: idx ? timeline[idx - 1]![0] : null, toStatus: s, actorRole: actor as never, actorUserId: actor === 'DRIVER' ? driver.id : actor === 'CUSTOMER' ? cust.id : null, createdAt: at, reason: s === 'CANCELLED' ? 'Vehicle started on its own' : s === 'FAILED' ? 'Unsafe recovery conditions' : null })) },
        quotes: {
          create: {
            version: 1,
            kind: 'INITIAL',
            status: 'APPROVED',
            rateCardId: rc.id,
            rateCardVersion: rc.version,
            pricingSnapshot: { rules, input, breakdown: quote } as unknown as Prisma.InputJsonValue,
            assumptions: { notes: quote.notes, sample: true },
            subtotal: quote.subtotal,
            discountTotal: quote.discountTotal,
            taxableValue: quote.taxableValue,
            taxTotal: quote.taxTotal,
            passThroughTotal: quote.passThroughTotal,
            total: quote.total,
            decidedById: cust.id,
            decidedAt: tConfirmed,
            createdAt: created,
            items: { create: quote.lines.map((l, idx) => ({ ...l, reason: l.reason, sortOrder: idx })) },
          },
        },
      },
    });

    if (status === 'CANCELLED') continue;
    await prisma.bookingAssignment.create({ data: { bookingId: booking.id, driverUserId: driver.id, truckId: truck.id, status: status === 'COMPLETED' ? 'COMPLETED' : 'RELEASED', method: 'AUTO', attempt: 1, offeredAt: tConfirmed, expiresAt: new Date(tConfirmed.getTime() + 90_000), respondedAt: tAccepted, etaMinutes: 30, distanceKm: pickupKm } });
    await prisma.bookingTeamMember.create({ data: { bookingId: booking.id, userId: driver.id, role: 'TEAM_LEADER', responsibility: 'Driver and team leader', createdAt: tAccepted } });
    if (rec.crew > 1) await prisma.bookingTeamMember.create({ data: { bookingId: booking.id, userId: worker.id, role: 'RECOVERY_WORKER', responsibility: 'Winching and securing', createdAt: tAccepted } });
    if (status === 'FAILED') continue;

    await prisma.custodyConfirmation.createMany({
      data: [
        { bookingId: booking.id, stage: 'PICKUP', method: 'OTP', confirmedById: driver.id, recipientName: cust.fullName, createdAt: tArrived },
        { bookingId: booking.id, stage: 'HANDOVER', method: 'OTP', confirmedById: driver.id, recipientName: cat.kind === 'TOWING' ? 'Sample garage supervisor' : cust.fullName, recipientRelation: cat.kind === 'TOWING' ? 'Garage' : 'Owner', createdAt: tDone },
      ],
    });
    if (cat.kind === 'TOWING')
      await prisma.vehicleConditionReport.createMany({
        data: [
          { bookingId: booking.id, stage: 'PICKUP', reportedById: driver.id, damageMarks: key === 'ACCIDENT_RECOVERY' ? [{ area: 'Front bumper', description: 'Cracked, pre-existing collision damage' }] : [], notes: 'Sample pickup inspection', fuelLevel: 'Half', attachmentIds: [], createdAt: new Date(tArrived.getTime() + 8 * 60_000) },
          { bookingId: booking.id, stage: 'DELIVERY', reportedById: driver.id, damageMarks: [], notes: 'No new damage', attachmentIds: [], createdAt: tDone },
        ],
      });

    // Final invoice: frozen rules + actual waiting time + tolls.
    const tolls = cat.kind === 'TOWING' && rand() < 0.25 ? 6500 : 0;
    const final = computePrice(rules, { ...input, final: true, waitingMinutes: Math.round(between(0, 35)), tolls });
    const issuedAt = new Date(tDone.getTime() + 60_000);
    const approvedQuote = await prisma.bookingQuote.findFirstOrThrow({ where: { bookingId: booking.id, status: 'APPROVED' }, select: { id: true } });
    const number = `INV/${fyLabel(issuedAt)}/S${String(++invoiceSeq).padStart(5, '0')}`;
    const paid = fleetBooking ? (rand() < 0.5 ? final.total : 0) : rand() < 0.9 ? final.total : rand() < 0.5 ? Math.round(final.total / 2) : 0;
    const inv = await prisma.invoice.create({
      data: {
        number,
        type: 'SERVICE',
        bookingId: booking.id,
        customerUserId: cust.id,
        fleetAccountId: fleetBooking ? fleet.id : null,
        billingName: fleetBooking ? fleet.name : cust.fullName,
        billingPhone: cust.phone,
        billingGstin: fleetBooking ? fleet.gstin : null,
        subtotal: final.subtotal,
        discountTotal: final.discountTotal,
        taxableValue: final.taxableValue,
        taxTotal: final.taxTotal,
        passThroughTotal: final.passThroughTotal,
        total: final.total,
        outstanding: final.total,
        approvedQuoteId: approvedQuote.id,
        approvedQuoteTotal: quote.total,
        pricingSnapshot: { rules, input: { ...input, final: true }, breakdown: final } as unknown as Prisma.InputJsonValue,
        issuedAt,
        dueAt: new Date(issuedAt.getTime() + (fleetBooking ? 30 : 0) * DAY),
        isSample: true,
        items: { create: final.lines.map((l, idx) => ({ code: l.code, description: l.description, quantity: l.quantity, unitAmount: l.unitAmount, amount: l.amount, taxable: l.taxable, isPassThrough: l.isPassThrough, isAdditional: l.isAdditional, sortOrder: idx })) },
      },
    });
    if (paid > 0) {
      const online = rand() < 0.75;
      const fee = online ? Math.round(paid * 0.02 * 1.18) : 0;
      await prisma.payment.create({
        data: {
          invoiceId: inv.id,
          method: online ? 'ONLINE' : 'CASH',
          provider: online ? 'SANDBOX' : 'MANUAL',
          status: 'SUCCEEDED',
          amount: paid,
          providerOrderId: online ? `sbx_order_seed_${i}` : null,
          providerPaymentId: online ? `sbx_pay_seed_${i}` : null,
          idempotencyKey: `seed-${i}`,
          gatewayFee: fee,
          gatewayTax: online ? Math.round(paid * 0.02 * 0.18) : 0,
          receiptNumber: `RCP/${fyLabel(issuedAt)}/S${String(i + 1).padStart(5, '0')}`,
          collectedById: online ? null : driver.id,
          confirmedById: online ? null : admin.id,
          isSandbox: online,
          createdAt: issuedAt,
          succeededAt: new Date(issuedAt.getTime() + 5 * 60_000),
        },
      });
    }
    const ledger = { total: final.total, paid, pendingCash: 0, credited: 0, refunded: 0, refundPending: 0, writtenOff: 0, hasPendingOnlineAttempt: false, lastAttemptFailed: false, disputed: false };
    await prisma.invoice.update({ where: { id: inv.id }, data: { amountPaid: paid, outstanding: outstandingAmount(ledger), paymentStatus: derivePaymentStatus(ledger) } });

    // Earnings per compensation rule
    const spec = driverSpecs[driverIdx]!;
    const amount = spec.emp === 'COMMISSION' ? applyBps(final.taxableValue, 2500) : spec.emp === 'JOB_BASED' || spec.emp === 'PARTNER' ? 45000 : 0;
    if (amount > 0) await prisma.driverEarning.create({ data: { userId: driver.id, bookingId: booking.id, kind: spec.emp === 'COMMISSION' ? 'JOB_COMMISSION' : 'JOB_FIXED', amount, earnedAt: tDone, status: daysAgo > 14 ? 'IN_PAYOUT' : 'PENDING', note: code } });
    if (rec.crew > 1) await prisma.driverEarning.create({ data: { userId: worker.id, bookingId: booking.id, kind: 'JOB_FIXED', amount: 25000, earnedAt: tDone, status: daysAgo > 14 ? 'IN_PAYOUT' : 'PENDING', note: code } });
    if (rand() < 0.7) await prisma.rating.create({ data: { bookingId: booking.id, raterUserId: cust.id, rateeUserId: driver.id, score: pick([5, 5, 5, 4, 4, 3]), comment: pick(['Quick and careful', 'Very professional', 'Arrived a bit late but handled the car well', null]) ?? undefined, createdAt: new Date(tDone.getTime() + 3600_000) } });
  }

  // Payouts for older earnings
  for (const d of [...drivers, worker]) {
    const lines = await prisma.driverEarning.findMany({ where: { userId: d.id, status: 'IN_PAYOUT' } });
    if (!lines.length) continue;
    const net = lines.reduce((a, l) => a + l.amount, 0);
    const po = await prisma.driverPayout.create({ data: { userId: d.id, periodStart: new Date(now.getTime() - 90 * DAY), periodEnd: new Date(now.getTime() - 14 * DAY), earningsAmount: net, incentivesAmount: 0, deductionsAmount: 0, reimbursementsAmount: 0, netAmount: net, status: 'PAID', paidAt: new Date(now.getTime() - 12 * DAY), paymentRef: `SAMPLE-UTR-${d.id.slice(-6)}`, createdById: admin.id, approvedById: admin.id } });
    await prisma.driverEarning.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { payoutId: po.id } });
  }

  // Expenses and salaries for the last three months
  let exp = 0;
  for (let m = 0; m < 3; m++) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - m + 1, 1);
    for (const t of trucks) {
      const date = new Date(Math.min(now.getTime() - DAY, monthStart.getTime() + between(2, 25) * DAY));
      await prisma.expense.create({ data: { number: `EXP-SAMPLE-${String(++exp).padStart(5, '0')}`, category: 'FUEL', description: `Diesel — ${t.registrationNumber}`, amount: Math.round(between(800000, 2200000)), expenseDate: date, fuelLitres: Math.round(between(80, 220)), truckId: t.id, zoneId: t.zoneId, status: 'PAID', paidAt: date, submittedById: admin.id, approvedById: admin.id, isSample: true } });
    }
    const d2 = new Date(Math.min(now.getTime() - DAY, monthStart.getTime() + 10 * DAY));
    await prisma.expense.create({ data: { number: `EXP-SAMPLE-${String(++exp).padStart(5, '0')}`, category: 'MARKETING', source: 'VENDOR_BILL', vendorName: 'Sample Ads Agency', description: 'Search ads', amount: 2500000, taxAmount: 450000, expenseDate: d2, status: 'PAID', paidAt: d2, submittedById: admin.id, approvedById: admin.id, isSample: true } });
    await prisma.expense.create({ data: { number: `EXP-SAMPLE-${String(++exp).padStart(5, '0')}`, category: 'OFFICE', description: 'Dispatch office rent', amount: 4000000, expenseDate: d2, status: 'PAID', paidAt: d2, submittedById: admin.id, approvedById: admin.id, isSample: true } });
    await prisma.expense.create({ data: { number: `EXP-SAMPLE-${String(++exp).padStart(5, '0')}`, category: 'SOFTWARE', description: 'Maps and SMS usage', amount: 800000, expenseDate: d2, status: m === 0 ? 'APPROVED' : 'PAID', paidAt: m === 0 ? null : d2, submittedById: admin.id, approvedById: admin.id, isSample: true } });
    if (monthEnd < now) {
      const salaried = await prisma.workerProfile.findMany({ where: { employmentType: 'SALARIED', baseSalary: { gt: 0 }, isSample: true } });
      for (const w of salaried) {
        await prisma.salaryRecord.create({ data: { userId: w.userId, frequency: 'MONTHLY', periodStart: monthStart, periodEnd: monthEnd, baseAmount: w.baseSalary!, netAmount: w.baseSalary!, status: 'PAID', paidAt: new Date(monthEnd.getTime() + DAY), paymentRef: `SAMPLE-SAL-${m}`, createdById: admin.id, isSample: true } });
      }
    }
  }
  const t0 = trucks[0]!;
  await prisma.maintenanceRecord.create({ data: { truckId: t0.id, type: 'SERVICE', description: 'Sample periodic service', odometerKm: t0.odometerKm - 4000, cost: 1850000, performedAt: new Date(now.getTime() - 60 * DAY), createdById: admin.id } });
  await prisma.maintenanceRecord.create({ data: { truckId: t0.id, type: 'INSPECTION', description: 'Sample monthly safety inspection', odometerKm: t0.odometerKm - 800, performedAt: new Date(now.getTime() - 10 * DAY), nextDueAt: new Date(now.getTime() + 20 * DAY), createdById: admin.id } });

  console.log('✔ Sample data created (all records flagged isSample=true)');
  console.log('\nSample accounts (development only):');
  console.log(`  Admin       admin@towpilot.local     / ${SAMPLE_PASSWORD}`);
  console.log(`  Dispatcher  dispatch@towpilot.local  / ${SAMPLE_PASSWORD}`);
  console.log(`  Finance     finance@towpilot.local   / ${SAMPLE_PASSWORD}`);
  console.log('  Driver      phone 9000000011 (OTP login; sandbox OTP is shown in the app)');
  console.log('  Worker      phone 9000000021');
  console.log('  Customer    phone 9000000101 (Priya), 9000000102 (Arjun, EV), 9000000104 (fleet manager)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
