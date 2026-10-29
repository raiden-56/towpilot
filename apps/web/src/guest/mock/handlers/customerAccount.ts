/**
 * Guest-mode customer account APIs: vehicles, invoices & payments, memberships, support tickets,
 * profile, notifications and public tracking links (apps/api/src/modules/{vehicles,billing,
 * memberships,support,profile,public}).
 */
import type { GInvoice, GPayment, GSubscription, GVehicle } from '../model';
import { DAY, db, newId, nextInvoiceNumber, nextReceiptNumber, nowIso, userById } from '../db';
import { LIVE_TRACKING_STATUSES, STATUS_LABELS } from '../bookingOps';
import { fail, notFound, on, paged, str } from '../router';
import { meFor } from '../serialize';
import { pdfFile, placeholderImage } from '../files';
import { guestConfig } from './core';
import { can, createTicket, invoiceFor, me, refreshLedger, ticketRow } from './customerShared';

// ─── Vehicles ─────────────────────────────────────────────────────────

const vehicleView = (v: GVehicle) => {
  const fa = v.fleetAccountId ? db.fleetAccounts.find((f) => f.id === v.fleetAccountId) : undefined;
  return { ...v, fleetAccount: fa ? { id: fa.id, name: fa.name } : null };
};
const REG = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$|^\d{2}BH\d{4}[A-Z]{1,2}$/;
const normaliseReg = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/[\s-]/g, '');

function ownVehicle(userId: string, id: string) {
  const v = db.vehicles.find((x) => x.id === id && x.ownerUserId === userId && !x.deletedAt);
  return v ?? notFound('Vehicle');
}

on('GET', '/vehicles', (c) => {
  const fleets = db.fleetAccounts.filter((f) => f.members.some((m) => m.userId === c.userId)).map((f) => f.id);
  return db.vehicles
    .filter((v) => !v.deletedAt && (v.ownerUserId === c.userId || (!!v.fleetAccountId && fleets.includes(v.fleetAccountId))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(vehicleView);
});

on('POST', '/vehicles', (c) => {
  const reg = normaliseReg(c.body.registrationNumber);
  if (!REG.test(reg)) fail(400, 'VALIDATION_ERROR', 'Check the highlighted fields', [{ path: 'registrationNumber', message: 'Enter a valid Indian registration number, e.g. KA01AB1234' }]);
  if (db.vehicles.some((v) => v.ownerUserId === c.userId && !v.deletedAt && v.registrationNumber === reg)) fail(409, 'CONFLICT', 'You have already added this vehicle');
  const at = nowIso();
  const v: GVehicle = {
    id: newId('veh'),
    ownerUserId: c.userId,
    fleetAccountId: null,
    vehicleClass: c.body.vehicleClass as GVehicle['vehicleClass'],
    registrationNumber: reg,
    make: String(c.body.make ?? ''),
    model: String(c.body.model ?? ''),
    fuelType: (c.body.fuelType as GVehicle['fuelType']) ?? 'PETROL',
    color: str(c.body.color) ?? null,
    year: c.body.year != null ? Number(c.body.year) : null,
    photoUrls: [],
    isSample: true,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  db.vehicles.push(v);
  return vehicleView(v);
});

on('PATCH', '/vehicles/:id', (c) => {
  const v = ownVehicle(c.userId, c.params.id!);
  const b = c.body;
  if (b.registrationNumber !== undefined) {
    const reg = normaliseReg(b.registrationNumber);
    if (!REG.test(reg)) fail(400, 'VALIDATION_ERROR', 'Check the highlighted fields', [{ path: 'registrationNumber', message: 'Enter a valid Indian registration number, e.g. KA01AB1234' }]);
    if (db.vehicles.some((x) => x.id !== v.id && x.ownerUserId === c.userId && !x.deletedAt && x.registrationNumber === reg)) fail(409, 'CONFLICT', 'You have already added this vehicle');
    v.registrationNumber = reg;
  }
  if (b.vehicleClass !== undefined) v.vehicleClass = b.vehicleClass as GVehicle['vehicleClass'];
  if (b.make !== undefined) v.make = String(b.make);
  if (b.model !== undefined) v.model = String(b.model);
  if (b.fuelType !== undefined) v.fuelType = b.fuelType as GVehicle['fuelType'];
  if (b.color !== undefined) v.color = str(b.color) ?? null;
  if (b.year !== undefined) v.year = b.year == null ? null : Number(b.year);
  v.updatedAt = nowIso();
  return vehicleView(v);
});

on('DELETE', '/vehicles/:id', (c) => {
  const v = ownVehicle(c.userId, c.params.id!);
  if (db.bookings.some((b) => b.vehicleId === v.id && !['COMPLETED', 'CANCELLED', 'FAILED'].includes(b.status))) fail(409, 'CONFLICT', 'This vehicle has an active booking');
  v.deletedAt = nowIso();
  return { deleted: true };
});

on('POST', '/vehicles/:id/photos', (c) => {
  const v = ownVehicle(c.userId, c.params.id!);
  if (v.photoUrls.length >= 8) fail(409, 'CONFLICT', 'Up to 8 photos per vehicle');
  const files = c.form ? c.form.getAll('photos').filter((f): f is File => typeof f !== 'string') : [];
  const n = Math.max(1, files.length);
  for (let i = 0; i < n && v.photoUrls.length < 8; i++) v.photoUrls.push(placeholderImage(`${v.make} ${v.model}`, ['#1d4ed8', '#0f766e', '#7c3aed', '#b45309'][v.photoUrls.length % 4]));
  v.updatedAt = nowIso();
  return vehicleView(v);
});

// ─── Invoices & payments ──────────────────────────────────────────────

const invoiceRow = (inv: GInvoice) => {
  const { items: _i, ...rest } = inv;
  void _i;
  const b = inv.bookingId ? db.bookings.find((x) => x.id === inv.bookingId) : undefined;
  return { ...rest, booking: b ? { code: b.code } : null };
};

on('GET', '/invoices', (c) => {
  const statuses = str(c.query.status)?.split(',');
  const rows = db.invoices
    .filter((i) => i.customerUserId === c.userId && (!statuses || statuses.includes(i.paymentStatus)))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    .map(invoiceRow);
  return paged(rows, c.query);
});

/** Approved quote vs final invoice (diffAgainstApproved in apps/api/src/domain/pricing.ts). */
function priceDifference(inv: GInvoice) {
  if (!inv.approvedQuoteId) return null;
  const q = db.bookings.flatMap((b) => b.quotes).find((x) => x.id === inv.approvedQuoteId);
  if (!q) return null;
  const approved = q.pricingSnapshot.breakdown.lines;
  const byCode = new Map(approved.map((l) => [l.code, l]));
  const changes = inv.items
    .map((l) => {
      const prev = byCode.get(l.code);
      return { code: l.code, description: l.description, approved: prev?.amount ?? 0, final: l.amount, delta: l.amount - (prev?.amount ?? 0), isPassThrough: l.isPassThrough, reason: l.reason };
    })
    .filter((x) => x.delta !== 0);
  for (const prev of approved) if (!inv.items.some((l) => l.code === prev.code)) changes.push({ code: prev.code, description: prev.description, approved: prev.amount, final: 0, delta: -prev.amount, isPassThrough: prev.isPassThrough, reason: null });
  return { approvedTotal: q.total, finalTotal: inv.total, changes, totalDelta: inv.total - q.total, chargeableIncrease: changes.filter((x) => x.delta > 0 && !x.isPassThrough).reduce((a, x) => a + x.delta, 0) };
}

on('GET', '/invoices/:id', (c) => {
  const inv = invoiceFor(me(c.userId), c.params.id!);
  const b = inv.bookingId ? db.bookings.find((x) => x.id === inv.bookingId) : undefined;
  const cat = b ? db.categories.find((x) => x.id === b.serviceCategoryId) : undefined;
  const v = b?.vehicleId ? db.vehicles.find((x) => x.id === b.vehicleId) : undefined;
  return {
    ...inv,
    items: [...inv.items].sort((a, x) => a.sortOrder - x.sortOrder),
    payments: db.payments
      .filter((p) => p.invoiceId === inv.id)
      .sort((a, x) => x.createdAt.localeCompare(a.createdAt))
      .map((p) => ({ id: p.id, method: p.method, provider: p.provider, status: p.status, amount: p.amount, providerPaymentId: p.providerPaymentId, receiptNumber: p.receiptNumber, isSandbox: p.isSandbox, failureReason: p.failureReason, createdAt: p.createdAt, succeededAt: p.succeededAt })),
    refunds: db.refunds.filter((r) => r.invoiceId === inv.id).sort((a, x) => x.createdAt.localeCompare(a.createdAt)),
    creditNotes: db.creditNotes.filter((n) => n.invoiceId === inv.id),
    booking: b ? { id: b.id, code: b.code, serviceCategory: cat ? { name: cat.name } : null, vehicle: v ? { registrationNumber: v.registrationNumber } : null } : null,
    tickets: db.tickets.filter((t) => t.invoiceId === inv.id).map((t) => ({ id: t.id, number: t.number, status: t.status, category: t.category })),
    priceDifference: priceDifference(inv),
  };
});

on('GET', '/invoices/:id/pdf', (c) => {
  const inv = invoiceFor(me(c.userId), c.params.id!);
  const rs = (p: number) => `Rs ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  return pdfFile(`Tax invoice ${inv.number}`, [
    `Billed to: ${inv.billingName}${inv.billingGstin ? ` (GSTIN ${inv.billingGstin})` : ''}`,
    `Issued: ${new Date(inv.issuedAt).toLocaleDateString('en-IN')}`,
    '',
    ...inv.items.map((l) => `${l.description}  x${l.quantity}  ${rs(l.amount)}`),
    '',
    `Taxable value: ${rs(inv.taxableValue)}`,
    `GST: ${rs(inv.taxTotal)}`,
    `Pass-through: ${rs(inv.passThroughTotal)}`,
    `Total: ${rs(inv.total)}`,
    `Paid: ${rs(inv.amountPaid)}   Outstanding: ${rs(inv.outstanding)}`,
  ]);
});

on('POST', '/invoices/:id/pay', (c) => {
  const inv = invoiceFor(me(c.userId), c.params.id!);
  if (inv.status !== 'ISSUED') fail(409, 'CONFLICT', 'This invoice is not payable');
  refreshLedger(inv);
  const payable = inv.outstanding - inv.amountPendingCash;
  if (payable <= 0) fail(409, 'CONFLICT', 'Nothing is due on this invoice');
  const amount = c.body.amount != null ? Math.round(Number(c.body.amount) * 100) : payable;
  if (amount < 100) fail(400, 'BAD_REQUEST', 'Minimum payment is ₹1');
  if (amount > payable) fail(400, 'BAD_REQUEST', `You can pay at most ₹${(payable / 100).toFixed(2)}`);
  for (const p of db.payments) if (p.invoiceId === inv.id && p.method === 'ONLINE' && p.status === 'CREATED') Object.assign(p, { status: 'CANCELLED', failureReason: 'Superseded by a newer attempt' });
  const at = nowIso();
  const pay: GPayment = { id: newId('pay'), invoiceId: inv.id, method: 'ONLINE', provider: 'SANDBOX', status: 'CREATED', amount, currency: 'INR', providerOrderId: newId('order_sbx'), providerPaymentId: null, gatewayFee: 0, gatewayTax: 0, receiptNumber: null, collectedById: null, confirmedById: null, initiatedById: c.userId, failureReason: null, isSandbox: true, notes: null, createdAt: at, succeededAt: null, updatedAt: at };
  db.payments.push(pay);
  refreshLedger(inv);
  return { paymentId: pay.id, orderId: pay.providerOrderId, amount, currency: 'INR', status: pay.status, provider: guestConfig.payments.provider, keyId: null, sandbox: true, invoiceNumber: inv.number };
});

const payOr404 = (userId: string, id: string) => {
  const pay = db.payments.find((p) => p.id === id);
  if (!pay) return notFound('Payment');
  return { pay, inv: invoiceFor(me(userId), pay.invoiceId) };
};
const pollView = (p: GPayment) => ({ id: p.id, status: p.status, amount: p.amount, method: p.method, receiptNumber: p.receiptNumber, failureReason: p.failureReason, isSandbox: p.isSandbox });

/** Membership subscriptions activate once their invoice is paid. */
function activateMembershipIfPaid(inv: GInvoice) {
  if (inv.type !== 'MEMBERSHIP' || !inv.subscriptionId || inv.paymentStatus !== 'PAID') return;
  const sub = db.subscriptions.find((s) => s.id === inv.subscriptionId);
  const plan = sub && db.memberships.find((m) => m.id === sub.membershipId);
  if (!sub || !plan || sub.status !== 'PENDING_PAYMENT') return;
  sub.status = 'ACTIVE';
  sub.startsAt = nowIso();
  sub.endsAt = new Date(Date.now() + plan.durationMonths * 30 * DAY).toISOString();
  sub.updatedAt = nowIso();
}

function settle(pay: GPayment, inv: GInvoice, outcome: 'success' | 'failure') {
  if (pay.status === 'SUCCEEDED' || pay.status === 'FAILED' || pay.status === 'CANCELLED') return;
  const at = nowIso();
  pay.updatedAt = at;
  if (outcome === 'success') {
    pay.status = 'SUCCEEDED';
    pay.succeededAt = at;
    pay.providerPaymentId ??= newId('pay_sbx');
    pay.receiptNumber = nextReceiptNumber();
    pay.gatewayFee = Math.round(pay.amount * 0.02);
    pay.gatewayTax = Math.round(pay.amount * 0.02 * 0.18);
    inv.amountPaid += pay.amount;
  } else {
    pay.status = 'FAILED';
    pay.failureReason = 'Payment declined by the bank (sandbox simulation)';
  }
  refreshLedger(inv);
  activateMembershipIfPaid(inv);
}

on('GET', '/payments/:id', (c) => pollView(payOr404(c.userId, c.params.id!).pay));

on('POST', '/payments/:id/checkout-callback', (c) => {
  const { pay, inv } = payOr404(c.userId, c.params.id!);
  if (pay.status === 'CREATED') {
    pay.status = 'PENDING';
    pay.providerPaymentId = str(c.body.providerPaymentId) ?? pay.providerPaymentId;
    // The gateway webhook would confirm shortly; simulate it.
    setTimeout(() => settle(pay, inv, 'success'), 1500);
  }
  return pollView(pay);
});

on('POST', '/payments/:id/sandbox-complete', (c) => {
  const { pay, inv } = payOr404(c.userId, c.params.id!);
  if (pay.provider !== 'SANDBOX') fail(409, 'CONFLICT', 'Not a sandbox payment');
  settle(pay, inv, c.body.outcome === 'failure' ? 'failure' : 'success');
  return { id: pay.id, status: pay.status, amount: pay.amount, receiptNumber: pay.receiptNumber, failureReason: pay.failureReason, isSandbox: pay.isSandbox };
});

on('GET', '/payments/history', (c) => {
  const mine = new Set(db.invoices.filter((i) => i.customerUserId === c.userId).map((i) => i.id));
  const rows = db.payments
    .filter((p) => mine.has(p.invoiceId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => {
      const inv = db.invoices.find((i) => i.id === p.invoiceId)!;
      return { id: p.id, method: p.method, status: p.status, amount: p.amount, receiptNumber: p.receiptNumber, isSandbox: p.isSandbox, createdAt: p.createdAt, succeededAt: p.succeededAt, failureReason: p.failureReason, invoice: { id: inv.id, number: inv.number } };
    });
  return paged(rows, c.query);
});

on('POST', '/invoices/:id/refund-request', (c) => {
  const u = me(c.userId);
  const inv = invoiceFor(u, c.params.id!);
  const amount = Math.round(Number(c.body.amount) * 100);
  const reason = String(c.body.reason ?? '').trim();
  const inFlight = db.refunds.filter((r) => r.invoiceId === inv.id && ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(r.status)).reduce((a, r) => a + r.amount, 0);
  const max = Math.max(0, inv.amountPaid - inv.amountRefunded - inFlight);
  if (!(amount > 0) || amount > max) fail(400, 'BAD_REQUEST', `Refund amount must be between ₹0.01 and ₹${(max / 100).toFixed(2)}`);
  const pay = db.payments.filter((p) => p.invoiceId === inv.id && p.status === 'SUCCEEDED').sort((a, b) => b.amount - a.amount)[0];
  if (!pay) fail(422, 'UNPROCESSABLE', 'No successful payment to refund');
  const at = nowIso();
  const refund = { id: newId('rf'), invoiceId: inv.id, paymentId: pay.id, amount, status: 'REQUESTED' as const, reason, providerRefundId: null, requestedById: u.id, approvedById: null, failureReason: null, isSandbox: pay.isSandbox, createdAt: at, processedAt: null, updatedAt: at };
  db.refunds.unshift(refund);
  refreshLedger(inv);
  const ticket = createTicket(u.id, { category: 'REFUND_REQUEST', subject: `Refund request for ${inv.number}`, invoiceId: inv.id, bookingId: inv.bookingId }, `${reason}\n\nRequested amount: ₹${(amount / 100).toFixed(2)} (refund ${refund.id})`);
  return { refund, ticket: ticketRow(ticket) };
});

on('POST', '/invoices/:id/dispute', (c) => {
  const u = me(c.userId);
  const inv = invoiceFor(u, c.params.id!);
  if (inv.disputed) fail(409, 'CONFLICT', 'A dispute is already open for this invoice');
  const reason = String(c.body.reason ?? '').trim();
  inv.disputed = true;
  refreshLedger(inv);
  return ticketRow(createTicket(u.id, { category: 'BILLING_DISPUTE', priority: 'HIGH', subject: `Billing dispute: ${inv.number}`, invoiceId: inv.id, bookingId: inv.bookingId }, reason));
});

// ─── Memberships ──────────────────────────────────────────────────────

on('GET', '/memberships/plans', () => db.memberships.filter((m) => m.active && !m.forFleet).sort((a, b) => a.price - b.price));

function subscriptionView(s: GSubscription) {
  const plan = db.memberships.find((m) => m.id === s.membershipId) ?? null;
  const inv = db.invoices.find((i) => i.subscriptionId === s.id);
  return {
    ...s,
    planSnapshot: plan && { name: plan.name, price: plan.price, durationMonths: plan.durationMonths, includedServices: plan.includedServices, includedKmPerService: plan.includedKmPerService, discountBps: plan.discountBps, coveredCategoryKeys: plan.coveredCategoryKeys, exclusions: plan.exclusions, renewalTerms: plan.renewalTerms },
    membership: plan,
    invoice: inv ? { id: inv.id, number: inv.number, total: inv.total, outstanding: inv.outstanding, paymentStatus: inv.paymentStatus } : null,
    usages: db.bookings
      .filter((b) => b.membershipSubscriptionId === s.id && ['COMPLETED', 'DELIVERED'].includes(b.status))
      .slice(0, Math.max(s.servicesUsed, 0))
      .map((b) => ({ id: `use_${b.id}`, bookingId: b.id, benefitAmount: b.quotes.find((q) => q.status === 'APPROVED')?.discountTotal ?? 0, createdAt: b.completedAt ?? b.updatedAt, booking: { code: b.code } })),
  };
}

on('GET', '/memberships/mine', (c) => db.subscriptions.filter((s) => s.userId === c.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(subscriptionView));

on('POST', '/memberships/subscribe', (c) => {
  const u = me(c.userId);
  const plan = db.memberships.find((m) => m.id === c.body.membershipId);
  if (!plan || !plan.active || plan.forFleet) return notFound('Plan');
  const active = db.subscriptions.find((s) => s.userId === u.id && ['ACTIVE', 'PENDING_PAYMENT'].includes(s.status) && (!s.endsAt || new Date(s.endsAt).getTime() > Date.now()));
  if (active) fail(409, 'CONFLICT', active.status === 'ACTIVE' ? 'You already have an active membership' : 'You have a membership awaiting payment', { subscriptionId: active.id });
  const at = nowIso();
  const sub: GSubscription = { id: newId('sub'), membershipId: plan.id, userId: u.id, fleetAccountId: null, status: 'PENDING_PAYMENT', startsAt: null, endsAt: null, servicesUsed: 0, cancelledAt: null, createdAt: at, updatedAt: at };
  db.subscriptions.push(sub);
  const taxable = Math.round(plan.price / 1.18);
  const invoice: GInvoice = { id: newId('inv'), number: nextInvoiceNumber(), type: 'MEMBERSHIP', status: 'ISSUED', paymentStatus: 'UNPAID', bookingId: null, subscriptionId: sub.id, customerUserId: u.id, fleetAccountId: null, approvedQuoteId: null, billingName: u.fullName, billingPhone: u.phone, billingEmail: u.email, billingAddress: null, billingGstin: null, currency: 'INR', subtotal: taxable, discountTotal: 0, taxableValue: taxable, taxTotal: plan.price - taxable, passThroughTotal: 0, total: plan.price, amountPaid: 0, amountPendingCash: 0, amountCredited: 0, amountRefunded: 0, amountWrittenOff: 0, outstanding: plan.price, approvedQuoteTotal: null, disputed: false, notes: null, issuedAt: at, dueAt: at, voidedAt: null, voidReason: null, isSample: true, createdAt: at, updatedAt: at, items: [{ id: newId('ii'), code: 'MEMBERSHIP', description: `${plan.name} (${plan.durationMonths} month${plan.durationMonths > 1 ? 's' : ''})`, quantity: 1, unitAmount: taxable, amount: taxable, taxable: true, isPassThrough: false, isAdditional: false, reason: null, sortOrder: 0 }] };
  db.invoices.push(invoice);
  return { subscription: sub, invoice: invoiceRow(invoice) };
});

on('POST', '/memberships/:id/cancel', (c) => {
  const sub = db.subscriptions.find((s) => s.id === c.params.id && s.userId === c.userId);
  if (!sub) return notFound('Membership');
  const at = nowIso();
  if (sub.status === 'PENDING_PAYMENT') {
    sub.status = 'CANCELLED';
    sub.cancelledAt = at;
    const inv = db.invoices.find((i) => i.subscriptionId === sub.id);
    if (inv && inv.amountPaid === 0) Object.assign(inv, { status: 'VOID', voidedAt: at, voidReason: 'Membership cancelled before payment', outstanding: 0, updatedAt: at });
  } else if (sub.status === 'ACTIVE') sub.cancelledAt = at;
  else fail(409, 'CONFLICT', 'Membership is not active');
  sub.updatedAt = at;
  return { cancelled: true };
});

// ─── Support tickets ──────────────────────────────────────────────────

on('GET', '/support/tickets', (c) =>
  paged(
    db.tickets
      .filter((t) => t.userId === c.userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((t) => ({ ...ticketRow(t), booking: t.bookingId ? { code: db.bookings.find((b) => b.id === t.bookingId)?.code ?? '—' } : null })),
    c.query,
  ),
);

on('POST', '/support/tickets', (c) => {
  const u = me(c.userId);
  const category = c.body.category as Parameters<typeof createTicket>[1]['category'];
  if (category === 'PERFORMANCE_CHALLENGE' && !can(u, 'driver:self')) return notFound('Category');
  const bookingId = str(c.body.bookingId);
  const invoiceId = str(c.body.invoiceId);
  if (bookingId && !db.bookings.some((b) => b.id === bookingId && (b.customerUserId === u.id || b.teamMembers.some((t) => t.userId === u.id)))) return notFound('Booking');
  if (invoiceId && !db.invoices.some((i) => i.id === invoiceId && i.customerUserId === u.id)) return notFound('Invoice');
  const t = createTicket(u.id, { category, subject: String(c.body.subject ?? '').trim(), bookingId: bookingId ?? null, invoiceId: invoiceId ?? null, subjectUserId: category === 'PERFORMANCE_CHALLENGE' ? u.id : null }, String(c.body.message ?? '').trim());
  if (category === 'BILLING_DISPUTE' && invoiceId) {
    const inv = db.invoices.find((i) => i.id === invoiceId)!;
    inv.disputed = true;
    refreshLedger(inv);
  }
  return ticketRow(t);
});

on('GET', '/support/tickets/:id', (c) => {
  const u = me(c.userId);
  const staff = can(u, 'support:manage');
  const t = db.tickets.find((x) => x.id === c.params.id);
  if (!t || (!staff && t.userId !== u.id)) return notFound('Ticket');
  const b = t.bookingId ? db.bookings.find((x) => x.id === t.bookingId) : undefined;
  const inv = t.invoiceId ? db.invoices.find((x) => x.id === t.invoiceId) : undefined;
  const owner = userById(t.userId);
  return {
    ...ticketRow(t),
    user: owner ? { fullName: owner.fullName, phone: owner.phone } : undefined,
    booking: b ? { id: b.id, code: b.code } : null,
    invoice: inv ? { id: inv.id, number: inv.number } : null,
    messages: t.messages
      .filter((m) => staff || !m.internal)
      .sort((a, b2) => a.createdAt.localeCompare(b2.createdAt))
      .map((m) => ({ ...m, ticketId: t.id, authorName: m.authorId === t.userId || staff ? (userById(m.authorId)?.fullName ?? 'Support team') : 'Support team', fromCustomer: m.authorId === t.userId })),
  };
});

on('POST', '/support/tickets/:id/messages', (c) => {
  const u = me(c.userId);
  const staff = can(u, 'support:manage');
  const t = db.tickets.find((x) => x.id === c.params.id);
  if (!t || (!staff && t.userId !== u.id)) return notFound('Ticket');
  const body = String(c.body.body ?? '').trim();
  if (!body) fail(400, 'VALIDATION_ERROR', 'Write a message', [{ path: 'body', message: 'Write a message' }]);
  const internal = staff && !!c.body.internal;
  const m = { id: newId('tm'), authorId: u.id, body, internal, createdAt: nowIso() };
  t.messages.push(m);
  const reopened = !staff && (t.status === 'RESOLVED' || t.status === 'CLOSED');
  t.status = staff && !internal ? 'AWAITING_CUSTOMER' : reopened ? 'OPEN' : t.status === 'AWAITING_CUSTOMER' ? 'IN_PROGRESS' : t.status;
  if (reopened) t.resolvedAt = null;
  t.updatedAt = m.createdAt;
  // A support agent replies to customers shortly so the conversation feels alive.
  if (!staff && t.status !== 'CLOSED') {
    setTimeout(() => {
      t.messages.push({ id: newId('tm'), authorId: 'u_dispatch', body: 'Thanks for the update — our team is looking into it and will get back to you shortly.', internal: false, createdAt: nowIso() });
      t.status = 'IN_PROGRESS';
      t.updatedAt = nowIso();
    }, 6000);
  }
  return { ...m, ticketId: t.id };
});

// ─── Profile, preferences, addresses, contacts ───────────────────────

const profileView = (userId: string) => {
  const u = me(userId);
  return { ...meFor(u), createdAt: u.createdAt, customerProfile: u.customerProfile && { ...u.customerProfile }, driverProfile: u.driverProfile && { licenceExpiry: u.driverProfile.licenceExpiry, canLeadTeam: u.driverProfile.canLeadTeam }, photoUrl: u.photoUrl };
};

on('GET', '/me', (c) => profileView(c.userId));

on('PATCH', '/me', (c) => {
  const u = me(c.userId);
  if (c.body.fullName !== undefined) {
    const name = String(c.body.fullName).trim();
    if (name.length < 2) fail(400, 'VALIDATION_ERROR', 'Check the highlighted fields', [{ path: 'fullName', message: 'Enter your full name' }]);
    u.fullName = name;
  }
  if (c.body.email !== undefined) u.email = c.body.email ? String(c.body.email).toLowerCase() : null;
  u.updatedAt = nowIso();
  return profileView(c.userId);
});

on('POST', '/me/photo', (c) => {
  const u = me(c.userId);
  const initials = u.fullName.split(' ').map((p) => p[0]).join('').slice(0, 2);
  u.photoUrl = placeholderImage(initials, '#1d4ed8');
  return { photoUrl: u.photoUrl };
});

on('PUT', '/me/preferences', (c) => {
  const u = me(c.userId);
  u.customerProfile ??= { preferredLanguage: 'en', termsAcceptedAt: nowIso(), privacyConsentAt: nowIso(), consentVersion: '2026-10', marketingConsent: false, locationConsent: false, notifySms: true, notifyEmail: true, notifyPush: true };
  const p = u.customerProfile;
  for (const k of ['marketingConsent', 'locationConsent', 'notifySms', 'notifyEmail', 'notifyPush'] as const) if (typeof c.body[k] === 'boolean') p[k] = c.body[k] as boolean;
  if (c.body.preferredLanguage === 'en' || c.body.preferredLanguage === 'hi') p.preferredLanguage = c.body.preferredLanguage;
  return { id: `cp_${u.id}`, userId: u.id, ...p, createdAt: u.createdAt, updatedAt: nowIso() };
});

on('GET', '/me/addresses', (c) => db.savedAddresses.filter((a) => a.userId === c.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
on('POST', '/me/addresses', (c) => {
  if (db.savedAddresses.filter((a) => a.userId === c.userId).length >= 20) fail(409, 'CONFLICT', 'You can save up to 20 addresses');
  const a = { id: newId('addr'), userId: c.userId, label: String(c.body.label ?? 'Saved'), address: String(c.body.address ?? ''), lat: Number(c.body.lat), lng: Number(c.body.lng), landmark: str(c.body.landmark) ?? null, createdAt: nowIso() };
  db.savedAddresses.push(a);
  return a;
});
on('DELETE', '/me/addresses/:id', (c) => {
  const i = db.savedAddresses.findIndex((a) => a.id === c.params.id && a.userId === c.userId);
  if (i < 0) return notFound('Address');
  db.savedAddresses.splice(i, 1);
  return { deleted: true };
});

on('GET', '/me/emergency-contacts', (c) => db.emergencyContacts.filter((x) => x.userId === c.userId));
on('POST', '/me/emergency-contacts', (c) => {
  if (db.emergencyContacts.filter((x) => x.userId === c.userId).length >= 5) fail(409, 'CONFLICT', 'You can add up to 5 emergency contacts');
  const raw = String(c.body.phone ?? '').replace(/\D/g, '');
  const ec = { id: newId('ec'), userId: c.userId, name: String(c.body.name ?? ''), phone: raw.length === 10 ? `+91${raw}` : `+${raw}`, relationship: str(c.body.relationship) ?? null, createdAt: nowIso() };
  db.emergencyContacts.push(ec);
  return ec;
});
on('DELETE', '/me/emergency-contacts/:id', (c) => {
  const i = db.emergencyContacts.findIndex((x) => x.id === c.params.id && x.userId === c.userId);
  if (i < 0) return notFound('Contact');
  db.emergencyContacts.splice(i, 1);
  return { deleted: true };
});

// ─── Notifications ────────────────────────────────────────────────────

on('GET', '/me/notifications', (c) => {
  const mine = db.notifications.filter((n) => n.userId === c.userId && n.channel === 'IN_APP');
  const unreadOnly = c.query.unread !== undefined && c.query.unread !== null && c.query.unread !== '';
  const rows = mine.filter((n) => !unreadOnly || !n.readAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return paged(rows, c.query, { unread: mine.filter((n) => !n.readAt).length });
});
on('POST', '/me/notifications/read-all', (c) => {
  const at = nowIso();
  for (const n of db.notifications) if (n.userId === c.userId && !n.readAt) n.readAt = at;
  return { ok: true };
});
on('POST', '/me/notifications/:id/read', (c) => {
  const n = db.notifications.find((x) => x.id === c.params.id && x.userId === c.userId);
  if (n && !n.readAt) n.readAt = nowIso();
  return { ok: true };
});

// ─── Privacy ──────────────────────────────────────────────────────────

on('GET', '/me/data-export', (c) => {
  const u = me(c.userId);
  const invoices = db.invoices.filter((i) => i.customerUserId === u.id);
  return {
    exportedAt: nowIso(),
    note: 'Guest mode: this export contains sample data only.',
    user: { id: u.id, fullName: u.fullName, phone: u.phone, email: u.email, createdAt: u.createdAt, customerProfile: u.customerProfile },
    vehicles: db.vehicles.filter((v) => v.ownerUserId === u.id),
    bookings: db.bookings.filter((b) => b.customerUserId === u.id).map((b) => ({ ...b, pickupOtp: undefined, handoverOtp: undefined })),
    invoices,
    payments: db.payments.filter((p) => invoices.some((i) => i.id === p.invoiceId)).map((p) => ({ id: p.id, method: p.method, status: p.status, amount: p.amount, createdAt: p.createdAt, receiptNumber: p.receiptNumber })),
    addresses: db.savedAddresses.filter((a) => a.userId === u.id),
    contacts: db.emergencyContacts.filter((x) => x.userId === u.id),
    tickets: db.tickets.filter((t) => t.userId === u.id).map((t) => ({ ...t, messages: t.messages.filter((m) => !m.internal) })),
    notifications: db.notifications.filter((n) => n.userId === u.id),
  };
});

on('POST', '/me/privacy-request', (c) => {
  const type = String(c.body.type ?? 'GRIEVANCE');
  const t = createTicket(c.userId, { category: 'PRIVACY_REQUEST', subject: `Privacy request: ${type.replace('_', ' ').toLowerCase()}` }, String(c.body.details ?? ''));
  return { ticket: ticketRow(t), note: 'Financial records must be retained as required by tax law; other personal data will be erased or anonymised after review.' };
});

// ─── Public tracking link ─────────────────────────────────────────────

on('GET', '/public/track/:token', (c) => {
  const b = db.bookings.find((x) => x.shareLinks.some((l) => l.token === c.params.token));
  const link = b?.shareLinks.find((l) => l.token === c.params.token);
  if (!b || !link || link.revokedAt || new Date(link.expiresAt).getTime() < Date.now()) return notFound('Tracking link');
  link.viewCount++;
  const a = b.assignments.find((x) => x.status === 'ACCEPTED');
  const driver = a ? userById(a.driverUserId) : undefined;
  const truck = a?.truckId ? db.trucks.find((t) => t.id === a.truckId) : undefined;
  const av = driver?.availability;
  const pickup = b.locations.find((l) => l.kind === 'PICKUP');
  const drop = b.locations.find((l) => l.kind === 'DROPOFF');
  const cat = db.categories.find((x) => x.id === b.serviceCategoryId);
  const v = b.vehicleId ? db.vehicles.find((x) => x.id === b.vehicleId) : undefined;
  return {
    code: b.code,
    status: b.status,
    statusLabel: STATUS_LABELS[b.status],
    service: cat?.name ?? 'Roadside assistance',
    vehicle: v ? `${v.make} ${v.model}` : null,
    etaAt: b.etaAt,
    timeline: b.statusHistory.filter((h) => h.fromStatus !== h.toStatus).map((h) => ({ status: h.toStatus, label: STATUS_LABELS[h.toStatus], at: h.createdAt })),
    driver: driver ? { firstName: driver.fullName.split(' ')[0], truck: truck ? { registrationNumber: truck.registrationNumber, truckType: truck.truckType } : null } : null,
    driverLocation: a && LIVE_TRACKING_STATUSES.includes(b.status) && av?.lastLat != null && av.lastLng != null ? { lat: av.lastLat, lng: av.lastLng, at: av.lastLocationAt } : null,
    pickupArea: pickup ? { lat: Math.round(pickup.lat * 100) / 100, lng: Math.round(pickup.lng * 100) / 100 } : null,
    destination: drop?.placeName ?? null,
    expiresAt: link.expiresAt,
  };
});

