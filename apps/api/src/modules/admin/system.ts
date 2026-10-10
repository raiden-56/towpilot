import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { idParam, ok, pageArgs, pageMeta, paginationSchema, parseBody, parseQuery, queryBool } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { DEFAULT_SETTINGS, getSettings, invalidateSettings, type SettingsKey } from '../../lib/settings.js';
import { principal, requirePermission } from '../../middleware/auth.js';
import { PERMISSIONS, ROLE_DEFINITIONS } from '../../domain/permissions.js';
import { notify } from '../notifications/service.js';
import { setInvoiceDispute } from '../billing/service.js';

export const systemRouter = Router();

// ─── Settings ────────────────────────────────────────────────────────

const settingsSchemas: Record<SettingsKey, z.ZodType> = {
  business: z.object({ brandName: z.string().min(2).max(60), legalName: z.string().max(200), gstin: z.string().max(15), address: z.string().max(300), supportPhone: z.string().max(20), supportEmail: z.string().email(), emergencyNumber: z.string().max(10), currency: z.literal('INR'), logoUrl: z.string().max(500) }).partial(),
  locale: z.object({ timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown timezone'), fyStartMonth: z.number().int().min(1).max(12) }).partial(),
  dispatch: z
    .object({
      autoDispatch: z.boolean(),
      offerTimeoutSec: z.number().int().min(20).max(600),
      maxAutoAttempts: z.number().int().min(1).max(10),
      searchRadiusKm: z.number().min(1).max(200),
      avgSpeedKmh: z.number().min(5).max(80),
      locationStaleMinutes: z.number().int().min(1).max(60),
      missedEtaGraceMinutes: z.number().int().min(1).max(120),
      scheduledLeadMinutes: z.number().int().min(10).max(240),
      weights: z.object({ eta: z.number().min(0).max(1), workload: z.number().min(0).max(1), rating: z.number().min(0).max(1) }),
    })
    .partial(),
  pricing: z.object({ roadDistanceFactor: z.number().min(1).max(2), holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) }).partial(),
  retention: z.object({ trackingDays: z.number().int().min(7).max(3650), otpDays: z.number().int().min(1).max(90), notificationDays: z.number().int().min(30).max(3650) }).partial(),
  shareLinks: z.object({ defaultHours: z.number().min(0.5).max(24), maxHours: z.number().min(1).max(48) }).partial(),
  performance: z.object({ weights: z.object({ punctuality: z.number(), completion: z.number(), safety: z.number(), feedback: z.number(), difficulty: z.number() }) }).partial(),
  privacy: z.object({ consentVersion: z.string().max(20), noticeUrl: z.string().max(500) }).partial(),
};

systemRouter.get('/settings', requirePermission('settings:manage', 'pricing:read'), async (_req, res) => {
  ok(res, { values: await getSettings(), defaults: DEFAULT_SETTINGS });
});

systemRouter.put('/settings/:key', requirePermission('settings:manage'), async (req, res) => {
  const key = z.enum(Object.keys(settingsSchemas) as [SettingsKey, ...SettingsKey[]]).parse(req.params.key);
  const value = parseBody(settingsSchemas[key], req) as Record<string, unknown>;
  const before = await prisma.applicationSetting.findUnique({ where: { key } });
  const merged = { ...((before?.value as object) ?? {}), ...value };
  await prisma.applicationSetting.upsert({ where: { key }, create: { key, value: merged as Prisma.InputJsonValue, updatedById: principal(req).userId }, update: { value: merged as Prisma.InputJsonValue, updatedById: principal(req).userId } });
  invalidateSettings();
  await audit(prisma, req, { action: `settings.${key}`, entityType: 'application_setting', entityId: key, before: before?.value, after: merged });
  ok(res, (await getSettings())[key]);
});

systemRouter.get('/roles', requirePermission('roles:manage', 'employee:read'), (_req, res) => ok(res, { roles: ROLE_DEFINITIONS, permissions: PERMISSIONS }));

// ─── Audit log ───────────────────────────────────────────────────────

systemRouter.get('/audit-logs', requirePermission('audit:read'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ entityType: z.string().optional(), entityId: z.string().optional(), actorUserId: z.string().optional(), action: z.string().optional() }), req);
  const where: Prisma.AuditLogWhereInput = {
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
    ...(q.action ? { action: { contains: q.action } } : {}),
  };
  const [items, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }), prisma.auditLog.count({ where })]);
  const actors = await prisma.user.findMany({ where: { id: { in: items.map((i) => i.actorUserId).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
  ok(res, items.map((i) => ({ ...i, actorName: actors.find((a) => a.id === i.actorUserId)?.fullName ?? (i.actorUserId ? null : 'System') })), pageMeta(q, total));
});

// ─── Support desk (staff side) ───────────────────────────────────────

systemRouter.get('/tickets', requirePermission('support:manage'), async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ status: z.string().optional(), category: z.string().optional(), assignedToMe: queryBool.optional() }), req);
  const where: Prisma.SupportTicketWhereInput = {
    ...(q.status ? { status: { in: q.status.split(',') as never } } : {}),
    ...(q.category ? { category: { in: q.category.split(',') as never } } : {}),
    ...(q.assignedToMe ? { assignedToId: principal(req).userId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.supportTicket.findMany({ where, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }], ...pageArgs(q), include: { user: { select: { fullName: true, phone: true } }, booking: { select: { code: true } }, invoice: { select: { number: true } } } }),
    prisma.supportTicket.count({ where }),
  ]);
  ok(res, items, pageMeta(q, total));
});

systemRouter.patch('/tickets/:id', requirePermission('support:manage'), async (req, res) => {
  const p = principal(req);
  const b = parseBody(
    z.object({
      status: z.enum(['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED']).optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      assignToMe: z.boolean().optional(),
      resolution: z.string().max(2000).optional(),
      verified: z.boolean().optional(),
      subjectUserId: z.string().nullable().optional(),
    }),
    req,
  );
  const t0 = await prisma.supportTicket.findUnique({ where: { id: idParam(req) } });
  if (!t0) throw notFound('Ticket');
  const t = await prisma.supportTicket.update({
    where: { id: t0.id },
    data: {
      status: b.status,
      priority: b.priority,
      resolution: b.resolution,
      verified: b.verified,
      subjectUserId: b.subjectUserId,
      ...(b.assignToMe ? { assignedToId: p.userId } : {}),
      ...(b.status === 'RESOLVED' || b.status === 'CLOSED' ? { resolvedAt: new Date() } : {}),
    },
  });
  // Resolving a billing dispute lifts the invoice's dispute flag.
  if ((b.status === 'RESOLVED' || b.status === 'CLOSED') && t.category === 'BILLING_DISPUTE' && t.invoiceId) await setInvoiceDispute(prisma, t.invoiceId, false);
  if (b.status === 'RESOLVED') await notify(prisma, t.userId, { type: 'support.resolved', title: `${t.number} resolved`, body: b.resolution ?? 'Your request has been resolved.', data: { ticketId: t.id }, channels: ['EMAIL'] });
  await audit(prisma, req, { action: 'ticket.updated', entityType: 'support_ticket', entityId: t.id, before: t0, after: b });
  ok(res, t);
});
