/**
 * Guest-mode finance back office (apps/api/src/modules/admin/finance.ts + billing service):
 * invoices, cash confirmation, refunds, expenses, ageing, reconciliation, salaries, earnings, payouts.
 */
import type { AdjustmentRow, ExpenseRow, InvoiceDetail, InvoiceRow, PaymentRow, PayoutRow, PendingByWorker, RefundRow, SalaryRow } from '@/pages/admin/biz/types';
import type { GExpense, GInvoice, GPayment, GRefund } from '../model';
import { db, DAY, fyLabel, MIN, newId, nextReceiptNumber, nowIso, pushNotification, refreshInvoiceLedger, userById } from '../db';
import { csvFile, placeholderImage } from '../files';
import { fail, inRange, matchesText, notFound, on, paged, str, type Query } from '../router';
import { bool, paise } from './adminBizUtil';

// ─── Ledger helpers ──────────────────────────────────────────────────

/** Write-offs (FinancialAdjustment rows), kept here because the shared model has none. */
export const adjustments: (AdjustmentRow & { invoiceId: string })[] = [];

/** Recomputes an invoice's balances and payment status from its payments and refunds. */
export function recomputeInvoice(inv: GInvoice) {
  const refundPending = db.refunds.filter((r) => r.invoiceId === inv.id && ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(r.status)).reduce((a, r) => a + r.amount, 0);
  const pays = db.payments.filter((p) => p.invoiceId === inv.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  refreshInvoiceLedger(inv, { refundPending, hasPendingOnline: pays.some((p) => p.method === 'ONLINE' && ['CREATED', 'PENDING'].includes(p.status)), lastFailed: pays[0]?.status === 'FAILED' });
}

const invoiceOr404 = (id: string) => db.invoices.find((i) => i.id === id) ?? notFound('Invoice');
const bookingCode = (id: string | null) => (id ? db.bookings.find((b) => b.id === id) : undefined);

export function invoiceRow(inv: GInvoice): InvoiceRow {
  const { items: _items, ...rest } = inv;
  void _items;
  const b = bookingCode(inv.bookingId);
  return { ...rest, booking: b ? { id: b.id, code: b.code } : null };
}

function paymentRow(p: GPayment): PaymentRow {
  const inv = db.invoices.find((i) => i.id === p.invoiceId);
  return { ...p, invoice: inv ? { number: inv.number, billingName: inv.billingName } : undefined, collectedBy: p.collectedById ? (userById(p.collectedById)?.fullName ?? null) : null };
}

function refundRow(r: GRefund): RefundRow {
  const inv = db.invoices.find((i) => i.id === r.invoiceId);
  const pay = r.paymentId ? db.payments.find((p) => p.id === r.paymentId) : undefined;
  return { ...r, invoice: inv ? { number: inv.number, billingName: inv.billingName } : undefined, payment: pay ? { method: pay.method, isSandbox: pay.isSandbox } : null };
}

const amountError = (msg: string) => fail(400, 'BAD_REQUEST', msg, [{ path: 'amount', message: msg }]);
const inrText = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function createCreditNote(inv: GInvoice, amount: number, reason: string) {
  const credited = db.creditNotes.filter((c) => c.invoiceId === inv.id).reduce((a, c) => a + c.amount, 0);
  const max = inv.total - inv.passThroughTotal - credited;
  if (amount <= 0 || amount > max) amountError(`Credit note cannot exceed ${inrText(Math.max(0, max))}`);
  const taxShare = inv.taxableValue + inv.taxTotal > 0 ? inv.taxTotal / (inv.taxableValue + inv.taxTotal) : 0;
  const taxAmount = Math.round(amount * taxShare);
  const cn = { id: newId('cn'), number: `CN/${fyLabel(Date.now())}/${String(db.creditNotes.length + 1).padStart(5, '0')}`, invoiceId: inv.id, taxableAmount: amount - taxAmount, taxAmount, amount, reason, issuedById: 'u_finance', createdAt: nowIso() };
  db.creditNotes.push(cn);
  inv.amountCredited += amount;
  return cn;
}

// ─── Invoices ────────────────────────────────────────────────────────

function filterInvoices(q: Query) {
  const statuses = str(q.paymentStatus)?.split(',');
  const now = Date.now();
  return db.invoices.filter((i) => {
    if (statuses && !statuses.includes(i.paymentStatus)) return false;
    if (q.type && i.type !== q.type) return false;
    if (q.fleetAccountId && i.fleetAccountId !== q.fleetAccountId) return false;
    if ((q.from || q.to) && !inRange(i.issuedAt, q)) return false;
    if (bool(q.overdue) && !(i.outstanding > 0 && i.status === 'ISSUED' && i.dueAt && new Date(i.dueAt).getTime() < now)) return false;
    return matchesText(str(q.q), i.number, i.billingName, bookingCode(i.bookingId)?.code);
  });
}

on('GET', '/admin/finance/invoices', (c) => {
  const list = filterInvoices(c.query).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const issued = list.filter((i) => i.status === 'ISSUED');
  const sums = { total: issued.reduce((a, i) => a + i.total, 0), amountPaid: issued.reduce((a, i) => a + i.amountPaid, 0), outstanding: issued.reduce((a, i) => a + i.outstanding, 0) };
  return paged(list.map(invoiceRow), c.query, { sums });
});

on('GET', '/admin/finance/invoices.csv', (c) => {
  const rs = (p: number) => (p / 100).toFixed(2);
  const rows = filterInvoices(c.query).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
  return csvFile(
    ['number', 'type', 'status', 'issuedAt', 'booking', 'billTo', 'gstin', 'serviceValue', 'discounts', 'taxableValue', 'gst', 'passThrough', 'total', 'paid', 'credited', 'refunded', 'outstanding', 'paymentStatus', 'sample'],
    rows.map((i) => [i.number, i.type, i.status, i.issuedAt, bookingCode(i.bookingId)?.code ?? '', i.billingName, i.billingGstin ?? '', rs(i.subtotal), rs(i.discountTotal), rs(i.taxableValue), rs(i.taxTotal), rs(i.passThroughTotal), rs(i.total), rs(i.amountPaid), rs(i.amountCredited), rs(i.amountRefunded), rs(i.outstanding), i.paymentStatus, i.isSample]),
  );
});

on('GET', '/admin/finance/invoices/:id', (c) => {
  const inv = invoiceOr404(c.params.id);
  const b = bookingCode(inv.bookingId);
  const fleet = inv.fleetAccountId ? db.fleetAccounts.find((f) => f.id === inv.fleetAccountId) : undefined;
  const detail: InvoiceDetail = {
    ...invoiceRow(inv),
    items: [...inv.items].sort((x, y) => x.sortOrder - y.sortOrder),
    payments: db.payments.filter((p) => p.invoiceId === inv.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map(paymentRow),
    refunds: db.refunds.filter((r) => r.invoiceId === inv.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map(refundRow),
    creditNotes: db.creditNotes.filter((x) => x.invoiceId === inv.id),
    adjustments: adjustments.filter((a) => a.invoiceId === inv.id),
    booking: b ? { id: b.id, code: b.code } : null,
    tickets: db.tickets.filter((t) => t.invoiceId === inv.id).map((t) => ({ id: t.id, number: t.number, category: t.category, status: t.status, subject: t.subject, createdAt: t.createdAt })),
    fleetAccount: fleet ? { name: fleet.name } : null,
  };
  return detail;
});

on('POST', '/admin/finance/invoices/:id/credit-notes', (c) => {
  const inv = invoiceOr404(c.params.id);
  const cn = createCreditNote(inv, paise(c.body.amount), String(c.body.reason ?? '').trim());
  recomputeInvoice(inv);
  return cn;
});

on('POST', '/admin/finance/invoices/:id/write-off', (c) => {
  const inv = invoiceOr404(c.params.id);
  const amount = paise(c.body.amount);
  if (amount <= 0 || amount > inv.outstanding) amountError(`Write-off cannot exceed outstanding ${inrText(inv.outstanding)}`);
  adjustments.push({ id: newId('adj'), invoiceId: inv.id, type: 'WRITE_OFF', amount, reason: String(c.body.reason ?? ''), createdAt: nowIso() });
  inv.amountWrittenOff += amount;
  recomputeInvoice(inv);
  return invoiceRow(inv);
});

on('POST', '/admin/finance/invoices/:id/bank-transfer', (c) => {
  const inv = invoiceOr404(c.params.id);
  const amount = paise(c.body.amount);
  if (amount <= 0 || amount > inv.outstanding) amountError(`Amount must not exceed outstanding ${inrText(inv.outstanding)}`);
  const now = nowIso();
  db.payments.push({ id: newId('pay'), invoiceId: inv.id, method: 'BANK_TRANSFER', provider: 'MANUAL', status: 'SUCCEEDED', amount, currency: 'INR', providerOrderId: null, providerPaymentId: null, gatewayFee: 0, gatewayTax: 0, receiptNumber: nextReceiptNumber(), collectedById: null, confirmedById: 'u_finance', initiatedById: 'u_finance', failureReason: null, isSandbox: false, notes: `Bank ref ${String(c.body.reference ?? '')}`, createdAt: now, succeededAt: now, updatedAt: now });
  inv.amountPaid += amount;
  recomputeInvoice(inv);
  activateIfPaid(inv);
  return invoiceRow(inv);
});

on('POST', '/admin/finance/invoices/:id/dispute', (c) => {
  const inv = invoiceOr404(c.params.id);
  inv.disputed = !!c.body.disputed;
  recomputeInvoice(inv);
  return invoiceRow(inv);
});

on('POST', '/admin/finance/invoices/:id/void', (c) => {
  const inv = invoiceOr404(c.params.id);
  if (inv.amountPaid > 0 || inv.amountPendingCash > 0) fail(409, 'CONFLICT', 'Invoices with payments cannot be voided. Issue a credit note and refund instead.');
  inv.status = 'VOID';
  inv.voidedAt = nowIso();
  inv.voidReason = String(c.body.reason ?? '');
  recomputeInvoice(inv);
  return { voided: true };
});

function activateIfPaid(inv: GInvoice) {
  if (inv.type !== 'MEMBERSHIP' || !inv.subscriptionId || inv.outstanding > 0) return;
  const s = db.subscriptions.find((x) => x.id === inv.subscriptionId);
  const m = s && db.memberships.find((x) => x.id === s.membershipId);
  if (!s || !m || s.status !== 'PENDING_PAYMENT') return;
  s.status = 'ACTIVE';
  s.startsAt = nowIso();
  s.endsAt = new Date(Date.now() + m.durationMonths * 30 * DAY).toISOString();
}

on('GET', '/admin/finance/ageing', () => {
  const now = Date.now();
  const bucketOf = (iso: string) => {
    const days = Math.floor((now - new Date(iso).getTime()) / DAY);
    return days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
  };
  const buckets = { current: { count: 0, amount: 0 }, '1-30': { count: 0, amount: 0 }, '31-60': { count: 0, amount: 0 }, '61-90': { count: 0, amount: 0 }, '90+': { count: 0, amount: 0 } };
  const invoices = db.invoices
    .filter((i) => i.status === 'ISSUED' && i.outstanding > 0)
    .map((i) => {
      const bucket = bucketOf(i.dueAt ?? i.issuedAt) as keyof typeof buckets;
      buckets[bucket].count++;
      buckets[bucket].amount += i.outstanding;
      return { id: i.id, number: i.number, billingName: i.billingName, outstanding: i.outstanding, dueAt: i.dueAt, issuedAt: i.issuedAt, fleetAccountId: i.fleetAccountId, bucket };
    })
    .sort((a, b) => (a.dueAt ?? a.issuedAt).localeCompare(b.dueAt ?? b.issuedAt));
  return { buckets, invoices };
});

// ─── Payments & reconciliation ───────────────────────────────────────

on('GET', '/admin/finance/payments', (c) => {
  const statuses = str(c.query.status)?.split(',');
  const method = str(c.query.method);
  const list = db.payments.filter((p) => (!statuses || statuses.includes(p.status)) && (!method || p.method === method)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return paged(list.map(paymentRow), c.query);
});

on('POST', '/admin/finance/payments/:id/cash-decision', (c) => {
  const pay = db.payments.find((p) => p.id === c.params.id && p.method === 'CASH') ?? notFound('Cash payment');
  if (pay.status !== 'PENDING') fail(409, 'CONFLICT', 'This cash entry was already processed');
  const inv = invoiceOr404(pay.invoiceId);
  const now = nowIso();
  inv.amountPendingCash = Math.max(0, inv.amountPendingCash - pay.amount);
  if (c.body.approve) {
    Object.assign(pay, { status: 'SUCCEEDED', confirmedById: 'u_finance', succeededAt: now, receiptNumber: nextReceiptNumber(), notes: str(c.body.note) ?? pay.notes, updatedAt: now });
    inv.amountPaid += pay.amount;
  } else Object.assign(pay, { status: 'CANCELLED', confirmedById: 'u_finance', failureReason: str(c.body.note) ?? 'Rejected by finance', updatedAt: now });
  recomputeInvoice(inv);
  activateIfPaid(inv);
  if (pay.collectedById) pushNotification(pay.collectedById, 'cash.decision', c.body.approve ? 'Cash collection confirmed' : 'Cash collection rejected', `${inv.number}: ${inrText(pay.amount)}`, { invoiceId: inv.id });
  return invoiceRow(inv);
});

on('GET', '/admin/finance/reconciliation', (c) => {
  const from = c.query.from ? new Date(String(c.query.from)).getTime() : Date.now() - 7 * DAY;
  const to = c.query.to ? new Date(String(c.query.to)).getTime() : Date.now();
  const within = (iso: string | null) => !!iso && new Date(iso).getTime() >= from && new Date(iso).getTime() < to;
  const pays = db.payments.filter((p) => p.method === 'ONLINE' && within(p.createdAt));
  const refunds = db.refunds.filter((r) => within(r.createdAt));
  const succeeded = pays.filter((p) => p.status === 'SUCCEEDED');
  // Simulated gateway webhooks: one captured event per successful order (+ one harmless duplicate).
  const events = succeeded
    .map((p, i) => ({ id: `wh_${p.id}`, provider: 'SANDBOX', eventId: `evt_${p.providerPaymentId ?? p.id}`, eventType: 'payment.captured', signatureValid: true, status: 'PROCESSED', error: null as string | null, receivedAt: p.succeededAt ?? p.createdAt, processedAt: p.succeededAt ?? p.createdAt, i }))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  if (events[0]) events.push({ ...events[0], id: `${events[0].id}_dup`, status: 'IGNORED', error: 'Duplicate delivery (already processed)', receivedAt: new Date(new Date(events[0].receivedAt).getTime() + 2 * MIN).toISOString() });
  const issues: { type: string; ref: string; detail: string }[] = [];
  for (const p of pays.filter((p) => ['CREATED', 'PENDING'].includes(p.status) && new Date(p.createdAt).getTime() < Date.now() - 30 * MIN)) {
    const inv = db.invoices.find((i) => i.id === p.invoiceId);
    issues.push({ type: 'UNCONFIRMED_PAYMENT', ref: p.providerOrderId ?? p.id, detail: `Order for ${inv?.number ?? p.invoiceId} has no confirmation after 30 minutes (status ${p.status}). Check the gateway dashboard.` });
  }
  for (const r of refunds.filter((r) => r.status === 'FAILED')) issues.push({ type: 'REFUND_FAILED', ref: r.id, detail: `${db.invoices.find((i) => i.id === r.invoiceId)?.number ?? ''}: ${r.failureReason ?? 'failed'}` });
  return {
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    totals: {
      ordersCreated: pays.length,
      succeeded: succeeded.length,
      succeededAmount: succeeded.reduce((a, p) => a + p.amount, 0),
      gatewayFees: succeeded.reduce((a, p) => a + p.gatewayFee, 0),
      sandboxAmount: succeeded.filter((p) => p.isSandbox).reduce((a, p) => a + p.amount, 0),
      webhookEvents: events.length,
      duplicateOrIgnored: events.filter((e) => e.status === 'IGNORED').length,
      refundsSucceeded: refunds.filter((r) => r.status === 'SUCCEEDED').reduce((a, r) => a + r.amount, 0),
    },
    issues,
    events: events.slice(0, 100).map(({ i: _i, ...e }) => (void _i, e)),
  };
});

// ─── Refunds ─────────────────────────────────────────────────────────

on('GET', '/admin/finance/refunds', (c) => {
  const statuses = str(c.query.status)?.split(',');
  return paged(db.refunds.filter((r) => !statuses || statuses.includes(r.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(refundRow), c.query);
});

function settleRefund(r: GRefund, ref: string) {
  const inv = invoiceOr404(r.invoiceId);
  Object.assign(r, { status: 'SUCCEEDED', processedAt: nowIso(), providerRefundId: ref, updatedAt: nowIso() });
  inv.amountRefunded += r.amount;
  pushNotification(inv.customerUserId, 'refund.processed', 'Refund processed', `${inrText(r.amount)} refunded against ${inv.number}.`, { invoiceId: inv.id });
}

on('POST', '/admin/finance/refunds/:id/decision', (c) => {
  const r = db.refunds.find((x) => x.id === c.params.id) ?? notFound('Refund');
  if (r.status !== 'REQUESTED') fail(409, 'CONFLICT', 'Refund already processed');
  const inv = invoiceOr404(r.invoiceId);
  const pay = r.paymentId ? db.payments.find((p) => p.id === r.paymentId) : undefined;
  const note = String(c.body.note ?? '');
  if (c.body.approve) {
    if (pay && pay.method !== 'ONLINE' && !str(c.body.manualReference)) fail(400, 'BAD_REQUEST', 'Provide the bank/cash refund reference for non-online payments');
    if (c.body.issueCreditNote !== false) createCreditNote(inv, r.amount, `Refund: ${r.reason}`);
    Object.assign(r, { status: 'APPROVED', approvedById: 'u_finance', updatedAt: nowIso() });
    // Sandbox gateway / manual refunds settle immediately in guest mode.
    settleRefund(r, pay && pay.method !== 'ONLINE' ? `manual:${String(c.body.manualReference)}` : `rfnd_${r.id.slice(-8)}`);
  } else Object.assign(r, { status: 'REJECTED', approvedById: 'u_finance', failureReason: note, updatedAt: nowIso() });
  recomputeInvoice(inv);
  return refundRow(r);
});

on('POST', '/admin/finance/refunds/:id/retry', (c) => {
  const r = db.refunds.find((x) => x.id === c.params.id);
  if (!r || r.status !== 'FAILED') fail(409, 'CONFLICT', 'Only failed refunds can be retried');
  r.failureReason = null;
  settleRefund(r, `rfnd_${r.id.slice(-8)}_retry`);
  recomputeInvoice(invoiceOr404(r.invoiceId));
  return refundRow(r);
});

// ─── Expenses ────────────────────────────────────────────────────────

function expenseRow(e: GExpense): ExpenseRow {
  const t = e.truckId ? db.trucks.find((x) => x.id === e.truckId) : undefined;
  const b = bookingCode(e.bookingId);
  return { ...e, truck: t ? { registrationNumber: t.registrationNumber } : null, booking: b ? { code: b.code } : null, claimant: e.claimantUserId ? (userById(e.claimantUserId)?.fullName ?? null) : null, attachmentUrl: e.hasAttachment ? placeholderImage(`Receipt ${e.number}`, '#475569') : null };
}

on('GET', '/admin/finance/expenses', (c) => {
  const q = c.query;
  const statuses = str(q.status)?.split(',');
  const list = db.expenses
    .filter((e) => (!statuses || statuses.includes(e.status)) && (!q.category || e.category === q.category) && (!q.truckId || e.truckId === q.truckId) && (!(q.from || q.to) || inRange(e.expenseDate, q)))
    .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
  const sum = { amount: list.reduce((a, e) => a + e.amount, 0), taxAmount: list.reduce((a, e) => a + e.taxAmount, 0) };
  return paged(list.map(expenseRow), q, { sum });
});

on('POST', '/admin/finance/expenses', (c) => {
  const b = c.body;
  const amount = paise(b.amount);
  if (amount <= 0) amountError('Enter an amount greater than 0');
  const paid = b.paid === 'true' || b.paid === true;
  const now = nowIso();
  const date = b.expenseDate ? new Date(String(b.expenseDate)).toISOString() : now;
  const n = db.expenses.length + 1;
  const e: GExpense = {
    id: newId('exp'),
    number: `EXP-${fyLabel(Date.now())}-${String(n).padStart(5, '0')}`,
    category: String(b.category ?? 'OTHER') as GExpense['category'],
    source: b.source === 'VENDOR_BILL' ? 'VENDOR_BILL' : 'DIRECT',
    status: paid ? 'PAID' : 'APPROVED',
    description: String(b.description ?? ''),
    vendorName: str(b.vendorName) ?? null,
    vendorBillRef: str(b.vendorBillRef) ?? null,
    amount,
    taxAmount: paise(b.taxAmount),
    expenseDate: date,
    fuelLitres: b.fuelLitres ? Number(b.fuelLitres) : null,
    odometerKm: b.odometerKm ? Number(b.odometerKm) : null,
    truckId: str(b.truckId) ?? null,
    bookingId: null,
    zoneId: str(b.zoneId) ?? null,
    claimantUserId: null,
    reimbursable: false,
    hasAttachment: !!c.form?.get('receipt'),
    submittedById: c.userId,
    approvedById: c.userId,
    approvedAt: now,
    rejectionReason: null,
    paidAt: paid ? now : null,
    paymentRef: paid ? (str(b.paymentRef) ?? null) : null,
    isSample: true,
    createdAt: now,
    updatedAt: now,
  };
  db.expenses.push(e);
  return expenseRow(e);
});

on('POST', '/admin/finance/expenses/:id/decision', (c) => {
  const e = db.expenses.find((x) => x.id === c.params.id) ?? notFound('Expense');
  if (e.status !== 'SUBMITTED') fail(409, 'CONFLICT', 'Expense already decided');
  const now = nowIso();
  if (c.body.approve) {
    Object.assign(e, { status: 'APPROVED', approvedById: c.userId, approvedAt: now, updatedAt: now });
    if (e.reimbursable && e.claimantUserId) db.earnings.push({ id: newId('earn'), userId: e.claimantUserId, bookingId: e.bookingId, kind: 'REIMBURSEMENT', amount: e.amount, status: 'PENDING', payoutId: null, expenseId: e.id, note: `Reimbursement ${e.number}: ${e.description}`, earnedAt: now, createdById: c.userId });
  } else Object.assign(e, { status: 'REJECTED', approvedById: c.userId, rejectionReason: str(c.body.reason) ?? null, updatedAt: now });
  if (e.claimantUserId) pushNotification(e.claimantUserId, 'expense.decision', `Expense ${e.number} ${c.body.approve ? 'approved' : 'rejected'}`, str(c.body.reason) ?? (c.body.approve ? 'It will be reimbursed in your next payout.' : ''), { expenseId: e.id });
  return expenseRow(e);
});

on('POST', '/admin/finance/expenses/:id/paid', (c) => {
  const e = db.expenses.find((x) => x.id === c.params.id) ?? notFound('Expense');
  if (e.reimbursable) fail(409, 'CONFLICT', 'Reimbursable claims are paid through driver payouts');
  if (e.status !== 'APPROVED') fail(409, 'CONFLICT', 'Only approved expenses can be marked paid');
  Object.assign(e, { status: 'PAID', paidAt: c.body.paidAt ? new Date(String(c.body.paidAt)).toISOString() : nowIso(), paymentRef: String(c.body.paymentRef ?? ''), updatedAt: nowIso() });
  return { paid: true };
});

// ─── Salaries ────────────────────────────────────────────────────────

function salaryRow(s: (typeof db.salaries)[number]): SalaryRow {
  const u = userById(s.userId);
  return { ...s, user: { fullName: u?.fullName ?? 'Employee', workerProfile: u?.workerProfile ? { employeeCode: u.workerProfile.employeeCode } : null } };
}

on('GET', '/admin/finance/salaries', (c) => {
  const list = db.salaries.filter((s) => (!c.query.status || s.status === c.query.status) && (!c.query.userId || s.userId === c.query.userId)).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  return paged(list.map(salaryRow), c.query);
});

on('POST', '/admin/finance/salaries/generate', (c) => {
  const frequency = String(c.body.frequency ?? 'MONTHLY') as 'WEEKLY' | 'MONTHLY' | 'ANNUAL';
  const start = new Date(String(c.body.periodStart ?? '')).getTime();
  const end = new Date(String(c.body.periodEnd ?? '')).getTime();
  if (!(end > start)) fail(400, 'BAD_REQUEST', 'Period end must be after start');
  const staff = db.users.filter((u) => u.status === 'ACTIVE' && u.workerProfile?.employmentType === 'SALARIED' && (u.workerProfile.payFrequency ?? 'MONTHLY') === frequency && (u.workerProfile.baseSalary ?? 0) > 0);
  let created = 0;
  const now = nowIso();
  for (const u of staff) {
    if (db.salaries.some((s) => s.userId === u.id && s.frequency === frequency && Math.abs(new Date(s.periodStart).getTime() - start) < DAY)) continue;
    const base = u.workerProfile!.baseSalary!;
    db.salaries.push({ id: newId('sal'), userId: u.id, frequency, periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString(), baseAmount: base, incentives: 0, deductions: 0, netAmount: base, status: 'ACCRUED', approvedById: null, paidAt: null, paymentRef: null, notes: null, createdById: c.userId, isSample: true, createdAt: now, updatedAt: now });
    created++;
  }
  return { created, eligible: staff.length };
});

on('PATCH', '/admin/finance/salaries/:id', (c) => {
  const s = db.salaries.find((x) => x.id === c.params.id) ?? notFound('Salary record');
  if (s.status !== 'ACCRUED') fail(409, 'CONFLICT', 'Only accrued records can be adjusted');
  if (c.body.incentives !== undefined) s.incentives = paise(c.body.incentives);
  if (c.body.deductions !== undefined) s.deductions = paise(c.body.deductions);
  if (c.body.notes !== undefined) s.notes = str(c.body.notes) ?? null;
  s.netAmount = s.baseAmount + s.incentives - s.deductions;
  s.updatedAt = nowIso();
  return salaryRow(s);
});

on('POST', '/admin/finance/salaries/:id/:action', (c) => {
  const s = db.salaries.find((x) => x.id === c.params.id) ?? notFound('Salary record');
  const action = c.params.action;
  const from = ({ approve: 'ACCRUED', pay: 'APPROVED', cancel: 'ACCRUED' } as Record<string, string>)[action];
  if (!from) fail(400, 'BAD_REQUEST', 'Unknown action');
  if (action === 'pay' && !str(c.body.paymentRef)) fail(400, 'BAD_REQUEST', 'Payment reference is required');
  if (s.status !== from) fail(409, 'CONFLICT', `Record must be ${from.toLowerCase()} to ${action}`);
  if (action === 'approve') Object.assign(s, { status: 'APPROVED', approvedById: c.userId });
  else if (action === 'pay') Object.assign(s, { status: 'PAID', paidAt: nowIso(), paymentRef: String(c.body.paymentRef) });
  else s.status = 'CANCELLED';
  s.updatedAt = nowIso();
  return { ok: true };
});

// ─── Earnings & payouts ──────────────────────────────────────────────

on('GET', '/admin/finance/earnings', (c) => {
  const q = c.query;
  const list = db.earnings.filter((e) => (!q.userId || e.userId === q.userId) && (!q.status || e.status === q.status) && (!q.kind || e.kind === q.kind)).sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));
  return paged(
    list.map((e) => {
      const b = bookingCode(e.bookingId);
      const po = e.payoutId ? db.payouts.find((p) => p.id === e.payoutId) : undefined;
      return { ...e, user: { fullName: userById(e.userId)?.fullName ?? 'Worker' }, booking: b ? { id: b.id, code: b.code } : null, payout: po ? { id: po.id, status: po.status } : null };
    }),
    q,
  );
});

on('POST', '/admin/finance/earnings', (c) => {
  const kind: 'DEDUCTION' | 'INCENTIVE' = c.body.kind === 'DEDUCTION' ? 'DEDUCTION' : 'INCENTIVE';
  const amount = paise(c.body.amount);
  if (amount <= 0) amountError('Enter an amount greater than 0');
  if (!userById(str(c.body.userId))) fail(400, 'BAD_REQUEST', 'Choose a worker');
  const e = { id: newId('earn'), userId: String(c.body.userId), bookingId: str(c.body.bookingId) ?? null, kind, amount: kind === 'DEDUCTION' ? -amount : amount, status: 'PENDING' as const, payoutId: null, expenseId: null, note: String(c.body.note ?? ''), earnedAt: nowIso(), createdById: c.userId };
  db.earnings.push(e);
  pushNotification(e.userId, 'earning.adjustment', `${kind === 'INCENTIVE' ? 'Incentive added' : 'Deduction recorded'}: ${inrText(amount)}`, `${e.note}. You can challenge this via Support → Performance challenge.`, { earningId: e.id });
  return e;
});

function payoutRow(p: (typeof db.payouts)[number]): PayoutRow {
  const u = userById(p.userId);
  const wp = u?.workerProfile;
  return { ...p, user: { fullName: u?.fullName ?? 'Worker', workerProfile: wp ? { employeeCode: wp.employeeCode, payoutMethod: wp.payoutMethod, payoutDetailsMasked: wp.payoutDetailsMasked } : null } };
}

on('GET', '/admin/finance/payouts', (c) => {
  const list = db.payouts.filter((p) => !c.query.status || p.status === c.query.status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const byUser = new Map<string, PendingByWorker>();
  for (const e of db.earnings.filter((x) => x.status === 'PENDING')) {
    const row = byUser.get(e.userId) ?? { userId: e.userId, name: userById(e.userId)?.fullName, amount: 0, lines: 0 };
    row.amount += e.amount;
    row.lines++;
    byUser.set(e.userId, row);
  }
  return paged(list.map(payoutRow), c.query, { pendingByWorker: [...byUser.values()] });
});

on('POST', '/admin/finance/payouts/generate', (c) => {
  const start = new Date(String(c.body.periodStart ?? '')).toISOString();
  const end = new Date(String(c.body.periodEnd ?? '')).getTime();
  const pending = db.earnings.filter((e) => e.status === 'PENDING' && new Date(e.earnedAt).getTime() < end);
  const byUser = new Map<string, typeof pending>();
  for (const e of pending) byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e]);
  const out: PayoutRow[] = [];
  const now = nowIso();
  for (const [userId, lines] of byUser) {
    const sumKind = (kinds: string[]) => lines.filter((l) => kinds.includes(l.kind)).reduce((a, l) => a + l.amount, 0);
    const earnings = sumKind(['JOB_FIXED', 'JOB_COMMISSION']);
    const incentives = sumKind(['INCENTIVE']);
    const deductions = -sumKind(['DEDUCTION']);
    const reimbursements = sumKind(['REIMBURSEMENT']);
    const po = { id: newId('po'), userId, periodStart: start, periodEnd: new Date(end).toISOString(), earningsAmount: earnings, incentivesAmount: incentives, deductionsAmount: deductions, reimbursementsAmount: reimbursements, netAmount: earnings + incentives - deductions + reimbursements, status: 'DRAFT' as const, approvedById: null, paidAt: null, paymentRef: null, createdById: c.userId, createdAt: now, updatedAt: now };
    db.payouts.push(po);
    for (const l of lines) Object.assign(l, { status: 'IN_PAYOUT', payoutId: po.id });
    out.push(payoutRow(po));
  }
  return out;
});

on('POST', '/admin/finance/payouts/:id/:action', (c) => {
  const po = db.payouts.find((p) => p.id === c.params.id) ?? notFound('Payout');
  const action = c.params.action;
  const from = ({ approve: ['DRAFT'], pay: ['APPROVED'], cancel: ['DRAFT', 'APPROVED'] } as Record<string, string[]>)[action];
  if (!from) fail(400, 'BAD_REQUEST', 'Unknown action');
  if (action === 'pay' && !str(c.body.paymentRef)) fail(400, 'BAD_REQUEST', 'Payment reference is required');
  if (!from.includes(po.status)) fail(409, 'CONFLICT', `Payout cannot be ${action}d from ${po.status}`);
  const now = nowIso();
  if (action === 'approve') Object.assign(po, { status: 'APPROVED', approvedById: c.userId });
  else if (action === 'pay') {
    Object.assign(po, { status: 'PAID', paidAt: now, paymentRef: String(c.body.paymentRef) });
    const expenseIds = db.earnings.filter((e) => e.payoutId === po.id && e.kind === 'REIMBURSEMENT' && e.expenseId).map((e) => e.expenseId);
    for (const e of db.expenses) if (expenseIds.includes(e.id) && e.status === 'APPROVED') Object.assign(e, { status: 'PAID', paidAt: now, paymentRef: `Payout ${String(c.body.paymentRef)}` });
    pushNotification(po.userId, 'payout.paid', `Payout of ${inrText(po.netAmount)} sent`, `Reference ${String(c.body.paymentRef)}`, { payoutId: po.id });
  } else {
    po.status = 'CANCELLED';
    for (const e of db.earnings) if (e.payoutId === po.id) Object.assign(e, { status: 'PENDING', payoutId: null });
  }
  po.updatedAt = now;
  return { ok: true };
});
