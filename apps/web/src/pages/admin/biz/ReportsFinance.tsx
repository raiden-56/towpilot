/** Reports → Profit & loss, Trends, Profitability (finance:read). */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Grid, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/api/client';
import { EmptyState, ErrorState, KpiCard, LoadingBlock, SectionCard } from '@/components/common';
import { date, humanize, inr, inrCompact } from '@/lib/format';
import { fmtPct, InfoTip, num, pctChange, SimpleTable } from './shared';
import { axisTick, ChartTooltip, FilterScopeNote, useChartColors, type ReportQuery } from './reportsShared';

interface Operating {
  grossServiceValue: number;
  discounts: number;
  creditNotes: number;
  recognizedRevenue: number;
  taxesCollected: number;
  passThrough: number;
  driverEarnings: number;
  salaries: number;
  expensesByCategory: Record<string, number>;
  expensesTotal: number;
  gatewayFees: number;
  writeOffs: number;
  totalCosts: number;
  operatingProfit: number;
  profitMarginPct: number | null;
}
interface CashFlow {
  onlineReceived: number;
  cashReceived: number;
  bankReceived: number;
  refundsPaid: number;
  payoutsPaid: number;
  salariesPaid: number;
  expensesPaid: number;
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
}
interface Summary {
  range: { from: string; to: string };
  invoicesIssued: number;
  invoicedTotal: number;
  operating: Operating;
  cashFlow: CashFlow;
  receivables: { amount: number; invoices: number };
  completedBookings: number;
  revenuePerCompletedBooking: number | null;
  scopeNote: string | null;
}
interface Financial {
  current: Summary;
  previous: Summary | null;
  definitions: Record<string, string>;
  dataQuality: { sampleInvoicesInRange: number; sandboxPaymentsInRange: number };
}

export const rangeLabel = (r: { from: string; to: string }) => `${date(r.from)} – ${date(new Date(new Date(r.to).getTime() - 1))}`;

function Change({ cur, prev, goodWhenUp = true }: { cur: number | null; prev: number | null | undefined; goodWhenUp?: boolean }) {
  const c = pctChange(cur, prev);
  if (c == null) return <Typography variant="body2" color="text.disabled" component="span">—</Typography>;
  const flat = Math.abs(c) < 0.05;
  const good = (c >= 0) === goodWhenUp;
  return (
    <Typography variant="body2" component="span" sx={{ ...num, color: flat ? 'text.secondary' : good ? 'success.main' : 'error.main', fontWeight: 600 }}>
      {flat ? '0.0%' : `${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(1)}%`}
    </Typography>
  );
}

type Row = { label: ReactNode; def?: string; cur: number | null; prev?: number | null; kind?: 'total' | 'sub' | 'memo' | 'pct'; goodWhenUp?: boolean; sign?: -1 };

function StatementTable({ rows, compare }: { rows: (Row | { section: string })[]; compare: boolean }) {
  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: compare ? 560 : 360 }}>
        <TableHead>
          <TableRow>
            <TableCell>Metric</TableCell>
            <TableCell align="right">This period</TableCell>
            {compare && <TableCell align="right">Previous</TableCell>}
            {compare && <TableCell align="right">Change</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) =>
            'section' in r ? (
              <TableRow key={`s${i}`}>
                <TableCell colSpan={compare ? 4 : 2} sx={{ pt: 2, pb: 0.5, fontSize: 12, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: 0 }}>
                  {r.section}
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={i} sx={r.kind === 'total' ? { '& td': { fontWeight: 700, borderTop: 2, borderTopColor: 'divider' } } : undefined}>
                <TableCell sx={{ pl: r.kind === 'sub' ? 4 : undefined, color: r.kind === 'memo' || r.kind === 'sub' ? 'text.secondary' : undefined }}>
                  {r.label}
                  {r.def && <InfoTip title={r.def} />}
                </TableCell>
                <TableCell align="right" sx={num}>
                  {r.cur == null ? '—' : r.kind === 'pct' ? fmtPct(r.cur, 2) : r.sign === -1 && r.cur ? `−${inr(r.cur)}` : inr(r.cur)}
                </TableCell>
                {compare && (
                  <TableCell align="right" sx={{ ...num, color: 'text.secondary' }}>
                    {r.prev == null ? '—' : r.kind === 'pct' ? fmtPct(r.prev, 2) : r.sign === -1 && r.prev ? `−${inr(r.prev)}` : inr(r.prev)}
                  </TableCell>
                )}
                {compare && (
                  <TableCell align="right">
                    {r.kind === 'pct' ? (
                      r.cur != null && r.prev != null ? <Typography variant="body2" component="span" sx={{ ...num, color: r.cur >= r.prev ? 'success.main' : 'error.main' }}>{`${r.cur - r.prev >= 0 ? '+' : ''}${(r.cur - r.prev).toFixed(1)} pts`}</Typography> : '—'
                    ) : (
                      <Change cur={r.cur} prev={r.prev} goodWhenUp={r.goodWhenUp} />
                    )}
                  </TableCell>
                )}
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function ProfitLossTab({ q, toastError }: { q: ReportQuery; toastError: (e: unknown) => void }) {
  const fin = useQuery({ queryKey: ['admin', 'reports', 'financial', q], queryFn: () => api.get<Financial>('/admin/reports/financial', q) });
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null);
  const exp = async (kind: 'csv' | 'pdf') => {
    setBusy(kind);
    try {
      await api.download(`/admin/reports/financial.${kind}`, `financial-${q.period}${q.from ? `-${q.from}_${q.to}` : ''}.${kind}`, q);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  if (fin.isLoading) return <LoadingBlock rows={5} />;
  if (fin.error || !fin.data) return <ErrorState error={fin.error} onRetry={() => void fin.refetch()} />;
  const { current: c, previous: p, definitions: d, dataQuality: dq } = fin.data;
  const o = c.operating;
  const po = p?.operating;
  const compare = !!p;
  const categories = [...new Set([...Object.keys(o.expensesByCategory), ...Object.keys(po?.expensesByCategory ?? {})])].sort();

  const operatingRows: (Row | { section: string })[] = [
    { section: 'Revenue (accrual)' },
    { label: 'Gross service value', def: d.grossServiceValue, cur: o.grossServiceValue, prev: po?.grossServiceValue },
    { label: 'Less: discounts', def: d.discounts, cur: o.discounts, prev: po?.discounts, sign: -1, kind: 'sub', goodWhenUp: false },
    { label: 'Less: credit notes (taxable value)', def: 'Taxable value of credit notes issued in the period (refunds and corrections).', cur: o.creditNotes, prev: po?.creditNotes, sign: -1, kind: 'sub', goodWhenUp: false },
    { label: 'Recognised revenue', def: d.recognizedRevenue, cur: o.recognizedRevenue, prev: po?.recognizedRevenue, kind: 'total' },
    { section: 'Operating costs (accrual)' },
    { label: 'Driver & partner earnings', def: d.driverEarnings, cur: o.driverEarnings, prev: po?.driverEarnings, goodWhenUp: false },
    { label: 'Salaries & incentives (obligation)', def: d.salaries, cur: o.salaries, prev: po?.salaries, goodWhenUp: false },
    { label: 'Operating expenses', def: d.expensesTotal, cur: o.expensesTotal, prev: po?.expensesTotal, goodWhenUp: false },
    ...categories.map((k) => ({ label: humanize(k), cur: o.expensesByCategory[k] ?? 0, prev: po ? (po.expensesByCategory[k] ?? 0) : null, kind: 'sub' as const, goodWhenUp: false })),
    { label: 'Payment gateway fees', def: d.gatewayFees, cur: o.gatewayFees, prev: po?.gatewayFees, goodWhenUp: false },
    { label: 'Bad-debt write-offs', def: d.writeOffs, cur: o.writeOffs, prev: po?.writeOffs, goodWhenUp: false },
    { label: 'Total operating costs', cur: o.totalCosts, prev: po?.totalCosts, kind: 'total', goodWhenUp: false },
    { section: 'Result' },
    { label: 'Operating profit', def: d.operatingProfit, cur: o.operatingProfit, prev: po?.operatingProfit, kind: 'total' },
    { label: 'Operating margin', def: d.profitMarginPct, cur: o.profitMarginPct, prev: po?.profitMarginPct, kind: 'pct' },
    { section: 'Collected for others — excluded from revenue' },
    { label: 'GST collected (liability, payable to government)', def: d.taxesCollected, cur: o.taxesCollected, prev: po?.taxesCollected, kind: 'memo' },
    { label: 'Pass-through tolls & parking', def: d.passThrough, cur: o.passThrough, prev: po?.passThrough, kind: 'memo' },
  ];
  const cf = c.cashFlow;
  const pcf = p?.cashFlow;
  const cashRows: (Row | { section: string })[] = [
    { section: 'Cash in' },
    { label: 'Online payments (gateway-confirmed)', def: d.onlineReceived, cur: cf.onlineReceived, prev: pcf?.onlineReceived, kind: 'sub' },
    { label: 'Cash collections (finance-confirmed)', def: d.cashReceived, cur: cf.cashReceived, prev: pcf?.cashReceived, kind: 'sub' },
    { label: 'Bank transfers', def: d.bankReceived, cur: cf.bankReceived, prev: pcf?.bankReceived, kind: 'sub' },
    { label: 'Total cash in', cur: cf.cashIn, prev: pcf?.cashIn, kind: 'total' },
    { section: 'Cash out' },
    { label: 'Refunds paid', cur: cf.refundsPaid, prev: pcf?.refundsPaid, kind: 'sub', goodWhenUp: false },
    { label: 'Driver payouts paid (excl. reimbursements)', cur: cf.payoutsPaid, prev: pcf?.payoutsPaid, kind: 'sub', goodWhenUp: false },
    { label: 'Salaries paid', cur: cf.salariesPaid, prev: pcf?.salariesPaid, kind: 'sub', goodWhenUp: false },
    { label: 'Expenses paid (incl. GST, reimbursements)', cur: cf.expensesPaid, prev: pcf?.expensesPaid, kind: 'sub', goodWhenUp: false },
    { label: 'Total cash out', cur: cf.cashOut, prev: pcf?.cashOut, kind: 'total', goodWhenUp: false },
    { section: 'Net' },
    { label: 'Net cash flow', def: d.netCashFlow, cur: cf.netCashFlow, prev: pcf?.netCashFlow, kind: 'total' },
  ];
  const sampleIncluded = dq.sampleInvoicesInRange > 0 || dq.sandboxPaymentsInRange > 0;

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ sm: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {rangeLabel(c.range)}
          {p && <> · compared with {rangeLabel(p.range)}</>}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} disabled={!!busy} onClick={() => void exp('csv')}>{busy === 'csv' ? 'Exporting…' : 'CSV'}</Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} disabled={!!busy} onClick={() => void exp('pdf')}>{busy === 'pdf' ? 'Exporting…' : 'PDF'}</Button>
        </Stack>
      </Stack>
      {sampleIncluded && (
        <Alert severity="warning">
          These figures include sample/sandbox data: {dq.sampleInvoicesInRange} sample invoice(s) and {dq.sandboxPaymentsInRange} sandbox payment(s) in this period. Turn on “Exclude sample/sandbox data” for real-business figures.
        </Alert>
      )}
      {c.scopeNote && <Alert severity="info">{c.scopeNote}</Alert>}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 2 }}><KpiCard label="Recognised revenue" value={inrCompact(o.recognizedRevenue)} definition={d.recognizedRevenue} trend={{ pct: pctChange(o.recognizedRevenue, po?.recognizedRevenue) }} hint="accrual" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 2 }}><KpiCard label="Operating profit" value={inrCompact(o.operatingProfit)} definition={d.operatingProfit} trend={{ pct: pctChange(o.operatingProfit, po?.operatingProfit) }} hint={o.profitMarginPct != null ? `${o.profitMarginPct.toFixed(1)}% margin` : 'accrual'} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 2 }}><KpiCard label="Net cash flow" value={inrCompact(cf.netCashFlow)} definition={d.netCashFlow} trend={{ pct: pctChange(cf.netCashFlow, pcf?.netCashFlow) }} hint="cash basis" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 2 }}><KpiCard label="Receivables" value={inrCompact(c.receivables.amount)} definition={d.receivables} hint={`${c.receivables.invoices} open invoices at period end`} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 2 }}><KpiCard label="Revenue / completed job" value={c.revenuePerCompletedBooking != null ? inrCompact(c.revenuePerCompletedBooking) : '—'} definition={d.revenuePerCompletedBooking} trend={{ pct: pctChange(c.revenuePerCompletedBooking, p?.revenuePerCompletedBooking) }} hint={`${c.completedBookings} completed`} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 2 }}><KpiCard label="GST collected" value={inrCompact(o.taxesCollected)} definition={d.taxesCollected} hint="liability, not revenue" /></Grid>
      </Grid>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, xl: 7 }}>
          <SectionCard title="Operating results (accrual basis)">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Revenue when invoiced and costs when incurred — regardless of when cash moves. {c.invoicesIssued} invoices issued totalling {inr(c.invoicedTotal)} (incl. GST and pass-through).
            </Typography>
            <StatementTable rows={operatingRows} compare={compare} />
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, xl: 5 }}>
          <SectionCard title="Cash flow (cash basis)">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Money actually received and paid in the period. Cash in includes GST collected; unconfirmed field cash is excluded.
            </Typography>
            <StatementTable rows={cashRows} compare={compare} />
          </SectionCard>
        </Grid>
      </Grid>
    </Stack>
  );
}

// ─── Trends ──────────────────────────────────────────────────────────

interface TrendRow {
  bucket: string;
  revenue: number;
  costs: number;
  profit: number;
  bookings: number;
}

function bucketLabel(b: string, g: string) {
  const d = new Date(`${b}T00:00:00Z`);
  const m = d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' });
  const y = d.getUTCFullYear();
  if (g === 'year') return String(y);
  if (g === 'quarter') return `${m}–${new Date(Date.UTC(y, d.getUTCMonth() + 2, 1)).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })} ${y}`;
  if (g === 'month') return `${m} ${y}`;
  if (g === 'week') return `Wk ${d.getUTCDate()} ${m}`;
  return `${d.getUTCDate()} ${m}`;
}

export function TrendsTab({ q }: { q: ReportQuery }) {
  const [g, setG] = useState<'day' | 'week' | 'month' | 'quarter' | 'year'>(['today', 'yesterday', 'this_week', 'last_week'].includes(q.period) ? 'day' : ['this_month', 'last_month'].includes(q.period) ? 'week' : 'month');
  const [table, setTable] = useState(false);
  const col = useChartColors();
  const tr = useQuery({ queryKey: ['admin', 'reports', 'trends', q, g], queryFn: () => api.get<{ range: { from: string; to: string }; granularity: string; series: TrendRow[] }>('/admin/reports/trends', { ...q, granularity: g }) });
  const data = useMemo(() => (tr.data ? tr.data.series.map((r) => ({ ...r, label: bucketLabel(r.bucket, g) })) : []), [tr.data, g]);
  return (
    <Stack spacing={2}>
      <FilterScopeNote applies={['sample']} q={q} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ sm: 'center' }}>
        <ToggleButtonGroup size="small" exclusive value={g} onChange={(_, v) => v && setG(v)} aria-label="Granularity">
          {(['day', 'week', 'month', 'quarter', 'year'] as const).map((x) => <ToggleButton key={x} value={x}>{humanize(x)}</ToggleButton>)}
        </ToggleButtonGroup>
        <Button size="small" onClick={() => setTable(!table)}>{table ? 'Show chart' : 'Show as table'}</Button>
      </Stack>
      {tr.isLoading ? <LoadingBlock rows={3} height={120} /> : tr.error ? <ErrorState error={tr.error} onRetry={() => void tr.refetch()} /> : !data.length ? (
        <SectionCard><EmptyState title="No financial activity in this period" body="Pick a longer period or include sample data." /></SectionCard>
      ) : table ? (
        <SectionCard title="Revenue, costs and profit">
          <SimpleTable rows={data} rowKey={(r) => r.bucket} minWidth={560} columns={[
            { key: 'b', header: 'Period', render: (r) => r.label, nowrap: true },
            { key: 'r', header: 'Revenue', align: 'right', render: (r) => inr(r.revenue) },
            { key: 'c', header: 'Costs', align: 'right', render: (r) => inr(r.costs) },
            { key: 'p', header: 'Profit', align: 'right', render: (r) => <Box component="span" sx={{ color: r.profit < 0 ? 'error.main' : undefined }}>{inr(r.profit)}</Box> },
            { key: 'k', header: 'Completed jobs', align: 'right', render: (r) => r.bookings },
          ]} />
        </SectionCard>
      ) : (
        <>
          <SectionCard title="Revenue vs costs (accrual)">
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Revenue = recognised revenue (excl. GST & pass-through). Costs = driver earnings + salary obligations + expenses + gateway fees. Profit line = revenue − costs.
            </Typography>
            <Box sx={{ height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke={col.grid} vertical={false} />
                  <XAxis dataKey="label" tick={axisTick(col.axis)} tickLine={false} axisLine={{ stroke: col.grid }} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis tickFormatter={(v: number) => inrCompact(v)} tick={axisTick(col.axis)} tickLine={false} axisLine={false} width={72} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: col.grid }} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Bar dataKey="revenue" name="Revenue" fill={col.revenue} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="costs" name="Costs" fill={col.costs} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Line dataKey="profit" name="Operating profit" stroke={col.profit} strokeWidth={2} dot={{ r: 4, stroke: col.surface, strokeWidth: 2, fill: col.profit }} activeDot={{ r: 5 }} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
          </SectionCard>
          <SectionCard title="Completed bookings">
            <Box sx={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke={col.grid} vertical={false} />
                  <XAxis dataKey="label" tick={axisTick(col.axis)} tickLine={false} axisLine={{ stroke: col.grid }} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis allowDecimals={false} tick={axisTick(col.axis)} tickLine={false} axisLine={false} width={72} />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => v.toLocaleString('en-IN')} />} cursor={{ fill: col.grid }} />
                  <Bar dataKey="bookings" name="Completed bookings" fill={col.neutral} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </SectionCard>
        </>
      )}
    </Stack>
  );
}

// ─── Profitability ───────────────────────────────────────────────────

interface ProfitRow {
  category: string;
  jobs: number;
  revenue: number;
  directCosts: number;
  contributionMargin: number;
  marginPct: number | null;
  revenuePerJob: number | null;
}

export function ProfitabilityTab({ q, definition }: { q: ReportQuery; definition?: string }) {
  const col = useChartColors();
  const pr = useQuery({ queryKey: ['admin', 'reports', 'profitability', q], queryFn: () => api.get<ProfitRow[]>('/admin/reports/profitability', q) });
  if (pr.isLoading) return <LoadingBlock rows={4} />;
  if (pr.error || !pr.data) return <ErrorState error={pr.error} onRetry={() => void pr.refetch()} />;
  const rows = pr.data;
  const tot = rows.reduce((a, r) => ({ jobs: a.jobs + r.jobs, revenue: a.revenue + r.revenue, direct: a.direct + r.directCosts }), { jobs: 0, revenue: 0, direct: 0 });
  if (!rows.length) return <SectionCard><EmptyState title="No service invoices in this period" /></SectionCard>;
  return (
    <Stack spacing={2}>
      <SectionCard title={<Typography variant="h5">Contribution margin by service{definition && <InfoTip title={definition} />}</Typography>}>
        <Box sx={{ height: Math.max(220, rows.length * 44 + 60) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke={col.grid} horizontal={false} />
              <XAxis type="number" tickFormatter={(v: number) => inrCompact(v)} tick={axisTick(col.axis)} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="category" width={150} tick={axisTick(col.axis)} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: col.grid }} />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              <Bar dataKey="revenue" name="Revenue" fill={col.revenue} radius={[0, 4, 4, 0]} maxBarSize={14} />
              <Bar dataKey="directCosts" name="Direct costs" fill={col.costs} radius={[0, 4, 4, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </SectionCard>
      <SectionCard>
        <SimpleTable
          rows={rows}
          rowKey={(r) => r.category}
          minWidth={760}
          columns={[
            { key: 'c', header: 'Service', render: (r) => r.category },
            { key: 'j', header: 'Jobs', align: 'right', render: (r) => r.jobs },
            { key: 'r', header: 'Revenue', align: 'right', render: (r) => inr(r.revenue) },
            { key: 'd', header: 'Direct costs', align: 'right', render: (r) => inr(r.directCosts) },
            { key: 'm', header: 'Contribution', align: 'right', render: (r) => <Box component="span" sx={{ fontWeight: 600, color: r.contributionMargin < 0 ? 'error.main' : undefined }}>{inr(r.contributionMargin)}</Box> },
            { key: 'p', header: 'Margin', align: 'right', render: (r) => fmtPct(r.marginPct) },
            { key: 'rj', header: 'Revenue / job', align: 'right', render: (r) => inr(r.revenuePerJob) },
          ]}
          footer={
            <Fragment>
              <TableRow sx={{ '& td': { fontWeight: 700, borderTop: 2, borderTopColor: 'divider' } }}>
                <TableCell>Total</TableCell>
                <TableCell align="right" sx={num}>{tot.jobs}</TableCell>
                <TableCell align="right" sx={num}>{inr(tot.revenue)}</TableCell>
                <TableCell align="right" sx={num}>{inr(tot.direct)}</TableCell>
                <TableCell align="right" sx={num}>{inr(tot.revenue - tot.direct)}</TableCell>
                <TableCell align="right" sx={num}>{tot.revenue ? fmtPct(((tot.revenue - tot.direct) / tot.revenue) * 100) : '—'}</TableCell>
                <TableCell align="right" sx={num}>{tot.jobs ? inr(Math.round(tot.revenue / tot.jobs)) : '—'}</TableCell>
              </TableRow>
            </Fragment>
          }
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Direct costs are job-linked only (driver earnings, job expenses, gateway fees). Salaries and overheads are not allocated, so contribution margin is higher than operating margin.
        </Typography>
      </SectionCard>
    </Stack>
  );
}
