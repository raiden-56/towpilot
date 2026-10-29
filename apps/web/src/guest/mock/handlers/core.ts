/** Guest-mode auth, catalogue and location helpers. */
import type { AppConfig } from '@/api/types';
import { db, PLACES, userById } from '../db';
import { on, str } from '../router';
import { meFor } from '../serialize';

export const guestConfig: AppConfig = {
  business: { brandName: 'TowPilot', supportPhone: '+91 80 4000 1234', supportEmail: 'support@towpilot.example', emergencyNumber: '112', currency: 'INR', logoUrl: '' },
  locale: { timezone: 'Asia/Kolkata', fyStartMonth: 4 },
  maps: { provider: 'osm', geocodingAvailable: true, distanceSource: 'estimate' },
  // Sandbox flags drive the "simulated payment" flows; the guest banner replaces the sandbox banner.
  payments: { provider: 'SANDBOX', sandbox: true, keyId: null },
  sms: { sandbox: true },
  shareLinks: { defaultHours: 4, maxHours: 24 },
  privacy: { consentVersion: '2026-10', noticeUrl: '' },
  environment: 'guest',
};

on('GET', '/catalog/config', () => guestConfig);

on('GET', '/auth/me', (c) => meFor(userById(c.userId)!));
on('POST', '/auth/logout', () => ({ loggedOut: true }));
on('POST', '/auth/logout-all', () => ({ loggedOut: true }));
// Guests never authenticate against the server; these keep stray calls harmless.
on('POST', '/auth/login', (c) => ({ accessToken: 'guest', user: meFor(userById(c.userId)!) }));
on('POST', '/auth/otp/request', () => ({ expiresInSec: 300, isNewUser: false, sandbox: true, sandboxOtp: '000000' }));
on('POST', '/auth/otp/verify', (c) => ({ accessToken: 'guest', user: meFor(userById(c.userId)!) }));

/** Which zone covers a point (nearest centre within its radius). */
export function zoneAt(lat: number, lng: number) {
  const km = (z: { centerLat: number; centerLng: number }) => Math.hypot((z.centerLat - lat) * 111, (z.centerLng - lng) * 108.5);
  return db.zones.filter((z) => z.active && km(z) <= z.radiusKm + 2).sort((a, b) => km(a) - km(b))[0] ?? null;
}

on('GET', '/catalog/services', (c) => {
  const lat = c.query.lat != null ? Number(c.query.lat) : null;
  const lng = c.query.lng != null ? Number(c.query.lng) : null;
  const zone = lat != null && lng != null ? zoneAt(lat, lng) : null;
  return {
    zone: zone && { id: zone.id, name: zone.name, city: zone.city },
    outsideServiceArea: lat != null && !zone,
    services: db.categories
      .filter((x) => x.active)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((x) => ({ id: x.id, key: x.key, name: x.name, description: x.description, kind: x.kind, icon: x.icon, vehicleClasses: x.vehicleClasses, availableHere: zone ? zone.categoryKeys.includes(x.key) : null })),
  };
});

on('GET', '/catalog/zones', () => db.zones.filter((z) => z.active).map((z) => ({ id: z.id, name: z.name, city: z.city, centerLat: z.centerLat, centerLng: z.centerLng, radiusKm: z.radiusKm, polygon: null })));

// ─── Locations (offline gazetteer of Bengaluru places) ─────────────────

const GAZETTEER: { lat: number; lng: number; label: string }[] = [
  ...PLACES.map(([lat, lng, label]) => ({ lat, lng, label: `${label}, Bengaluru, Karnataka` })),
  { lat: 12.9767, lng: 77.5713, label: 'Majestic (Kempegowda Bus Station), Bengaluru' },
  { lat: 12.9757, lng: 77.6061, label: 'MG Road, Bengaluru' },
  { lat: 12.9177, lng: 77.6233, label: 'Silk Board Junction, Bengaluru' },
  { lat: 13.1986, lng: 77.7066, label: 'Kempegowda International Airport, Bengaluru' },
  { lat: 12.9915, lng: 77.5543, label: 'Yeshwanthpur, Bengaluru' },
  { lat: 12.9507, lng: 77.5848, label: 'Lalbagh Botanical Garden, Bengaluru' },
  { lat: 12.9259, lng: 77.6766, label: 'Bellandur, Outer Ring Road, Bengaluru' },
  { lat: 12.9855, lng: 77.6052, label: 'Cubbon Park, Bengaluru' },
  { lat: 13.0067, lng: 77.6956, label: 'KR Puram, Bengaluru' },
  { lat: 12.8996, lng: 77.4827, label: 'Kengeri, Mysore Road, Bengaluru' },
];

on('GET', '/locations/search', (c) => {
  const q = (str(c.query.q) ?? '').toLowerCase();
  const words = q.split(/[\s,]+/).filter((w) => w.length > 2);
  const results = GAZETTEER.filter((g) => words.some((w) => g.label.toLowerCase().includes(w))).slice(0, 5);
  return { results, available: true };
});

on('GET', '/locations/reverse', (c) => {
  const lat = Number(c.query.lat);
  const lng = Number(c.query.lng);
  const near = [...GAZETTEER].sort((a, b) => Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng))[0]!;
  return { address: `Near ${near.label}`, available: true, provider: 'osm' };
});

on('POST', '/locations/parse-link', (c) => {
  const url = String(c.body.url ?? '');
  const m = url.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/) ?? url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const point = m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
  return { point, note: point ? null : 'Could not read coordinates from this link. Short links (maps.app.goo.gl) must be opened first and the full link copied.' };
});
