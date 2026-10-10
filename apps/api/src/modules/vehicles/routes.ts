import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, parseBody } from '../../lib/http.js';
import { conflict, notFound } from '../../lib/errors.js';
import { principal, requireAuth, requirePermission } from '../../middleware/auth.js';
import { storeUploads, uploadMiddleware } from '../../lib/upload.js';
import { signedFileUrl } from '../../integrations/storage.js';

export const vehiclesRouter = Router();
vehiclesRouter.use(requireAuth, requirePermission('customer:self'));

const vehicleInput = z.object({
  vehicleClass: z.enum(['TWO_WHEELER', 'HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'LCV', 'HCV']),
  registrationNumber: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .refine((v) => /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$|^\d{2}BH\d{4}[A-Z]{1,2}$/.test(v), 'Enter a valid Indian registration number, e.g. KA01AB1234'),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  fuelType: z.enum(['PETROL', 'DIESEL', 'CNG', 'LPG', 'ELECTRIC', 'HYBRID', 'OTHER']),
  color: z.string().trim().max(30).optional(),
  year: z.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
});

const view = <T extends { photoKeys: string[] }>(v: T) => ({ ...v, photoUrls: v.photoKeys.map((k) => signedFileUrl(k)), photoKeys: undefined });

async function ownVehicle(userId: string, id: string) {
  const v = await prisma.vehicle.findFirst({ where: { id, ownerUserId: userId, deletedAt: null } });
  if (!v) throw notFound('Vehicle');
  return v;
}

vehiclesRouter.get('/', async (req, res) => {
  const p = principal(req);
  const vs = await prisma.vehicle.findMany({
    where: { deletedAt: null, OR: [{ ownerUserId: p.userId }, { fleetAccount: { members: { some: { userId: p.userId } } } }] },
    orderBy: { createdAt: 'desc' },
    include: { fleetAccount: { select: { id: true, name: true } } },
  });
  ok(res, vs.map(view));
});

vehiclesRouter.post('/', async (req, res) => {
  const p = principal(req);
  const body = parseBody(vehicleInput, req);
  const dup = await prisma.vehicle.findFirst({ where: { ownerUserId: p.userId, registrationNumber: body.registrationNumber, deletedAt: null } });
  if (dup) throw conflict('You have already added this vehicle');
  const count = await prisma.vehicle.count({ where: { ownerUserId: p.userId, deletedAt: null } });
  if (count >= 25) throw conflict('Vehicle limit reached. Contact us about a business account.');
  created(res, view(await prisma.vehicle.create({ data: { ...body, ownerUserId: p.userId } })));
});

vehiclesRouter.patch('/:id', async (req, res) => {
  const p = principal(req);
  const v = await ownVehicle(p.userId, idParam(req));
  const body = parseBody(vehicleInput.partial().extend({ color: z.string().trim().max(30).nullable().optional(), year: z.number().int().min(1950).max(new Date().getFullYear() + 1).nullable().optional() }), req);
  if (body.registrationNumber && body.registrationNumber !== v.registrationNumber) {
    const dup = await prisma.vehicle.findFirst({ where: { ownerUserId: p.userId, registrationNumber: body.registrationNumber, deletedAt: null, id: { not: v.id } } });
    if (dup) throw conflict('You have already added this vehicle');
  }
  ok(res, view(await prisma.vehicle.update({ where: { id: idParam(req) }, data: body })));
});

vehiclesRouter.delete('/:id', async (req, res) => {
  const p = principal(req);
  const v = await ownVehicle(p.userId, idParam(req));
  const active = await prisma.booking.count({ where: { vehicleId: v.id, status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] } } });
  if (active) throw conflict('This vehicle has an active booking');
  // Soft delete: historical bookings and invoices keep referencing it.
  await prisma.vehicle.update({ where: { id: v.id }, data: { deletedAt: new Date() } });
  ok(res, { deleted: true });
});

vehiclesRouter.post('/:id/photos', uploadMiddleware.array('photos', 4), async (req, res) => {
  const p = principal(req);
  const v = await ownVehicle(p.userId, idParam(req));
  if (v.photoKeys.length >= 8) throw conflict('Up to 8 photos per vehicle');
  const files = await storeUploads(req, `vehicles/${v.id}`, ['image']);
  ok(res, view(await prisma.vehicle.update({ where: { id: v.id }, data: { photoKeys: { push: files.map((f) => f.storageKey) } } })));
});
