import { prisma, type Db } from './prisma.js';

export const DEFAULT_SETTINGS = {
  business: {
    brandName: 'TowPilot',
    legalName: 'TowPilot Roadside Services (configure legal entity)',
    gstin: '',
    address: 'Configure business address in Settings',
    supportPhone: '+91 00000 00000',
    supportEmail: 'support@example.com',
    emergencyNumber: '112',
    currency: 'INR',
    logoUrl: '',
  },
  locale: {
    timezone: 'Asia/Kolkata',
    fyStartMonth: 4,
  },
  dispatch: {
    autoDispatch: true,
    offerTimeoutSec: 90,
    maxAutoAttempts: 3,
    searchRadiusKm: 30,
    avgSpeedKmh: 25,
    locationStaleMinutes: 5,
    missedEtaGraceMinutes: 10,
    scheduledLeadMinutes: 45,
    weights: { eta: 0.6, workload: 0.2, rating: 0.2 },
  },
  pricing: {
    roadDistanceFactor: 1.3,
    holidays: [] as string[],
  },
  retention: {
    trackingDays: 90,
    otpDays: 7,
    notificationDays: 365,
  },
  shareLinks: {
    defaultHours: 4,
    maxHours: 12,
  },
  performance: {
    weights: { punctuality: 0.25, completion: 0.25, safety: 0.2, feedback: 0.2, difficulty: 0.1 },
  },
  privacy: {
    consentVersion: '2026-10',
    noticeUrl: '',
  },
};

export type Settings = typeof DEFAULT_SETTINGS;
export type SettingsKey = keyof Settings;

let cache: { value: Settings; at: number } | null = null;
const TTL_MS = 10_000;

function deepMerge<T>(base: T, override: unknown): T {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return (override as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? deepMerge(b, v) : v;
  }
  return out as T;
}

export async function getSettings(db: Db = prisma): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const rows = await db.applicationSetting.findMany();
  let value: Settings = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    if (r.key in value) value = { ...value, [r.key]: deepMerge(value[r.key as SettingsKey], r.value) };
  }
  cache = { value, at: Date.now() };
  return value;
}

export function invalidateSettings() {
  cache = null;
}
