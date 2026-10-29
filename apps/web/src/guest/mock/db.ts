/**
 * Guest-mode sample data: a coherent Bengaluru operation generated deterministically at load time
 * (relative to "now"), modelled on apps/api/prisma/seed.ts. Everything lives in memory only, so a
 * reload of the page starts from the same fresh state.
 */
import type { Assessment, BookingStatus, Recommendation, Role, VehicleClass } from '@/api/types';
import type {
  ActorRole,
  GAssignment,
  GAvailabilityLog,
  GBooking,
  GCategory,
  GCreditNote,
  GDocument,
  GEarning,
  GEmergencyContact,
  GEscalation,
  GExpense,
  GFleetAccount,
  GIncident,
  GInvoice,
  GMaintenance,
  GMembership,
  GNotification,
  GPayment,
  GPayout,
  GPromo,
  GQuote,
  GRating,
  GRefund,
  GSalary,
  GSavedAddress,
  GStatusHistory,
  GSubscription,
  GTicket,
  GTruck,
  GUser,
  GVehicle,
  GZone,
  GWorkerProfile,
  TruckType,
} from './model';
import { applyBps, computePrice, rateCardFor, type PriceBreakdown, type QuoteInput } from './pricing';

// ─── Time & id helpers ────────────────────────────────────────────────

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const NOW = Date.now();
export const iso = (ms: number) => new Date(ms).toISOString();
export const nowIso = () => new Date().toISOString();

let idSeq = 0;
/** New unique id for records created during the session. */
export const newId = (prefix: string) => `${prefix}_g${(++idSeq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}
const rand = rng(20261029);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const between = (a: number, b: number) => a + rand() * (b - a);
const chance = (p: number) => rand() < p;
const round1 = (n: number) => Math.round(n * 10) / 10;
/** India Standard Time hour of a timestamp (pricing night surcharge). */
export const istHour = (ms: number) => new Date(ms + 5.5 * HOUR).getUTCHours();
/** Financial-year label (April–March), e.g. 2026-27. */
export function fyLabel(ms: number) {
  const d = new Date(ms + 5.5 * HOUR);
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

// ─── Reference data ───────────────────────────────────────────────────

const ALL_KEYS = ['CAR_TOW', 'BIKE_TOW', 'PREMIUM_TOW', 'FLATBED_TOW', 'WHEEL_LIFT_TOW', 'ACCIDENT_RECOVERY', 'COMMERCIAL_RECOVERY', 'JUMP_START', 'FLAT_TYRE', 'FUEL_DELIVERY', 'LOCKOUT'];
const zone = (id: string, name: string, centerLat: number, centerLng: number, radiusKm: number, keys = ALL_KEYS): GZone => ({ id, name, city: 'Bengaluru', centerLat, centerLng, radiusKm, polygon: null, active: true, categoryKeys: keys, createdAt: iso(NOW - 400 * DAY), updatedAt: iso(NOW - 30 * DAY) });

const zones: GZone[] = [
  zone('zn_blr_central', 'Bengaluru Central', 12.9716, 77.5946, 14),
  zone('zn_blr_east', 'Bengaluru East', 12.9698, 77.73, 12),
  zone('zn_blr_north', 'Bengaluru North', 13.0604, 77.5946, 12),
  zone('zn_blr_south', 'Bengaluru South', 12.8656, 77.6476, 11, ALL_KEYS.filter((k) => k !== 'COMMERCIAL_RECOVERY')),
];

const cat = (key: string, name: string, description: string, kind: 'TOWING' | 'ONSITE', allowedTruckTypes: TruckType[], requiredEquipment: string[], vehicleClasses: VehicleClass[], defaultCrew: number, icon: string, sortOrder: number): GCategory => ({ id: `cat_${key.toLowerCase()}`, key, name, description, kind, allowedTruckTypes, requiredEquipment, vehicleClasses, defaultCrew, icon, sortOrder, active: true });

const categories: GCategory[] = [
  cat('CAR_TOW', 'Car towing', 'Tow a hatchback or sedan to your garage or home.', 'TOWING', ['FLATBED', 'WHEEL_LIFT'], [], ['HATCHBACK', 'SEDAN', 'SUV'], 1, 'car', 1),
  cat('BIKE_TOW', 'Motorcycle towing', 'Two-wheelers moved on a bike carrier or flatbed.', 'TOWING', ['BIKE_CARRIER', 'FLATBED'], [], ['TWO_WHEELER'], 1, 'bike', 2),
  cat('PREMIUM_TOW', 'SUV & premium towing', 'Flatbed-only transport for SUVs, luxury and EVs.', 'TOWING', ['FLATBED'], ['WHEEL_SKATES'], ['SUV', 'PREMIUM', 'SEDAN'], 1, 'premium', 3),
  cat('FLATBED_TOW', 'Flatbed towing', 'All four wheels off the ground. Safest for damaged or AWD vehicles.', 'TOWING', ['FLATBED'], [], ['HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'TWO_WHEELER'], 1, 'flatbed', 4),
  cat('WHEEL_LIFT_TOW', 'Wheel-lift towing', 'Compact truck for tight lanes and basements.', 'TOWING', ['WHEEL_LIFT'], [], ['HATCHBACK', 'SEDAN'], 1, 'wheellift', 5),
  cat('ACCIDENT_RECOVERY', 'Accident recovery', 'Recovery of damaged or immobilised vehicles after a collision.', 'TOWING', ['FLATBED', 'HEAVY_DUTY'], ['WINCH'], ['HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'TWO_WHEELER', 'LCV'], 2, 'accident', 6),
  cat('COMMERCIAL_RECOVERY', 'Commercial vehicle recovery', 'Heavy-duty recovery for LCVs and trucks.', 'TOWING', ['HEAVY_DUTY'], ['WINCH'], ['LCV', 'HCV'], 2, 'truck', 7),
  cat('JUMP_START', 'Battery jump-start', 'On-site jump-start for a flat battery.', 'ONSITE', ['SERVICE_VAN', 'FLATBED', 'WHEEL_LIFT'], ['JUMP_STARTER'], [], 1, 'battery', 8),
  cat('FLAT_TYRE', 'Flat-tyre assistance', 'Spare-wheel change or puncture repair on site.', 'ONSITE', ['SERVICE_VAN', 'FLATBED', 'WHEEL_LIFT'], ['TYRE_KIT'], [], 1, 'tyre', 9),
  cat('FUEL_DELIVERY', 'Fuel delivery', 'Emergency fuel (charged at actuals) to get you to the nearest pump.', 'ONSITE', ['SERVICE_VAN'], ['FUEL_CAN'], ['TWO_WHEELER', 'HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM'], 1, 'fuel', 10),
  cat('LOCKOUT', 'Lockout assistance', 'Non-destructive vehicle entry when keys are locked inside.', 'ONSITE', ['SERVICE_VAN'], ['LOCKOUT_KIT'], ['HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM'], 1, 'key', 11),
];
const catByKey = (key: string) => categories.find((c) => c.key === key)!;

// ─── People ───────────────────────────────────────────────────────────

const PERMS_DISPATCHER = ['booking:read_any', 'booking:manage', 'booking:override', 'dispatch:manage', 'employee:read', 'fleet:read', 'customer:read', 'pricing:read', 'incident:manage', 'support:manage', 'reports:read'];
const PERMS_FINANCE = ['finance:read', 'finance:manage', 'payroll:manage', 'reports:read', 'customer:read', 'pricing:read', 'employee:read', 'fleet:read', 'booking:read_any'];
export const ALL_PERMISSIONS = [
  'customer:self', 'driver:self', 'booking:read_any', 'booking:manage', 'booking:override', 'dispatch:manage', 'employee:read', 'employee:manage', 'employee:verify', 'employee:documents',
  'fleet:read', 'fleet:manage', 'customer:read', 'customer:manage', 'pricing:read', 'pricing:manage', 'pricing:approve_override', 'finance:read', 'finance:manage', 'payroll:manage',
  'reports:read', 'support:manage', 'incident:manage', 'membership:manage', 'settings:manage', 'audit:read', 'roles:manage',
];
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  customer: ['customer:self'],
  driver: ['driver:self'],
  worker: ['driver:self'],
  dispatcher: PERMS_DISPATCHER,
  finance: PERMS_FINANCE,
  admin: ALL_PERMISSIONS,
};
export const permissionsFor = (roles: Role[]) => [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))];

let empSeq = 0;
function baseUser(id: string, fullName: string, phone: string, roles: Role[], createdDaysAgo: number, email: string | null = null): GUser {
  return { id, fullName, phone, email, status: 'ACTIVE', roles, photoUrl: null, isSample: true, lastLoginAt: iso(NOW - between(0.1, 30) * HOUR), createdAt: iso(NOW - createdDaysAgo * DAY), updatedAt: iso(NOW - 2 * DAY), deletedAt: null, customerProfile: null, workerProfile: null, driverProfile: null, availability: null };
}
function worker(p: Partial<GWorkerProfile> & Pick<GWorkerProfile, 'employmentType'>, joinedDaysAgo: number): GWorkerProfile {
  const n = ++empSeq;
  return {
    id: `wp_${n}`,
    employeeCode: `EMP${String(n).padStart(4, '0')}`,
    partnerCompany: null,
    payFrequency: p.employmentType === 'SALARIED' ? 'MONTHLY' : null,
    baseSalary: null,
    commissionBps: null,
    perJobAmount: null,
    verificationStatus: 'APPROVED',
    verificationNote: null,
    verifiedById: 'u_admin',
    verifiedAt: iso(NOW - (joinedDaysAgo - 3) * DAY),
    skills: [],
    trainingNotes: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    payoutMethod: 'BANK',
    payoutDetailsMasked: 'XXXXXX4821',
    joinedAt: iso(NOW - joinedDaysAgo * DAY),
    zoneIds: [],
    ...p,
  };
}

function staff(id: string, name: string, email: string, phone: string, role: Role, salary: number): GUser {
  const u = baseUser(id, name, phone, [role], 520, email);
  u.workerProfile = worker({ employmentType: 'SALARIED', baseSalary: salary, zoneIds: ['zn_blr_central'] }, 500);
  return u;
}

const users: GUser[] = [
  staff('u_admin', 'Asha Rao', 'admin@towpilot.local', '+919000000001', 'admin', 5500000),
  staff('u_dispatch', 'Vikram Shetty', 'dispatch@towpilot.local', '+919000000002', 'dispatcher', 3000000),
  staff('u_finance', 'Neha Iyer', 'finance@towpilot.local', '+919000000003', 'finance', 3200000),
];

interface DriverSpec {
  id: string;
  name: string;
  phone: string;
  emp: GWorkerProfile['employmentType'];
  zones: string[];
  truck: string | null;
  home: [number, number];
  heavy?: boolean;
  joined: number;
}
const driverSpecs: DriverSpec[] = [
  { id: 'u_drv_ravi', name: 'Ravi Kumar', phone: '+919000000011', emp: 'COMMISSION', zones: ['zn_blr_central', 'zn_blr_east'], truck: 'trk_ka01tp1001', home: [12.9352, 77.6245], joined: 420 },
  { id: 'u_drv_imran', name: 'Imran Pasha', phone: '+919000000012', emp: 'JOB_BASED', zones: ['zn_blr_central'], truck: 'trk_ka01tp1002', home: [12.9719, 77.6412], joined: 380 },
  { id: 'u_drv_suresh', name: 'Suresh Gowda', phone: '+919000000013', emp: 'SALARIED', zones: ['zn_blr_east', 'zn_blr_central'], truck: 'trk_ka03tp2001', home: [12.9698, 77.75], joined: 610 },
  { id: 'u_drv_anil', name: 'Anil Reddy', phone: '+919000000014', emp: 'PARTNER', zones: ['zn_blr_central'], truck: 'trk_ka01tp3001', home: [12.9784, 77.5718], joined: 300 },
  { id: 'u_drv_kiran', name: 'Kiran Naik', phone: '+919000000015', emp: 'JOB_BASED', zones: ['zn_blr_central', 'zn_blr_east', 'zn_blr_south'], truck: 'trk_ka01tp4001', home: [12.9141, 77.6411], joined: 260 },
  { id: 'u_drv_manju', name: 'Manjunath Hegde', phone: '+919000000016', emp: 'SALARIED', zones: ['zn_blr_north', 'zn_blr_central'], truck: 'trk_ka01tp5001', home: [13.0358, 77.597], heavy: true, joined: 700 },
  { id: 'u_drv_prakash', name: 'Prakash Patil', phone: '+919000000017', emp: 'COMMISSION', zones: ['zn_blr_south', 'zn_blr_central'], truck: 'trk_ka51tp7001', home: [12.8452, 77.6602], joined: 190 },
  { id: 'u_drv_farhan', name: 'Farhan Sheikh', phone: '+919000000018', emp: 'JOB_BASED', zones: ['zn_blr_north'], truck: 'trk_ka50tp8001', home: [13.1007, 77.5963], joined: 150 },
  { id: 'u_drv_sanjay', name: 'Sanjay Murthy', phone: '+919000000019', emp: 'COMMISSION', zones: ['zn_blr_north'], truck: null, home: [13.0285, 77.5409], joined: 6 },
];
for (const d of driverSpecs) {
  const u = baseUser(d.id, d.name, d.phone, ['driver'], d.joined + 5);
  u.workerProfile = worker(
    {
      employmentType: d.emp,
      baseSalary: d.emp === 'SALARIED' ? 2400000 : null,
      commissionBps: d.emp === 'COMMISSION' ? 2500 : null,
      perJobAmount: d.emp === 'JOB_BASED' || d.emp === 'PARTNER' ? 45000 : null,
      partnerCompany: d.emp === 'PARTNER' ? 'Nandi Partner Towing Co.' : null,
      skills: ['flatbed', 'winching', ...(d.heavy ? ['heavy recovery'] : []), ...(d.id === 'u_drv_kiran' ? ['battery service', 'tyre change'] : [])],
      emergencyContactName: 'Family contact',
      emergencyContactPhone: '+919000009999',
      payoutMethod: d.emp === 'PARTNER' ? 'BANK' : 'UPI',
      payoutDetailsMasked: d.emp === 'PARTNER' ? 'XXXXXX7310' : `${d.name.split(' ')[0]!.toLowerCase()}@upi`,
      zoneIds: d.zones,
      ...(d.id === 'u_drv_sanjay' ? { verificationStatus: 'DOCUMENTS_REQUESTED' as const, verificationNote: 'Please upload a clearer copy of the driving licence (back side).', verifiedById: null, verifiedAt: null } : {}),
    },
    d.joined,
  );
  u.driverProfile = { licenceNumberMask: `KA0${(d.joined % 9) + 1}**********${String(1000 + d.joined).slice(-4)}`, licenceClass: d.heavy ? 'LMV, HGMV' : 'LMV, MGV', licenceExpiry: iso(NOW + between(200, 2000) * DAY), canLeadTeam: true, heavyVehicleCert: !!d.heavy };
  u.availability = { status: 'AVAILABLE', zoneId: d.zones[0]!, lastLat: d.home[0] + between(-0.01, 0.01), lastLng: d.home[1] + between(-0.01, 0.01), lastAccuracyM: 12, lastLocationAt: iso(NOW - between(10, 50) * 1000), locationSharing: true, statusSince: iso(NOW - between(1, 5) * HOUR) };
  if (d.id === 'u_drv_sanjay') {
    u.status = 'PENDING';
    u.availability = { ...u.availability, status: 'OFF_DUTY', locationSharing: false, lastLocationAt: iso(NOW - 2 * DAY) };
  }
  users.push(u);
}
{
  const w = baseUser('u_wrk_lokesh', 'Lokesh Babu', '+919000000021', ['worker'], 240);
  w.workerProfile = worker({ employmentType: 'JOB_BASED', perJobAmount: 25000, skills: ['winching', 'rigging'], zoneIds: ['zn_blr_central', 'zn_blr_north'] }, 235);
  w.availability = { status: 'AVAILABLE', zoneId: 'zn_blr_central', lastLat: 13.0285, lastLng: 77.5409, lastAccuracyM: 15, lastLocationAt: iso(NOW - 40_000), locationSharing: true, statusSince: iso(NOW - 3 * HOUR) };
  users.push(w);
}

interface CustomerSpec {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  days: number;
  vehicles: [VehicleClass, string, string, string, GVehicle['fuelType'], string, number][];
  home: [number, number, string];
}
const customerSpecs: CustomerSpec[] = [
  { id: 'u_cus_priya', name: 'Priya Sharma', phone: '+919000000101', email: 'priya.sharma@example.com', days: 320, vehicles: [['SEDAN', 'KA05MN4321', 'Honda', 'City', 'PETROL', 'Pearl white', 2021], ['TWO_WHEELER', 'KA05HJ8899', 'Royal Enfield', 'Classic 350', 'PETROL', 'Gunmetal grey', 2022]], home: [12.9784, 77.6408, '14, 12th Main Road, HAL 2nd Stage, Indiranagar, Bengaluru 560008'] },
  { id: 'u_cus_arjun', name: 'Arjun Menon', phone: '+919000000102', email: 'arjun.menon@example.com', days: 260, vehicles: [['SUV', 'KA03PQ7788', 'Tata', 'Nexon EV', 'ELECTRIC', 'Teal blue', 2023]], home: [12.9698, 77.7499, 'Prestige Shantiniketan, Whitefield, Bengaluru 560048'] },
  { id: 'u_cus_meera', name: 'Meera Nair', phone: '+919000000103', email: null, days: 210, vehicles: [['HATCHBACK', 'KA51AB1122', 'Maruti Suzuki', 'Swift', 'PETROL', 'Red', 2019]], home: [12.9141, 77.6411, '27th Main, Sector 2, HSR Layout, Bengaluru 560102'] },
  { id: 'u_cus_rahul', name: 'Rahul Desai', phone: '+919000000104', email: 'rahul@sahyadri-logistics.example', days: 300, vehicles: [['LCV', 'KA01FL0001', 'Tata', 'Ace Gold', 'DIESEL', 'White', 2020], ['SEDAN', 'KA01FL0002', 'Toyota', 'Etios', 'DIESEL', 'Silver', 2019], ['LCV', 'KA01FL0003', 'Mahindra', 'Bolero Pik-Up', 'DIESEL', 'White', 2022]], home: [13.0285, 77.5196, 'Plot 42, Peenya Industrial Area, Bengaluru 560058'] },
  { id: 'u_cus_sneha', name: 'Sneha Kulkarni', phone: '+919000000105', email: 'sneha.k@example.com', days: 180, vehicles: [['SUV', 'KA04MK5566', 'Hyundai', 'Creta', 'DIESEL', 'Phantom black', 2022]], home: [13.0358, 77.597, 'Hebbal Kempapura, Bengaluru 560024'] },
  { id: 'u_cus_rohan', name: 'Rohan Das', phone: '+919000000106', email: null, days: 150, vehicles: [['HATCHBACK', 'KA02JK7788', 'Hyundai', 'i20', 'PETROL', 'Fiery red', 2020]], home: [12.9784, 77.5718, 'Dr Rajkumar Road, Rajajinagar, Bengaluru 560010'] },
  { id: 'u_cus_fatima', name: 'Fatima Khan', phone: '+919000000107', email: 'fatima.khan@example.com', days: 140, vehicles: [['SUV', 'KA41AB9090', 'Toyota', 'Innova Crysta', 'DIESEL', 'Silver', 2021]], home: [12.8452, 77.6602, 'Neeladri Nagar, Electronic City Phase 1, Bengaluru 560100'] },
  { id: 'u_cus_deepak', name: 'Deepak Joshi', phone: '+919000000108', email: 'deepak.joshi@example.com', days: 120, vehicles: [['PREMIUM', 'KA01MX3030', 'BMW', '330Li', 'PETROL', 'Mineral white', 2023]], home: [12.9716, 77.5946, 'Lavelle Road, Bengaluru 560001'] },
  { id: 'u_cus_kavya', name: 'Kavya Reddy', phone: '+919000000109', email: null, days: 90, vehicles: [['TWO_WHEELER', 'KA53EX1212', 'Honda', 'Activa 6G', 'PETROL', 'Matte grey', 2022]], home: [12.9063, 77.5857, '24th Main, JP Nagar 6th Phase, Bengaluru 560078'] },
  { id: 'u_cus_aditya', name: 'Aditya Bhat', phone: '+919000000110', email: 'aditya.bhat@example.com', days: 75, vehicles: [['HATCHBACK', 'KA50P4455', 'Maruti Suzuki', 'Baleno', 'PETROL', 'Nexa blue', 2021]], home: [13.1007, 77.5963, 'Yelahanka New Town, Bengaluru 560064'] },
  { id: 'u_cus_nikhil', name: 'Nikhil Rao', phone: '+919000000111', email: null, days: 2, vehicles: [['SEDAN', 'KA03NR6060', 'Skoda', 'Slavia', 'PETROL', 'Crystal blue', 2024]], home: [12.9592, 77.6974, 'Marathahalli, Bengaluru 560037'] },
  { id: 'u_cus_lakshmi', name: 'Lakshmi Iyengar', phone: '+919000000112', email: 'lakshmi.i@example.com', days: 60, vehicles: [['HATCHBACK', 'KA05LI2323', 'Tata', 'Tiago', 'CNG', 'Arizona blue', 2023]], home: [12.9279, 77.5826, 'Jayanagar 4th Block, Bengaluru 560011'] },
];
/** More customers so 90 days of volume is spread realistically (named ones above drive the stories). */
export const EXTRA_CUSTOMER_IDS: string[] = [];
{
  const names = ['Ananya Gupta', 'Karthik Subramanian', 'Pooja Hegde', 'Siddharth Jain', 'Divya Krishnan', 'Varun Shetty', 'Ishita Bose', 'Manoj Kumar', 'Shreya Patil', 'Harish Gowda', 'Nandini Rao', 'Abhishek Verma', 'Ritu Agarwal', 'Sameer Kulkarni', 'Bhavana Murthy', 'Gaurav Malhotra', 'Keerthi Prasad', 'Naveen Chandra', 'Swati Mishra', 'Tarun Nair', 'Anjali Pillai', 'Vivek Sharma', 'Rekha Srinivas', 'Imtiaz Ahmed', 'Sonal Mehta', 'Prateek Singh', 'Yamini Reddy', 'Arvind Iyer', 'Chaitra Bhat', 'Rajesh Naidu', 'Megha Joshi', 'Suhas Kamath', 'Zoya Mirza', 'Kunal Kapoor', 'Lavanya Raghavan', 'Omkar Desai'];
  const cars: [VehicleClass, string, string, GVehicle['fuelType']][] = [['HATCHBACK', 'Maruti Suzuki', 'Wagon R', 'CNG'], ['SEDAN', 'Hyundai', 'Verna', 'PETROL'], ['SUV', 'Mahindra', 'XUV700', 'DIESEL'], ['HATCHBACK', 'Tata', 'Altroz', 'PETROL'], ['SUV', 'Kia', 'Seltos', 'PETROL'], ['TWO_WHEELER', 'TVS', 'Jupiter', 'PETROL'], ['SEDAN', 'Honda', 'Amaze', 'PETROL'], ['SUV', 'MG', 'ZS EV', 'ELECTRIC'], ['TWO_WHEELER', 'Bajaj', 'Pulsar NS200', 'PETROL'], ['PREMIUM', 'Mercedes-Benz', 'C-Class', 'DIESEL']];
  const areas: [number, number, string][] = [[12.9352, 77.6245, 'Koramangala'], [12.9719, 77.6412, 'Indiranagar'], [12.9141, 77.6411, 'HSR Layout'], [13.0358, 77.597, 'Hebbal'], [12.9592, 77.6974, 'Marathahalli'], [12.9063, 77.5857, 'JP Nagar'], [12.9279, 77.5826, 'Jayanagar'], [12.8452, 77.6602, 'Electronic City'], [13.1007, 77.5963, 'Yelahanka'], [12.9166, 77.6101, 'BTM Layout']];
  names.forEach((name, i) => {
    const id = `u_cus_x${String(i + 1).padStart(2, '0')}`;
    const [cls, make, model, fuel] = cars[i % cars.length]!;
    const a = areas[i % areas.length]!;
    EXTRA_CUSTOMER_IDS.push(id);
    customerSpecs.push({ id, name, phone: `+9190000${String(201 + i).padStart(5, '0')}`, email: i % 3 ? `${name.split(' ')[0]!.toLowerCase()}@example.com` : null, days: 95 + ((i * 37) % 300), vehicles: [[cls, `KA${String(1 + (i % 53)).padStart(2, '0')}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(77 + (i % 13))}${String(1000 + i * 271).slice(-4)}`, make, model, fuel, 'Grey', 2018 + (i % 7)]], home: [a[0] + 0.004, a[1] - 0.003, `${a[2]}, Bengaluru`] });
  });
}

const vehicles: GVehicle[] = [];
const savedAddresses: GSavedAddress[] = [];
const emergencyContacts: GEmergencyContact[] = [];
for (const c of customerSpecs) {
  const u = baseUser(c.id, c.name, c.phone, ['customer'], c.days, c.email);
  u.customerProfile = { preferredLanguage: 'en', termsAcceptedAt: u.createdAt, privacyConsentAt: u.createdAt, consentVersion: '2026-10', marketingConsent: chance(0.4), locationConsent: true, notifySms: true, notifyEmail: !!c.email, notifyPush: true };
  users.push(u);
  c.vehicles.forEach(([cls, reg, make, model, fuel, color, year], i) =>
    vehicles.push({ id: `veh_${reg.toLowerCase()}`, ownerUserId: c.id, fleetAccountId: c.id === 'u_cus_rahul' ? 'fa_sahyadri' : null, vehicleClass: cls, registrationNumber: reg, make, model, fuelType: fuel, color, year, photoUrls: [], isSample: true, createdAt: iso(NOW - (c.days - i * 5) * DAY), updatedAt: iso(NOW - (c.days - i * 5) * DAY), deletedAt: null }),
  );
  savedAddresses.push({ id: `addr_${c.id.slice(6)}_home`, userId: c.id, label: 'Home', address: c.home[2], lat: c.home[0], lng: c.home[1], landmark: null, createdAt: iso(NOW - c.days * DAY) });
  emergencyContacts.push({ id: `ec_${c.id.slice(6)}`, userId: c.id, name: c.id === 'u_cus_priya' ? 'Rohit Sharma' : 'Family contact', phone: '+919000009998', relationship: c.id === 'u_cus_priya' ? 'Spouse' : 'Family', createdAt: iso(NOW - c.days * DAY) });
}
savedAddresses.push({ id: 'addr_priya_work', userId: 'u_cus_priya', label: 'Work', address: 'Embassy Golf Links Business Park, Domlur, Bengaluru 560071', lat: 12.9539, lng: 77.6413, landmark: 'Gate 2', createdAt: iso(NOW - 200 * DAY) });
users.find((u) => u.id === 'u_cus_aditya')!.status = 'ACTIVE';

export const userById = (id: string | null | undefined) => (id ? users.find((u) => u.id === id) : undefined);
export const userName = (id: string | null | undefined) => userById(id)?.fullName ?? 'Unknown';

// ─── Fleet ────────────────────────────────────────────────────────────

const truckSpecs: [string, string, TruckType, VehicleClass, string, string[]][] = [
  ['trk_ka01tp1001', 'KA01TP1001', 'FLATBED', 'PREMIUM', 'zn_blr_central', ['FLATBED_DECK', 'WINCH', 'WHEEL_SKATES', 'SAFETY_CONES', 'RECOVERY_STRAPS', 'EV_SAFE_KIT', 'JUMP_STARTER', 'TYRE_KIT']],
  ['trk_ka01tp1002', 'KA01TP1002', 'WHEEL_LIFT', 'SUV', 'zn_blr_central', ['WHEEL_LIFT', 'DOLLIES', 'GO_JACKS', 'SAFETY_CONES', 'JUMP_STARTER', 'TYRE_KIT', 'RECOVERY_STRAPS']],
  ['trk_ka03tp2001', 'KA03TP2001', 'FLATBED', 'PREMIUM', 'zn_blr_east', ['FLATBED_DECK', 'WINCH', 'WHEEL_SKATES', 'SAFETY_CONES', 'GO_JACKS', 'RECOVERY_STRAPS', 'EV_SAFE_KIT']],
  ['trk_ka01tp3001', 'KA01TP3001', 'BIKE_CARRIER', 'TWO_WHEELER', 'zn_blr_central', ['SAFETY_CONES', 'RECOVERY_STRAPS']],
  ['trk_ka01tp4001', 'KA01TP4001', 'SERVICE_VAN', 'TWO_WHEELER', 'zn_blr_central', ['JUMP_STARTER', 'TYRE_KIT', 'FUEL_CAN', 'LOCKOUT_KIT', 'SAFETY_CONES']],
  ['trk_ka01tp5001', 'KA01TP5001', 'HEAVY_DUTY', 'HCV', 'zn_blr_north', ['WINCH', 'RECOVERY_STRAPS', 'SAFETY_CONES', 'WHEEL_LIFT']],
  ['trk_ka51tp7001', 'KA51TP7001', 'FLATBED', 'PREMIUM', 'zn_blr_south', ['FLATBED_DECK', 'WINCH', 'WHEEL_SKATES', 'SAFETY_CONES', 'RECOVERY_STRAPS']],
  ['trk_ka50tp8001', 'KA50TP8001', 'WHEEL_LIFT', 'SUV', 'zn_blr_north', ['WHEEL_LIFT', 'DOLLIES', 'SAFETY_CONES', 'JUMP_STARTER', 'TYRE_KIT']],
  ['trk_ka01tp6001', 'KA01TP6001', 'FLATBED', 'SUV', 'zn_blr_central', ['FLATBED_DECK', 'WINCH', 'SAFETY_CONES']],
];
const trucks: GTruck[] = truckSpecs.map(([id, reg, type, max, zoneId, eq], i) => {
  const odo = Math.round(between(22000, 94000));
  const t: GTruck = {
    id,
    registrationNumber: reg,
    truckType: type,
    make: type === 'SERVICE_VAN' ? 'Mahindra' : type === 'BIKE_CARRIER' ? 'Ashok Leyland' : 'Tata',
    model: type === 'SERVICE_VAN' ? 'Supro Service Van' : type === 'HEAVY_DUTY' ? 'Signa 2823 Recovery' : type === 'BIKE_CARRIER' ? 'Dost+ Bike Carrier' : 'Ultra 1518 Tow',
    maxLoadKg: type === 'HEAVY_DUTY' ? 18000 : type === 'BIKE_CARRIER' || type === 'SERVICE_VAN' ? 600 : 3500,
    maxVehicleClass: max,
    status: 'AVAILABLE',
    zoneId,
    assignedDriverUserId: driverSpecs.find((d) => d.truck === id)?.id ?? null,
    odometerKm: odo,
    lastServiceAt: iso(NOW - between(20, 170) * DAY),
    lastServiceOdometerKm: odo - Math.round(between(1500, 9600)),
    serviceIntervalKm: 10000,
    serviceIntervalDays: 180,
    insuranceExpiry: iso(NOW + (i === 2 ? -6 : between(25, 300)) * DAY),
    fitnessExpiry: iso(NOW + between(60, 500) * DAY),
    permitExpiry: iso(NOW + between(60, 500) * DAY),
    pucExpiry: iso(NOW + (i === 4 ? 9 : between(20, 180)) * DAY),
    nextInspectionDue: iso(NOW + (i === 0 ? -3 : between(5, 60)) * DAY),
    notes: null,
    isSample: true,
    createdAt: iso(NOW - 500 * DAY),
    updatedAt: iso(NOW - 3 * DAY),
    equipment: eq.map((type, j) => ({ id: `eq_${id.slice(4)}_${j}`, truckId: id, type, status: 'OK', notes: null, updatedAt: iso(NOW - between(5, 60) * DAY) })),
  };
  return t;
});
{
  const spare = trucks.find((t) => t.id === 'trk_ka01tp6001')!;
  spare.status = 'MAINTENANCE';
  spare.notes = 'Hydraulic bed cylinder leaking — at the workshop.';
  trucks.find((t) => t.id === 'trk_ka01tp1002')!.equipment.find((e) => e.type === 'DOLLIES')!.status = 'DAMAGED';
  trucks.find((t) => t.id === 'trk_ka01tp1002')!.equipment.find((e) => e.type === 'DOLLIES')!.notes = 'One caster wheel cracked';
}
export const truckById = (id: string | null | undefined) => (id ? trucks.find((t) => t.id === id) : undefined);
export const truckForDriver = (userId: string) => trucks.find((t) => t.assignedDriverUserId === userId);

const maintenance: GMaintenance[] = [];
for (const t of trucks) {
  maintenance.push({ id: `mnt_${t.id.slice(4)}_svc`, truckId: t.id, type: 'SERVICE', description: 'Periodic service: engine oil, filters, brake inspection', odometerKm: t.lastServiceOdometerKm, cost: Math.round(between(1200000, 2400000)), performedAt: t.lastServiceAt!, nextDueAt: iso(new Date(t.lastServiceAt!).getTime() + 180 * DAY), expenseId: null, createdById: 'u_admin', createdAt: t.lastServiceAt! });
  maintenance.push({ id: `mnt_${t.id.slice(4)}_insp`, truckId: t.id, type: 'INSPECTION', description: 'Monthly safety inspection: lights, winch cable, straps', odometerKm: t.odometerKm - 700, cost: 0, performedAt: iso(NOW - between(8, 25) * DAY), nextDueAt: t.nextInspectionDue, expenseId: null, createdById: 'u_dispatch', createdAt: iso(NOW - 10 * DAY) });
}
maintenance.push({ id: 'mnt_spare_repair', truckId: 'trk_ka01tp6001', type: 'REPAIR', description: 'Hydraulic cylinder seal replacement (in progress)', odometerKm: 61200, cost: 3850000, performedAt: iso(NOW - 2 * DAY), nextDueAt: null, expenseId: null, createdById: 'u_admin', createdAt: iso(NOW - 2 * DAY) });
maintenance.push({ id: 'mnt_heavy_breakdown', truckId: 'trk_ka01tp5001', type: 'BREAKDOWN', description: 'Alternator failure on ORR — recovered by partner', odometerKm: 80110, cost: 1450000, performedAt: iso(NOW - 41 * DAY), nextDueAt: null, expenseId: null, createdById: 'u_dispatch', createdAt: iso(NOW - 41 * DAY) });

// ─── Commercial: memberships, promos, fleet accounts ─────────────────

const memberships: GMembership[] = [
  { id: 'mem_annual', code: 'ROADSAFE_ANNUAL', name: 'RoadSafe Annual', description: 'Up to 3 covered towing or on-site services a year with extra free kilometres and 10% off.', price: 199900, durationMonths: 12, includedServices: 3, includedKmPerService: 15, discountBps: 1000, coveredCategoryKeys: ['CAR_TOW', 'BIKE_TOW', 'FLATBED_TOW', 'WHEEL_LIFT_TOW', 'JUMP_START', 'FLAT_TYRE', 'FUEL_DELIVERY', 'LOCKOUT'], exclusions: 'Accident recovery, commercial vehicles, fuel cost, tolls and parking. Services outside active zones.', renewalTerms: 'Does not auto-renew. Renew any time before expiry.', forFleet: false, active: true, createdAt: iso(NOW - 400 * DAY), updatedAt: iso(NOW - 60 * DAY) },
  { id: 'mem_monthly', code: 'ROADSAFE_MONTHLY', name: 'RoadSafe Monthly', description: 'One covered on-site service per month and 5% off towing.', price: 24900, durationMonths: 1, includedServices: 1, includedKmPerService: 0, discountBps: 500, coveredCategoryKeys: ['JUMP_START', 'FLAT_TYRE', 'FUEL_DELIVERY', 'LOCKOUT', 'CAR_TOW', 'BIKE_TOW'], exclusions: 'Accident and commercial recovery, tolls and parking.', renewalTerms: 'Monthly; does not auto-renew.', forFleet: false, active: true, createdAt: iso(NOW - 400 * DAY), updatedAt: iso(NOW - 60 * DAY) },
  { id: 'mem_fleet', code: 'FLEET_ASSIST_PRO', name: 'Fleet Assist Pro', description: '20 covered services a year across the fleet, priority dispatch and 15% off all towing.', price: 4999900, durationMonths: 12, includedServices: 20, includedKmPerService: 20, discountBps: 1500, coveredCategoryKeys: ALL_KEYS, exclusions: 'Tolls, parking and fuel cost.', renewalTerms: 'Annual contract; renewal by agreement.', forFleet: true, active: true, createdAt: iso(NOW - 300 * DAY), updatedAt: iso(NOW - 30 * DAY) },
];
const subscriptions: GSubscription[] = [
  { id: 'sub_priya_annual', membershipId: 'mem_annual', userId: 'u_cus_priya', fleetAccountId: null, status: 'ACTIVE', startsAt: iso(NOW - 140 * DAY), endsAt: iso(NOW + 225 * DAY), servicesUsed: 1, cancelledAt: null, createdAt: iso(NOW - 140 * DAY), updatedAt: iso(NOW - 40 * DAY) },
  { id: 'sub_arjun_monthly', membershipId: 'mem_monthly', userId: 'u_cus_arjun', fleetAccountId: null, status: 'ACTIVE', startsAt: iso(NOW - 12 * DAY), endsAt: iso(NOW + 18 * DAY), servicesUsed: 0, cancelledAt: null, createdAt: iso(NOW - 12 * DAY), updatedAt: iso(NOW - 12 * DAY) },
  { id: 'sub_sneha_monthly', membershipId: 'mem_monthly', userId: 'u_cus_sneha', fleetAccountId: null, status: 'EXPIRED', startsAt: iso(NOW - 75 * DAY), endsAt: iso(NOW - 45 * DAY), servicesUsed: 1, cancelledAt: null, createdAt: iso(NOW - 75 * DAY), updatedAt: iso(NOW - 45 * DAY) },
  { id: 'sub_deepak_annual', membershipId: 'mem_annual', userId: 'u_cus_deepak', fleetAccountId: null, status: 'ACTIVE', startsAt: iso(NOW - 100 * DAY), endsAt: iso(NOW + 265 * DAY), servicesUsed: 0, cancelledAt: null, createdAt: iso(NOW - 100 * DAY), updatedAt: iso(NOW - 100 * DAY) },
  { id: 'sub_sahyadri_fleet', membershipId: 'mem_fleet', userId: null, fleetAccountId: 'fa_sahyadri', status: 'ACTIVE', startsAt: iso(NOW - 90 * DAY), endsAt: iso(NOW + 275 * DAY), servicesUsed: 6, cancelledAt: null, createdAt: iso(NOW - 90 * DAY), updatedAt: iso(NOW - 5 * DAY) },
];
const promos: GPromo[] = [
  { id: 'promo_welcome10', code: 'WELCOME10', description: '10% off your first booking', discountBps: 1000, maxDiscount: 30000, validFrom: iso(NOW - 60 * DAY), validTo: iso(NOW + 300 * DAY), maxUses: 1000, usedCount: 87, active: true, createdAt: iso(NOW - 60 * DAY) },
  { id: 'promo_diwali15', code: 'DIWALI15', description: 'Festive season: 15% off towing (max ₹500)', discountBps: 1500, maxDiscount: 50000, validFrom: iso(NOW - 10 * DAY), validTo: iso(NOW + 12 * DAY), maxUses: 500, usedCount: 41, active: true, createdAt: iso(NOW - 12 * DAY) },
  { id: 'promo_monsoon20', code: 'MONSOON20', description: 'Monsoon rescue offer (expired)', discountBps: 2000, maxDiscount: 40000, validFrom: iso(NOW - 150 * DAY), validTo: iso(NOW - 60 * DAY), maxUses: 300, usedCount: 212, active: false, createdAt: iso(NOW - 150 * DAY) },
];
const fleetAccounts: GFleetAccount[] = [
  {
    id: 'fa_sahyadri',
    name: 'Sahyadri Logistics Pvt Ltd',
    gstin: '29ABCDE1234F1Z5',
    billingEmail: 'accounts@sahyadri-logistics.example',
    billingPhone: '+918000000104',
    billingAddress: 'Plot 42, Peenya Industrial Area, Bengaluru 560058',
    creditLimit: 5000000,
    paymentTermsDays: 30,
    status: 'ACTIVE',
    isSample: true,
    createdAt: iso(NOW - 300 * DAY),
    updatedAt: iso(NOW - 20 * DAY),
    members: [{ userId: 'u_cus_rahul', isManager: true, createdAt: iso(NOW - 300 * DAY) }],
    contracts: [{ id: 'fc_sahyadri_fy27', name: 'FY27 Fleet Support Contract', startsAt: iso(NOW - 90 * DAY), endsAt: iso(NOW + 275 * DAY), active: true, discountBps: 1200, slaResponseMinutes: 45, monthlyServiceLimit: 20, notes: 'Priority dispatch for LCVs on Tumakuru Road corridor.', createdAt: iso(NOW - 90 * DAY), updatedAt: iso(NOW - 90 * DAY) }],
  },
  {
    id: 'fa_greenline',
    name: 'Greenline Cabs LLP',
    gstin: '29FGHIJ5678K1Z2',
    billingEmail: 'billing@greenline-cabs.example',
    billingPhone: '+918000000220',
    billingAddress: 'Outer Ring Road, Bellandur, Bengaluru 560103',
    creditLimit: 2500000,
    paymentTermsDays: 15,
    status: 'ACTIVE',
    isSample: true,
    createdAt: iso(NOW - 45 * DAY),
    updatedAt: iso(NOW - 45 * DAY),
    members: [{ userId: 'u_cus_lakshmi', isManager: true, createdAt: iso(NOW - 45 * DAY) }],
    contracts: [{ id: 'fc_greenline_pilot', name: 'Pilot — EV cab support', startsAt: iso(NOW - 45 * DAY), endsAt: iso(NOW + 45 * DAY), active: true, discountBps: 800, slaResponseMinutes: 60, monthlyServiceLimit: 10, notes: null, createdAt: iso(NOW - 45 * DAY), updatedAt: iso(NOW - 45 * DAY) }],
  },
];

// ─── Bookings ─────────────────────────────────────────────────────────

type Place = readonly [number, number, string];
export const PLACES: Place[] = [
  [12.9352, 77.6245, 'Koramangala 5th Block'],
  [12.9719, 77.6412, 'Indiranagar 100 Feet Road'],
  [12.9141, 77.6411, 'HSR Layout Sector 2'],
  [13.0358, 77.597, 'Hebbal Flyover'],
  [12.9592, 77.6974, 'Marathahalli Bridge'],
  [12.9698, 77.75, 'Whitefield Main Road'],
  [12.9063, 77.5857, 'JP Nagar 6th Phase'],
  [12.9784, 77.5718, 'Rajajinagar 1st Block'],
  [12.8452, 77.6602, 'Electronic City Phase 1'],
  [12.9279, 77.5826, 'Jayanagar 4th Block'],
  [13.0285, 77.5196, 'Peenya Industrial Area'],
  [13.1007, 77.5963, 'Yelahanka New Town'],
  [12.9166, 77.6101, 'BTM Layout 2nd Stage'],
  [12.9591, 77.6484, 'Old Airport Road, Domlur'],
];
const GARAGES: Place[] = [
  [12.9611, 77.6387, 'Shreyas Honda Service, Domlur'],
  [12.9279, 77.6271, 'Koramangala Multi-brand Car Care'],
  [12.9895, 77.7208, 'Whitefield Tata Motors Service Centre'],
  [13.0108, 77.5545, 'Yeshwanthpur Auto Works'],
  [12.8496, 77.6631, 'E-City Hyundai Service'],
  [13.0451, 77.5946, 'Hebbal BMW Service (Navnit)'],
];
const zoneFor = (lat: number, lng: number) => {
  let best = zones[0]!;
  let bestD = Infinity;
  for (const z of zones) {
    const d = (z.centerLat - lat) ** 2 + (z.centerLng - lng) ** 2;
    if (d < bestD) (best = z), (bestD = d);
  }
  return best.id;
};

const HAPPY: BookingStatus[] = ['REQUESTED', 'QUOTED', 'CONFIRMED', 'SEARCHING_FOR_PROVIDER', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
/** Minutes after creation at which each step typically happens. */
const OFFSET: Partial<Record<BookingStatus, number>> = { REQUESTED: 0, QUOTED: 0.3, CONFIRMED: 2, SEARCHING_FOR_PROVIDER: 2.1, ASSIGNED: 3, ACCEPTED: 4, EN_ROUTE: 4.5, ARRIVED: 31, INSPECTING: 33, RECOVERY_AUTHORIZED: 40, LOADING: 42, IN_TRANSIT: 55, DELIVERED: 86, COMPLETED: 87 };
const ONSITE_OFFSET: Partial<Record<BookingStatus, number>> = { DELIVERED: 58, COMPLETED: 59 };
const ACTOR: Partial<Record<BookingStatus, ActorRole>> = { REQUESTED: 'CUSTOMER', QUOTED: 'SYSTEM', CONFIRMED: 'CUSTOMER', SEARCHING_FOR_PROVIDER: 'SYSTEM', ASSIGNED: 'SYSTEM', CANCELLED: 'CUSTOMER', DISPUTED: 'CUSTOMER', REASSIGNMENT_REQUIRED: 'SYSTEM' };

let bookingSeq = 0;
let invoiceSeq = 0;
let receiptSeq = 0;
const bookings: GBooking[] = [];
const ratings: GRating[] = [];
const escalations: GEscalation[] = [];
const incidents: GIncident[] = [];
const invoices: GInvoice[] = [];
const payments: GPayment[] = [];
const refunds: GRefund[] = [];
const creditNotes: GCreditNote[] = [];
const earnings: GEarning[] = [];

export function recommendationFor(c: GCategory, vehicleClass: VehicleClass, a: Assessment): Recommendation {
  const safetyFlags: string[] = [];
  const reasons: string[] = [`${c.name} for a ${vehicleClass.toLowerCase().replace('_', '-')}`];
  const equipment = new Set(c.requiredEquipment);
  let truckTypes = [...c.allowedTruckTypes] as string[];
  let crew = c.defaultCrew;
  let priority: Recommendation['priority'] = 'NORMAL';
  const manualReviewReasons: string[] = [];
  if (a.isEvOrHybrid) {
    safetyFlags.push('EV_HIGH_VOLTAGE');
    if (c.kind === 'TOWING') truckTypes = truckTypes.filter((t) => t === 'FLATBED').length ? ['FLATBED'] : truckTypes;
    equipment.add('EV_SAFE_KIT');
    reasons.push('EV/hybrid: flatbed only, wheels must not turn');
  }
  if (a.blockingTraffic === 'YES') {
    safetyFlags.push('BLOCKING_TRAFFIC');
    priority = 'HIGH';
    reasons.push('Vehicle is blocking traffic');
  }
  if (a.majorDamage === 'YES') {
    equipment.add('WINCH');
    crew = Math.max(crew, 2);
    reasons.push('Major damage: winch and second crew member');
  }
  if (a.hasChildren || a.hasElderly) {
    safetyFlags.push('VULNERABLE_PASSENGERS');
    priority = 'HIGH';
  }
  if (vehicleClass === 'PREMIUM') {
    equipment.add('WHEEL_SKATES');
    manualReviewReasons.push('Premium vehicle: confirm flatbed and insurance cover');
  }
  if (a.wheelsRotate === 'NO' && c.kind === 'TOWING') equipment.add('GO_JACKS');
  return { truckTypes, equipment: [...equipment], crew, priority, safetyFlags, manualReviewReasons, reasons, suggestedCategoryKey: null, crewNote: crew > 1 ? 'Two-person crew recommended for safe recovery' : 'Single operator is sufficient' };
}

export function assessmentFor(key: string, fuel: string, opts: Partial<Assessment> = {}): Assessment {
  const kind = catByKey(key).kind;
  return {
    breakdownType: kind === 'ONSITE' ? (key === 'JUMP_START' ? 'BATTERY' : key === 'FLAT_TYRE' ? 'TYRE' : key === 'FUEL_DELIVERY' ? 'FUEL' : 'LOCKOUT') : key === 'ACCIDENT_RECOVERY' ? 'COLLISION' : pick(['MECHANICAL', 'ENGINE', 'TRANSMISSION'])!,
    engineStarts: key === 'LOCKOUT' ? 'YES' : 'NO',
    wheelsRotate: key === 'ACCIDENT_RECOVERY' ? 'NOT_SURE' : 'YES',
    steeringWorks: 'YES',
    brakesWork: 'YES',
    isStuck: 'NO',
    isOverturned: 'NO',
    isSubmerged: 'NO',
    blockingTraffic: 'NO',
    majorDamage: key === 'ACCIDENT_RECOVERY' ? 'YES' : 'NO',
    isEvOrHybrid: fuel === 'ELECTRIC' || fuel === 'HYBRID',
    accessRestriction: 'NONE',
    hasChildren: false,
    hasElderly: false,
    needsAccessibility: false,
    passengersNeedingTransport: 0,
    notes: null,
    ...opts,
  };
}

/** Builds a quote record (items + totals) from the pricing engine. */
export function quoteRecord(bookingId: string, version: number, kind: GQuote['kind'], status: GQuote['status'], serviceKey: string, input: QuoteInput, createdAt: number, extra: Partial<GQuote> = {}): GQuote {
  const rc = rateCardFor(serviceKey);
  const p: PriceBreakdown = computePrice(rc, input);
  const id = extra.id ?? `${bookingId}_q${version}`;
  return {
    id,
    bookingId,
    version,
    kind,
    status,
    rateCardId: rc.id,
    rateCardVersion: rc.version,
    pricingSnapshot: { rules: rc, input, breakdown: p },
    assumptions: { notes: p.notes, pickupDistance: input.pickupDistanceKm != null ? `${input.pickupDistanceKm} km estimated driver travel` : undefined },
    subtotal: p.subtotal,
    discountTotal: p.discountTotal,
    taxableValue: p.taxableValue,
    taxTotal: p.taxTotal,
    passThroughTotal: p.passThroughTotal,
    total: p.total,
    currency: 'INR',
    expiresAt: iso(createdAt + rc.quoteValidityMin * MIN),
    reason: null,
    requestedById: null,
    internalApprovedById: null,
    decidedById: null,
    decidedAt: null,
    createdAt: iso(createdAt),
    items: p.lines.map((l, i) => ({ id: `${id}_i${i}`, code: l.code, description: l.description, quantity: l.quantity, unitAmount: l.unitAmount, amount: l.amount, taxable: l.taxable, isPassThrough: l.isPassThrough, isEstimate: l.isEstimate, isAdditional: l.isAdditional, reason: l.reason ?? null, sortOrder: i })),
    ...extra,
  };
}

export function nextBookingCode(createdAt = Date.now()) {
  const d = new Date(createdAt + 5.5 * HOUR);
  return `TP-${d.toISOString().slice(2, 10).replace(/-/g, '')}-${String(++bookingSeq).padStart(4, '0')}`;
}
export const nextInvoiceNumber = (at = Date.now()) => `INV/${fyLabel(at)}/${String(++invoiceSeq).padStart(5, '0')}`;
export const nextReceiptNumber = (at = Date.now()) => `RCP/${fyLabel(at)}/${String(++receiptSeq).padStart(5, '0')}`;
const otp = () => String(Math.floor(between(1000, 9999)));

/** Ledger-derived payment status, as in apps/api/src/domain/paymentStatus.ts. */
export function refreshInvoiceLedger(inv: GInvoice, opts: { hasPendingOnline?: boolean; lastFailed?: boolean; refundPending?: number } = {}) {
  const settled = inv.amountPaid + inv.amountCredited + inv.amountWrittenOff - inv.amountRefunded;
  inv.outstanding = Math.max(0, inv.total - settled - inv.amountPendingCash);
  if (inv.status === 'VOID') inv.outstanding = 0;
  let s: GInvoice['paymentStatus'];
  if (inv.disputed) s = 'DISPUTED';
  else if ((opts.refundPending ?? 0) > 0) s = 'REFUND_PENDING';
  else if (inv.amountRefunded > 0 && inv.amountRefunded >= inv.amountPaid) s = 'REFUNDED';
  else if (inv.amountRefunded > 0) s = 'PARTIALLY_REFUNDED';
  else if (inv.outstanding <= 0 && inv.amountPendingCash === 0) s = 'PAID';
  else if (opts.hasPendingOnline || inv.amountPendingCash > 0) s = 'PAYMENT_PENDING';
  else if (opts.lastFailed) s = 'PAYMENT_FAILED';
  else if (inv.amountPaid > 0) s = 'PARTIALLY_PAID';
  else s = 'UNPAID';
  inv.paymentStatus = s;
  inv.updatedAt = nowIso();
}

/** Issues the final service invoice for a delivered booking (frozen quote rules + actuals). */
export function issueServiceInvoice(b: GBooking, at: number, actuals: { waitingMinutes?: number; tolls?: number } = {}): GInvoice {
  const c = categories.find((x) => x.id === b.serviceCategoryId)!;
  const approved = b.quotes.find((q) => q.status === 'APPROVED') ?? b.quotes[0]!;
  const input = { ...approved.pricingSnapshot.input, final: true, waitingMinutes: actuals.waitingMinutes ?? b.waitingMinutes, tolls: actuals.tolls ?? 0 };
  const p = computePrice(rateCardFor(c.key), input);
  const cust = userById(b.customerUserId)!;
  const fleet = b.fleetAccountId ? fleetAccounts.find((f) => f.id === b.fleetAccountId) : undefined;
  const inv: GInvoice = {
    id: `inv_${b.id}`,
    number: nextInvoiceNumber(at),
    type: 'SERVICE',
    status: 'ISSUED',
    paymentStatus: 'UNPAID',
    bookingId: b.id,
    subscriptionId: null,
    customerUserId: b.customerUserId,
    fleetAccountId: b.fleetAccountId,
    approvedQuoteId: approved.id,
    billingName: fleet?.name ?? cust.fullName,
    billingPhone: cust.phone,
    billingEmail: fleet?.billingEmail ?? cust.email,
    billingAddress: fleet?.billingAddress ?? null,
    billingGstin: fleet?.gstin ?? null,
    currency: 'INR',
    subtotal: p.subtotal,
    discountTotal: p.discountTotal,
    taxableValue: p.taxableValue,
    taxTotal: p.taxTotal,
    passThroughTotal: p.passThroughTotal,
    total: p.total,
    amountPaid: 0,
    amountPendingCash: 0,
    amountCredited: 0,
    amountRefunded: 0,
    amountWrittenOff: 0,
    outstanding: p.total,
    approvedQuoteTotal: approved.total,
    disputed: false,
    notes: null,
    issuedAt: iso(at),
    dueAt: iso(at + (fleet ? fleet.paymentTermsDays : 0) * DAY),
    voidedAt: null,
    voidReason: null,
    isSample: true,
    createdAt: iso(at),
    updatedAt: iso(at),
    items: p.lines.map((l, i) => ({ id: `${b.id}_ii${i}`, code: l.code, description: l.description, quantity: l.quantity, unitAmount: l.unitAmount, amount: l.amount, taxable: l.taxable, isPassThrough: l.isPassThrough, isAdditional: l.isAdditional, reason: l.reason ?? null, sortOrder: i })),
  };
  invoices.push(inv);
  return inv;
}

/** Records a successful payment against an invoice and refreshes its ledger. */
export function recordPayment(inv: GInvoice, amount: number, method: GPayment['method'], at: number, opts: { collectedById?: string | null; pendingCash?: boolean } = {}): GPayment {
  const online = method === 'ONLINE';
  const pay: GPayment = {
    id: newIdDet('pay'),
    invoiceId: inv.id,
    method,
    provider: online ? 'SANDBOX' : 'MANUAL',
    status: opts.pendingCash ? 'PENDING' : 'SUCCEEDED',
    amount,
    currency: 'INR',
    providerOrderId: online ? `order_${inv.id.slice(-6)}${receiptSeq}` : null,
    providerPaymentId: online ? `pay_${inv.id.slice(-6)}${receiptSeq}` : null,
    gatewayFee: online ? Math.round(amount * 0.02) : 0,
    gatewayTax: online ? Math.round(amount * 0.02 * 0.18) : 0,
    receiptNumber: opts.pendingCash ? null : nextReceiptNumber(at),
    collectedById: opts.collectedById ?? null,
    confirmedById: online || opts.pendingCash ? null : 'u_finance',
    initiatedById: online ? inv.customerUserId : null,
    failureReason: null,
    isSandbox: online,
    notes: null,
    createdAt: iso(at),
    succeededAt: opts.pendingCash ? null : iso(at + 3 * MIN),
    updatedAt: iso(at + 3 * MIN),
  };
  payments.push(pay);
  if (opts.pendingCash) inv.amountPendingCash += amount;
  else inv.amountPaid += amount;
  refreshInvoiceLedger(inv);
  return pay;
}
let detSeq = 0;
function newIdDet(prefix: string) {
  return `${prefix}_${String(++detSeq).padStart(4, '0')}`;
}

/** Driver earning per compensation rule, as in the seed. */
export function addJobEarning(driverId: string, b: GBooking, inv: GInvoice | null, at: number) {
  const wp = userById(driverId)?.workerProfile;
  if (!wp) return;
  const amount = wp.employmentType === 'COMMISSION' ? applyBps(inv?.taxableValue ?? 0, wp.commissionBps ?? 2500) : wp.employmentType === 'JOB_BASED' || wp.employmentType === 'PARTNER' ? (wp.perJobAmount ?? 45000) : 0;
  if (amount <= 0) return;
  earnings.push({ id: newIdDet('earn'), userId: driverId, bookingId: b.id, kind: wp.employmentType === 'COMMISSION' ? 'JOB_COMMISSION' : 'JOB_FIXED', amount, status: 'PENDING', payoutId: null, expenseId: null, note: b.code, earnedAt: iso(at), createdById: null });
}

interface BookingSpec {
  id?: string;
  customer: string;
  vehicle: string;
  key: string;
  at: number;
  target: BookingStatus;
  pickup: Place;
  dropoff?: Place | null;
  driver?: string | null;
  worker?: string | null;
  assessment?: Partial<Assessment>;
  type?: 'EMERGENCY' | 'SCHEDULED';
  scheduledFor?: number | null;
  payment?: 'paid' | 'unpaid' | 'partial' | 'cash_pending' | 'cash';
  rating?: number | null;
  instructions?: string | null;
  manualReview?: boolean;
  tolls?: number;
}

function buildBooking(s: BookingSpec): GBooking {
  const id = s.id ?? `bk_${String(bookings.length + 1).padStart(4, '0')}`;
  const c = catByKey(s.key);
  const v = vehicles.find((x) => x.id === s.vehicle)!;
  const cust = userById(s.customer)!;
  const a = assessmentFor(s.key, v.fuelType, s.assessment);
  const rec = recommendationFor(c, v.vehicleClass, a);
  const towKm = c.kind === 'TOWING' ? round1(between(4, 24)) : 0;
  const pickupKm = round1(between(2, 13));
  const pickupJitter = [s.pickup[0] + between(-0.006, 0.006), s.pickup[1] + between(-0.006, 0.006)] as const;
  const drop = c.kind === 'TOWING' ? (s.dropoff === undefined ? pick(GARAGES)! : s.dropoff) : null;
  const fleet = v.fleetAccountId;
  const sub = s.customer === 'u_cus_priya' && chance(0.3) ? 'sub_priya_annual' : null;
  const input: QuoteInput = {
    serviceKind: c.kind,
    towDistanceKm: towKm,
    pickupDistanceKm: pickupKm,
    crew: rec.crew,
    equipment: rec.equipment,
    localHour: istHour(s.at),
    isHoliday: false,
    scheduled: s.type === 'SCHEDULED',
    discounts: fleet ? { contract: { label: 'Contract FY27 Fleet Support Contract', discountBps: 1200 } } : sub ? { membership: { label: 'RoadSafe Annual', waiveBaseFee: false, extraFreeKm: 15, discountBps: 1000 } } : {},
  };
  const createdAt = s.at;
  const off = (st: BookingStatus) => createdAt + ((c.kind === 'ONSITE' ? ONSITE_OFFSET[st] : undefined) ?? OFFSET[st] ?? 0) * MIN * (0.8 + rand() * 0.4);

  // Timeline up to the target
  const path = HAPPY.filter((st) => c.kind === 'TOWING' || (st !== 'LOADING' && st !== 'IN_TRANSIT'));
  let steps: BookingStatus[];
  const t = s.target;
  if (path.includes(t)) steps = path.slice(0, path.indexOf(t) + 1);
  else if (t === 'CANCELLED') steps = [...path.slice(0, 4), 'CANCELLED'];
  else if (t === 'FAILED') steps = [...path.slice(0, path.indexOf('INSPECTING') + 1), 'FAILED'];
  else if (t === 'REASSIGNMENT_REQUIRED') steps = [...path.slice(0, 5), 'REJECTED', 'REASSIGNMENT_REQUIRED'];
  else if (t === 'SAFETY_HOLD') steps = [...path.slice(0, path.indexOf('ARRIVED') + 1), 'SAFETY_HOLD'];
  else if (t === 'DISPUTED') steps = [...path, 'DISPUTED'];
  else steps = path.slice(0, 1);
  const times: number[] = [];
  steps.forEach((st, i) => {
    const prev = times[i - 1] ?? createdAt;
    let at = st === 'REJECTED' ? prev + 1.5 * MIN : st === 'REASSIGNMENT_REQUIRED' ? prev + 0.2 * MIN : st === 'CANCELLED' ? prev + 6 * MIN : st === 'FAILED' ? prev + 18 * MIN : st === 'SAFETY_HOLD' ? prev + 6 * MIN : st === 'DISPUTED' ? prev + 20 * HOUR : off(st);
    if (s.type === 'SCHEDULED' && i > 3) at = Math.max(at, (s.scheduledFor ?? createdAt) - 40 * MIN + i * MIN);
    times.push(Math.max(prev, at));
  });
  const when = (st: BookingStatus) => {
    const i = steps.indexOf(st);
    return i >= 0 ? times[i]! : null;
  };
  const reached = (st: BookingStatus) => steps.includes(st);
  const actorFor = (st: BookingStatus): ActorRole => ACTOR[st] ?? (st === 'COMPLETED' ? 'DRIVER' : st === 'SAFETY_HOLD' || st === 'REJECTED' ? 'DRIVER' : HAPPY.indexOf(st) >= HAPPY.indexOf('ACCEPTED') || st === 'FAILED' ? 'DRIVER' : 'SYSTEM');
  const history: GStatusHistory[] = steps.map((st, i) => {
    const actor = actorFor(st);
    return {
      id: `${id}_h${i}`,
      fromStatus: i ? steps[i - 1]! : null,
      toStatus: st,
      actorUserId: actor === 'CUSTOMER' ? s.customer : actor === 'DRIVER' ? ((st === 'REJECTED' ? 'u_drv_anil' : s.driver) ?? null) : null,
      actorRole: actor,
      reason: st === 'CANCELLED' ? 'Vehicle started on its own' : st === 'FAILED' ? 'Vehicle could not be safely recovered from the location' : st === 'REJECTED' ? 'Truck not suitable for basement access' : st === 'SAFETY_HOLD' ? 'Vehicle stopped on a blind curve with heavy traffic; waiting for traffic police' : st === 'DISPUTED' ? 'Scratch on rear bumper after delivery' : null,
      isOverride: false,
      metadata: null,
      createdAt: iso(times[i]!),
    };
  });

  const quote = quoteRecord(id, 1, 'INITIAL', reached('CONFIRMED') ? 'APPROVED' : 'PENDING_CUSTOMER_APPROVAL', s.key, input, when('QUOTED') ?? createdAt, reached('CONFIRMED') ? { decidedById: s.customer, decidedAt: iso(when('CONFIRMED')!) } : {});
  if (!reached('CONFIRMED')) quote.expiresAt = iso(Date.now() + 25 * MIN);

  const driverId = s.driver ?? null;
  const truck = driverId ? truckForDriver(driverId) : undefined;
  const assignments: GAssignment[] = [];
  if (t === 'REASSIGNMENT_REQUIRED') {
    const anilTruck = truckForDriver('u_drv_anil');
    assignments.push({ id: `${id}_a1`, bookingId: id, driverUserId: 'u_drv_anil', truckId: anilTruck?.id ?? null, status: 'REJECTED', method: 'AUTO', attempt: 1, offeredAt: iso(when('ASSIGNED')!), expiresAt: iso(when('ASSIGNED')! + 90_000), respondedAt: iso(when('REJECTED')!), rejectionReason: 'Truck not suitable for basement access', assignedById: null, etaMinutes: 18, distanceKm: 6.2, score: 0.71 });
  } else if (driverId && reached('ASSIGNED')) {
    const accepted = when('ACCEPTED');
    const status: GAssignment['status'] = !accepted ? 'OFFERED' : reached('DELIVERED') ? 'COMPLETED' : t === 'FAILED' || t === 'CANCELLED' ? 'RELEASED' : 'ACCEPTED';
    assignments.push({ id: `${id}_a1`, bookingId: id, driverUserId: driverId, truckId: truck?.id ?? null, status, method: 'AUTO', attempt: 1, offeredAt: iso(when('ASSIGNED')!), expiresAt: iso(status === 'OFFERED' ? Date.now() + 75_000 : when('ASSIGNED')! + 90_000), respondedAt: accepted ? iso(accepted) : null, rejectionReason: null, assignedById: null, etaMinutes: Math.round(between(14, 32)), distanceKm: pickupKm, score: round1(between(0.62, 0.95) * 100) / 100 });
  }
  const accepted = when('ACCEPTED');
  const teamMembers: GBooking['teamMembers'] = [];
  if (driverId && accepted && t !== 'CANCELLED') {
    teamMembers.push({ id: `${id}_t1`, userId: driverId, role: 'TEAM_LEADER', responsibility: 'Driver and team leader', addedById: null, active: true, createdAt: iso(accepted) });
    if (s.worker) teamMembers.push({ id: `${id}_t2`, userId: s.worker, role: 'RECOVERY_WORKER', responsibility: 'Winching and securing', addedById: 'u_dispatch', active: true, createdAt: iso(accepted + MIN) });
  }
  const pickupVerified = when('RECOVERY_AUTHORIZED');
  const delivered = when('DELIVERED');
  const b: GBooking = {
    id,
    code: nextBookingCode(createdAt),
    customerUserId: s.customer,
    vehicleId: v.id,
    fleetAccountId: fleet,
    serviceCategoryId: c.id,
    zoneId: zoneFor(s.pickup[0], s.pickup[1]),
    status: t,
    type: s.type ?? 'EMERGENCY',
    scheduledFor: s.scheduledFor ? iso(s.scheduledFor) : null,
    priority: rec.priority as GBooking['priority'],
    safetyFlags: rec.safetyFlags,
    requiresManualReview: !!s.manualReview,
    manualReviewReasons: s.manualReview ? (rec.manualReviewReasons.length ? rec.manualReviewReasons : ['Major damage reported: confirm crew and equipment']) : [],
    reviewedById: null,
    reviewedAt: null,
    recommendation: rec,
    crewRequested: 1,
    crewRecommended: rec.crew,
    contactName: cust.fullName,
    contactPhone: cust.phone!,
    instructions: s.instructions ?? null,
    promoCode: null,
    membershipSubscriptionId: sub,
    pickupOtp: otp(),
    handoverOtp: otp(),
    pickupVerifiedAt: pickupVerified ? iso(pickupVerified) : null,
    pickupDistanceKm: pickupKm,
    towDistanceKm: towKm || null,
    distanceSource: 'estimate',
    etaAt: accepted ? iso(accepted + 27 * MIN) : null,
    arrivedAt: when('ARRIVED') ? iso(when('ARRIVED')!) : null,
    waitingMinutes: reached('ARRIVED') ? Math.round(between(0, 30)) : 0,
    dispatchAttempts: reached('ASSIGNED') ? (t === 'REASSIGNMENT_REQUIRED' ? 1 : 1) : 0,
    cancellationReason: t === 'CANCELLED' ? 'Vehicle started on its own' : null,
    cancellationFee: 0,
    cancelledById: t === 'CANCELLED' ? s.customer : null,
    failureReason: t === 'FAILED' ? 'Vehicle could not be safely recovered from the location' : null,
    holdReturnStatus: t === 'SAFETY_HOLD' ? 'ARRIVED' : null,
    completedAt: when('COMPLETED') ? iso(when('COMPLETED')!) : null,
    version: steps.length,
    isSample: true,
    createdAt: iso(createdAt),
    updatedAt: iso(times[times.length - 1]!),
    locations: [
      { id: `${id}_lp`, kind: 'PICKUP', lat: pickupJitter[0], lng: pickupJitter[1], accuracyM: 12, capturedAt: iso(createdAt), source: 'GPS', address: `Near ${s.pickup[2]}, Bengaluru`, landmark: pick(['Opposite the metro pillar', 'Next to the petrol bunk', 'Near the bus stop', 'In front of the bakery', 'Beside the temple arch'])!, highway: null, roadDirection: null, kmMarker: null, gateNumber: null, floor: null, parkingLevel: null, accessNotes: null, isSafeLocation: t !== 'SAFETY_HOLD', destinationType: null, placeName: null, createdAt: iso(createdAt) },
      ...(drop ? [{ id: `${id}_ld`, kind: 'DROPOFF' as const, lat: drop[0], lng: drop[1], accuracyM: null, capturedAt: null, source: 'MAP_PIN' as const, address: `${drop[2]}, Bengaluru`, landmark: null, highway: null, roadDirection: null, kmMarker: null, gateNumber: null, floor: null, parkingLevel: null, accessNotes: null, isSafeLocation: null, destinationType: 'GARAGE' as const, placeName: drop[2], createdAt: iso(createdAt) }] : []),
    ],
    assessment: a,
    attachments: [],
    quotes: [quote],
    assignments,
    teamMembers,
    statusHistory: history,
    conditionReports: [],
    custody: [],
    shareLinks: [],
  };
  if (pickupVerified && driverId) b.custody.push({ stage: 'PICKUP', method: 'OTP', recipientName: cust.fullName, recipientRelation: 'Owner', confirmedById: driverId, overrideReason: null, createdAt: iso(pickupVerified) });
  if (c.kind === 'TOWING' && when('LOADING') && driverId) b.conditionReports.push({ id: `${id}_cr1`, stage: 'PICKUP', reportedById: driverId, notes: s.key === 'ACCIDENT_RECOVERY' ? 'Front-end collision damage, airbags deployed' : 'Minor scratches on rear bumper (pre-existing)', damageMarks: s.key === 'ACCIDENT_RECOVERY' ? [{ area: 'Front bumper', description: 'Cracked, pre-existing collision damage' }] : [{ area: 'Rear bumper', description: 'Light scratches' }], odometerKm: Math.round(between(8000, 90000)), fuelLevel: pick(['Quarter', 'Half', 'Three-quarters'])!, itemsInVehicle: 'Owner manual, umbrella', attachmentIds: [], createdAt: iso(when('LOADING')!) });
  if (delivered && driverId) {
    b.custody.push({ stage: 'HANDOVER', method: 'OTP', recipientName: c.kind === 'TOWING' ? 'Service advisor' : cust.fullName, recipientRelation: c.kind === 'TOWING' ? 'Garage' : 'Owner', confirmedById: driverId, overrideReason: null, createdAt: iso(delivered) });
    if (c.kind === 'TOWING') b.conditionReports.push({ id: `${id}_cr2`, stage: 'DELIVERY', reportedById: driverId, notes: 'No new damage', damageMarks: [], odometerKm: null, fuelLevel: null, itemsInVehicle: null, attachmentIds: [], createdAt: iso(delivered) });
  }
  bookings.push(b);

  // Invoice, payment, earnings, rating
  if (delivered) {
    const inv = issueServiceInvoice(b, delivered + MIN, { tolls: s.tolls ?? (c.kind === 'TOWING' && chance(0.2) ? 6500 : 0) });
    const pay = s.payment ?? (fleet ? (chance(0.5) ? 'paid' : 'unpaid') : chance(0.88) ? 'paid' : chance(0.5) ? 'cash' : 'unpaid');
    const payAt = delivered + between(3, 40) * MIN;
    if (pay === 'paid') recordPayment(inv, inv.total, 'ONLINE', payAt);
    else if (pay === 'cash') recordPayment(inv, inv.total, 'CASH', payAt, { collectedById: driverId });
    else if (pay === 'cash_pending') recordPayment(inv, inv.total, 'CASH', payAt, { collectedById: driverId, pendingCash: true });
    else if (pay === 'partial') recordPayment(inv, Math.round(inv.total / 2), 'ONLINE', payAt);
    if (driverId) addJobEarning(driverId, b, inv, delivered);
    if (s.worker) earnings.push({ id: newIdDet('earn'), userId: s.worker, bookingId: b.id, kind: 'JOB_FIXED', amount: 25000, status: 'PENDING', payoutId: null, expenseId: null, note: b.code, earnedAt: iso(delivered), createdById: null });
    const score = s.rating === undefined ? (chance(0.7) ? pick([5, 5, 5, 4, 4, 3])! : null) : s.rating;
    if (score && driverId && reached('COMPLETED'))
      ratings.push({ id: `${id}_r`, bookingId: id, raterUserId: s.customer, rateeUserId: driverId, score, comment: pick(['Quick and careful with the car', 'Very professional', 'Arrived a bit late but handled the car well', 'Polite and explained everything', null])!, tags: score >= 4 ? ['On time', 'Careful handling'] : ['Late arrival'], createdAt: iso(delivered + 2 * HOUR) });
  }
  return b;
}

// Historical bookings over the last 90 days.
{
  const histCustomers = [...EXTRA_CUSTOMER_IDS, 'u_cus_priya', 'u_cus_arjun', 'u_cus_meera', 'u_cus_rahul', 'u_cus_rahul', 'u_cus_rahul', 'u_cus_sneha', 'u_cus_rohan', 'u_cus_fatima', 'u_cus_deepak', 'u_cus_kavya', 'u_cus_aditya', 'u_cus_lakshmi'];
  const towKeys = ['CAR_TOW', 'CAR_TOW', 'FLATBED_TOW', 'PREMIUM_TOW', 'WHEEL_LIFT_TOW', 'JUMP_START', 'FLAT_TYRE', 'FUEL_DELIVERY', 'LOCKOUT', 'ACCIDENT_RECOVERY'];
  const specs: BookingSpec[] = [];
  for (let i = 0; i < 720; i++) {
    // Heavier recent volume so dashboards show growth.
    const daysAgo = 1 + Math.floor(89 * Math.pow(rand(), 1.35));
    const at = NOW - daysAgo * DAY - between(0, 14) * HOUR;
    const customer = pick(histCustomers)!;
    if (users.find((u) => u.id === customer)!.createdAt > iso(at)) continue;
    const vs = vehicles.filter((v) => v.ownerUserId === customer);
    const v = pick(vs)!;
    let key = pick(towKeys)!;
    if (v.vehicleClass === 'TWO_WHEELER') key = pick(['BIKE_TOW', 'BIKE_TOW', 'JUMP_START', 'FLAT_TYRE'])!;
    if (v.vehicleClass === 'LCV') key = 'COMMERCIAL_RECOVERY';
    if (key === 'PREMIUM_TOW' && !['SUV', 'PREMIUM', 'SEDAN'].includes(v.vehicleClass)) key = 'CAR_TOW';
    if (key === 'WHEEL_LIFT_TOW' && !['HATCHBACK', 'SEDAN'].includes(v.vehicleClass)) key = 'FLATBED_TOW';
    if (key === 'LOCKOUT' && v.vehicleClass === 'TWO_WHEELER') key = 'FLAT_TYRE';
    const place = pick(PLACES)!;
    const south = place[0] < 12.88;
    const north = place[0] > 13.02;
    const c = catByKey(key);
    const driver = key === 'BIKE_TOW' ? 'u_drv_anil' : c.kind === 'ONSITE' ? 'u_drv_kiran' : key === 'COMMERCIAL_RECOVERY' ? 'u_drv_manju' : south ? 'u_drv_prakash' : north ? pick(['u_drv_farhan', 'u_drv_manju', 'u_drv_ravi'])! : pick(['u_drv_ravi', 'u_drv_ravi', 'u_drv_imran', 'u_drv_suresh'])!;
    const o = rand();
    const target: BookingStatus = o < 0.07 ? 'CANCELLED' : o < 0.1 ? 'FAILED' : o < 0.115 && daysAgo < 30 ? 'DISPUTED' : 'COMPLETED';
    specs.push({ customer, vehicle: v.id, key, at, target, pickup: place, driver, worker: c.defaultCrew > 1 ? 'u_wrk_lokesh' : null });
  }
  // Guaranteed history for the guest customer and driver.
  specs.push({ customer: 'u_cus_priya', vehicle: 'veh_ka05mn4321', key: 'CAR_TOW', at: NOW - 2 * DAY - 3 * HOUR, target: 'COMPLETED', pickup: PLACES[13]!, dropoff: GARAGES[0]!, driver: 'u_drv_ravi', payment: 'unpaid', rating: null });
  specs.push({ customer: 'u_cus_priya', vehicle: 'veh_ka05hj8899', key: 'JUMP_START', at: NOW - 9 * DAY - 5 * HOUR, target: 'COMPLETED', pickup: PLACES[1]!, driver: 'u_drv_kiran', payment: 'paid', rating: 5 });
  specs.push({ customer: 'u_cus_priya', vehicle: 'veh_ka05mn4321', key: 'FLAT_TYRE', at: NOW - 21 * DAY - 2 * HOUR, target: 'CANCELLED', pickup: PLACES[0]! });
  specs.push({ customer: 'u_cus_sneha', vehicle: 'veh_ka04mk5566', key: 'FLATBED_TOW', at: NOW - 4 * DAY, target: 'COMPLETED', pickup: PLACES[3]!, driver: 'u_drv_ravi', payment: 'paid', rating: 4 });
  specs.push({ customer: 'u_cus_rohan', vehicle: 'veh_ka02jk7788', key: 'CAR_TOW', at: NOW - 1 * DAY - 2 * HOUR, target: 'COMPLETED', pickup: PLACES[7]!, driver: 'u_drv_ravi', payment: 'cash_pending', rating: 5 });
  specs.push({ customer: 'u_cus_meera', vehicle: 'veh_ka51ab1122', key: 'WHEEL_LIFT_TOW', at: NOW - 20 * HOUR, target: 'DELIVERED', pickup: PLACES[2]!, driver: 'u_drv_imran', payment: 'unpaid' });
  specs.sort((x, y) => x.at - y.at);
  for (const s of specs) buildBooking(s);
}

// Live operations right now.
const live = (minutesAgo: number) => NOW - minutesAgo * MIN;
export const LIVE = {
  priyaActive: buildBooking({ id: 'bk_live_priya', customer: 'u_cus_priya', vehicle: 'veh_ka05mn4321', key: 'CAR_TOW', at: live(16), target: 'EN_ROUTE', pickup: [12.9352, 77.6245, 'Koramangala 5th Block'], dropoff: GARAGES[0]!, driver: 'u_drv_ravi', instructions: 'Car is parked outside the bakery on 80 Feet Road. Hazard lights are on.' }),
  arjunEv: buildBooking({ id: 'bk_live_arjun', customer: 'u_cus_arjun', vehicle: 'veh_ka03pq7788', key: 'PREMIUM_TOW', at: live(52), target: 'INSPECTING', pickup: PLACES[5]!, dropoff: GARAGES[2]!, driver: 'u_drv_suresh' }),
  lakshmiJump: buildBooking({ id: 'bk_live_lakshmi', customer: 'u_cus_lakshmi', vehicle: 'veh_ka05li2323', key: 'JUMP_START', at: live(9), target: 'ACCEPTED', pickup: PLACES[9]!, driver: 'u_drv_kiran' }),
  rahulLcv: buildBooking({ id: 'bk_live_rahul', customer: 'u_cus_rahul', vehicle: 'veh_ka01fl0001', key: 'COMMERCIAL_RECOVERY', at: live(68), target: 'IN_TRANSIT', pickup: PLACES[10]!, dropoff: GARAGES[3]!, driver: 'u_drv_manju', worker: 'u_wrk_lokesh' }),
  snehaSearching: buildBooking({ id: 'bk_live_sneha', customer: 'u_cus_sneha', vehicle: 'veh_ka04mk5566', key: 'FLATBED_TOW', at: live(4), target: 'SEARCHING_FOR_PROVIDER', pickup: PLACES[3]!, assessment: { blockingTraffic: 'YES' } }),
  deepakReview: buildBooking({ id: 'bk_live_deepak', customer: 'u_cus_deepak', vehicle: 'veh_ka01mx3030', key: 'PREMIUM_TOW', at: live(7), target: 'SEARCHING_FOR_PROVIDER', pickup: [12.9716, 77.5946, 'MG Road Metro'], dropoff: GARAGES[5]!, manualReview: true, assessment: { majorDamage: 'YES', breakdownType: 'COLLISION' } }),
  rohanOffer: buildBooking({ id: 'bk_live_rohan', customer: 'u_cus_rohan', vehicle: 'veh_ka02jk7788', key: 'CAR_TOW', at: live(5), target: 'ASSIGNED', pickup: PLACES[7]!, driver: 'u_drv_imran' }),
  kavyaReassign: buildBooking({ id: 'bk_live_kavya', customer: 'u_cus_kavya', vehicle: 'veh_ka53ex1212', key: 'BIKE_TOW', at: live(11), target: 'REASSIGNMENT_REQUIRED', pickup: PLACES[6]!, instructions: 'Scooter is in the basement parking (B2) of the apartment.' }),
  fatimaHold: buildBooking({ id: 'bk_live_fatima', customer: 'u_cus_fatima', vehicle: 'veh_ka41ab9090', key: 'FLAT_TYRE', at: live(48), target: 'SAFETY_HOLD', pickup: [12.8615, 77.6647, 'Hosur Road, near Electronic City flyover'], driver: 'u_drv_prakash', assessment: { hasElderly: true, passengersNeedingTransport: 2 } }),
  adityaQuoted: buildBooking({ id: 'bk_live_aditya', customer: 'u_cus_aditya', vehicle: 'veh_ka50p4455', key: 'CAR_TOW', at: live(2), target: 'QUOTED', pickup: PLACES[11]! }),
  priyaScheduled: buildBooking({ id: 'bk_sched_priya', customer: 'u_cus_priya', vehicle: 'veh_ka05hj8899', key: 'BIKE_TOW', at: NOW - 3 * HOUR, target: 'CONFIRMED', type: 'SCHEDULED', scheduledFor: Math.floor((NOW + 5.5 * HOUR) / DAY) * DAY - 5.5 * HOUR + DAY + 10 * HOUR, pickup: [12.9784, 77.6408, 'Indiranagar (home)'], dropoff: [12.9719, 77.6412, 'Royal Enfield Service, Indiranagar'] }),
};
LIVE.priyaActive.statusHistory.find((h) => h.toStatus === 'EN_ROUTE')!.createdAt = iso(NOW - 9 * MIN);
LIVE.priyaActive.etaAt = iso(NOW + 12 * MIN);
LIVE.priyaActive.shareLinks.push({ id: 'sl_priya_1', token: 'guest-demo-track', expiresAt: iso(NOW + 3 * HOUR), revokedAt: null, viewCount: 2, createdAt: iso(NOW - 8 * MIN) });
LIVE.rahulLcv.fleetAccountId = 'fa_sahyadri';

// Drivers busy on live jobs, trucks in use, live GPS positions.
for (const b of bookings) {
  const a = b.assignments.find((x) => x.status === 'ACCEPTED');
  if (!a) continue;
  const u = userById(a.driverUserId)!;
  const p = b.locations.find((l) => l.kind === 'PICKUP')!;
  u.availability = { ...u.availability!, status: 'ON_JOB', lastLat: p.lat + 0.004, lastLng: p.lng - 0.003, lastLocationAt: iso(NOW - 15_000), statusSince: a.respondedAt ?? iso(NOW) };
  const t = truckById(a.truckId);
  if (t) t.status = 'IN_USE';
  for (const m of b.teamMembers) if (m.userId !== u.id) userById(m.userId)!.availability!.status = 'ON_JOB';
}
userById('u_drv_farhan')!.availability!.status = 'ON_BREAK';
userById('u_drv_anil')!.availability!.status = 'AVAILABLE';

// Escalations & incidents
escalations.push(
  { id: 'esc_sneha_noprov', bookingId: 'bk_live_sneha', type: 'NO_PROVIDER', status: 'OPEN', detail: 'No eligible flatbed within 8 km of Hebbal Flyover after the first dispatch round.', resolution: null, resolvedById: null, resolvedAt: null, createdAt: iso(NOW - 2 * MIN) },
  { id: 'esc_deepak_review', bookingId: 'bk_live_deepak', type: 'MANUAL_REVIEW', status: 'OPEN', detail: 'Premium vehicle with major collision damage — confirm flatbed, winch and insurance before dispatch.', resolution: null, resolvedById: null, resolvedAt: null, createdAt: iso(NOW - 6 * MIN) },
  { id: 'esc_kavya_rejected', bookingId: 'bk_live_kavya', type: 'DRIVER_REJECTED', status: 'OPEN', detail: 'Anil Reddy declined: truck not suitable for basement access.', resolution: null, resolvedById: null, resolvedAt: null, createdAt: iso(NOW - 9 * MIN) },
  { id: 'esc_arjun_eta', bookingId: 'bk_live_arjun', type: 'MISSED_ETA', status: 'ACKNOWLEDGED', detail: 'Driver arrived 11 minutes after the promised ETA (traffic on ITPL Main Road).', resolution: null, resolvedById: null, resolvedAt: null, createdAt: iso(NOW - 20 * MIN) },
);
incidents.push({ id: 'inc_fatima_unsafe', bookingId: 'bk_live_fatima', reportedById: 'u_drv_prakash', type: 'UNSAFE_LOCATION', severity: 'HIGH', description: 'Vehicle stopped on a blind curve of the elevated expressway ramp. Hazard triangle placed; waiting for traffic police before changing the tyre. Two elderly passengers moved to the footpath.', lat: 12.8615, lng: 77.6647, status: 'OPEN', acknowledgedById: null, acknowledgedAt: null, resolution: null, resolvedAt: null, createdAt: iso(NOW - 40 * MIN) });
escalations.push({ id: 'esc_fatima_safety', bookingId: 'bk_live_fatima', type: 'SAFETY', status: 'OPEN', detail: 'Driver placed the job on safety hold: unsafe location on Hosur Road.', resolution: null, resolvedById: null, resolvedAt: null, createdAt: iso(NOW - 40 * MIN) });
{
  const past = bookings.filter((b) => b.status === 'COMPLETED' || b.status === 'FAILED');
  past.slice(-30).forEach((b, i) => {
    if (i % 6 !== 0) return;
    const t = new Date(b.createdAt).getTime() + 40 * MIN;
    escalations.push({ id: `esc_hist_${i}`, bookingId: b.id, type: pick(['MISSED_ETA', 'DRIVER_NO_RESPONSE', 'LOCATION_STALE', 'CUSTOMER_CANNOT_CONTACT'] as const)!, status: 'RESOLVED', detail: 'Raised automatically by the dispatch monitor.', resolution: 'Customer updated by phone; job continued.', resolvedById: 'u_dispatch', resolvedAt: iso(t + 15 * MIN), createdAt: iso(t) });
  });
  const failed = bookings.filter((b) => b.status === 'FAILED');
  failed.slice(0, 2).forEach((b, i) =>
    incidents.push({ id: `inc_hist_${i}`, bookingId: b.id, reportedById: b.assignments[0]?.driverUserId ?? 'u_drv_ravi', type: i ? 'EQUIPMENT_DAMAGE' : 'UNSAFE_LOCATION', severity: i ? 'MEDIUM' : 'HIGH', description: i ? 'Winch cable frayed during recovery attempt; job aborted.' : 'Vehicle on an unlit service road with oncoming traffic; recovery unsafe.', lat: null, lng: null, status: 'RESOLVED', acknowledgedById: 'u_dispatch', acknowledgedAt: iso(new Date(b.updatedAt).getTime() + 5 * MIN), resolution: 'Customer refunded; follow-up booked with heavy-duty truck.', resolvedAt: iso(new Date(b.updatedAt).getTime() + 2 * HOUR), createdAt: b.updatedAt }),
  );
  const disputed = bookings.find((b) => b.status === 'DISPUTED');
  if (disputed) {
    const inv = invoices.find((x) => x.bookingId === disputed.id);
    if (inv) {
      inv.disputed = true;
      refreshInvoiceLedger(inv);
    }
  }
}

// Refunds, credit notes
{
  const paidInvoices = invoices.filter((i) => i.paymentStatus === 'PAID' && i.amountPaid > 0);
  const mk = (inv: GInvoice, amount: number, status: GRefund['status'], reason: string, daysAgo: number): GRefund => {
    const pay = payments.find((p) => p.invoiceId === inv.id && p.status === 'SUCCEEDED') ?? null;
    return { id: `rf_${inv.id.slice(4)}`, invoiceId: inv.id, paymentId: pay?.id ?? null, amount, status, reason, providerRefundId: status === 'SUCCEEDED' ? `rfnd_${inv.id.slice(-5)}` : null, requestedById: inv.customerUserId, approvedById: status === 'REQUESTED' ? null : 'u_finance', failureReason: status === 'FAILED' ? 'Bank rejected the refund (account closed)' : null, isSandbox: true, createdAt: iso(NOW - daysAgo * DAY), processedAt: status === 'SUCCEEDED' ? iso(NOW - (daysAgo - 1) * DAY) : null, updatedAt: iso(NOW - daysAgo * DAY) };
  };
  const r1 = paidInvoices[paidInvoices.length - 3];
  const r2 = paidInvoices[paidInvoices.length - 8];
  const r3 = paidInvoices[20];
  const r4 = paidInvoices[30];
  if (r1) {
    refunds.push(mk(r1, 30000, 'REQUESTED', 'Waiting time charged although the driver arrived late', 1));
    refreshInvoiceLedger(r1, { refundPending: 30000 });
  }
  if (r2) refunds.push(mk(r2, Math.round(r2.total * 0.1), 'REQUESTED', 'Promo code was not applied', 2));
  if (r3) {
    refunds.push(mk(r3, 50000, 'SUCCEEDED', 'Goodwill refund for delayed arrival', 40));
    r3.amountRefunded = 50000;
    refreshInvoiceLedger(r3);
  }
  if (r4) refunds.push(mk(r4, 25000, 'FAILED', 'Duplicate toll charge', 25));
  const cn = paidInvoices[12];
  if (cn) {
    creditNotes.push({ id: 'cn_0001', number: `CN/${fyLabel(NOW)}/00001`, invoiceId: cn.id, taxableAmount: 16949, taxAmount: 3051, amount: 20000, reason: 'Pricing correction: pickup distance over-estimated', issuedById: 'u_finance', createdAt: iso(NOW - 30 * DAY) });
  }
}

// Membership invoices
for (const s of subscriptions) {
  if (!s.userId) continue;
  const m = memberships.find((x) => x.id === s.membershipId)!;
  const u = userById(s.userId)!;
  const at = new Date(s.createdAt).getTime();
  const taxable = Math.round(m.price / 1.18);
  const inv: GInvoice = { id: `inv_${s.id}`, number: nextInvoiceNumber(at), type: 'MEMBERSHIP', status: 'ISSUED', paymentStatus: 'UNPAID', bookingId: null, subscriptionId: s.id, customerUserId: u.id, fleetAccountId: null, approvedQuoteId: null, billingName: u.fullName, billingPhone: u.phone, billingEmail: u.email, billingAddress: null, billingGstin: null, currency: 'INR', subtotal: taxable, discountTotal: 0, taxableValue: taxable, taxTotal: m.price - taxable, passThroughTotal: 0, total: m.price, amountPaid: 0, amountPendingCash: 0, amountCredited: 0, amountRefunded: 0, amountWrittenOff: 0, outstanding: m.price, approvedQuoteTotal: null, disputed: false, notes: null, issuedAt: iso(at), dueAt: iso(at), voidedAt: null, voidReason: null, isSample: true, createdAt: iso(at), updatedAt: iso(at), items: [{ id: `${s.id}_ii0`, code: 'MEMBERSHIP', description: `${m.name} (${m.durationMonths} month${m.durationMonths > 1 ? 's' : ''})`, quantity: 1, unitAmount: taxable, amount: taxable, taxable: true, isPassThrough: false, isAdditional: false, reason: null, sortOrder: 0 }] };
  invoices.push(inv);
  recordPayment(inv, inv.total, 'ONLINE', at + 2 * MIN);
}

// ─── People ops: attendance, documents, payroll, expenses ─────────────

const availabilityLogs: GAvailabilityLog[] = [];
for (const u of users.filter((x) => x.availability && x.id !== 'u_drv_sanjay')) {
  for (let d = 13; d >= 0; d--) {
    if (d % 7 === 3) continue; // weekly off
    const start = NOW - d * DAY - (d === 0 ? between(2, 5) * HOUR : between(9, 13) * HOUR);
    const shift = between(7.5, 10) * HOUR;
    availabilityLogs.push({ id: `att_${u.id.slice(2)}_${d}`, userId: u.id, status: 'AVAILABLE', zoneId: u.availability!.zoneId, startedAt: iso(start), endedAt: d === 0 ? null : iso(start + shift) });
    if (d > 0) availabilityLogs.push({ id: `att_${u.id.slice(2)}_${d}_b`, userId: u.id, status: 'ON_BREAK', zoneId: u.availability!.zoneId, startedAt: iso(start + 4 * HOUR), endedAt: iso(start + 4.5 * HOUR) });
  }
}

const documents: GDocument[] = [];
for (const u of users.filter((x) => x.roles.includes('driver') || x.roles.includes('worker'))) {
  const pending = u.id === 'u_drv_sanjay';
  const types: GDocument['type'][] = u.roles.includes('driver') ? ['ID_PROOF', 'DRIVING_LICENCE', 'PHOTO'] : ['ID_PROOF', 'PHOTO'];
  if (u.id === 'u_drv_ravi') types.push('TRAINING_CERTIFICATE');
  types.forEach((type, i) =>
    documents.push({ id: `doc_${u.id.slice(2)}_${i}`, userId: u.id, type, numberMasked: type === 'PHOTO' ? null : `****${String(1234 + i * 1111).slice(-4)}`, mimeType: type === 'PHOTO' ? 'image/jpeg' : 'application/pdf', expiresAt: type === 'DRIVING_LICENCE' ? (u.id === 'u_drv_imran' ? iso(NOW + 21 * DAY) : iso(NOW + between(300, 1500) * DAY)) : type === 'TRAINING_CERTIFICATE' ? iso(NOW + 160 * DAY) : null, status: pending ? (type === 'DRIVING_LICENCE' ? 'REJECTED' : 'PENDING') : 'APPROVED', reviewedById: pending && type !== 'DRIVING_LICENCE' ? null : 'u_admin', reviewNote: pending && type === 'DRIVING_LICENCE' ? 'Back side of the licence is not readable' : null, reviewedAt: pending && type !== 'DRIVING_LICENCE' ? null : iso(NOW - (pending ? 2 : 100) * DAY), createdAt: iso(new Date(u.createdAt).getTime() + DAY) }),
  );
}

const payouts: GPayout[] = [];
for (const u of users.filter((x) => x.roles.includes('driver') || x.roles.includes('worker'))) {
  const old = earnings.filter((e) => e.userId === u.id && new Date(e.earnedAt).getTime() < NOW - 14 * DAY);
  if (!old.length) continue;
  const po: GPayout = { id: `po_${u.id.slice(2)}`, userId: u.id, periodStart: iso(NOW - 90 * DAY), periodEnd: iso(NOW - 14 * DAY), earningsAmount: 0, incentivesAmount: 0, deductionsAmount: 0, reimbursementsAmount: 0, netAmount: 0, status: 'PAID', approvedById: 'u_finance', paidAt: iso(NOW - 12 * DAY), paymentRef: `UTR${String(40000000 + payouts.length * 7919)}`, createdById: 'u_finance', createdAt: iso(NOW - 13 * DAY), updatedAt: iso(NOW - 12 * DAY) };
  for (const e of old) {
    e.status = 'IN_PAYOUT';
    e.payoutId = po.id;
    po.earningsAmount += e.amount;
  }
  if (u.id === 'u_drv_ravi') {
    earnings.push({ id: newIdDet('earn'), userId: u.id, bookingId: null, kind: 'INCENTIVE', amount: 150000, status: 'IN_PAYOUT', payoutId: po.id, expenseId: null, note: 'Top-rated driver incentive (September)', earnedAt: iso(NOW - 20 * DAY), createdById: 'u_finance' });
    po.incentivesAmount = 150000;
  }
  po.netAmount = po.earningsAmount + po.incentivesAmount;
  payouts.push(po);
}
earnings.push({ id: newIdDet('earn'), userId: 'u_drv_ravi', bookingId: null, kind: 'DEDUCTION', amount: -20000, status: 'PENDING', payoutId: null, expenseId: null, note: 'Uniform replacement', earnedAt: iso(NOW - 5 * DAY), createdById: 'u_finance' });

const salaries: GSalary[] = [];
for (let m = 0; m < 4; m++) {
  const ist = new Date(NOW + 5.5 * HOUR);
  const start = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - m, 1) - 5.5 * HOUR;
  const end = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - m + 1, 1) - 5.5 * HOUR;
  for (const u of users.filter((x) => x.workerProfile?.employmentType === 'SALARIED' && x.workerProfile.baseSalary)) {
    const base = u.workerProfile!.baseSalary!;
    const status: GSalary['status'] = m === 0 ? 'ACCRUED' : m === 1 && u.id === 'u_drv_manju' ? 'APPROVED' : 'PAID';
    salaries.push({ id: `sal_${u.id.slice(2)}_${m}`, userId: u.id, frequency: 'MONTHLY', periodStart: iso(start), periodEnd: iso(end), baseAmount: base, incentives: m === 1 && u.id === 'u_drv_suresh' ? 200000 : 0, deductions: 0, netAmount: base + (m === 1 && u.id === 'u_drv_suresh' ? 200000 : 0), status, approvedById: status === 'ACCRUED' ? null : 'u_finance', paidAt: status === 'PAID' ? iso(end + DAY) : null, paymentRef: status === 'PAID' ? `SAL-${fyLabel(end)}-${m}` : null, notes: null, createdById: 'u_finance', isSample: true, createdAt: iso(end - 2 * DAY), updatedAt: iso(end + DAY) });
  }
}

const expenses: GExpense[] = [];
{
  let n = 0;
  const exp = (e: Partial<GExpense> & Pick<GExpense, 'category' | 'description' | 'amount' | 'expenseDate' | 'status'>): GExpense => {
    const x: GExpense = { id: `exp_${String(++n).padStart(4, '0')}`, number: `EXP-${fyLabel(new Date(e.expenseDate).getTime())}-${String(n).padStart(5, '0')}`, source: 'DIRECT', vendorName: null, vendorBillRef: null, taxAmount: 0, fuelLitres: null, odometerKm: null, truckId: null, bookingId: null, zoneId: null, claimantUserId: null, reimbursable: false, hasAttachment: true, submittedById: 'u_finance', approvedById: e.status === 'SUBMITTED' ? null : 'u_finance', approvedAt: e.status === 'SUBMITTED' ? null : e.expenseDate, rejectionReason: null, paidAt: e.status === 'PAID' ? e.expenseDate : null, paymentRef: e.status === 'PAID' ? `NEFT${n}0042` : null, isSample: true, createdAt: e.expenseDate, updatedAt: e.expenseDate, ...e };
    expenses.push(x);
    return x;
  };
  for (let m = 0; m < 3; m++) {
    const monthStart = NOW - m * 30 * DAY - 28 * DAY;
    for (const t of trucks.filter((x) => x.status !== 'MAINTENANCE')) {
      const d = Math.min(NOW - DAY, monthStart + between(2, 25) * DAY);
      exp({ category: 'FUEL', description: `Diesel — ${t.registrationNumber}`, amount: Math.round(between(450000, 1100000)), expenseDate: iso(d), fuelLitres: Math.round(between(65, 160)), odometerKm: t.odometerKm - m * 2500, truckId: t.id, zoneId: t.zoneId, status: 'PAID', vendorName: 'Indian Oil — Hosur Road' });
    }
    const d2 = Math.min(NOW - DAY, monthStart + 10 * DAY);
    exp({ category: 'MARKETING', source: 'VENDOR_BILL', vendorName: 'Kaveri Digital Ads', vendorBillRef: `KDA/${m + 101}`, description: 'Search and map listing ads', amount: 1500000, taxAmount: 270000, expenseDate: iso(d2), status: 'PAID' });
    exp({ category: 'OFFICE', description: 'Dispatch office rent — Domlur', amount: 2500000, expenseDate: iso(d2), status: 'PAID', vendorName: 'Domlur Estates' });
    exp({ category: 'SOFTWARE', description: 'Maps and SMS usage', amount: 800000, expenseDate: iso(d2), status: m === 0 ? 'APPROVED' : 'PAID', vendorName: 'CloudComm Services' });
    exp({ category: 'INSURANCE', description: 'Fleet insurance instalment', amount: 1200000, expenseDate: iso(d2 + 3 * DAY), status: 'PAID', vendorName: 'Sahyog General Insurance' });
  }
  exp({ category: 'REPAIR', source: 'VENDOR_BILL', vendorName: 'Peenya Hydraulics', vendorBillRef: 'PH-8812', description: 'Hydraulic cylinder seal kit — KA01TP6001', amount: 3850000, taxAmount: 693000, expenseDate: iso(NOW - 2 * DAY), truckId: 'trk_ka01tp6001', zoneId: 'zn_blr_central', status: 'SUBMITTED' });
  exp({ category: 'TOLLS_PARKING', source: 'EMPLOYEE_CLAIM', description: 'NICE Road toll — job to Electronic City', amount: 9500, expenseDate: iso(NOW - 1 * DAY), truckId: 'trk_ka01tp1001', claimantUserId: 'u_drv_ravi', reimbursable: true, submittedById: 'u_drv_ravi', status: 'SUBMITTED' });
  exp({ category: 'FUEL', source: 'EMPLOYEE_CLAIM', description: 'Diesel top-up paid in cash (receipt attached)', amount: 250000, fuelLitres: 27, expenseDate: iso(NOW - 6 * DAY), truckId: 'trk_ka01tp1001', claimantUserId: 'u_drv_ravi', reimbursable: true, submittedById: 'u_drv_ravi', status: 'APPROVED' });
  exp({ category: 'EQUIPMENT', description: 'Replacement dollies set — KA01TP1002', amount: 1850000, taxAmount: 333000, expenseDate: iso(NOW - 3 * DAY), truckId: 'trk_ka01tp1002', status: 'SUBMITTED', vendorName: 'Tow Gear India' });
  exp({ category: 'TOLLS_PARKING', source: 'EMPLOYEE_CLAIM', description: 'Airport parking while waiting for customer', amount: 15000, expenseDate: iso(NOW - 9 * DAY), claimantUserId: 'u_drv_imran', reimbursable: true, submittedById: 'u_drv_imran', status: 'REJECTED', rejectionReason: 'Customer-requested waiting is billed to the customer' });
}

// ─── Notifications & support ─────────────────────────────────────────

const notifications: GNotification[] = [];
const notify = (userId: string, type: string, title: string, body: string, minutesAgo: number, read: boolean, data: Record<string, unknown> | null = null) =>
  notifications.push({ id: `ntf_${notifications.length + 1}`, userId, channel: 'IN_APP', type, title, body, data, readAt: read ? iso(NOW - (minutesAgo - 1) * MIN) : null, createdAt: iso(NOW - minutesAgo * MIN) });
{
  const p = LIVE.priyaActive;
  const unpaid = invoices.find((i) => i.customerUserId === 'u_cus_priya' && i.paymentStatus === 'UNPAID' && i.type === 'SERVICE');
  notify('u_cus_priya', 'booking.status', 'Ravi is on the way', `Ravi Kumar (KA01TP1001) is heading to your location. Booking ${p.code}.`, 9, false, { bookingId: p.id });
  notify('u_cus_priya', 'booking.status', 'Driver assigned', `Ravi Kumar accepted booking ${p.code}.`, 12, false, { bookingId: p.id });
  notify('u_cus_priya', 'booking.status', 'Booking confirmed', `We are finding the nearest truck for ${p.code}.`, 14, true, { bookingId: p.id });
  notify('u_cus_priya', 'booking.scheduled', 'Pickup scheduled for tomorrow', `Your motorcycle pickup ${LIVE.priyaScheduled.code} is confirmed.`, 180, true, { bookingId: LIVE.priyaScheduled.id });
  if (unpaid) notify('u_cus_priya', 'invoice.issued', 'Invoice ready', `Invoice ${unpaid.number} is ready. Pay online or in cash to the driver.`, 2 * 24 * 60 - 200, false, { invoiceId: unpaid.id });
  notify('u_cus_priya', 'membership', 'RoadSafe Annual is active', '2 of 3 covered services remaining this year.', 40 * 24 * 60, true);
  notify('u_drv_ravi', 'job.assigned', 'New job accepted', `${p.code}: car tow from Koramangala to Domlur.`, 12, true, { bookingId: p.id });
  notify('u_drv_ravi', 'payout.paid', 'Payout sent', 'Your payout for the last period was paid to your UPI ID.', 12 * 24 * 60, false);
  notify('u_drv_ravi', 'expense.approved', 'Expense claim approved', 'Diesel top-up of ₹2,500 approved for reimbursement.', 5 * 24 * 60, true);
  notify('u_drv_ravi', 'rating', 'New 5★ rating', 'Rohan Das rated your last job 5 stars.', 20 * 60, false);
  for (const staffId of ['u_admin', 'u_dispatch']) {
    notify(staffId, 'escalation.created', 'No provider for a high-priority job', `${LIVE.snehaSearching.code}: no eligible flatbed near Hebbal Flyover.`, 2, false, { bookingId: LIVE.snehaSearching.id });
    notify(staffId, 'incident.created', 'Safety hold on Hosur Road', `${LIVE.fatimaHold.code}: driver reported an unsafe location.`, 40, false, { bookingId: LIVE.fatimaHold.id });
    notify(staffId, 'escalation.created', 'Manual review needed', `${LIVE.deepakReview.code}: premium vehicle with collision damage.`, 6, false, { bookingId: LIVE.deepakReview.id });
    notify(staffId, 'escalation.created', 'Driver declined a job', `${LIVE.kavyaReassign.code}: reassignment required.`, 9, true, { bookingId: LIVE.kavyaReassign.id });
  }
  for (const staffId of ['u_admin', 'u_finance']) {
    notify(staffId, 'refund.requested', 'Refund requested', 'A customer requested a partial refund for waiting time.', 24 * 60, false);
    notify(staffId, 'cash.pending', 'Cash awaiting confirmation', 'Ravi Kumar collected cash for a completed job.', 22 * 60, false);
    notify(staffId, 'expense.submitted', 'Expenses awaiting approval', '3 expenses were submitted for approval.', 3 * 24 * 60, true);
  }
}

const tickets: GTicket[] = [];
{
  const priyaUnpaid = invoices.find((i) => i.customerUserId === 'u_cus_priya' && i.paymentStatus === 'UNPAID' && i.type === 'SERVICE');
  const priyaPast = bookings.filter((b) => b.customerUserId === 'u_cus_priya' && b.status === 'COMPLETED');
  const t = (x: Omit<GTicket, 'number' | 'updatedAt' | 'subjectUserId' | 'verified' | 'invoiceId' | 'bookingId' | 'assignedToId' | 'resolution' | 'resolvedAt'> & Partial<GTicket>) => {
    const tk: GTicket = { number: `TKT-${String(1041 + tickets.length)}`, updatedAt: x.messages[x.messages.length - 1]?.createdAt ?? x.createdAt, subjectUserId: null, verified: null, invoiceId: null, bookingId: null, assignedToId: null, resolution: null, resolvedAt: null, ...x };
    tickets.push(tk);
  };
  t({ id: 'tkt_priya_billing', userId: 'u_cus_priya', category: 'BILLING_DISPUTE', status: 'IN_PROGRESS', priority: 'MEDIUM', subject: 'Pickup distance charge looks higher than expected', bookingId: priyaUnpaid?.bookingId ?? null, invoiceId: priyaUnpaid?.id ?? null, assignedToId: 'u_finance', createdAt: iso(NOW - 30 * HOUR), messages: [
    { id: 'tm_1', authorId: 'u_cus_priya', body: 'The invoice shows a pickup travel charge but the truck came from nearby. Can you check?', internal: false, createdAt: iso(NOW - 30 * HOUR) },
    { id: 'tm_2', authorId: 'u_finance', body: 'Thanks Priya — we are checking the GPS trail for the driver’s route and will update you today.', internal: false, createdAt: iso(NOW - 26 * HOUR) },
    { id: 'tm_3', authorId: 'u_finance', body: 'Driver started from Domlur; estimate used the zone depot. Likely a ₹150 correction via credit note.', internal: true, createdAt: iso(NOW - 25 * HOUR) },
  ] });
  t({ id: 'tkt_priya_general', userId: 'u_cus_priya', category: 'GENERAL', status: 'RESOLVED', priority: 'LOW', subject: 'Can I add my husband as a second contact?', bookingId: priyaPast[0]?.id ?? null, assignedToId: 'u_dispatch', resolution: 'Emergency contacts can be added under Account → Emergency contacts.', resolvedAt: iso(NOW - 33 * DAY), createdAt: iso(NOW - 34 * DAY), messages: [
    { id: 'tm_4', authorId: 'u_cus_priya', body: 'I want my husband to also get updates when I book a tow.', internal: false, createdAt: iso(NOW - 34 * DAY) },
    { id: 'tm_5', authorId: 'u_dispatch', body: 'You can add him under Account → Emergency contacts. He will be able to view shared tracking links you send.', internal: false, createdAt: iso(NOW - 33 * DAY) },
  ] });
  t({ id: 'tkt_arjun_complaint', userId: 'u_cus_arjun', category: 'COMPLAINT', status: 'OPEN', priority: 'HIGH', subject: 'Driver arrived late for EV pickup', bookingId: 'bk_live_arjun', createdAt: iso(NOW - 18 * MIN), messages: [{ id: 'tm_6', authorId: 'u_cus_arjun', body: 'The ETA said 25 minutes but it took almost 40. Please make sure the EV is loaded with the wheels locked.', internal: false, createdAt: iso(NOW - 18 * MIN) }] });
  t({ id: 'tkt_sneha_refund', userId: 'u_cus_sneha', category: 'REFUND_REQUEST', status: 'AWAITING_CUSTOMER', priority: 'MEDIUM', subject: 'Charged twice for the same tow', assignedToId: 'u_finance', createdAt: iso(NOW - 3 * DAY), messages: [
    { id: 'tm_7', authorId: 'u_cus_sneha', body: 'I see two debits on my card for the Hebbal tow.', internal: false, createdAt: iso(NOW - 3 * DAY) },
    { id: 'tm_8', authorId: 'u_finance', body: 'We only see one successful payment. Could you share the bank reference numbers of both debits?', internal: false, createdAt: iso(NOW - 2 * DAY) },
  ] });
  t({ id: 'tkt_ravi_perf', userId: 'u_drv_ravi', category: 'PERFORMANCE_CHALLENGE', status: 'OPEN', priority: 'MEDIUM', subject: 'Low rating was due to a traffic diversion', subjectUserId: 'u_drv_ravi', createdAt: iso(NOW - 2 * DAY), messages: [{ id: 'tm_9', authorId: 'u_drv_ravi', body: 'The 3-star rating last week was because the police diverted traffic near Silk Board. Please review.', internal: false, createdAt: iso(NOW - 2 * DAY) }] });
  t({ id: 'tkt_kavya_safety', userId: 'u_cus_kavya', category: 'SAFETY', status: 'CLOSED', priority: 'HIGH', subject: 'Driver did not wear a safety vest', assignedToId: 'u_admin', resolution: 'Driver briefed; PPE compliance check added to the daily checklist.', verified: true, resolvedAt: iso(NOW - 15 * DAY), createdAt: iso(NOW - 17 * DAY), messages: [{ id: 'tm_10', authorId: 'u_cus_kavya', body: 'The driver was not wearing a reflective vest on a dark road.', internal: false, createdAt: iso(NOW - 17 * DAY) }, { id: 'tm_11', authorId: 'u_admin', body: 'Thank you for flagging this. We have briefed the driver and added a PPE check.', internal: false, createdAt: iso(NOW - 15 * DAY) }] });
}

// ─── The database ────────────────────────────────────────────────────

export const db = {
  zones,
  categories,
  users,
  availabilityLogs,
  savedAddresses,
  emergencyContacts,
  vehicles,
  trucks,
  maintenance,
  bookings,
  ratings,
  escalations,
  incidents,
  invoices,
  payments,
  refunds,
  creditNotes,
  expenses,
  salaries,
  earnings,
  payouts,
  memberships,
  subscriptions,
  promos,
  fleetAccounts,
  notifications,
  tickets,
  documents,
};

export const zoneById = (id: string | null | undefined) => (id ? zones.find((z) => z.id === id) : undefined);
export const categoryById = (id: string) => categories.find((c) => c.id === id)!;
export const categoryByKey = catByKey;
export const vehicleById = (id: string | null | undefined) => (id ? vehicles.find((v) => v.id === id) : undefined);
export const bookingById = (id: string) => bookings.find((b) => b.id === id);
export const invoiceById = (id: string) => invoices.find((i) => i.id === id);
export const invoiceForBooking = (bookingId: string) => invoices.find((i) => i.bookingId === bookingId && i.type !== 'MEMBERSHIP' && i.status !== 'VOID') ?? invoices.find((i) => i.bookingId === bookingId);
export { zoneFor, otp as newOtp };

/** Adds an in-app notification during the session. */
export function pushNotification(userId: string, type: string, title: string, body: string, data: Record<string, unknown> | null = null) {
  notifications.unshift({ id: newId('ntf'), userId, channel: 'IN_APP', type, title, body, data, readAt: null, createdAt: nowIso() });
}
