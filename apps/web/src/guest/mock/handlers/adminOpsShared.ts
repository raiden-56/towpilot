/** Shared state for the guest-mode admin operations handlers: audit log, settings, permission checks. */
import type { AuditRow } from '@/pages/admin/biz/types';
import { DAY, db, MIN, newId, NOW, nowIso, permissionsFor, userById } from '../db';
import { fail, type Ctx } from '../router';

// ─── Permissions ──────────────────────────────────────────────────────

/** 403 unless the guest's role grants one of the permissions (mirrors requirePermission). */
export function requirePerm(c: Ctx, ...perms: string[]) {
  const granted = permissionsFor(userById(c.userId)?.roles ?? []);
  if (!perms.some((p) => granted.includes(p))) fail(403, 'FORBIDDEN', 'You do not have permission to do this');
}

export const canDo = (c: Ctx, perm: string) => permissionsFor(userById(c.userId)?.roles ?? []).includes(perm);

/** Ops actor for booking transitions (opsActor in the API). */
export const opsRole = (c: Ctx) => (userById(c.userId)?.roles.includes('admin') ? ('ADMIN' as const) : ('DISPATCHER' as const));

// ─── Audit log ────────────────────────────────────────────────────────

interface AuditRecord {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}

const auditLog: AuditRecord[] = [];

/** Appends an audit entry (newest first). Exported so other guest handlers can record writes too. */
export function appendAudit(actorUserId: string | null, action: string, entityType: string, entityId: string | null, after: unknown = null, before: unknown = null, at = nowIso()) {
  auditLog.unshift({ id: newId('aud'), actorUserId, action, entityType, entityId, before, after, ip: actorUserId ? '10.0.12.34' : null, requestId: `req_${Math.random().toString(36).slice(2, 10)}`, createdAt: at });
}

export function auditRows(): AuditRow[] {
  return auditLog.map((a) => ({ ...a, actorName: a.actorUserId ? (userById(a.actorUserId)?.fullName ?? null) : 'System' }));
}

// Believable history for the last 30 days, derived from the sample data.
{
  const seed: AuditRecord[] = [];
  const add = (minutesAgo: number, actor: string | null, action: string, entityType: string, entityId: string | null, after: unknown = null, before: unknown = null) =>
    seed.push({ id: `aud_seed_${seed.length + 1}`, actorUserId: actor, action, entityType, entityId, before, after, ip: actor ? `10.0.12.${30 + (seed.length % 20)}` : null, requestId: `req_seed${String(seed.length + 1).padStart(4, '0')}`, createdAt: new Date(NOW - minutesAgo * MIN).toISOString() });
  add(3, 'u_dispatch', 'auth.login', 'user', 'u_dispatch', { method: 'password' });
  add(8, 'u_admin', 'auth.login', 'user', 'u_admin', { method: 'password' });
  for (const e of db.escalations.filter((x) => x.status === 'RESOLVED').slice(0, 6)) add((NOW - new Date(e.resolvedAt!).getTime()) / MIN, e.resolvedById, 'escalation.resolve', 'escalation', e.id, { resolution: e.resolution });
  for (const e of db.escalations.filter((x) => x.status === 'ACKNOWLEDGED')) add(15, 'u_dispatch', 'escalation.ack', 'escalation', e.id, {});
  for (const i of db.incidents.filter((x) => x.status === 'RESOLVED')) add((NOW - new Date(i.resolvedAt!).getTime()) / MIN, 'u_dispatch', 'incident.resolve', 'incident', i.id, { resolution: i.resolution });
  const cancelled = db.bookings.filter((b) => b.status === 'FAILED').slice(0, 3);
  for (const b of cancelled) add((NOW - new Date(b.updatedAt).getTime()) / MIN, 'u_dispatch', 'booking.ops_transition', 'booking', b.id, { to: 'FAILED', reason: b.failureReason });
  for (const p of db.payments.filter((x) => x.method === 'CASH' && x.status === 'SUCCEEDED').slice(-8)) add((NOW - new Date(p.succeededAt!).getTime()) / MIN + 30, 'u_finance', 'payment.cash_confirmed', 'payment', p.id, { amount: p.amount });
  for (const r of db.refunds.filter((x) => x.status !== 'REQUESTED')) add((NOW - new Date(r.updatedAt).getTime()) / MIN, 'u_finance', 'refund.approved', 'refund', r.id, { amount: r.amount });
  for (const s of db.salaries.filter((x) => x.status === 'PAID').slice(-6)) add((NOW - new Date(s.paidAt!).getTime()) / MIN, 'u_finance', 'salary.paid', 'salary_record', s.id, { netAmount: s.netAmount, paymentRef: s.paymentRef });
  for (const p of db.payouts) add((NOW - new Date(p.paidAt ?? p.createdAt).getTime()) / MIN, 'u_finance', 'payout.paid', 'driver_payout', p.id, { netAmount: p.netAmount, paymentRef: p.paymentRef });
  for (const m of db.maintenance.filter((x) => x.type !== 'INSPECTION').slice(0, 6)) add((NOW - new Date(m.createdAt).getTime()) / MIN, m.createdById, 'truck.maintenance', 'tow_truck', m.truckId, { type: m.type, description: m.description, cost: m.cost });
  add(2 * 24 * 60, 'u_admin', 'truck.updated', 'tow_truck', 'trk_ka01tp6001', { status: 'MAINTENANCE' }, { status: 'AVAILABLE' });
  add(2 * 24 * 60 + 40, 'u_admin', 'employee.verification.documents_requested', 'user', 'u_drv_sanjay', { decision: 'DOCUMENTS_REQUESTED', note: 'Please upload a clearer copy of the driving licence (back side).' }, { status: 'PENDING' });
  add(2 * 24 * 60 + 45, 'u_admin', 'employee.document.rejected', 'employee_document', 'doc_drv_sanjay_1', { status: 'REJECTED', note: 'Back side of the licence is not readable' });
  add(6 * 24 * 60, 'u_admin', 'employee.created', 'user', 'u_drv_sanjay', { fullName: 'Sanjay Murthy', roles: ['driver'], employmentType: 'COMMISSION' });
  add(4 * 24 * 60, 'u_admin', 'settings.dispatch', 'application_setting', 'dispatch', { offerTimeoutSec: 90, searchRadiusKm: 30 }, { offerTimeoutSec: 120, searchRadiusKm: 25 });
  add(9 * 24 * 60, 'u_admin', 'rate_card.version_created', 'rate_card', 'rc_car_tow_v1', { reason: 'Diesel price revision' });
  add(10 * 24 * 60, 'u_admin', 'promo.created', 'promo_code', 'promo_diwali15', { code: 'DIWALI15', discountBps: 1500 });
  add(12 * 24 * 60, 'u_admin', 'fleet_contract.updated', 'fleet_contract', 'fc_sahyadri_fy27', { slaResponseMinutes: 45 }, { slaResponseMinutes: 60 });
  add(15 * 24 * 60, 'u_admin', 'ticket.updated', 'support_ticket', 'tkt_kavya_safety', { status: 'CLOSED', verified: true });
  add(18 * 24 * 60, 'u_admin', 'employee.updated', 'user', 'u_drv_kiran', { skills: ['flatbed', 'winching', 'battery service', 'tyre change'] });
  add(20 * 24 * 60, 'u_finance', 'employee.export', 'employee', null);
  add(25 * 24 * 60, 'u_admin', 'employee.roles', 'user', 'u_dispatch', ['dispatcher'], ['dispatcher', 'finance']);
  add(27 * 24 * 60, 'u_admin', 'customer.status.suspended', 'user', 'u_cus_aditya', { status: 'SUSPENDED', reason: 'Chargeback under investigation' }, { status: 'ACTIVE' });
  add(26 * 24 * 60, 'u_admin', 'customer.status.active', 'user', 'u_cus_aditya', { status: 'ACTIVE', reason: 'Chargeback withdrawn by bank' }, { status: 'SUSPENDED' });
  add(29 * 24 * 60, 'u_admin', 'fleet_account.created', 'fleet_account', 'fa_greenline', { name: 'Greenline Cabs LLP' });
  for (let d = 1; d < 30; d += 2) {
    add(d * 24 * 60 + 9 * 60, 'u_dispatch', 'auth.login', 'user', 'u_dispatch', { method: 'password' });
    if (d % 4 === 1) add(d * 24 * 60 + 10 * 60, 'u_finance', 'auth.login', 'user', 'u_finance', { method: 'password' });
  }
  seed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  auditLog.push(...seed.filter((s) => new Date(s.createdAt).getTime() > NOW - 60 * DAY));
}

// ─── Application settings ─────────────────────────────────────────────

export const DEFAULT_SETTINGS = {
  business: { brandName: 'TowPilot', legalName: 'TowPilot Roadside Services (configure legal entity)', gstin: '', address: 'Configure business address in Settings', supportPhone: '+91 00000 00000', supportEmail: 'support@example.com', emergencyNumber: '112', currency: 'INR', logoUrl: '' },
  locale: { timezone: 'Asia/Kolkata', fyStartMonth: 4 },
  dispatch: { autoDispatch: true, offerTimeoutSec: 90, maxAutoAttempts: 3, searchRadiusKm: 30, avgSpeedKmh: 25, locationStaleMinutes: 5, missedEtaGraceMinutes: 10, scheduledLeadMinutes: 45, weights: { eta: 0.6, workload: 0.2, rating: 0.2 } },
  pricing: { roadDistanceFactor: 1.3, holidays: [] as string[] },
  retention: { trackingDays: 90, otpDays: 7, notificationDays: 365 },
  shareLinks: { defaultHours: 4, maxHours: 12 },
  performance: { weights: { punctuality: 0.25, completion: 0.25, safety: 0.2, feedback: 0.2, difficulty: 0.1 } },
  privacy: { consentVersion: '2026-10', noticeUrl: '' },
};

/** Current settings (defaults merged with the sample business's saved values). */
export const settings: Record<string, Record<string, unknown>> = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, Record<string, unknown>>;
Object.assign(settings.business!, { legalName: 'TowPilot Roadside Services Pvt Ltd', gstin: '29AAHCT4821K1Z7', address: '3rd Floor, 80 Feet Road, Domlur, Bengaluru 560071', supportPhone: '+91 80 4000 1234', supportEmail: 'support@towpilot.example' });
settings.pricing!.holidays = ['2026-11-01', '2026-11-08', '2026-12-25', '2027-01-26'];

export function mergeDeep(base: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [k, v] of Object.entries(patch)) {
    const b = base[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b)) mergeDeep(b as Record<string, unknown>, v as Record<string, unknown>);
    else base[k] = v;
  }
  return base;
}

export const dispatchSetting = <T,>(key: string) => (settings.dispatch as Record<string, unknown>)[key] as T;
