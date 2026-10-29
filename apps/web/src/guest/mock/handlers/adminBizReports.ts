/**
 * Guest-mode reports & analytics (apps/api/src/modules/admin/reports.ts), computed from the
 * in-memory ledger so dashboard KPIs, statements and charts agree with the rest of the app.
 * All sample records are flagged as sample data; "exclude sample data" is not applied here,
 * otherwise every guest report would be empty.
 */
import type { BookingStatus } from '@/api/types';
import type { KpiItem, TrendPoint } from '@/pages/admin/ops/types';
import type { GBooking, GInvoice } from '../model';
import { db, DAY, HOUR } from '../db';
import { NEEDS_PROVIDER_STATUSES, statusGroups } from '../bookingOps';
import { csvFile, pdfFile } from '../files';
import { on, str, type Query } from '../router';
import { adjustments } from './adminBizFinance';

const IST = 5.5 * HOUR;

// ─── Periods (Asia/Kolkata, April financial year) ────────────────────

interface Range {
  from: number;
  to: number;
}
const local = (ms: number) => {
  const d = new Date(ms + IST);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours() };
};
/** UTC instant of local midnight (Date.UTC normalises overflowing months/days). */
const mid = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) - IST;
const FY_START = 4;

function resolvePeriod(q: Query): Range {
  const p = local(Date.now());
  switch (String(q.period ?? 'this_month')) {
    case 'today':
      return { from: mid(p.y, p.m, p.d), to: mid(p.y, p.m, p.d + 1) };
    case 'yesterday':
      return { from: mid(p.y, p.m, p.d - 1), to: mid(p.y, p.m, p.d) };
    case 'this_week':
    case 'last_week': {
      const back = (p.wd + 6) % 7 + (q.period === 'last_week' ? 7 : 0);
      return { from: mid(p.y, p.m, p.d - back), to: mid(p.y, p.m, p.d - back + 7) };
    }
    case 'last_month':
      return { from: mid(p.y, p.m - 1, 1), to: mid(p.y, p.m, 1) };
    case 'this_quarter': {
      const offset = (p.m - FY_START + 12) % 12;
      const startAbs = FY_START + offset - (offset % 3);
      const sy = p.y - (startAbs > p.m ? 1 : 0);
      const sm = ((startAbs - 1) % 12) + 1;
      return { from: mid(sy, sm, 1), to: mid(sy, sm + 3, 1) };
    }
    case 'this_fy':
    case 'last_fy': {
      const sy = (p.m >= FY_START ? p.y : p.y - 1) - (q.period === 'last_fy' ? 1 : 0);
      return { from: mid(sy, FY_START, 1), to: mid(sy + 1, FY_START, 1) };
    }
    case 'custom': {
      const f = str(q.from)?.split('-').map(Number);
      const t = str(q.to)?.split('-').map(Number);
      if (f?.length === 3 && t?.length === 3) return { from: mid(f[0]!, f[1]!, f[2]!), to: mid(t[0]!, t[1]!, t[2]! + 1) };
      return { from: mid(p.y, p.m, 1), to: mid(p.y, p.m + 1, 1) };
    }
    default:
      return { from: mid(p.y, p.m, 1), to: mid(p.y, p.m + 1, 1) };
  }
}
const prevRange = (r: Range): Range => ({ from: r.from - (r.to - r.from), to: r.from });
const isoRange = (r: Range) => ({ from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString() });
const within = (iso: string | null | undefined, r: Range) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= r.from && t < r.to;
};

// ─── Filters ─────────────────────────────────────────────────────────

interface Filters {
  zoneId?: string;
  serviceCategoryId?: string;
}
const filtersOf = (q: Query): Filters => ({ zoneId: str(q.zoneId), serviceCategoryId: str(q.serviceCategoryId) });
const isFiltered = (f: Filters) => !!(f.zoneId || f.serviceCategoryId);
const bookingMatches = (b: GBooking | undefined, f: Filters) => !!b && (!f.zoneId || b.zoneId === f.zoneId) && (!f.serviceCategoryId || b.serviceCategoryId === f.serviceCategoryId);
const bookingOf = (id: string | null) => (id ? db.bookings.find((b) => b.id === id) : undefined);
/** Issued invoices; with a zone/service filter only booking-linked invoices that match. */
const invoiceMatches = (i: GInvoice | undefined, f: Filters) => !!i && i.status === 'ISSUED' && (!isFiltered(f) || bookingMatches(bookingOf(i.bookingId), f));
const invoiceOf = (id: string) => db.invoices.find((i) => i.id === id);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

export const METRIC_DEFINITIONS: Record<string, string> = {
  grossServiceValue: 'Sum of service charges on invoices issued in the period, before discounts, excluding taxes and pass-through tolls/parking.',
  discounts: 'Discounts and membership benefits applied on invoices issued in the period.',
  recognizedRevenue: 'Taxable value of invoices issued in the period (after discounts) minus taxable value of credit notes issued in the period. Excludes GST and pass-through charges.',
  taxesCollected: 'GST charged on invoices minus GST reversed by credit notes. A liability payable to the government — not revenue.',
  passThrough: 'Tolls and parking recovered from customers at actuals. Excluded from revenue and from costs.',
  onlineReceived: 'Online payments confirmed by verified gateway events in the period (cash basis).',
  cashReceived: 'Cash collections confirmed by finance in the period. Unconfirmed field collections are excluded.',
  bankReceived: 'Bank transfers recorded by finance in the period.',
  receivables: 'Outstanding balance on issued, non-void invoices at the end of the period.',
  driverEarnings: 'Job earnings, incentives and deductions accrued to drivers/partners in the period. Reimbursements are excluded (counted in expenses).',
  salaries: 'Salary obligations (base + incentives − deductions) for pay periods ending in the period. This is the accrued obligation, not cash paid.',
  expensesTotal: 'Approved or paid operating expenses dated in the period, excluding recoverable GST input tax.',
  gatewayFees: 'Payment gateway fees and GST on fees for payments that succeeded in the period.',
  writeOffs: 'Receivables written off as uncollectable in the period.',
  operatingProfit: 'Recognized revenue minus driver earnings, salaries, expenses, gateway fees and write-offs.',
  profitMarginPct: 'Operating profit as a percentage of recognized revenue.',
  revenuePerCompletedBooking: 'Recognized revenue from service invoices divided by bookings completed in the period.',
  contributionMargin: 'Per service category: recognized revenue minus direct job costs (driver earnings on those jobs, job-linked expenses, gateway fees on those invoices).',
  netCashFlow: 'Cash received minus refunds, payouts, salaries and expenses actually paid in the period.',
};

// ─── Financial summary (single source for money figures) ─────────────

function financialSummary(r: Range, f: Filters) {
  const filtered = isFiltered(f);
  const inv = db.invoices.filter((i) => invoiceMatches(i, f) && within(i.issuedAt, r));
  const cn = db.creditNotes.filter((c) => within(c.createdAt, r) && invoiceMatches(invoiceOf(c.invoiceId), f));
  const earnings = db.earnings.filter((e) => within(e.earnedAt, r) && e.status !== 'VOID' && e.kind !== 'REIMBURSEMENT' && (!filtered || bookingMatches(bookingOf(e.bookingId), f)));
  const salaries = filtered ? [] : db.salaries.filter((s) => s.status !== 'CANCELLED' && new Date(s.periodEnd).getTime() > r.from && new Date(s.periodEnd).getTime() <= r.to);
  const expenses = db.expenses.filter((e) => within(e.expenseDate, r) && (e.status === 'APPROVED' || e.status === 'PAID') && (!filtered || bookingMatches(bookingOf(e.bookingId), f)));
  const okPays = db.payments.filter((p) => p.status === 'SUCCEEDED' && within(p.succeededAt, r) && (!filtered || invoiceMatches(invoiceOf(p.invoiceId), f)));
  const byMethod = (m: string) => sum(okPays.filter((p) => p.method === m).map((p) => p.amount));
  const refundsPaid = sum(db.refunds.filter((x) => x.status === 'SUCCEEDED' && within(x.processedAt, r) && (!filtered || invoiceMatches(invoiceOf(x.invoiceId), f))).map((x) => x.amount));
  const payouts = filtered ? [] : db.payouts.filter((p) => p.status === 'PAID' && within(p.paidAt, r));
  const salariesPaid = filtered ? 0 : sum(db.salaries.filter((s) => s.status === 'PAID' && within(s.paidAt, r)).map((s) => s.netAmount));
  const expensesPaid = filtered ? 0 : sum(db.expenses.filter((e) => e.status === 'PAID' && within(e.paidAt, r)).map((e) => e.amount + e.taxAmount));
  const receivables = db.invoices.filter((i) => invoiceMatches(i, f) && new Date(i.issuedAt).getTime() < r.to && i.outstanding > 0);
  const writeOffs = sum(adjustments.filter((a) => a.type === 'WRITE_OFF' && within(a.createdAt, r) && (!filtered || invoiceMatches(invoiceOf(a.invoiceId), f))).map((a) => a.amount));

  const expensesByCategory: Record<string, number> = {};
  for (const e of expenses) expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + e.amount;
  const recognizedRevenue = sum(inv.map((i) => i.taxableValue)) - sum(cn.map((c) => c.taxableAmount));
  const expensesTotal = sum(Object.values(expensesByCategory));
  const driverEarnings = sum(earnings.map((e) => e.amount));
  const salaryTotal = sum(salaries.map((s) => s.netAmount));
  const gatewayFees = sum(okPays.map((p) => p.gatewayFee));
  const totalCosts = driverEarnings + salaryTotal + expensesTotal + gatewayFees + writeOffs;
  const operatingProfit = recognizedRevenue - totalCosts;
  const operating = {
    grossServiceValue: sum(inv.map((i) => i.subtotal)),
    discounts: sum(inv.map((i) => i.discountTotal)),
    creditNotes: sum(cn.map((c) => c.taxableAmount)),
    recognizedRevenue,
    taxesCollected: sum(inv.map((i) => i.taxTotal)) - sum(cn.map((c) => c.taxAmount)),
    passThrough: sum(inv.map((i) => i.passThroughTotal)),
    driverEarnings,
    salaries: salaryTotal,
    expensesByCategory,
    expensesTotal,
    gatewayFees,
    writeOffs,
    totalCosts,
    operatingProfit,
    profitMarginPct: recognizedRevenue > 0 ? Math.round((operatingProfit / recognizedRevenue) * 10000) / 100 : null,
  };
  const cash = {
    onlineReceived: byMethod('ONLINE'),
    cashReceived: byMethod('CASH'),
    bankReceived: byMethod('BANK_TRANSFER'),
    refundsPaid,
    payoutsPaid: sum(payouts.map((p) => p.netAmount - p.reimbursementsAmount)),
    salariesPaid,
    expensesPaid,
  };
  const cashIn = cash.onlineReceived + cash.cashReceived + cash.bankReceived;
  const cashOut = cash.refundsPaid + cash.payoutsPaid + cash.salariesPaid + cash.expensesPaid;
  const completed = db.bookings.filter((b) => (b.status === 'COMPLETED' || b.status === 'DISPUTED') && within(b.completedAt, r) && bookingMatches(b, f)).length;
  const serviceRevenue = sum(inv.filter((i) => i.type === 'SERVICE').map((i) => i.taxableValue));
  return {
    range: isoRange(r),
    filters: { excludeSample: false, ...f },
    invoicesIssued: inv.length,
    invoicedTotal: sum(inv.map((i) => i.total)),
    operating,
    cashFlow: { ...cash, cashIn, cashOut, netCashFlow: cashIn - cashOut },
    receivables: { amount: sum(receivables.map((i) => i.outstanding)), invoices: receivables.length },
    completedBookings: completed,
    revenuePerCompletedBooking: completed ? Math.round(serviceRevenue / completed) : null,
    scopeNote: filtered ? 'Filtered view: company-wide salaries, payouts and unlinked expenses are excluded; only booking-linked revenue and costs are shown.' : null,
  };
}

on('GET', '/admin/reports/definitions', () => METRIC_DEFINITIONS);

on('GET', '/admin/reports/financial', (c) => {
  const r = resolvePeriod(c.query);
  const f = filtersOf(c.query);
  const compare = c.query.compare === undefined || c.query.compare === true || c.query.compare === 'true';
  return {
    current: financialSummary(r, f),
    previous: compare ? financialSummary(prevRange(r), f) : null,
    definitions: METRIC_DEFINITIONS,
    dataQuality: { sampleInvoicesInRange: db.invoices.filter((i) => i.isSample && within(i.issuedAt, r)).length, sandboxPaymentsInRange: db.payments.filter((p) => p.isSandbox && p.status === 'SUCCEEDED' && within(p.succeededAt, r)).length },
  };
});

function statementRows(s: ReturnType<typeof financialSummary>): [string, number][] {
  const o = s.operating;
  return [
    ['Gross service value', o.grossServiceValue],
    ['Discounts', o.discounts],
    ['Credit notes (taxable)', o.creditNotes],
    ['Recognized revenue', o.recognizedRevenue],
    ['GST collected (liability)', o.taxesCollected],
    ['Pass-through tolls/parking', o.passThrough],
    ['Driver & partner earnings', o.driverEarnings],
    ['Salaries & incentives (accrued)', o.salaries],
    ...Object.entries(o.expensesByCategory).map(([k, v]) => [`Expense: ${k}`, v] as [string, number]),
    ['Gateway fees', o.gatewayFees],
    ['Write-offs', o.writeOffs],
    ['Operating profit', o.operatingProfit],
    ['Cash in (online)', s.cashFlow.onlineReceived],
    ['Cash in (cash)', s.cashFlow.cashReceived],
    ['Cash in (bank)', s.cashFlow.bankReceived],
    ['Cash out (refunds)', s.cashFlow.refundsPaid],
    ['Cash out (payouts)', s.cashFlow.payoutsPaid],
    ['Cash out (salaries)', s.cashFlow.salariesPaid],
    ['Cash out (expenses)', s.cashFlow.expensesPaid],
    ['Net cash flow', s.cashFlow.netCashFlow],
    ['Receivables at period end', s.receivables.amount],
  ];
}

on('GET', '/admin/reports/financial.csv', (c) => {
  const r = resolvePeriod(c.query);
  const s = financialSummary(r, filtersOf(c.query));
  const { from, to } = isoRange(r);
  return csvFile(['metric', 'amountInr', 'from', 'to'], statementRows(s).map(([k, v]) => [k, (v / 100).toFixed(2), from, to]));
});

on('GET', '/admin/reports/financial.pdf', (c) => {
  const r = resolvePeriod(c.query);
  const s = financialSummary(r, filtersOf(c.query));
  const d = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
  const rs = (p: number) => `Rs. ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  return pdfFile(`TowPilot - Financial summary`, [`${d(r.from)} to ${d(r.to - 1)} (Asia/Kolkata)`, '', ...statementRows(s).map(([k, v]) => `${k}: ${rs(v)}`)]);
});

// ─── Operational KPIs ────────────────────────────────────────────────

/** Open = not terminal, delivered or disputed (as OPEN_STATUSES in the API). */
const OPEN_STATUSES: BookingStatus[] = statusGroups.active.filter((s) => s !== 'DELIVERED' && s !== 'DISPUTED');

const firstAt = (b: GBooking, s: BookingStatus) => b.statusHistory.find((h) => h.toStatus === s)?.createdAt ?? null;

function responseTimes(r: Range, f: Filters) {
  const resp: number[] = [];
  const arr: number[] = [];
  for (const b of db.bookings.filter((x) => bookingMatches(x, f))) {
    const c = firstAt(b, 'CONFIRMED');
    const a = firstAt(b, 'ACCEPTED');
    const v = firstAt(b, 'ARRIVED');
    if (c && a && within(a, r)) resp.push((new Date(a).getTime() - new Date(c).getTime()) / 60_000);
    if (a && v && within(v, r)) arr.push((new Date(v).getTime() - new Date(a).getTime()) / 60_000);
  }
  const avg = (xs: number[]) => (xs.length ? round1(sum(xs) / xs.length) : null);
  return { avgResponseMin: avg(resp), avgArrivalMin: avg(arr) };
}

on('GET', '/admin/reports/overview', (c) => {
  const r = resolvePeriod(c.query);
  const f = filtersOf(c.query);
  const bs = db.bookings.filter((b) => bookingMatches(b, f));
  const p = local(Date.now());
  const todayFrom = mid(p.y, p.m, p.d);
  const customers = db.users.filter((u) => u.roles.includes('customer') && !u.deletedAt);
  const created = bs.filter((b) => within(b.createdAt, r) && b.status !== 'REQUESTED' && b.status !== 'QUOTED').length;
  const cancelled = bs.filter((b) => b.statusHistory.some((h) => h.toStatus === 'CANCELLED' && within(h.createdAt, r) && h.fromStatus !== 'REQUESTED' && h.fromStatus !== 'QUOTED')).length;
  const ratings = db.ratings.filter((x) => within(x.createdAt, r) && bookingMatches(bookingOf(x.bookingId), f));
  const times = responseTimes(r, f);
  const fin = financialSummary(r, f);
  const kpis: KpiItem[] = [
    { key: 'totalCustomers', label: 'Total customers', value: customers.length, unit: 'count', definition: 'Customer accounts not deleted.' },
    { key: 'newCustomers', label: 'New customers', value: customers.filter((u) => within(u.createdAt, r)).length, unit: 'count', definition: 'Customer accounts created in the period.' },
    { key: 'activeBookings', label: 'Active bookings', value: bs.filter((b) => OPEN_STATUSES.includes(b.status)).length, unit: 'count', definition: 'Bookings not yet delivered, completed, cancelled or failed (live, right now).' },
    { key: 'unassignedBookings', label: 'Unassigned bookings', value: bs.filter((b) => NEEDS_PROVIDER_STATUSES.includes(b.status)).length, unit: 'count', definition: 'Confirmed bookings without an accepted provider (live).' },
    { key: 'availableDrivers', label: 'Available drivers', value: db.users.filter((u) => u.availability?.status === 'AVAILABLE' && u.status === 'ACTIVE' && u.workerProfile?.verificationStatus === 'APPROVED' && (!f.zoneId || u.availability.zoneId === f.zoneId)).length, unit: 'count', definition: 'Verified, active workers currently marked Available (live).' },
    { key: 'availableTrucks', label: 'Available tow trucks', value: db.trucks.filter((t) => t.status === 'AVAILABLE' && (!f.zoneId || t.zoneId === f.zoneId)).length, unit: 'count', definition: 'Trucks with status Available (live).' },
    { key: 'completedToday', label: 'Jobs completed today', value: bs.filter((b) => (b.status === 'COMPLETED' || b.status === 'DISPUTED') && b.completedAt && new Date(b.completedAt).getTime() >= todayFrom).length, unit: 'count', definition: 'Bookings completed since local midnight.' },
    { key: 'avgResponseMin', label: 'Avg response time', value: times.avgResponseMin, unit: 'minutes', definition: 'Average minutes from booking confirmation to a driver accepting, for bookings accepted in the period.' },
    { key: 'avgPickupMin', label: 'Avg time to arrival', value: times.avgArrivalMin, unit: 'minutes', definition: 'Average minutes from driver acceptance to arrival at pickup, for arrivals in the period.' },
    { key: 'cancellationRate', label: 'Cancellation rate', value: created ? Math.round((cancelled / created) * 1000) / 10 : null, unit: 'percent', definition: 'Bookings cancelled after confirmation ÷ bookings confirmed in the period.' },
    { key: 'grossServiceValue', label: 'Gross service revenue', value: fin.operating.grossServiceValue, unit: 'paise', definition: METRIC_DEFINITIONS.grossServiceValue! },
    { key: 'discountsRefunds', label: 'Discounts & refunds', value: fin.operating.discounts + fin.cashFlow.refundsPaid, unit: 'paise', definition: 'Discounts on invoices issued plus refunds paid in the period.' },
    { key: 'payouts', label: 'Driver & partner payouts', value: fin.operating.driverEarnings, unit: 'paise', definition: METRIC_DEFINITIONS.driverEarnings! },
    { key: 'operatingExpenses', label: 'Operating expenses', value: fin.operating.expensesTotal + fin.operating.salaries + fin.operating.gatewayFees, unit: 'paise', definition: 'Expenses + salary obligations + gateway fees in the period.' },
    { key: 'operatingProfit', label: 'Net operating profit', value: fin.operating.operatingProfit, unit: 'paise', definition: METRIC_DEFINITIONS.operatingProfit! },
    { key: 'receivables', label: 'Outstanding customer payments', value: fin.receivables.amount, unit: 'paise', definition: METRIC_DEFINITIONS.receivables! },
    { key: 'satisfaction', label: 'Customer satisfaction', value: ratings.length ? round1(sum(ratings.map((x) => x.score)) / ratings.length) : null, unit: 'rating', definition: `Average rating (1–5) across ${ratings.length} ratings in the period.` },
  ];
  return { range: isoRange(r), kpis };
});

// ─── Trends ──────────────────────────────────────────────────────────

function bucketOf(iso: string, g: string) {
  const p = local(new Date(iso).getTime());
  const fmt = (y: number, m: number, d: number) => {
    const t = new Date(Date.UTC(y, m - 1, d));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  };
  if (g === 'day') return fmt(p.y, p.m, p.d);
  if (g === 'week') return fmt(p.y, p.m, p.d - ((p.wd + 6) % 7));
  if (g === 'quarter') return fmt(p.y, p.m - ((p.m - 1) % 3), 1);
  if (g === 'year') return fmt(p.y, 1, 1);
  return fmt(p.y, p.m, 1);
}

on('GET', '/admin/reports/trends', (c) => {
  const r = resolvePeriod(c.query);
  const g = ['day', 'week', 'month', 'quarter', 'year'].includes(String(c.query.granularity)) ? String(c.query.granularity) : 'month';
  const series = new Map<string, TrendPoint>();
  const add = (iso: string | null, field: 'revenue' | 'costs' | 'bookings', v: number) => {
    if (!iso || !within(iso, r)) return;
    const k = bucketOf(iso, g);
    const row = series.get(k) ?? { bucket: k, revenue: 0, costs: 0, profit: 0, bookings: 0 };
    row[field] += v;
    series.set(k, row);
  };
  for (const i of db.invoices) if (i.status === 'ISSUED') add(i.issuedAt, 'revenue', i.taxableValue);
  for (const cn of db.creditNotes) add(cn.createdAt, 'revenue', -cn.taxableAmount);
  for (const e of db.earnings) if (e.status !== 'VOID' && e.kind !== 'REIMBURSEMENT') add(e.earnedAt, 'costs', e.amount);
  for (const s of db.salaries) if (s.status !== 'CANCELLED') {
    const end = new Date(s.periodEnd).getTime();
    // Salary obligations land in the bucket of the period they belong to (period end is exclusive).
    if (end > r.from && end <= r.to) add(new Date(Math.min(end - 1, r.to - 1)).toISOString(), 'costs', s.netAmount);
  }
  for (const e of db.expenses) if (e.status === 'APPROVED' || e.status === 'PAID') add(e.expenseDate, 'costs', e.amount);
  for (const p of db.payments) if (p.status === 'SUCCEEDED') add(p.succeededAt, 'costs', p.gatewayFee);
  for (const b of db.bookings) if (b.status === 'COMPLETED' || b.status === 'DISPUTED') add(b.completedAt, 'bookings', 1);
  const out = [...series.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)).map((x) => ({ ...x, profit: x.revenue - x.costs }));
  return { range: isoRange(r), granularity: g, timezone: 'Asia/Kolkata', series: out };
});

// ─── Breakdown reports ───────────────────────────────────────────────

on('GET', '/admin/reports/profitability', (c) => {
  const r = resolvePeriod(c.query);
  const f = filtersOf(c.query);
  const rows = new Map<string, { category: string; jobs: number; revenue: number; direct: number }>();
  for (const i of db.invoices) {
    const b = bookingOf(i.bookingId);
    if (i.type !== 'SERVICE' || i.status !== 'ISSUED' || !within(i.issuedAt, r) || !b || !bookingMatches(b, f)) continue;
    const cat = db.categories.find((x) => x.id === b.serviceCategoryId)?.name ?? 'Other';
    const row = rows.get(cat) ?? { category: cat, jobs: 0, revenue: 0, direct: 0 };
    row.jobs++;
    row.revenue += i.taxableValue;
    row.direct += sum(db.earnings.filter((e) => e.bookingId === b.id && e.kind !== 'REIMBURSEMENT' && e.status !== 'VOID').map((e) => e.amount));
    row.direct += sum(db.expenses.filter((e) => e.bookingId === b.id && (e.status === 'APPROVED' || e.status === 'PAID')).map((e) => e.amount));
    row.direct += sum(db.payments.filter((p) => p.invoiceId === i.id && p.status === 'SUCCEEDED').map((p) => p.gatewayFee));
    rows.set(cat, row);
  }
  return [...rows.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .map((x) => ({ category: x.category, jobs: x.jobs, revenue: x.revenue, directCosts: x.direct, contributionMargin: x.revenue - x.direct, marginPct: x.revenue ? Math.round(((x.revenue - x.direct) / x.revenue) * 1000) / 10 : null, revenuePerJob: x.jobs ? Math.round(x.revenue / x.jobs) : null }));
});

on('GET', '/admin/reports/zones', (c) => {
  const r = resolvePeriod(c.query);
  const f = filtersOf(c.query);
  const rows = new Map<string, { zone: string; bookings: number; completed: number; cancelled: number; failed: number; revenue: number }>();
  for (const b of db.bookings.filter((x) => within(x.createdAt, r) && bookingMatches(x, f))) {
    const name = db.zones.find((z) => z.id === b.zoneId)?.name ?? 'Unzoned';
    const row = rows.get(name) ?? { zone: name, bookings: 0, completed: 0, cancelled: 0, failed: 0, revenue: 0 };
    row.bookings++;
    if (b.status === 'COMPLETED' || b.status === 'DISPUTED') row.completed++;
    if (b.status === 'CANCELLED') row.cancelled++;
    if (b.status === 'FAILED') row.failed++;
    row.revenue += sum(db.invoices.filter((i) => i.bookingId === b.id && i.status === 'ISSUED').map((i) => i.taxableValue));
    rows.set(name, row);
  }
  return [...rows.values()].sort((a, b) => b.bookings - a.bookings);
});

on('GET', '/admin/reports/drivers', (c) => {
  const r = resolvePeriod(c.query);
  const f = filtersOf(c.query);
  return db.users
    .filter((u) => u.driverProfile)
    .map((u) => {
      const asg = db.bookings.filter((b) => bookingMatches(b, f)).flatMap((b) => b.assignments.filter((a) => a.driverUserId === u.id && within(a.offeredAt, r)));
      const earnings = sum(db.earnings.filter((e) => e.userId === u.id && e.kind !== 'REIMBURSEMENT' && e.status !== 'VOID' && within(e.earnedAt, r) && (!e.bookingId || bookingMatches(bookingOf(e.bookingId), f))).map((e) => e.amount));
      const rt = db.ratings.filter((x) => x.rateeUserId === u.id && within(x.createdAt, r));
      return { id: u.id, name: u.fullName, offered: asg.length, completed: asg.filter((a) => a.status === 'COMPLETED').length, declined: asg.filter((a) => a.status === 'REJECTED' || a.status === 'TIMED_OUT').length, earnings, rating: rt.length ? round1(sum(rt.map((x) => x.score)) / rt.length) : null };
    })
    .sort((a, b) => b.completed - a.completed);
});

on('GET', '/admin/reports/trucks', (c) => {
  const r = resolvePeriod(c.query);
  const f = filtersOf(c.query);
  const hours = Math.max(0, Math.min(r.to, Date.now()) - r.from) / HOUR;
  const trucks = db.trucks
    .filter((t) => t.status !== 'RETIRED' && (!f.zoneId || t.zoneId === f.zoneId))
    .map((t) => {
      let jobs = 0;
      let busy = 0;
      for (const b of db.bookings.filter((x) => bookingMatches(x, f))) {
        for (const a of b.assignments.filter((x) => x.truckId === t.id && within(x.offeredAt, r))) {
          if (a.status === 'COMPLETED') jobs++;
          if ((a.status === 'COMPLETED' || a.status === 'ACCEPTED') && a.respondedAt) busy += ((b.completedAt ? new Date(b.completedAt).getTime() : Date.now()) - new Date(a.respondedAt).getTime()) / HOUR;
        }
      }
      const exp = (cats: string[]) => sum(db.expenses.filter((x) => x.truckId === t.id && cats.includes(x.category) && (x.status === 'APPROVED' || x.status === 'PAID') && within(x.expenseDate, r)).map((x) => x.amount));
      return { id: t.id, registrationNumber: t.registrationNumber, truckType: t.truckType, jobs, busyHours: round1(busy), utilisationPct: hours ? Math.round((busy / hours) * 1000) / 10 : null, maintenanceEvents: db.maintenance.filter((m) => m.truckId === t.id && within(m.performedAt, r)).length, fuelCost: exp(['FUEL']), repairCost: exp(['MAINTENANCE', 'REPAIR']) };
    })
    .sort((a, b) => b.jobs - a.jobs);
  return { periodHours: Math.round(hours), trucks };
});

on('GET', '/admin/reports/customers', (c) => {
  const r = resolvePeriod(c.query);
  const f = filtersOf(c.query);
  const counts = new Map<string, number>();
  for (const b of db.bookings) if ((b.status === 'COMPLETED' || b.status === 'DISPUTED') && within(b.completedAt, r) && bookingMatches(b, f)) counts.set(b.customerUserId, (counts.get(b.customerUserId) ?? 0) + 1);
  const customers = counts.size;
  const repeat = [...counts.values()].filter((n) => n > 1).length;
  return { customersServed: customers, repeatCustomers: repeat, repeatRatePct: customers ? Math.round((repeat / customers) * 1000) / 10 : null, definition: 'Share of customers served in the period who completed more than one booking in the period.' };
});

on('GET', '/admin/reports/cancellations', (c) => {
  const r = resolvePeriod(c.query);
  const f = filtersOf(c.query);
  const rows = db.bookings.filter((b) => bookingMatches(b, f)).flatMap((b) => b.statusHistory.filter((h) => h.toStatus === 'CANCELLED' && within(h.createdAt, r)).map((h) => ({ h, fee: b.cancellationFee })));
  const by = (key: (x: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    for (const x of rows) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
    return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
  };
  return { total: rows.length, feesCharged: sum(rows.map((x) => x.fee)), byStage: by((x) => x.h.fromStatus ?? 'UNKNOWN'), byActor: by((x) => x.h.actorRole), topReasons: by((x) => (x.h.reason ?? 'No reason').slice(0, 80)).slice(0, 10) };
});

on('GET', '/admin/reports/demand', (c) => {
  const r = resolvePeriod(c.query);
  const f = filtersOf(c.query);
  const bs = db.bookings.filter((b) => within(b.createdAt, r) && bookingMatches(b, f));
  const cells = new Map<string, { lat: number; lng: number; bookings: number; unfulfilled: number; resp: number[] }>();
  const hours = new Map<string, { dow: number; hour: number; bookings: number }>();
  const cats = new Map<string, number>();
  const classes = new Map<string, number>();
  for (const b of bs) {
    const p = b.locations.find((l) => l.kind === 'PICKUP');
    if (p) {
      const lat = Math.round(p.lat / 0.02) * 0.02;
      const lng = Math.round(p.lng / 0.02) * 0.02;
      const k = `${lat.toFixed(2)},${lng.toFixed(2)}`;
      const cell = cells.get(k) ?? { lat: Number(lat.toFixed(2)), lng: Number(lng.toFixed(2)), bookings: 0, unfulfilled: 0, resp: [] };
      cell.bookings++;
      const acc = firstAt(b, 'ACCEPTED');
      const con = firstAt(b, 'CONFIRMED');
      if (b.status === 'FAILED' || (b.status === 'CANCELLED' && !acc && con)) cell.unfulfilled++;
      if (acc && con) cell.resp.push((new Date(acc).getTime() - new Date(con).getTime()) / 60_000);
      cells.set(k, cell);
    }
    const lp = local(new Date(b.createdAt).getTime());
    const hk = `${lp.wd}-${lp.h}`;
    const hr = hours.get(hk) ?? { dow: lp.wd, hour: lp.h, bookings: 0 };
    hr.bookings++;
    hours.set(hk, hr);
    const cn = db.categories.find((x) => x.id === b.serviceCategoryId)?.name ?? 'Other';
    cats.set(cn, (cats.get(cn) ?? 0) + 1);
    const v = db.vehicles.find((x) => x.id === b.vehicleId);
    if (v) classes.set(v.vehicleClass, (classes.get(v.vehicleClass) ?? 0) + 1);
  }
  const weeks = Math.max(1, (r.to - r.from) / (7 * DAY));
  const cellRows = [...cells.values()].sort((a, b) => b.bookings - a.bookings).slice(0, 200).map((x) => ({ lat: x.lat, lng: x.lng, bookings: x.bookings, unfulfilled: x.unfulfilled, avgResponseMin: x.resp.length ? round1(sum(x.resp) / x.resp.length) : null }));
  const median = [...cellRows.map((x) => x.avgResponseMin ?? 0)].sort((a, b) => a - b)[Math.floor(cellRows.length / 2)] ?? 0;
  return {
    range: isoRange(r),
    hotspots: cellRows.map((x) => ({ ...x, insufficientCoverage: x.unfulfilled > 0 || (x.avgResponseMin != null && x.avgResponseMin > median * 1.5 && x.bookings >= 3) })),
    byHour: [...hours.values()].map((h) => ({ ...h, expectedPerWeek: round1(h.bookings / weeks) })),
    byCategory: [...cats.entries()].map(([category, bookings]) => ({ category, bookings })).sort((a, b) => b.bookings - a.bookings),
    byVehicleClass: [...classes.entries()].map(([vehicleClass, bookings]) => ({ vehicleClass, bookings })).sort((a, b) => b.bookings - a.bookings),
    zones: db.zones.filter((z) => z.active).map((z) => ({ id: z.id, name: z.name, drivers: db.users.filter((u) => u.availability?.status === 'AVAILABLE' && u.availability.zoneId === z.id).length, trucks: db.trucks.filter((t) => t.zoneId === z.id && (t.status === 'AVAILABLE' || t.status === 'IN_USE')).length, bookings: db.bookings.filter((b) => b.zoneId === z.id && within(b.createdAt, r)).length })),
    methodology: 'Historical analysis of recorded bookings. "expectedPerWeek" is the historical average for that weekday/hour — an estimate, not a forecast model.',
  };
});
