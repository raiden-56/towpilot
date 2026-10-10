import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { created, idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { nextDocumentNumber } from '../../lib/numbering.js';
import { can, principal, requireAuth } from '../../middleware/auth.js';
import { notify, notifyOps } from '../notifications/service.js';
import { setInvoiceDispute } from '../billing/service.js';

export const supportRouter = Router();
supportRouter.use(requireAuth);

supportRouter.post('/tickets', async (req, res) => {
  const p = principal(req);
  const body = parseBody(
    z.object({
      category: z.enum(['GENERAL', 'COMPLAINT', 'BILLING_DISPUTE', 'REFUND_REQUEST', 'PRIVACY_REQUEST', 'PERFORMANCE_CHALLENGE', 'SAFETY']),
      subject: z.string().trim().min(3).max(150),
      message: z.string().trim().min(5).max(4000),
      bookingId: z.string().optional(),
      invoiceId: z.string().optional(),
    }),
    req,
  );
  if (body.category === 'PERFORMANCE_CHALLENGE' && !can(req, 'driver:self')) throw notFound('Category');
  if (body.bookingId) {
    const ok_ = await prisma.booking.count({ where: { id: body.bookingId, OR: [{ customerUserId: p.userId }, { teamMembers: { some: { userId: p.userId } } }] } });
    if (!ok_) throw notFound('Booking');
  }
  if (body.invoiceId && !(await prisma.invoice.count({ where: { id: body.invoiceId, customerUserId: p.userId } }))) throw notFound('Invoice');
  const t = await prisma.supportTicket.create({
    data: {
      number: await nextDocumentNumber(prisma, 'TKT'),
      userId: p.userId,
      category: body.category,
      subject: body.subject,
      bookingId: body.bookingId,
      invoiceId: body.invoiceId,
      priority: body.category === 'SAFETY' ? 'CRITICAL' : body.category === 'COMPLAINT' ? 'HIGH' : 'MEDIUM',
      messages: { create: { authorId: p.userId, body: body.message } },
    },
  });
  if (body.category === 'BILLING_DISPUTE' && body.invoiceId) await setInvoiceDispute(prisma, body.invoiceId, true);
  await notifyOps(prisma, { type: 'support.ticket', title: `New ${body.category.replace(/_/g, ' ').toLowerCase()} ticket ${t.number}`, body: body.subject, data: { ticketId: t.id } });
  created(res, t);
});

supportRouter.get('/tickets', async (req, res) => {
  const p = principal(req);
  const q = parseQuery(paginationSchema, req);
  const where = { userId: p.userId };
  const [items, total] = await Promise.all([prisma.supportTicket.findMany({ where, orderBy: { updatedAt: 'desc' }, ...pageArgs(q), include: { booking: { select: { code: true } } } }), prisma.supportTicket.count({ where })]);
  ok(res, items, pageMeta(q, total));
});

supportRouter.get('/tickets/:id', async (req, res) => {
  const p = principal(req);
  const staff = can(req, 'support:manage');
  const t = await prisma.supportTicket.findUnique({ where: { id: idParam(req) }, include: { messages: { where: staff ? {} : { internal: false }, orderBy: { createdAt: 'asc' } }, booking: { select: { id: true, code: true } }, invoice: { select: { id: true, number: true } } } });
  if (!t || (!staff && t.userId !== p.userId)) throw notFound('Ticket');
  const authors = await prisma.user.findMany({ where: { id: { in: t.messages.map((m) => m.authorId) } }, select: { id: true, fullName: true } });
  const nameOf = new Map(authors.map((a) => [a.id, a.fullName]));
  ok(res, { ...t, messages: t.messages.map((m) => ({ ...m, authorName: m.authorId === t.userId ? nameOf.get(m.authorId) : staff ? nameOf.get(m.authorId) : 'Support team', fromCustomer: m.authorId === t.userId })) });
});

supportRouter.post('/tickets/:id/messages', async (req, res) => {
  const p = principal(req);
  const staff = can(req, 'support:manage');
  const body = parseBody(z.object({ body: z.string().trim().min(1).max(4000), internal: z.boolean().default(false) }), req);
  const t = await prisma.supportTicket.findUnique({ where: { id: idParam(req) } });
  if (!t || (!staff && t.userId !== p.userId)) throw notFound('Ticket');
  const m = await prisma.ticketMessage.create({ data: { ticketId: t.id, authorId: p.userId, body: body.body, internal: staff && body.internal } });
  const reopened = !staff && (t.status === 'RESOLVED' || t.status === 'CLOSED');
  await prisma.supportTicket.update({
    where: { id: t.id },
    data: { status: staff && !body.internal ? 'AWAITING_CUSTOMER' : reopened ? 'OPEN' : t.status === 'AWAITING_CUSTOMER' ? 'IN_PROGRESS' : t.status, ...(reopened ? { resolvedAt: null } : {}) },
  });
  if (!staff) await notifyOps(prisma, { type: 'support.reply', title: `${reopened ? 'Reopened' : 'Customer reply'}: ${t.number}`, body: body.body.slice(0, 140), data: { ticketId: t.id } });
  if (staff && !body.internal) await notify(prisma, t.userId, { type: 'support.reply', title: `Reply on ${t.number}`, body: body.body.slice(0, 140), data: { ticketId: t.id }, channels: ['EMAIL'] });
  created(res, m);
});
