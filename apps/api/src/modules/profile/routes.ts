import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery, phoneSchema, queryBool } from '../../lib/http.js';
import { conflict, notFound } from '../../lib/errors.js';
import { nextDocumentNumber } from '../../lib/numbering.js';
import { getSettings } from '../../lib/settings.js';
import { invalidatePrincipal, principal, requireAuth } from '../../middleware/auth.js';
import { meView } from '../auth/routes.js';
import { storeUploads, uploadMiddleware } from '../../lib/upload.js';
import { signedFileUrl } from '../../integrations/storage.js';

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get('/', async (req, res) => {
  const me = await meView(principal(req).userId);
  ok(res, { ...me, photoUrl: me.photoKey ? signedFileUrl(me.photoKey) : null });
});

profileRouter.patch('/', async (req, res) => {
  const p = principal(req);
  const body = parseBody(z.object({ fullName: z.string().trim().min(2).max(100).optional(), email: z.string().email().toLowerCase().nullable().optional() }), req);
  await prisma.user.update({ where: { id: p.userId }, data: body });
  invalidatePrincipal(p.userId);
  const me = await meView(p.userId);
  ok(res, { ...me, photoUrl: me.photoKey ? signedFileUrl(me.photoKey) : null });
});

profileRouter.post('/photo', uploadMiddleware.single('photo'), async (req, res) => {
  const p = principal(req);
  const [f] = await storeUploads(req, `users/${p.userId}`, ['image']);
  await prisma.user.update({ where: { id: p.userId }, data: { photoKey: f!.storageKey } });
  ok(res, { photoUrl: signedFileUrl(f!.storageKey) });
});

profileRouter.put('/preferences', async (req, res) => {
  const p = principal(req);
  const body = parseBody(
    z.object({ marketingConsent: z.boolean().optional(), locationConsent: z.boolean().optional(), notifySms: z.boolean().optional(), notifyEmail: z.boolean().optional(), notifyPush: z.boolean().optional(), preferredLanguage: z.enum(['en', 'hi']).optional() }),
    req,
  );
  const s = await getSettings();
  const prof = await prisma.customerProfile.upsert({ where: { userId: p.userId }, create: { userId: p.userId, ...body, consentVersion: s.privacy.consentVersion }, update: body });
  await prisma.auditLog.create({ data: { actorUserId: p.userId, action: 'consent.updated', entityType: 'customer_profile', entityId: prof.id, after: body } });
  ok(res, prof);
});

// Saved addresses
profileRouter.get('/addresses', async (req, res) => ok(res, await prisma.savedAddress.findMany({ where: { userId: principal(req).userId }, orderBy: { createdAt: 'desc' } })));
profileRouter.post('/addresses', async (req, res) => {
  const body = parseBody(z.object({ label: z.string().trim().min(1).max(40), address: z.string().trim().min(3).max(500), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), landmark: z.string().max(200).optional() }), req);
  const count = await prisma.savedAddress.count({ where: { userId: principal(req).userId } });
  if (count >= 20) throw conflict('You can save up to 20 addresses');
  created(res, await prisma.savedAddress.create({ data: { ...body, userId: principal(req).userId } }));
});
profileRouter.delete('/addresses/:id', async (req, res) => {
  const r = await prisma.savedAddress.deleteMany({ where: { id: idParam(req), userId: principal(req).userId } });
  if (!r.count) throw notFound('Address');
  ok(res, { deleted: true });
});

// Emergency contacts
profileRouter.get('/emergency-contacts', async (req, res) => ok(res, await prisma.emergencyContact.findMany({ where: { userId: principal(req).userId } })));
profileRouter.post('/emergency-contacts', async (req, res) => {
  const body = parseBody(z.object({ name: z.string().trim().min(2).max(100), phone: phoneSchema, relationship: z.string().max(40).optional() }), req);
  const count = await prisma.emergencyContact.count({ where: { userId: principal(req).userId } });
  if (count >= 5) throw conflict('You can add up to 5 emergency contacts');
  created(res, await prisma.emergencyContact.create({ data: { ...body, userId: principal(req).userId } }));
});
profileRouter.delete('/emergency-contacts/:id', async (req, res) => {
  const r = await prisma.emergencyContact.deleteMany({ where: { id: idParam(req), userId: principal(req).userId } });
  if (!r.count) throw notFound('Contact');
  ok(res, { deleted: true });
});

// Notifications
profileRouter.get('/notifications', async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ unread: queryBool.optional() }), req);
  const where = { userId: principal(req).userId, channel: 'IN_APP' as const, ...(q.unread ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: principal(req).userId, channel: 'IN_APP', readAt: null } }),
  ]);
  ok(res, items, { ...pageMeta(q, total), unread });
});
profileRouter.post('/notifications/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: principal(req).userId, readAt: null }, data: { readAt: new Date() } });
  ok(res, { ok: true });
});
profileRouter.post('/notifications/:id/read', async (req, res) => {
  await prisma.notification.updateMany({ where: { id: idParam(req), userId: principal(req).userId }, data: { readAt: new Date() } });
  ok(res, { ok: true });
});

// ─── Data-subject rights (DPDP Act): access and erasure requests ───────

profileRouter.get('/data-export', async (req, res) => {
  const id = principal(req).userId;
  const [user, vehicles, bookings, invoices, payments, addresses, contacts, tickets, notifications] = await Promise.all([
    prisma.user.findUnique({ where: { id }, select: { id: true, fullName: true, phone: true, email: true, createdAt: true, customerProfile: true } }),
    prisma.vehicle.findMany({ where: { ownerUserId: id } }),
    prisma.booking.findMany({ where: { customerUserId: id }, include: { locations: true, assessment: true, statusHistory: true, ratings: true }, omit: { pickupOtp: true, handoverOtp: true } }),
    prisma.invoice.findMany({ where: { customerUserId: id }, include: { items: true } }),
    prisma.payment.findMany({ where: { invoice: { customerUserId: id } }, select: { id: true, method: true, status: true, amount: true, createdAt: true, receiptNumber: true } }),
    prisma.savedAddress.findMany({ where: { userId: id } }),
    prisma.emergencyContact.findMany({ where: { userId: id } }),
    prisma.supportTicket.findMany({ where: { userId: id }, include: { messages: { where: { internal: false } } } }),
    prisma.notification.findMany({ where: { userId: id }, take: 500, orderBy: { createdAt: 'desc' } }),
  ]);
  await prisma.auditLog.create({ data: { actorUserId: id, action: 'privacy.data_export', entityType: 'user', entityId: id } });
  res.setHeader('content-disposition', 'attachment; filename="towpilot-my-data.json"');
  ok(res, { exportedAt: new Date(), user, vehicles, bookings, invoices, payments, addresses, contacts, tickets, notifications });
});

profileRouter.post('/privacy-request', async (req, res) => {
  const p = principal(req);
  const body = parseBody(z.object({ type: z.enum(['ERASURE', 'CORRECTION', 'WITHDRAW_CONSENT', 'GRIEVANCE']), details: z.string().trim().min(5).max(2000) }), req);
  const t = await prisma.supportTicket.create({
    data: { number: await nextDocumentNumber(prisma, 'TKT'), userId: p.userId, category: 'PRIVACY_REQUEST', subject: `Privacy request: ${body.type.replace('_', ' ').toLowerCase()}`, messages: { create: { authorId: p.userId, body: body.details } } },
  });
  created(res, { ticket: t, note: 'Financial records must be retained as required by tax law; other personal data will be erased or anonymised after review.' });
});
