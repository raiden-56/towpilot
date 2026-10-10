import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { ok } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { sha256 } from '../../lib/crypto.js';
import { coarsen } from '../../lib/geo.js';
import { publicLimiter } from '../../middleware/rateLimit.js';
import { LIVE_TRACKING_STATUSES, STATUS_LABELS } from '../../domain/bookingStateMachine.js';
import { storage, verifyFileSignature } from '../../integrations/storage.js';

export const publicRouter = Router();
publicRouter.use(publicLimiter);

/**
 * Shared emergency tracking link. Reveals only: status, timeline labels, ETA, driver first
 * name, truck plate, live driver position and an approximate pickup area. No phone numbers,
 * OTPs, prices, exact pickup coordinates or customer identity.
 */
publicRouter.get('/track/:token', async (req, res) => {
  const link = await prisma.bookingShareLink.findUnique({ where: { tokenHash: sha256(req.params.token ?? '') } });
  if (!link || link.revokedAt || link.expiresAt < new Date()) throw notFound('Tracking link');
  await prisma.bookingShareLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: link.bookingId },
    select: {
      code: true,
      status: true,
      etaAt: true,
      serviceCategory: { select: { name: true } },
      vehicle: { select: { make: true, model: true } },
      locations: { select: { kind: true, lat: true, lng: true, placeName: true } },
      statusHistory: { select: { toStatus: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      assignments: { where: { status: 'ACCEPTED' }, select: { driverUserId: true, driver: { select: { fullName: true } }, truck: { select: { registrationNumber: true, truckType: true } } } },
    },
  });
  const a = b.assignments[0];
  let driverLocation = null;
  if (a && LIVE_TRACKING_STATUSES.includes(b.status)) {
    const av = await prisma.driverAvailability.findUnique({ where: { userId: a.driverUserId }, select: { lastLat: true, lastLng: true, lastLocationAt: true } });
    if (av?.lastLat != null && av.lastLng != null) driverLocation = { lat: av.lastLat, lng: av.lastLng, at: av.lastLocationAt };
  }
  const pickup = b.locations.find((l) => l.kind === 'PICKUP');
  const drop = b.locations.find((l) => l.kind === 'DROPOFF');
  ok(res, {
    code: b.code,
    status: b.status,
    statusLabel: STATUS_LABELS[b.status],
    service: b.serviceCategory.name,
    vehicle: b.vehicle ? `${b.vehicle.make} ${b.vehicle.model}` : null,
    etaAt: b.etaAt,
    timeline: b.statusHistory.map((h) => ({ status: h.toStatus, label: STATUS_LABELS[h.toStatus], at: h.createdAt })),
    driver: a ? { firstName: a.driver.fullName.split(' ')[0], truck: a.truck } : null,
    driverLocation,
    pickupArea: pickup ? coarsen(pickup) : null,
    destination: drop?.placeName ?? null,
    expiresAt: link.expiresAt,
  });
});

/** Signed, expiring access to private files (evidence, documents, invoices). */
publicRouter.get('/files/*key', async (req, res) => {
  const raw = (req.params as { key?: string | string[] }).key;
  const key = Array.isArray(raw) ? raw.join('/') : (raw ?? '');
  const { exp, sig } = req.query as { exp?: string; sig?: string };
  if (!exp || !sig || !verifyFileSignature(key, exp, sig)) throw notFound('File');
  if (!(await storage.exists(key))) throw notFound('File');
  res.setHeader('cache-control', 'private, max-age=300');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-disposition', 'inline');
  const ext = key.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', heic: 'image/heic' };
  res.setHeader('content-type', types[ext ?? ''] ?? 'application/octet-stream');
  (await storage.get(key)).pipe(res);
});
