import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery } from '../../lib/http.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { getSettings } from '../../lib/settings.js';
import { env } from '../../config/env.js';
import { principal, requireAuth, requirePermission, can } from '../../middleware/auth.js';
import { storeUploads, uploadMiddleware } from '../../lib/upload.js';
import { signedFileUrl } from '../../integrations/storage.js';
import {
  cancelBooking,
  cancellationPreview,
  confirmBooking,
  createBooking,
  createBookingInput,
  getBookingFor,
  listSummarySelect,
  requote,
  resolveViewer,
  statusGroups,
} from './service.js';
import { decideRevision } from '../field/service.js';
import { raiseEscalation } from '../dispatch/service.js';
import { withTx } from '../../lib/tx.js';
import { transition } from './transitions.js';
import { nextDocumentNumber } from '../../lib/numbering.js';
import { emitToBooking } from '../../realtime/socket.js';
import { renderCustodyReport } from './custody.js';

export const bookingsRouter = Router();
bookingsRouter.use(requireAuth);

bookingsRouter.post('/', requirePermission('customer:self'), async (req, res) => {
  const input = parseBody(createBookingInput, req);
  const id = await createBooking(principal(req), input);
  created(res, await getBookingFor(principal(req), id));
});

bookingsRouter.get('/', async (req, res) => {
  const p = principal(req);
  const q = parseQuery(
    paginationSchema.extend({
      group: z.enum(['active', 'completed', 'cancelled', 'unassigned']).optional(),
      status: z.string().optional(),
      q: z.string().trim().max(60).optional(),
      zoneId: z.string().optional(),
      serviceCategoryId: z.string().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
    req,
  );
  const where: NonNullable<Parameters<typeof prisma.booking.findMany>[0]>['where'] = {};
  if (!can(req, 'booking:read_any')) where.customerUserId = p.userId; // customers only ever see their own
  if (q.group) where.status = { in: statusGroups[q.group] };
  if (q.status) where.status = { in: q.status.split(',') as never };
  if (q.zoneId) where.zoneId = q.zoneId;
  if (q.serviceCategoryId) where.serviceCategoryId = q.serviceCategoryId;
  if (q.from || q.to) where.createdAt = { gte: q.from, lt: q.to };
  if (q.q) where.OR = [{ code: { contains: q.q, mode: 'insensitive' } }, { vehicle: { registrationNumber: { contains: q.q.replace(/\s/g, ''), mode: 'insensitive' } } }, { contactName: { contains: q.q, mode: 'insensitive' } }];
  const [items, total] = await Promise.all([prisma.booking.findMany({ where, select: listSummarySelect, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }), prisma.booking.count({ where })]);
  ok(res, items, pageMeta(q, total));
});

bookingsRouter.get('/:id', async (req, res) => {
  ok(res, await getBookingFor(principal(req), idParam(req)));
});

bookingsRouter.post('/:id/requote', requirePermission('customer:self'), async (req, res) => {
  const body = parseBody(z.object({ promoCode: z.string().trim().max(30).nullable().optional(), useMembership: z.boolean().optional() }), req);
  await requote(principal(req), idParam(req), body);
  ok(res, await getBookingFor(principal(req), idParam(req)));
});

bookingsRouter.post('/:id/confirm', requirePermission('customer:self'), async (req, res) => {
  const { quoteId } = parseBody(z.object({ quoteId: z.string().min(1) }), req);
  await confirmBooking(principal(req), idParam(req), quoteId);
  ok(res, await getBookingFor(principal(req), idParam(req)));
});

bookingsRouter.get('/:id/cancellation', async (req, res) => {
  await getBookingFor(principal(req), idParam(req)); // access check
  ok(res, await cancellationPreview(idParam(req)));
});

bookingsRouter.post('/:id/cancel', async (req, res) => {
  const p = principal(req);
  const body = parseBody(z.object({ reason: z.string().trim().min(3).max(500), acceptFee: z.boolean().optional(), waiveFee: z.boolean().optional() }), req);
  const b = await prisma.booking.findUnique({ where: { id: idParam(req) }, select: { id: true, customerUserId: true } });
  if (!b) throw notFound('Booking');
  const isCustomer = b.customerUserId === p.userId;
  if (!isCustomer && !can(req, 'booking:manage')) throw notFound('Booking');
  const actor = isCustomer ? { userId: p.userId, role: 'CUSTOMER' as const } : { userId: p.userId, role: p.roles.includes('admin') ? ('ADMIN' as const) : ('DISPATCHER' as const) };
  const r = await cancelBooking(actor, b.id, body);
  ok(res, { ...r, booking: await getBookingFor(p, b.id) });
});

bookingsRouter.post('/:id/quotes/:quoteId/decision', requirePermission('customer:self'), async (req, res) => {
  const body = parseBody(z.object({ approve: z.boolean(), note: z.string().max(500).optional() }), req);
  ok(res, await decideRevision(principal(req), idParam(req), idParam(req, 'quoteId'), body.approve, body.note));
});

// ─── Evidence uploads (customer damage photos, field evidence, receipts) ───

bookingsRouter.post('/:id/attachments', uploadMiddleware.array('files', 6), async (req, res) => {
  const p = principal(req);
  const bookingId = idParam(req);
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true, customerUserId: true, status: true } });
  if (!b) throw notFound('Booking');
  const viewer = await resolveViewer(p, b);
  if (viewer !== 'customer' && viewer !== 'field') throw notFound('Booking');
  const { kind, caption } = z
    .object({
      kind: z.enum(['DAMAGE_PHOTO', 'DAMAGE_VIDEO', 'PICKUP_EVIDENCE', 'DELIVERY_EVIDENCE', 'TOLL_RECEIPT', 'INCIDENT', 'OTHER']),
      caption: z.string().max(200).optional(),
    })
    .parse(req.body);
  if (viewer === 'customer' && !['DAMAGE_PHOTO', 'DAMAGE_VIDEO', 'OTHER'].includes(kind)) throw badRequest('Customers can upload damage photos and videos');
  if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(b.status)) throw conflict('This booking is closed');
  const files = await storeUploads(req, `bookings/${bookingId}`, kind === 'DAMAGE_VIDEO' ? ['video'] : kind === 'TOLL_RECEIPT' ? ['document'] : ['image']);
  const rows = await prisma.$transaction(
    files.map((f) => prisma.bookingAttachment.create({ data: { bookingId, uploadedById: p.userId, kind, storageKey: f.storageKey, mimeType: f.mimeType, sizeBytes: f.sizeBytes, sha256: f.sha256, caption } })),
  );
  emitToBooking(bookingId, 'booking.evidence', { kind });
  created(res, rows.map((r) => ({ ...r, storageKey: undefined, url: signedFileUrl(r.storageKey) })));
});

// ─── Sharing, contact, escalation ────────────────────────────────────

bookingsRouter.post('/:id/share-links', requirePermission('customer:self'), async (req, res) => {
  const p = principal(req);
  const s = await getSettings();
  const { hours } = parseBody(z.object({ hours: z.number().min(0.5).max(s.shareLinks.maxHours).default(s.shareLinks.defaultHours) }), req);
  const b = await prisma.booking.findUnique({ where: { id: idParam(req) } });
  if (!b || b.customerUserId !== p.userId) throw notFound('Booking');
  if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(b.status)) throw conflict('Sharing is only available for active bookings');
  const token = randomToken(24);
  const link = await prisma.bookingShareLink.create({ data: { bookingId: b.id, tokenHash: sha256(token), createdById: p.userId, expiresAt: new Date(Date.now() + hours * 3600_000) } });
  // The raw token is returned once and never stored.
  created(res, { id: link.id, expiresAt: link.expiresAt, url: `${env.APP_BASE_URL}/track/${token}` });
});

bookingsRouter.delete('/:id/share-links/:linkId', requirePermission('customer:self'), async (req, res) => {
  const p = principal(req);
  const link = await prisma.bookingShareLink.findUnique({ where: { id: idParam(req, 'linkId') }, include: { booking: { select: { customerUserId: true } } } });
  if (!link || link.booking.customerUserId !== p.userId) throw notFound('Share link');
  await prisma.bookingShareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
  ok(res, { revoked: true });
});

/** Contact details for the other party on an active job. A masking provider can be plugged in here. */
bookingsRouter.post('/:id/contact', async (req, res) => {
  const p = principal(req);
  const b = await prisma.booking.findUnique({ where: { id: idParam(req) }, include: { assignments: { where: { status: 'ACCEPTED' }, include: { driver: { select: { fullName: true, phone: true } } } } } });
  if (!b) throw notFound('Booking');
  const viewer = await resolveViewer(p, b);
  if (viewer === 'customer') {
    const a = b.assignments[0];
    if (!a) throw conflict('No driver has accepted this booking yet');
    return ok(res, { name: a.driver.fullName, phone: a.driver.phone, masked: false, note: 'Number masking is not configured; this is the driver’s work number for this job only.' });
  }
  if (viewer === 'field') return ok(res, { name: b.contactName, phone: b.contactPhone, masked: false, note: 'Customer contact for this job only.' });
  throw notFound('Booking');
});

bookingsRouter.post('/:id/report-unreachable', requirePermission('customer:self'), async (req, res) => {
  const p = principal(req);
  const b = await prisma.booking.findUnique({ where: { id: idParam(req) } });
  if (!b || b.customerUserId !== p.userId) throw notFound('Booking');
  const { note } = parseBody(z.object({ note: z.string().max(500).optional() }), req);
  await raiseEscalation(prisma, null, b.id, 'CUSTOMER_CANNOT_CONTACT', `Customer cannot reach the assigned driver${note ? `: ${note}` : ''}`, String(Math.floor(Date.now() / 600_000)));
  ok(res, { escalated: true, message: 'Our dispatch team has been alerted and will contact you shortly.' });
});

bookingsRouter.post('/:id/rating', requirePermission('customer:self'), async (req, res) => {
  const p = principal(req);
  const body = parseBody(z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(1000).optional(), tags: z.array(z.string().max(30)).max(8).default([]) }), req);
  const b = await prisma.booking.findUnique({ where: { id: idParam(req) }, include: { teamMembers: { where: { role: 'TEAM_LEADER' } } } });
  if (!b || b.customerUserId !== p.userId) throw notFound('Booking');
  if (!['COMPLETED', 'DELIVERED'].includes(b.status)) throw conflict('You can rate after the job is completed');
  const lead = b.teamMembers[0];
  if (!lead) throw conflict('No driver to rate');
  created(res, await prisma.rating.create({ data: { bookingId: b.id, raterUserId: p.userId, rateeUserId: lead.userId, ...body } }));
});

bookingsRouter.post('/:id/dispute', requirePermission('customer:self'), async (req, res) => {
  const p = principal(req);
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(10).max(2000) }), req);
  const ticket = await withTx(async (tx, after) => {
    const b = await tx.booking.findUnique({ where: { id: idParam(req) } });
    if (!b || b.customerUserId !== p.userId) throw notFound('Booking');
    await transition(tx, after, b, 'DISPUTED', { userId: p.userId, role: 'CUSTOMER' }, { reason });
    return tx.supportTicket.create({
      data: { number: await nextDocumentNumber(tx, 'TKT'), userId: p.userId, category: 'COMPLAINT', subject: `Dispute on booking ${b.code}`, bookingId: b.id, priority: 'HIGH', messages: { create: { authorId: p.userId, body: reason } } },
    });
  });
  created(res, ticket);
});

bookingsRouter.get('/:id/custody-report', async (req, res) => {
  const p = principal(req);
  const b = await prisma.booking.findUnique({ where: { id: idParam(req) }, select: { id: true, customerUserId: true, code: true } });
  if (!b) throw notFound('Booking');
  const viewer = await resolveViewer(p, b);
  if (!viewer || viewer === 'offered') throw notFound('Booking');
  const pdf = await renderCustodyReport(b.id);
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="custody-${b.code}.pdf"`);
  res.send(pdf);
});

// Live tracking reconciliation endpoint (clients poll this periodically besides sockets).
bookingsRouter.get('/:id/tracking', async (req, res) => {
  const d = (await getBookingFor(principal(req), idParam(req))) as { status: string; etaAt: Date | null; driverLocation?: unknown };
  ok(res, { status: d.status, etaAt: d.etaAt, driverLocation: d.driverLocation ?? null, serverTime: new Date() });
});
