import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ok, parseQuery, queryBool } from '../../lib/http.js';
import { badRequest } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import { previousRange, resolvePeriod, startOfLocalDay, type DateRange, type PeriodKey } from '../../lib/time.js';
import { requirePermission } from '../../middleware/auth.js';
import { computeCashFlow, computeOperatingResults, METRIC_DEFINITIONS } from '../../domain/finance.js';
import { NEEDS_PROVIDER_STATUSES, OPEN_STATUSES } from '../../domain/bookingStateMachine.js';
import { toCsv, paiseToRupees } from './csv.js';

export const reportsRouter = Router();

const periodQuery = z.object({
  period: z.enum(['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'this_fy', 'last_fy', 'custom']).default('this_month'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  excludeSample: queryBool.default(false),
  zoneId: z.string().optional(),
  serviceCategoryId: z.string().optional(),
});
type PeriodQuery = z.infer<typeof periodQuery>;

/** SQL conditions for zone / service / sample filters on a bookings alias (e.g. `b`). */
function bookingSql(f: Filters, alias = 'b') {
  const a = Prisma.raw(`"${alias}"`);
  const parts = [Prisma.sql`true`];
  if (f.zoneId) parts.push(Prisma.sql`${a}."zoneId" = ${f.zoneId}`);
  if (f.serviceCategoryId) parts.push(Prisma.sql`${a}."serviceCategoryId" = ${f.serviceCategoryId}`);
  if (f.excludeSample) parts.push(Prisma.sql`${a}."isSample" = false`);
  return Prisma.join(parts, ' AND ');
}

async function rangeFrom(q: PeriodQuery) {
  if (q.period === 'custom' && (!q.from || !q.to)) throw badRequest('A custom period needs both from and to dates (YYYY-MM-DD)');
  if (q.period === 'custom' && q.from! > q.to!) throw badRequest('The start date must be on or before the end date');
  const s = await getSettings();
  return { range: resolvePeriod(q.period as PeriodKey, { tz: s.locale.timezone, fyStartMonth: s.locale.fyStartMonth, from: q.from, to: q.to }), tz: s.locale.timezone };
}

interface Filters {
  excludeSample: boolean;
  zoneId?: string;
  serviceCategoryId?: string;
}

function bookingFilter(f: Filters): Prisma.BookingWhereInput {
  return { ...(f.excludeSample ? { isSample: false } : {}), ...(f.zoneId ? { zoneId: f.zoneId } : {}), ...(f.serviceCategoryId ? { serviceCategoryId: f.serviceCategoryId } : {}) };
}

function invoiceFilter(f: Filters): Prisma.InvoiceWhereInput {
  const bf = bookingFilter({ ...f, excludeSample: false });
  return { status: 'ISSUED', ...(f.excludeSample ? { isSample: false } : {}), ...(Object.keys(bf).length ? { booking: bf } : {}) };
}

/**
 * Single source for financial numbers. Every figure is a sum over concrete ledger rows in the
 * range; composition rules live in domain/finance.ts. Zone/category filters apply to
 * booking-linked revenue and job costs; company-wide costs (salaries, unlinked expenses) are
 * included only when no filter is applied.
 */
export async function financialSummary(range: DateRange, f: Filters) {
  const inRange = { gte: range.from, lt: range.to };
  const filtered = !!(f.zoneId || f.serviceCategoryId);
  const invWhere: Prisma.InvoiceWhereInput = { ...invoiceFilter(f), issuedAt: inRange };
  const payWhere = (method: 'ONLINE' | 'CASH' | 'BANK_TRANSFER'): Prisma.PaymentWhereInput => ({ method, status: 'SUCCEEDED', succeededAt: inRange, ...(f.excludeSample ? { isSandbox: false, invoice: { isSample: false } } : {}), ...(filtered ? { invoice: invoiceFilter(f) } : {}) });
  const bookingLinked = filtered ? { booking: bookingFilter(f) } : {};

  const [inv, cn, earnings, salaries, expenses, fees, writeOffs, online, cash, bank, refundsPaid, payoutsPaid, salariesPaid, expensesPaid, receivables] = await Promise.all([
    prisma.invoice.aggregate({ where: invWhere, _sum: { subtotal: true, discountTotal: true, taxableValue: true, taxTotal: true, passThroughTotal: true, total: true }, _count: true }),
    prisma.creditNote.aggregate({ where: { createdAt: inRange, invoice: invoiceFilter(f) }, _sum: { taxableAmount: true, taxAmount: true, amount: true } }),
    prisma.driverEarning.aggregate({ where: { earnedAt: inRange, status: { not: 'VOID' }, kind: { not: 'REIMBURSEMENT' }, ...bookingLinked }, _sum: { amount: true } }),
    filtered ? Promise.resolve({ _sum: { netAmount: 0 } }) : prisma.salaryRecord.aggregate({ where: { periodEnd: { gt: range.from, lte: range.to }, status: { not: 'CANCELLED' }, ...(f.excludeSample ? { isSample: false } : {}) }, _sum: { netAmount: true } }),
    prisma.expense.groupBy({ by: ['category'], where: { expenseDate: inRange, status: { in: ['APPROVED', 'PAID'] }, ...(f.excludeSample ? { isSample: false } : {}), ...(filtered ? { booking: bookingFilter(f) } : {}) }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'SUCCEEDED', succeededAt: inRange, ...(f.excludeSample ? { isSandbox: false } : {}), ...(filtered ? { invoice: invoiceFilter(f) } : {}) }, _sum: { gatewayFee: true } }),
    prisma.financialAdjustment.aggregate({ where: { type: 'WRITE_OFF', createdAt: inRange, ...(filtered ? { invoice: invoiceFilter(f) } : {}) }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: payWhere('ONLINE'), _sum: { amount: true } }),
    prisma.payment.aggregate({ where: payWhere('CASH'), _sum: { amount: true } }),
    prisma.payment.aggregate({ where: payWhere('BANK_TRANSFER'), _sum: { amount: true } }),
    prisma.refund.aggregate({ where: { status: 'SUCCEEDED', processedAt: inRange, ...(f.excludeSample ? { isSandbox: false } : {}), ...(filtered ? { invoice: invoiceFilter(f) } : {}) }, _sum: { amount: true } }),
    filtered ? Promise.resolve({ _sum: { netAmount: 0, reimbursementsAmount: 0 } }) : prisma.driverPayout.aggregate({ where: { status: 'PAID', paidAt: inRange }, _sum: { netAmount: true, reimbursementsAmount: true } }),
    filtered ? Promise.resolve({ _sum: { netAmount: 0 } }) : prisma.salaryRecord.aggregate({ where: { status: 'PAID', paidAt: inRange }, _sum: { netAmount: true } }),
    filtered ? Promise.resolve({ _sum: { amount: 0, taxAmount: 0 } }) : prisma.expense.aggregate({ where: { status: 'PAID', paidAt: inRange }, _sum: { amount: true, taxAmount: true } }),
    prisma.invoice.aggregate({ where: { ...invoiceFilter(f), issuedAt: { lt: range.to }, outstanding: { gt: 0 } }, _sum: { outstanding: true }, _count: true }),
  ]);

  const expensesByCategory = Object.fromEntries(expenses.map((e) => [e.category, e._sum.amount ?? 0]));
  const operating = computeOperatingResults(
    {
      grossServiceValue: inv._sum.subtotal ?? 0,
      discounts: inv._sum.discountTotal ?? 0,
      invoicedTaxableValue: inv._sum.taxableValue ?? 0,
      invoicedTax: inv._sum.taxTotal ?? 0,
      passThrough: inv._sum.passThroughTotal ?? 0,
      creditNoteTaxable: cn._sum.taxableAmount ?? 0,
      creditNoteTax: cn._sum.taxAmount ?? 0,
    },
    { driverEarnings: earnings._sum.amount ?? 0, salaries: salaries._sum.netAmount ?? 0, expensesByCategory, gatewayFees: fees._sum.gatewayFee ?? 0, writeOffs: writeOffs._sum.amount ?? 0 },
  );
  const cashFlow = computeCashFlow({
    onlineReceived: online._sum.amount ?? 0,
    cashReceived: cash._sum.amount ?? 0,
    bankReceived: bank._sum.amount ?? 0,
    refundsPaid: refundsPaid._sum.amount ?? 0,
    // Reimbursements inside payouts are counted once, as paid expenses.
    payoutsPaid: (payoutsPaid._sum.netAmount ?? 0) - (payoutsPaid._sum.reimbursementsAmount ?? 0),
    salariesPaid: salariesPaid._sum.netAmount ?? 0,
    expensesPaid: (expensesPaid._sum.amount ?? 0) + (expensesPaid._sum.taxAmount ?? 0),
  });

  const completed = await prisma.booking.count({ where: { ...bookingFilter(f), status: { in: ['COMPLETED', 'DISPUTED'] }, completedAt: inRange } });
  const serviceRevenue = await prisma.invoice.aggregate({ where: { ...invWhere, type: 'SERVICE' }, _sum: { taxableValue: true } });
  return {
    range,
    filters: f,
    invoicesIssued: inv._count,
    invoicedTotal: inv._sum.total ?? 0,
    operating,
    cashFlow,
    receivables: { amount: receivables._sum.outstanding ?? 0, invoices: receivables._count },
    completedBookings: completed,
    revenuePerCompletedBooking: completed ? Math.round((serviceRevenue._sum.taxableValue ?? 0) / completed) : null,
    scopeNote: filtered ? 'Filtered view: company-wide salaries, payouts and unlinked expenses are excluded; only booking-linked revenue and costs are shown.' : null,
  };
}

reportsRouter.get('/definitions', requirePermission('reports:read', 'finance:read'), (_req, res) => ok(res, METRIC_DEFINITIONS));

reportsRouter.get('/financial', requirePermission('finance:read'), async (req, res) => {
  const q = parseQuery(periodQuery.extend({ compare: queryBool.default(true) }), req);
  const { range } = await rangeFrom(q);
  const current = await financialSummary(range, q);
  const previous = q.compare ? await financialSummary(previousRange(range), q) : null;
  const sample = await prisma.invoice.count({ where: { isSample: true, issuedAt: { gte: range.from, lt: range.to } } });
  const sandbox = await prisma.payment.count({ where: { isSandbox: true, status: 'SUCCEEDED', succeededAt: { gte: range.from, lt: range.to } } });
  ok(res, { current, previous, definitions: METRIC_DEFINITIONS, dataQuality: { sampleInvoicesInRange: q.excludeSample ? 0 : sample, sandboxPaymentsInRange: q.excludeSample ? 0 : sandbox } });
});

/** Operational KPI cards. Each value is computed from database records with a stated definition. */
reportsRouter.get('/overview', requirePermission('reports:read', 'finance:read'), async (req, res) => {
  const q = parseQuery(periodQuery, req);
  const { range, tz } = await rangeFrom(q);
  const inRange = { gte: range.from, lt: range.to };
  const bf = bookingFilter(q);
  const today = { gte: startOfLocalDay(new Date(), tz) };
  const [totalCustomers, newCustomers, active, unassigned, availableDrivers, availableTrucks, completedToday, created, cancelled, rating] = await Promise.all([
    prisma.user.count({ where: { roles: { some: { role: { key: 'customer' } } }, deletedAt: null, ...(q.excludeSample ? { isSample: false } : {}) } }),
    prisma.user.count({ where: { roles: { some: { role: { key: 'customer' } } }, createdAt: inRange, ...(q.excludeSample ? { isSample: false } : {}) } }),
    prisma.booking.count({ where: { ...bf, status: { in: OPEN_STATUSES } } }),
    prisma.booking.count({ where: { ...bf, status: { in: NEEDS_PROVIDER_STATUSES } } }),
    prisma.driverAvailability.count({ where: { status: 'AVAILABLE', user: { status: 'ACTIVE', workerProfile: { verificationStatus: 'APPROVED' } }, ...(q.zoneId ? { zoneId: q.zoneId } : {}) } }),
    prisma.towTruck.count({ where: { status: 'AVAILABLE', ...(q.zoneId ? { zoneId: q.zoneId } : {}) } }),
    prisma.booking.count({ where: { ...bf, status: { in: ['COMPLETED', 'DISPUTED'] }, completedAt: today } }),
    prisma.booking.count({ where: { ...bf, createdAt: inRange, status: { notIn: ['REQUESTED', 'QUOTED'] } } }),
    prisma.bookingStatusHistory.count({ where: { toStatus: 'CANCELLED', createdAt: inRange, fromStatus: { notIn: ['REQUESTED', 'QUOTED'] }, booking: bf } }),
    prisma.rating.aggregate({ where: { createdAt: inRange, booking: bf }, _avg: { score: true }, _count: true }),
  ]);
  const times = await responseTimes(range, q);
  const fin = await financialSummary(range, q);
  const kpis = [
    { key: 'totalCustomers', label: 'Total customers', value: totalCustomers, unit: 'count', definition: 'Customer accounts not deleted.' },
    { key: 'newCustomers', label: 'New customers', value: newCustomers, unit: 'count', definition: 'Customer accounts created in the period.' },
    { key: 'activeBookings', label: 'Active bookings', value: active, unit: 'count', definition: 'Bookings not yet delivered, completed, cancelled or failed (live, right now).' },
    { key: 'unassignedBookings', label: 'Unassigned bookings', value: unassigned, unit: 'count', definition: 'Confirmed bookings without an accepted provider (live).' },
    { key: 'availableDrivers', label: 'Available drivers', value: availableDrivers, unit: 'count', definition: 'Verified, active workers currently marked Available (live).' },
    { key: 'availableTrucks', label: 'Available tow trucks', value: availableTrucks, unit: 'count', definition: 'Trucks with status Available (live).' },
    { key: 'completedToday', label: 'Jobs completed today', value: completedToday, unit: 'count', definition: 'Bookings completed since local midnight.' },
    { key: 'avgResponseMin', label: 'Avg response time', value: times.avgResponseMin, unit: 'minutes', definition: 'Average minutes from booking confirmation to a driver accepting, for bookings accepted in the period.' },
    { key: 'avgPickupMin', label: 'Avg time to arrival', value: times.avgArrivalMin, unit: 'minutes', definition: 'Average minutes from driver acceptance to arrival at pickup, for arrivals in the period.' },
    { key: 'cancellationRate', label: 'Cancellation rate', value: created ? Math.round((cancelled / created) * 1000) / 10 : null, unit: 'percent', definition: 'Bookings cancelled after confirmation ÷ bookings confirmed in the period.' },
    { key: 'grossServiceValue', label: 'Gross service revenue', value: fin.operating.grossServiceValue, unit: 'paise', definition: METRIC_DEFINITIONS.grossServiceValue },
    { key: 'discountsRefunds', label: 'Discounts & refunds', value: fin.operating.discounts + fin.cashFlow.refundsPaid, unit: 'paise', definition: 'Discounts on invoices issued plus refunds paid in the period.' },
    { key: 'payouts', label: 'Driver & partner payouts', value: fin.operating.driverEarnings, unit: 'paise', definition: METRIC_DEFINITIONS.driverEarnings },
    { key: 'operatingExpenses', label: 'Operating expenses', value: fin.operating.expensesTotal + fin.operating.salaries + fin.operating.gatewayFees, unit: 'paise', definition: 'Expenses + salary obligations + gateway fees in the period.' },
    { key: 'operatingProfit', label: 'Net operating profit', value: fin.operating.operatingProfit, unit: 'paise', definition: METRIC_DEFINITIONS.operatingProfit },
    { key: 'receivables', label: 'Outstanding customer payments', value: fin.receivables.amount, unit: 'paise', definition: METRIC_DEFINITIONS.receivables },
    { key: 'satisfaction', label: 'Customer satisfaction', value: rating._avg.score ? Math.round(rating._avg.score * 10) / 10 : null, unit: 'rating', definition: `Average rating (1–5) across ${rating._count} ratings in the period.` },
  ];
  ok(res, { range, kpis });
});

async function responseTimes(range: DateRange, f: Filters) {
  const zone = f.zoneId ? Prisma.sql`AND b."zoneId" = ${f.zoneId}` : Prisma.empty;
  const cat = f.serviceCategoryId ? Prisma.sql`AND b."serviceCategoryId" = ${f.serviceCategoryId}` : Prisma.empty;
  const sample = f.excludeSample ? Prisma.sql`AND b."isSample" = false` : Prisma.empty;
  const [r] = await prisma.$queryRaw<{ resp: number | null; arr: number | null }[]>(Prisma.sql`
    WITH c AS (SELECT "bookingId", MIN("createdAt") t FROM booking_status_history WHERE "toStatus" = 'CONFIRMED' GROUP BY 1),
         a AS (SELECT "bookingId", MIN("createdAt") t FROM booking_status_history WHERE "toStatus" = 'ACCEPTED' GROUP BY 1),
         r AS (SELECT "bookingId", MIN("createdAt") t FROM booking_status_history WHERE "toStatus" = 'ARRIVED' GROUP BY 1)
    SELECT
      AVG(EXTRACT(EPOCH FROM (a.t - c.t)) / 60) FILTER (WHERE a.t >= ${range.from} AND a.t < ${range.to}) AS resp,
      AVG(EXTRACT(EPOCH FROM (r.t - a.t)) / 60) FILTER (WHERE r.t >= ${range.from} AND r.t < ${range.to}) AS arr
    FROM bookings b JOIN c ON c."bookingId" = b.id LEFT JOIN a ON a."bookingId" = b.id LEFT JOIN r ON r."bookingId" = b.id
    WHERE true ${zone} ${cat} ${sample}`);
  return { avgResponseMin: r?.resp != null ? Math.round(Number(r.resp) * 10) / 10 : null, avgArrivalMin: r?.arr != null ? Math.round(Number(r.arr) * 10) / 10 : null };
}

/** Revenue / cost / profit series bucketed by day, week, month or year in the business timezone. */
reportsRouter.get('/trends', requirePermission('finance:read'), async (req, res) => {
  const q = parseQuery(periodQuery.extend({ granularity: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('month') }), req);
  const { range, tz } = await rangeFrom(q);
  const g = Prisma.raw(`'${q.granularity}'`);
  const sample = q.excludeSample ? Prisma.sql`AND "isSample" = false` : Prisma.empty;
  // Bucket label computed in SQL as text (YYYY-MM-DD in the business timezone) — no host-timezone conversion.
  const bucket = (col: string) => Prisma.raw(`to_char(date_trunc('${q.granularity}', "${col}" AT TIME ZONE '${tz.replace(/'/g, '')}'), 'YYYY-MM-DD')`);
  void g;
  const [revenue, credit, earnings, salaries, expenses, fees, bookings] = await Promise.all([
    prisma.$queryRaw<{ b: string; v: bigint }[]>(Prisma.sql`SELECT ${bucket('issuedAt')} b, SUM("taxableValue") v FROM invoices WHERE status = 'ISSUED' AND "issuedAt" >= ${range.from} AND "issuedAt" < ${range.to} ${sample} GROUP BY 1`),
    prisma.$queryRaw<{ b: string; v: bigint }[]>(Prisma.sql`SELECT ${bucket('createdAt')} b, SUM("taxableAmount") v FROM credit_notes WHERE "createdAt" >= ${range.from} AND "createdAt" < ${range.to} GROUP BY 1`),
    prisma.$queryRaw<{ b: string; v: bigint }[]>(Prisma.sql`SELECT ${bucket('earnedAt')} b, SUM(amount) v FROM driver_earnings WHERE status <> 'VOID' AND kind <> 'REIMBURSEMENT' AND "earnedAt" >= ${range.from} AND "earnedAt" < ${range.to} GROUP BY 1`),
    prisma.$queryRaw<{ b: string; v: bigint }[]>(Prisma.sql`SELECT ${bucket('periodEnd')} b, SUM("netAmount") v FROM salary_records WHERE status <> 'CANCELLED' AND "periodEnd" > ${range.from} AND "periodEnd" <= ${range.to} ${sample} GROUP BY 1`),
    prisma.$queryRaw<{ b: string; v: bigint }[]>(Prisma.sql`SELECT ${bucket('expenseDate')} b, SUM(amount) v FROM expenses WHERE status IN ('APPROVED','PAID') AND "expenseDate" >= ${range.from} AND "expenseDate" < ${range.to} ${sample} GROUP BY 1`),
    prisma.$queryRaw<{ b: string; v: bigint }[]>(Prisma.sql`SELECT ${bucket('succeededAt')} b, SUM("gatewayFee") v FROM payments WHERE status = 'SUCCEEDED' AND "succeededAt" >= ${range.from} AND "succeededAt" < ${range.to} GROUP BY 1`),
    prisma.$queryRaw<{ b: string; v: bigint }[]>(Prisma.sql`SELECT ${bucket('completedAt')} b, COUNT(*) v FROM bookings WHERE status IN ('COMPLETED','DISPUTED') AND "completedAt" >= ${range.from} AND "completedAt" < ${range.to} ${sample} GROUP BY 1`),
  ]);
  const series = new Map<string, { bucket: string; revenue: number; costs: number; profit: number; bookings: number }>();
  const key = (d: string) => d;
  const add = (rows: { b: string; v: bigint }[], field: 'revenue' | 'costs' | 'bookings', sign = 1) => {
    for (const r of rows) {
      const k = key(r.b);
      const row = series.get(k) ?? { bucket: k, revenue: 0, costs: 0, profit: 0, bookings: 0 };
      row[field] += Number(r.v) * sign;
      series.set(k, row);
    }
  };
  add(revenue, 'revenue');
  add(credit, 'revenue', -1);
  add(earnings, 'costs');
  add(salaries, 'costs');
  add(expenses, 'costs');
  add(fees, 'costs');
  add(bookings, 'bookings');
  const out = [...series.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)).map((r) => ({ ...r, profit: r.revenue - r.costs }));
  ok(res, { range, granularity: q.granularity, timezone: tz, series: out });
});

/** Contribution margin per service category. */
reportsRouter.get('/profitability', requirePermission('finance:read'), async (req, res) => {
  const q = parseQuery(periodQuery, req);
  const { range } = await rangeFrom(q);
  const sample = q.excludeSample ? Prisma.sql`AND i."isSample" = false` : Prisma.empty;
  const zone = q.zoneId ? Prisma.sql`AND b."zoneId" = ${q.zoneId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ category: string; jobs: bigint; revenue: bigint; earnings: bigint; expenses: bigint; fees: bigint }[]>(Prisma.sql`
    SELECT sc.name AS category,
      COUNT(DISTINCT i.id) AS jobs,
      COALESCE(SUM(i."taxableValue"), 0) AS revenue,
      COALESCE(SUM((SELECT SUM(e.amount) FROM driver_earnings e WHERE e."bookingId" = b.id AND e.kind <> 'REIMBURSEMENT' AND e.status <> 'VOID')), 0) AS earnings,
      COALESCE(SUM((SELECT SUM(x.amount) FROM expenses x WHERE x."bookingId" = b.id AND x.status IN ('APPROVED','PAID'))), 0) AS expenses,
      COALESCE(SUM((SELECT SUM(p."gatewayFee") FROM payments p WHERE p."invoiceId" = i.id AND p.status = 'SUCCEEDED')), 0) AS fees
    FROM invoices i JOIN bookings b ON b.id = i."bookingId" JOIN service_categories sc ON sc.id = b."serviceCategoryId"
    WHERE i.type = 'SERVICE' AND i.status = 'ISSUED' AND i."issuedAt" >= ${range.from} AND i."issuedAt" < ${range.to} ${sample} AND ${bookingSql({ ...q, excludeSample: false })}
    GROUP BY sc.name ORDER BY revenue DESC`);
  ok(
    res,
    rows.map((r) => {
      const revenue = Number(r.revenue);
      const direct = Number(r.earnings) + Number(r.expenses) + Number(r.fees);
      return { category: r.category, jobs: Number(r.jobs), revenue, directCosts: direct, contributionMargin: revenue - direct, marginPct: revenue ? Math.round(((revenue - direct) / revenue) * 1000) / 10 : null, revenuePerJob: Number(r.jobs) ? Math.round(revenue / Number(r.jobs)) : null };
    }),
  );
});

reportsRouter.get('/zones', requirePermission('reports:read'), async (req, res) => {
  const q = parseQuery(periodQuery, req);
  const { range } = await rangeFrom(q);
  const sample = q.excludeSample ? Prisma.sql`AND b."isSample" = false` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ zone: string; bookings: bigint; completed: bigint; cancelled: bigint; failed: bigint; revenue: bigint }[]>(Prisma.sql`
    SELECT COALESCE(z.name, 'Unzoned') zone, COUNT(*) bookings,
      COUNT(*) FILTER (WHERE b.status IN ('COMPLETED','DISPUTED')) completed,
      COUNT(*) FILTER (WHERE b.status = 'CANCELLED') cancelled,
      COUNT(*) FILTER (WHERE b.status = 'FAILED') failed,
      COALESCE(SUM(i."taxableValue") FILTER (WHERE i.status = 'ISSUED'), 0) revenue
    FROM bookings b LEFT JOIN service_zones z ON z.id = b."zoneId" LEFT JOIN invoices i ON i."bookingId" = b.id
    WHERE b."createdAt" >= ${range.from} AND b."createdAt" < ${range.to} AND ${bookingSql(q)}
    GROUP BY 1 ORDER BY bookings DESC`);
  ok(res, rows.map((r) => ({ zone: r.zone, bookings: Number(r.bookings), completed: Number(r.completed), cancelled: Number(r.cancelled), failed: Number(r.failed), revenue: Number(r.revenue) })));
});

reportsRouter.get('/drivers', requirePermission('reports:read'), async (req, res) => {
  const q = parseQuery(periodQuery, req);
  const { range } = await rangeFrom(q);
  const rows = await prisma.$queryRaw<{ id: string; name: string; offered: bigint; completed: bigint; declined: bigint; earnings: bigint; rating: number | null }[]>(Prisma.sql`
    SELECT u.id, u."fullName" name,
      COUNT(a.*) offered,
      COUNT(a.*) FILTER (WHERE a.status = 'COMPLETED') completed,
      COUNT(a.*) FILTER (WHERE a.status IN ('REJECTED','TIMED_OUT')) declined,
      COALESCE((SELECT SUM(e.amount) FROM driver_earnings e WHERE e."userId" = u.id AND e.kind <> 'REIMBURSEMENT' AND e.status <> 'VOID' AND e."earnedAt" >= ${range.from} AND e."earnedAt" < ${range.to} AND (e."bookingId" IS NULL OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = e."bookingId" AND ${bookingSql(q)}))), 0) earnings,
      (SELECT AVG(score) FROM ratings r WHERE r."rateeUserId" = u.id AND r."createdAt" >= ${range.from} AND r."createdAt" < ${range.to}) rating
    FROM users u JOIN driver_profiles d ON d."userId" = u.id
    LEFT JOIN booking_assignments a ON a."driverUserId" = u.id AND a."offeredAt" >= ${range.from} AND a."offeredAt" < ${range.to} AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = a."bookingId" AND ${bookingSql(q)})
    WHERE (${!q.excludeSample} OR u."isSample" = false)
    GROUP BY u.id ORDER BY completed DESC`);
  ok(res, rows.map((r) => ({ id: r.id, name: r.name, offered: Number(r.offered), completed: Number(r.completed), declined: Number(r.declined), earnings: Number(r.earnings), rating: r.rating != null ? Math.round(Number(r.rating) * 10) / 10 : null })));
});

reportsRouter.get('/trucks', requirePermission('reports:read', 'fleet:read'), async (req, res) => {
  const q = parseQuery(periodQuery, req);
  const { range } = await rangeFrom(q);
  // Utilisation is measured against elapsed time only (a period in progress has no future capacity yet).
  const hours = Math.max(0, Math.min(range.to.getTime(), Date.now()) - range.from.getTime()) / 3600_000;
  const rows = await prisma.$queryRaw<{ id: string; reg: string; type: string; jobs: bigint; busy_hours: number | null; maint: bigint; fuel: bigint; repairs: bigint }[]>(Prisma.sql`
    SELECT t.id, t."registrationNumber" reg, t."truckType"::text type,
      COUNT(a.*) FILTER (WHERE a.status = 'COMPLETED') jobs,
      SUM(EXTRACT(EPOCH FROM (COALESCE(b."completedAt", now()) - a."respondedAt")) / 3600) FILTER (WHERE a.status IN ('COMPLETED','ACCEPTED')) busy_hours,
      (SELECT COUNT(*) FROM maintenance_records m WHERE m."truckId" = t.id AND m."performedAt" >= ${range.from} AND m."performedAt" < ${range.to}) maint,
      COALESCE((SELECT SUM(x.amount) FROM expenses x WHERE x."truckId" = t.id AND x.category = 'FUEL' AND x.status IN ('APPROVED','PAID') AND x."expenseDate" >= ${range.from} AND x."expenseDate" < ${range.to}), 0) fuel,
      COALESCE((SELECT SUM(x.amount) FROM expenses x WHERE x."truckId" = t.id AND x.category IN ('MAINTENANCE','REPAIR') AND x.status IN ('APPROVED','PAID') AND x."expenseDate" >= ${range.from} AND x."expenseDate" < ${range.to}), 0) repairs
    FROM tow_trucks t
    LEFT JOIN booking_assignments a ON a."truckId" = t.id AND a."offeredAt" >= ${range.from} AND a."offeredAt" < ${range.to} AND EXISTS (SELECT 1 FROM bookings b2 WHERE b2.id = a."bookingId" AND ${bookingSql(q, 'b2')})
    LEFT JOIN bookings b ON b.id = a."bookingId"
    WHERE t.status <> 'RETIRED' AND (${!q.excludeSample} OR t."isSample" = false) AND (${!q.zoneId} OR t."zoneId" = ${q.zoneId ?? ''})
    GROUP BY t.id ORDER BY jobs DESC`);
  ok(res, { periodHours: Math.round(hours), trucks: rows.map((r) => ({ id: r.id, registrationNumber: r.reg, truckType: r.type, jobs: Number(r.jobs), busyHours: Math.round(Number(r.busy_hours ?? 0) * 10) / 10, utilisationPct: hours ? Math.round((Number(r.busy_hours ?? 0) / hours) * 1000) / 10 : null, maintenanceEvents: Number(r.maint), fuelCost: Number(r.fuel), repairCost: Number(r.repairs) })) });
});

reportsRouter.get('/customers', requirePermission('reports:read'), async (req, res) => {
  const q = parseQuery(periodQuery, req);
  const { range } = await rangeFrom(q);
  const [r] = await prisma.$queryRaw<{ customers: bigint; repeat: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) customers, COUNT(*) FILTER (WHERE n > 1) repeat FROM (
      SELECT b."customerUserId", COUNT(*) n FROM bookings b WHERE b.status IN ('COMPLETED','DISPUTED') AND b."completedAt" >= ${range.from} AND b."completedAt" < ${range.to} AND ${bookingSql(q)} GROUP BY 1) t`);
  const customers = Number(r?.customers ?? 0);
  ok(res, { customersServed: customers, repeatCustomers: Number(r?.repeat ?? 0), repeatRatePct: customers ? Math.round((Number(r!.repeat) / customers) * 1000) / 10 : null, definition: 'Share of customers served in the period who completed more than one booking in the period.' });
});

reportsRouter.get('/cancellations', requirePermission('reports:read'), async (req, res) => {
  const q = parseQuery(periodQuery, req);
  const { range } = await rangeFrom(q);
  const rows = await prisma.bookingStatusHistory.findMany({ where: { toStatus: 'CANCELLED', createdAt: { gte: range.from, lt: range.to }, booking: bookingFilter(q) }, select: { fromStatus: true, actorRole: true, reason: true, booking: { select: { cancellationFee: true } } } });
  const by = <K extends string>(f: (r: (typeof rows)[number]) => K) => Object.entries(rows.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {})).map(([k, v]) => ({ key: k, count: v })).sort((a, b) => b.count - a.count);
  ok(res, {
    total: rows.length,
    feesCharged: rows.reduce((a, r) => a + (r.booking.cancellationFee ?? 0), 0),
    byStage: by((r) => r.fromStatus ?? 'UNKNOWN'),
    byActor: by((r) => r.actorRole),
    topReasons: by((r) => (r.reason ?? 'No reason').slice(0, 80)).slice(0, 10),
  });
});

/**
 * Demand & coverage insights from real historical bookings. Hotspots are ~2 km grid cells.
 * The "expected" figures are a simple historical average per weekday/hour — labelled as an estimate.
 */
reportsRouter.get('/demand', requirePermission('reports:read'), async (req, res) => {
  const q = parseQuery(periodQuery, req);
  const { range, tz } = await rangeFrom(q);
  const sample = q.excludeSample ? Prisma.sql`AND b."isSample" = false` : Prisma.empty;
  const tzSql = Prisma.raw(`'${tz.replace(/'/g, '')}'`);
  const [cells, hours, categories, classes, zoneCoverage] = await Promise.all([
    prisma.$queryRaw<{ lat: number; lng: number; n: bigint; unfulfilled: bigint; avg_resp: number | null }[]>(Prisma.sql`
      WITH acc AS (SELECT "bookingId", MIN("createdAt") t FROM booking_status_history WHERE "toStatus" = 'ACCEPTED' GROUP BY 1),
           con AS (SELECT "bookingId", MIN("createdAt") t FROM booking_status_history WHERE "toStatus" = 'CONFIRMED' GROUP BY 1)
      SELECT ROUND((l.lat / 0.02)::numeric) * 0.02 lat, ROUND((l.lng / 0.02)::numeric) * 0.02 lng, COUNT(*) n,
        COUNT(*) FILTER (WHERE b.status IN ('FAILED') OR (b.status = 'CANCELLED' AND acc.t IS NULL AND con.t IS NOT NULL)) unfulfilled,
        AVG(EXTRACT(EPOCH FROM (acc.t - con.t)) / 60) avg_resp
      FROM bookings b JOIN booking_locations l ON l."bookingId" = b.id AND l.kind = 'PICKUP'
      LEFT JOIN acc ON acc."bookingId" = b.id LEFT JOIN con ON con."bookingId" = b.id
      WHERE b."createdAt" >= ${range.from} AND b."createdAt" < ${range.to} AND ${bookingSql(q)}
      GROUP BY 1, 2 ORDER BY n DESC LIMIT 200`),
    prisma.$queryRaw<{ dow: number; hour: number; n: bigint }[]>(Prisma.sql`
      SELECT EXTRACT(DOW FROM b."createdAt" AT TIME ZONE ${tzSql})::int AS dow, EXTRACT(HOUR FROM b."createdAt" AT TIME ZONE ${tzSql})::int AS "hour", COUNT(*) AS n
      FROM bookings b WHERE b."createdAt" >= ${range.from} AND b."createdAt" < ${range.to} AND ${bookingSql(q)} GROUP BY 1, 2`),
    prisma.$queryRaw<{ name: string; n: bigint }[]>(Prisma.sql`SELECT sc.name, COUNT(*) n FROM bookings b JOIN service_categories sc ON sc.id = b."serviceCategoryId" WHERE b."createdAt" >= ${range.from} AND b."createdAt" < ${range.to} AND ${bookingSql(q)} GROUP BY 1 ORDER BY n DESC`),
    prisma.$queryRaw<{ cls: string; n: bigint }[]>(Prisma.sql`SELECT v."vehicleClass"::text cls, COUNT(*) n FROM bookings b JOIN vehicles v ON v.id = b."vehicleId" WHERE b."createdAt" >= ${range.from} AND b."createdAt" < ${range.to} AND ${bookingSql(q)} GROUP BY 1 ORDER BY n DESC`),
    prisma.serviceZone.findMany({ where: { active: true }, select: { id: true, name: true, _count: { select: { drivers: { where: { status: 'AVAILABLE' } } as never, trucks: { where: { status: { in: ['AVAILABLE', 'IN_USE'] } } } as never, bookings: { where: { createdAt: { gte: range.from, lt: range.to } } } as never } } } }),
  ]);
  const weeks = Math.max(1, (range.to.getTime() - range.from.getTime()) / (7 * 86_400_000));
  const cellRows = cells.map((c) => ({ lat: Number(c.lat), lng: Number(c.lng), bookings: Number(c.n), unfulfilled: Number(c.unfulfilled), avgResponseMin: c.avg_resp != null ? Math.round(Number(c.avg_resp) * 10) / 10 : null }));
  const medianResp = [...cellRows.map((c) => c.avgResponseMin ?? 0)].sort((a, b) => a - b)[Math.floor(cellRows.length / 2)] ?? 0;
  ok(res, {
    range,
    hotspots: cellRows.map((c) => ({ ...c, insufficientCoverage: c.unfulfilled > 0 || (c.avgResponseMin != null && c.avgResponseMin > medianResp * 1.5 && c.bookings >= 3) })),
    byHour: hours.map((h) => ({ dow: h.dow, hour: h.hour, bookings: Number(h.n), expectedPerWeek: Math.round((Number(h.n) / weeks) * 10) / 10 })),
    byCategory: categories.map((c) => ({ category: c.name, bookings: Number(c.n) })),
    byVehicleClass: classes.map((c) => ({ vehicleClass: c.cls, bookings: Number(c.n) })),
    zones: zoneCoverage.map((z) => ({ id: z.id, name: z.name, ...(z._count as unknown as { drivers: number; trucks: number; bookings: number }) })),
    methodology: 'Historical analysis of recorded bookings. "expectedPerWeek" is the historical average for that weekday/hour — an estimate, not a forecast model.',
  });
});

// ─── Exports ─────────────────────────────────────────────────────────

reportsRouter.get('/financial.csv', requirePermission('finance:read'), async (req, res) => {
  const q = parseQuery(periodQuery, req);
  const { range } = await rangeFrom(q);
  const s = await financialSummary(range, q);
  const o = s.operating;
  const rows = [
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
  ] as [string, number][];
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', `attachment; filename="financial-${q.period}.csv"`);
  res.send(toCsv(rows.map(([metric, v]) => ({ metric, amountInr: paiseToRupees(v), from: range.from.toISOString(), to: range.to.toISOString() }))));
});

reportsRouter.get('/financial.pdf', requirePermission('finance:read'), async (req, res) => {
  const q = parseQuery(periodQuery, req);
  const { range, tz } = await rangeFrom(q);
  const s = await financialSummary(range, q);
  const settings = await getSettings();
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="financial-${q.period}.pdf"`);
  doc.pipe(res);
  const rs = (p: number) => `Rs. ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const d = (x: Date) => x.toLocaleDateString('en-IN', { timeZone: tz });
  doc.fontSize(18).text(`${settings.business.brandName} — Financial summary`);
  doc.fontSize(10).fillColor('#475569').text(`${d(range.from)} to ${d(new Date(range.to.getTime() - 1))} (${tz})${q.excludeSample ? '' : ' · includes any sample/sandbox data'}`);
  doc.moveDown().fillColor('#0f172a');
  const line = (k: string, v: number, bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(`${k}`, { continued: true }).text(rs(v), { align: 'right' });
  doc.fontSize(12).text('Operating results (accrual)').fontSize(10);
  line('Gross service value', s.operating.grossServiceValue);
  line('Less discounts', -s.operating.discounts);
  line('Less credit notes', -s.operating.creditNotes);
  line('Recognized revenue', s.operating.recognizedRevenue, true);
  line('Driver & partner earnings', -s.operating.driverEarnings);
  line('Salaries & incentives', -s.operating.salaries);
  for (const [k, v] of Object.entries(s.operating.expensesByCategory)) line(`Expense: ${k.toLowerCase()}`, -v);
  line('Gateway fees', -s.operating.gatewayFees);
  line('Write-offs', -s.operating.writeOffs);
  line('Operating profit', s.operating.operatingProfit, true);
  doc.moveDown().fontSize(12).text('Cash flow').fontSize(10);
  line('Cash received', s.cashFlow.cashIn);
  line('Cash paid out', -s.cashFlow.cashOut);
  line('Net cash flow', s.cashFlow.netCashFlow, true);
  doc.moveDown().fontSize(12).text('Balances').fontSize(10);
  line('GST collected (payable)', s.operating.taxesCollected);
  line('Receivables', s.receivables.amount);
  doc.moveDown().fontSize(8).fillColor('#64748b').text('Definitions: ' + Object.entries(METRIC_DEFINITIONS).map(([k, v]) => `${k}: ${v}`).join(' '));
  doc.end();
});
