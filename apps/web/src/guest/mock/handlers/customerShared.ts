/** Helpers shared by the guest-mode customer handlers. */
import type { GInvoice, GTicket, GUser } from '../model';
import { db, invoiceById, nowIso, newId, permissionsFor, refreshInvoiceLedger, userById } from '../db';
import { fail, notFound } from '../router';

export const me = (userId: string): GUser => userById(userId) ?? fail(401, 'UNAUTHORIZED', 'Not signed in');
export const can = (u: GUser, perm: string) => permissionsFor(u.roles).includes(perm);

/** Straight-line distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
/** Road distance estimate from a straight line (city detour factor). */
export const roadKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.round(haversineKm(a, b) * 1.35 * 10) / 10;

/** Recompute an invoice's ledger including in-flight refunds and online attempts. */
export function refreshLedger(inv: GInvoice) {
  const refundPending = db.refunds.filter((r) => r.invoiceId === inv.id && ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(r.status)).reduce((a, r) => a + r.amount, 0);
  const pays = db.payments.filter((p) => p.invoiceId === inv.id && p.method === 'ONLINE').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const hasPendingOnline = pays.some((p) => p.status === 'CREATED' || p.status === 'PENDING');
  const lastFailed = pays[0]?.status === 'FAILED';
  refreshInvoiceLedger(inv, { refundPending, hasPendingOnline, lastFailed });
}

/** Invoice visible to the user: own, finance staff, or fleet manager of the billed account. */
export function invoiceFor(u: GUser, id: string): GInvoice {
  const inv = invoiceById(id);
  if (!inv) return notFound('Invoice');
  if (inv.customerUserId === u.id || can(u, 'finance:read')) return inv;
  if (inv.fleetAccountId && db.fleetAccounts.find((f) => f.id === inv.fleetAccountId)?.members.some((m) => m.userId === u.id && m.isManager)) return inv;
  return notFound('Invoice');
}

export function nextTicketNumber() {
  const max = db.tickets.reduce((m, t) => Math.max(m, Number(t.number.replace(/\D/g, '')) || 0), 1040);
  return `TKT-${max + 1}`;
}

export function createTicket(userId: string, t: Pick<GTicket, 'category' | 'subject'> & Partial<Pick<GTicket, 'priority' | 'bookingId' | 'invoiceId' | 'subjectUserId'>>, message: string): GTicket {
  const at = nowIso();
  const ticket: GTicket = {
    id: newId('tkt'),
    number: nextTicketNumber(),
    userId,
    category: t.category,
    status: 'OPEN',
    priority: t.priority ?? (t.category === 'SAFETY' ? 'CRITICAL' : t.category === 'COMPLAINT' ? 'HIGH' : 'MEDIUM'),
    subject: t.subject,
    bookingId: t.bookingId ?? null,
    invoiceId: t.invoiceId ?? null,
    subjectUserId: t.subjectUserId ?? null,
    assignedToId: null,
    resolution: null,
    verified: null,
    resolvedAt: null,
    createdAt: at,
    updatedAt: at,
    messages: [{ id: newId('tm'), authorId: userId, body: message, internal: false, createdAt: at }],
  };
  db.tickets.unshift(ticket);
  return ticket;
}

/** Ticket row as returned by the API (scalars, messages omitted). */
export function ticketRow(t: GTicket) {
  const { messages: _m, ...rest } = t;
  void _m;
  return rest;
}
