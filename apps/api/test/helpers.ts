import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { prisma } from '../src/lib/prisma.js';
import { createApp } from '../src/app.js';
import { syncCatalogue, syncRoles } from '../src/lib/reference.js';
import { invalidateSettings } from '../src/lib/settings.js';
import { drainOnce } from '../src/jobs/queue.js';
// Register job handlers
import '../src/modules/dispatch/service.js';
import '../src/modules/billing/service.js';
import '../src/modules/notifications/service.js';

let app: Express | null = null;
export const getApp = () => (app ??= createApp());
export const api = () => request(getApp());

/** Wipes all tables in the TEST database (guarded) and re-syncs reference data. */
export async function resetDb() {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('_test')) throw new Error('resetDb() only runs against a *_test database');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  invalidateSettings();
  await syncRoles(prisma);
  await syncCatalogue(prisma);
}

/** Process queued background jobs (dispatch, notifications, sandbox refunds) synchronously. */
export async function drainJobs(rounds = 5) {
  for (let i = 0; i < rounds; i++) if ((await drainOnce(50)) === 0) break;
}

let phoneSeq = 0;
export const nextPhone = () => `+9196${String(10000000 + ++phoneSeq).slice(-8)}`;

export async function loginCustomer(name = 'Test Customer') {
  const phone = nextPhone();
  const r1 = await api().post('/api/v1/auth/otp/request').send({ phone }).expect(200);
  const r2 = await api().post('/api/v1/auth/otp/verify').send({ phone, code: r1.body.data.sandboxOtp, fullName: name, acceptTerms: true }).expect(200);
  return { token: r2.body.data.accessToken as string, user: r2.body.data.user, phone, cookie: r2.headers['set-cookie'] as unknown as string[] };
}

export async function loginByOtp(phone: string) {
  const r1 = await api().post('/api/v1/auth/otp/request').send({ phone }).expect(200);
  const r2 = await api().post('/api/v1/auth/otp/verify').send({ phone, code: r1.body.data.sandboxOtp }).expect(200);
  return r2.body.data.accessToken as string;
}

export async function createStaff(roleKey: 'admin' | 'dispatcher' | 'finance') {
  const email = `${roleKey}-${randomUUID().slice(0, 6)}@test.local`;
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  await prisma.user.create({ data: { fullName: `Test ${roleKey}`, email, phone: nextPhone(), passwordHash: await bcrypt.hash('Password123!', 4), roles: { create: { roleId: role.id } } } });
  const r = await api().post('/api/v1/auth/login').send({ email, password: 'Password123!' }).expect(200);
  return r.body.data.accessToken as string;
}

export const ZONE_CENTER = { lat: 12.9716, lng: 77.5946 };

/** Zone + all categories enabled + a simple rate card for CAR_TOW and JUMP_START. */
export async function createPricingFixtures() {
  const zone = await prisma.serviceZone.create({ data: { name: 'Test Zone', city: 'Bengaluru', centerLat: ZONE_CENTER.lat, centerLng: ZONE_CENTER.lng, radiusKm: 30 } });
  const cats = await prisma.serviceCategory.findMany();
  await prisma.serviceZoneCategory.createMany({ data: cats.map((c) => ({ zoneId: zone.id, categoryId: c.id })) });
  const car = cats.find((c) => c.key === 'CAR_TOW')!;
  const jump = cats.find((c) => c.key === 'JUMP_START')!;
  const base = { lineageId: randomUUID(), version: 1, pickupFreeKm: 10, pickupPerKm: 1000, includedCrew: 1, crewChargePerWorker: 40000, waitingFreeMinutes: 15, waitingPer15Min: 10000, nightSurchargeBps: 0, holidaySurchargeBps: 0, taxRateBps: 1800, quoteValidityMin: 30, equipmentSurcharges: { WINCH: 50000 } };
  const carCard = await prisma.rateCard.create({ data: { ...base, name: 'Car tow test', serviceCategoryId: car.id, baseFee: 150000, includedKm: 10, perKm: 3000, minimumCharge: 0, cancellationPolicy: { acceptedFee: 30000, arrivedFee: 60000, description: 'test policy' } } });
  await prisma.rateCard.create({ data: { ...base, lineageId: randomUUID(), name: 'Jump test', serviceCategoryId: jump.id, baseFee: 60000, includedKm: 0, perKm: 0, cancellationPolicy: { acceptedFee: 0, arrivedFee: 0, description: 'free' } } });
  return { zone, car, jump, carCard };
}

/** Verified driver with an assigned, dispatchable flatbed and a fresh location near the zone centre. */
export async function createDriver(zoneId: string, opts: { employmentType?: 'COMMISSION' | 'JOB_BASED' | 'SALARIED'; lat?: number; lng?: number; available?: boolean } = {}) {
  const phone = nextPhone();
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'driver' } });
  const user = await prisma.user.create({
    data: {
      fullName: `Driver ${phone.slice(-4)}`,
      phone,
      roles: { create: { roleId: role.id } },
      workerProfile: { create: { employeeCode: `T${phone.slice(-6)}`, employmentType: opts.employmentType ?? 'COMMISSION', commissionBps: 2500, perJobAmount: 40000, verificationStatus: 'APPROVED', zones: { connect: [{ id: zoneId }] } } },
      driverProfile: { create: { licenceNumberMask: '****1111', licenceClass: 'LMV', licenceExpiry: new Date(Date.now() + 365 * 86_400_000) } },
      availability: { create: { status: opts.available === false ? 'OFF_DUTY' : 'AVAILABLE', zoneId, lastLat: opts.lat ?? ZONE_CENTER.lat + 0.01, lastLng: opts.lng ?? ZONE_CENTER.lng + 0.01, lastLocationAt: new Date(), locationSharing: true } },
    },
  });
  const truck = await prisma.towTruck.create({
    data: {
      registrationNumber: `KA01T${phone.slice(-5)}`,
      truckType: 'FLATBED',
      make: 'Tata',
      model: 'Test',
      maxLoadKg: 3500,
      maxVehicleClass: 'PREMIUM',
      zoneId,
      assignedDriverUserId: user.id,
      equipment: { create: ['FLATBED_DECK', 'WINCH', 'WHEEL_SKATES', 'SAFETY_CONES', 'JUMP_STARTER', 'TYRE_KIT', 'RECOVERY_STRAPS', 'EV_SAFE_KIT', 'GO_JACKS'].map((type) => ({ type: type as never })) },
    },
  });
  const token = await loginByOtp(phone);
  return { user, truck, token, phone };
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export async function addVehicle(token: string, overrides: Record<string, unknown> = {}) {
  const r = await api()
    .post('/api/v1/vehicles')
    .set(bearer(token))
    .send({ vehicleClass: 'SEDAN', registrationNumber: `KA0${Math.floor(Math.random() * 9) + 1}AB${Math.floor(1000 + Math.random() * 8999)}`, make: 'Honda', model: 'City', fuelType: 'PETROL', ...overrides })
    .expect(201);
  return r.body.data;
}

export function bookingPayload(serviceCategoryId: string, vehicleId: string, overrides: Record<string, unknown> = {}) {
  return {
    serviceCategoryId,
    vehicleId,
    type: 'EMERGENCY',
    pickup: { lat: ZONE_CENTER.lat, lng: ZONE_CENTER.lng, accuracyM: 15, capturedAt: new Date().toISOString(), source: 'GPS', address: 'MG Road, Bengaluru', landmark: 'Near metro', isSafeLocation: true },
    dropoff: { lat: ZONE_CENTER.lat + 0.05, lng: ZONE_CENTER.lng + 0.05, source: 'MAP_PIN', destinationType: 'GARAGE', placeName: 'Test Garage', address: 'Test Garage Road' },
    assessment: {
      breakdownType: 'ENGINE',
      engineStarts: 'NO',
      wheelsRotate: 'YES',
      steeringWorks: 'YES',
      brakesWork: 'YES',
      isStuck: 'NO',
      isOverturned: 'NO',
      isSubmerged: 'NO',
      blockingTraffic: 'NO',
      majorDamage: 'NO',
      isEvOrHybrid: false,
      accessRestriction: 'NONE',
    },
    crewRequested: 1,
    contactName: 'Test Customer',
    contactPhone: '+919811111111',
    ...overrides,
  };
}

// Minimal valid JPEG (magic bytes FF D8 FF) for evidence uploads.
export const TINY_JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb004300' + '08'.repeat(64) + 'ffd9', 'hex');
