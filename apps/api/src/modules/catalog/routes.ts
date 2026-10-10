import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ok, parseBody, parseQuery } from '../../lib/http.js';
import { resolveZone } from '../../lib/geo.js';
import { getSettings } from '../../lib/settings.js';
import { requireAuth } from '../../middleware/auth.js';
import { geocode, mapsProviderInfo, parseLocationLink, reverseGeocode } from '../../integrations/maps.js';
import { gateway } from '../../integrations/payments.js';
import { env } from '../../config/env.js';

export const catalogRouter = Router();

/** Public app configuration (no secrets). */
catalogRouter.get('/config', async (_req, res) => {
  const s = await getSettings();
  ok(res, {
    business: { brandName: s.business.brandName, supportPhone: s.business.supportPhone, supportEmail: s.business.supportEmail, emergencyNumber: s.business.emergencyNumber, currency: s.business.currency, logoUrl: s.business.logoUrl },
    locale: s.locale,
    maps: mapsProviderInfo(),
    payments: { provider: gateway.provider, sandbox: gateway.isSandbox, keyId: gateway.publicKeyId },
    sms: { sandbox: env.SMS_PROVIDER === 'sandbox' },
    shareLinks: s.shareLinks,
    privacy: s.privacy,
    environment: env.NODE_ENV,
  });
});

/**
 * Services available at a location: only categories enabled in the zone covering the point.
 * Without coordinates, returns the full active catalogue flagged as "location needed".
 */
catalogRouter.get('/services', async (req, res) => {
  const q = parseQuery(z.object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }), req);
  const categories = await prisma.serviceCategory.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' }, include: { zones: { where: { active: true }, select: { zoneId: true } } } });
  let zone = null;
  if (q.lat != null && q.lng != null) zone = resolveZone({ lat: q.lat, lng: q.lng }, await prisma.serviceZone.findMany({ where: { active: true } }));
  ok(res, {
    zone: zone && { id: zone.id, name: zone.name, city: zone.city },
    outsideServiceArea: q.lat != null && !zone,
    services: categories.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      description: c.description,
      kind: c.kind,
      icon: c.icon,
      vehicleClasses: c.vehicleClasses,
      availableHere: zone ? c.zones.some((z) => z.zoneId === zone.id) : null,
    })),
  });
});

catalogRouter.get('/zones', async (_req, res) => {
  ok(res, await prisma.serviceZone.findMany({ where: { active: true }, select: { id: true, name: true, city: true, centerLat: true, centerLng: true, radiusKm: true, polygon: true } }));
});

// ─── Location helpers (authenticated to protect provider quotas) ─────

export const locationsRouter = Router();
locationsRouter.use(requireAuth);

locationsRouter.get('/reverse', async (req, res) => {
  const q = parseQuery(z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }), req);
  const address = await reverseGeocode(q);
  ok(res, { address, available: address != null, provider: mapsProviderInfo().provider });
});

locationsRouter.get('/search', async (req, res) => {
  const q = parseQuery(z.object({ q: z.string().trim().min(3).max(200) }), req);
  const results = await geocode(q.q);
  ok(res, { results, available: mapsProviderInfo().geocodingAvailable });
});

locationsRouter.post('/parse-link', async (req, res) => {
  const { url } = parseBody(z.object({ url: z.string().trim().min(3).max(2000) }), req);
  const point = parseLocationLink(url);
  ok(res, { point, note: point ? null : 'Could not read coordinates from this link. Short links (maps.app.goo.gl) must be opened first and the full link copied.' });
});
