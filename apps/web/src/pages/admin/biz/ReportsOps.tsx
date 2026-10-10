/** Reports → operational tabs (reports:read). */
import { Fragment, useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Grid, LinearProgress, Link, Stack, Tooltip as MuiTooltip, Typography, alpha } from '@mui/material';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/api/client';
import { EmptyState, ErrorState, KpiCard, LoadingBlock, SectionCard } from '@/components/common';
import { MapView, type MapMarker } from '@/components/MapView';
import { humanize, inr, STATUS_LABELS, VEHICLE_CLASS_LABELS } from '@/lib/format';
import type { BookingStatus } from '@/api/types';
import { fmtPct, num, SimpleTable } from './shared';
import { axisTick, ChartTooltip, useChartColors, type ReportQuery } from './reportsShared';

const pct = (a: number, b: number) => (b ? (a / b) * 100 : null);

function Share({ value, total }: { value: number; total: number }) {
  const p = total ? (value / total) * 100 : 0;
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 140 }}>
      <LinearProgress variant="determinate" value={p} sx={{ flex: 1, height: 6, borderRadius: 3 }} aria-hidden />
      <Typography variant="body2" sx={{ ...num, minWidth: 64, textAlign: 'right' }}>{value} ({p.toFixed(0)}%)</Typography>
    </Stack>
  );
}

// ─── Zones ───────────────────────────────────────────────────────────

export function ZonesReport({ q }: { q: ReportQuery }) {
  const r = useQuery({ queryKey: ['admin', 'reports', 'zones', q], queryFn: () => api.get<{ zone: string; bookings: number; completed: number; cancelled: number; failed: number; revenue: number }[]>('/admin/reports/zones', q) });
  if (r.isLoading) return <LoadingBlock />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  return (
    <SectionCard title="Performance by zone">
      <SimpleTable rows={r.data} rowKey={(z) => z.zone} empty="No bookings in this period." minWidth={720} columns={[
        { key: 'z', header: 'Zone', render: (z) => z.zone },
        { key: 'b', header: 'Bookings', align: 'right', render: (z) => z.bookings },
        { key: 'c', header: 'Completed', align: 'right', render: (z) => z.completed },
        { key: 'x', header: 'Cancelled', align: 'right', render: (z) => z.cancelled },
        { key: 'f', header: 'Failed', align: 'right', render: (z) => z.failed },
        { key: 'cr', header: 'Completion rate', align: 'right', render: (z) => fmtPct(pct(z.completed, z.bookings)) },
        { key: 'r', header: 'Revenue (taxable)', align: 'right', render: (z) => inr(z.revenue) },
      ]} />
    </SectionCard>
  );
}

// ─── Drivers ─────────────────────────────────────────────────────────

export function DriversReport({ q }: { q: ReportQuery }) {
  const r = useQuery({ queryKey: ['admin', 'reports', 'drivers', q], queryFn: () => api.get<{ id: string; name: string; offered: number; completed: number; declined: number; earnings: number; rating: number | null }[]>('/admin/reports/drivers', q) });
  if (r.isLoading) return <LoadingBlock />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  return (
    <SectionCard title="Driver productivity">
      <SimpleTable rows={r.data} rowKey={(d) => d.id} empty="No drivers." minWidth={760} columns={[
        { key: 'n', header: 'Driver', render: (d) => <Link component={RouterLink} to={`/admin/employees/${d.id}`}>{d.name}</Link> },
        { key: 'o', header: 'Offers', align: 'right', render: (d) => d.offered },
        { key: 'c', header: 'Completed', align: 'right', render: (d) => d.completed },
        { key: 'd', header: 'Declined / timed out', align: 'right', render: (d) => d.declined },
        { key: 'ar', header: 'Acceptance', align: 'right', render: (d) => fmtPct(d.offered ? ((d.offered - d.declined) / d.offered) * 100 : null) },
        { key: 'e', header: 'Earnings (accrued)', align: 'right', render: (d) => inr(d.earnings) },
        { key: 'epj', header: 'Earnings / job', align: 'right', render: (d) => (d.completed ? inr(Math.round(d.earnings / d.completed)) : '—') },
        { key: 'r', header: 'Rating', align: 'right', render: (d) => (d.rating != null ? `${d.rating.toFixed(1)} ★` : '—') },
      ]} />
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>Offers and completions count job assignments offered in the period; earnings exclude expense reimbursements.</Typography>
    </SectionCard>
  );
}

// ─── Trucks ──────────────────────────────────────────────────────────

export function TrucksReport({ q }: { q: ReportQuery }) {
  const col = useChartColors();
  const r = useQuery({ queryKey: ['admin', 'reports', 'trucks', q], queryFn: () => api.get<{ periodHours: number; trucks: { id: string; registrationNumber: string; truckType: string; jobs: number; busyHours: number; utilisationPct: number | null; maintenanceEvents: number; fuelCost: number; repairCost: number }[] }>('/admin/reports/trucks', q) });
  if (r.isLoading) return <LoadingBlock />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  const t = r.data.trucks;
  if (!t.length) return <SectionCard><EmptyState title="No active trucks" /></SectionCard>;
  return (
    <Stack spacing={2}>
      <SectionCard title="Utilisation">
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Busy hours (from job acceptance to completion) ÷ {r.data.periodHours.toLocaleString('en-IN')} hours in the period.
        </Typography>
        <Box sx={{ height: Math.max(200, t.length * 34 + 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={t} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={col.grid} horizontal={false} />
              <XAxis type="number" domain={[0, (max: number) => Math.max(10, Math.ceil(max / 10) * 10)]} tickFormatter={(v: number) => `${v}%`} tick={axisTick(col.axis)} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="registrationNumber" width={110} tick={axisTick(col.axis)} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)}%`} />} cursor={{ fill: col.grid }} />
              <Bar dataKey="utilisationPct" name="Utilisation" fill={col.revenue} radius={[0, 4, 4, 0]} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </SectionCard>
      <SectionCard title="Truck costs & activity">
        <SimpleTable rows={t} rowKey={(x) => x.id} minWidth={820} columns={[
          { key: 'r', header: 'Truck', render: (x) => (<Box><Link component={RouterLink} to={`/admin/fleet/${x.id}`}>{x.registrationNumber}</Link><Typography variant="caption" color="text.secondary" display="block">{humanize(x.truckType)}</Typography></Box>) },
          { key: 'j', header: 'Jobs', align: 'right', render: (x) => x.jobs },
          { key: 'h', header: 'Busy hours', align: 'right', render: (x) => x.busyHours.toFixed(1) },
          { key: 'u', header: 'Utilisation', align: 'right', render: (x) => fmtPct(x.utilisationPct) },
          { key: 'm', header: 'Maintenance events', align: 'right', render: (x) => x.maintenanceEvents },
          { key: 'f', header: 'Fuel cost', align: 'right', render: (x) => inr(x.fuelCost) },
          { key: 'rp', header: 'Repairs & maintenance', align: 'right', render: (x) => inr(x.repairCost) },
          { key: 'cpj', header: 'Running cost / job', align: 'right', render: (x) => (x.jobs ? inr(Math.round((x.fuelCost + x.repairCost) / x.jobs)) : '—') },
        ]} />
      </SectionCard>
    </Stack>
  );
}

// ─── Customers ───────────────────────────────────────────────────────

export function CustomersReport({ q }: { q: ReportQuery }) {
  const r = useQuery({ queryKey: ['admin', 'reports', 'customers', q], queryFn: () => api.get<{ customersServed: number; repeatCustomers: number; repeatRatePct: number | null; definition: string }>('/admin/reports/customers', q) });
  if (r.isLoading) return <LoadingBlock rows={2} />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="Customers served" value={r.data.customersServed.toLocaleString('en-IN')} definition="Distinct customers with at least one completed booking in the period." /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="Repeat customers" value={r.data.repeatCustomers.toLocaleString('en-IN')} definition="Customers who completed more than one booking in the period." /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="Repeat rate" value={fmtPct(r.data.repeatRatePct)} definition={r.data.definition} /></Grid>
      </Grid>
    </Stack>
  );
}

// ─── Cancellations ───────────────────────────────────────────────────

export function CancellationsReport({ q }: { q: ReportQuery }) {
  const r = useQuery({ queryKey: ['admin', 'reports', 'cancellations', q], queryFn: () => api.get<{ total: number; feesCharged: number; byStage: { key: string; count: number }[]; byActor: { key: string; count: number }[]; topReasons: { key: string; count: number }[] }>('/admin/reports/cancellations', q) });
  if (r.isLoading) return <LoadingBlock />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  const c = r.data;
  const table = (rows: { key: string; count: number }[], label: (k: string) => string) => (
    <SimpleTable rows={rows} rowKey={(x) => x.key} empty="None." columns={[
      { key: 'k', header: 'Value', render: (x) => label(x.key) },
      { key: 'c', header: 'Cancellations', align: 'right', render: (x) => <Share value={x.count} total={c.total} /> },
    ]} />
  );
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}><KpiCard label="Cancellations" value={c.total} definition="Bookings moved to Cancelled in the period (any stage)." /></Grid>
        <Grid size={{ xs: 12, sm: 6 }}><KpiCard label="Cancellation fees charged" value={inr(c.feesCharged)} definition="Cancellation fees set on those bookings (GST inclusive), per the rate card’s cancellation policy." /></Grid>
      </Grid>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}><SectionCard title="By stage when cancelled">{table(c.byStage, (k) => STATUS_LABELS[k as BookingStatus] ?? humanize(k))}</SectionCard></Grid>
        <Grid size={{ xs: 12, md: 6 }}><SectionCard title="Cancelled by">{table(c.byActor, humanize)}</SectionCard></Grid>
        <Grid size={12}><SectionCard title="Top reasons">{table(c.topReasons, (k) => k)}</SectionCard></Grid>
      </Grid>
    </Stack>
  );
}

// ─── Demand & coverage ───────────────────────────────────────────────

interface Demand {
  hotspots: { lat: number; lng: number; bookings: number; unfulfilled: number; avgResponseMin: number | null; insufficientCoverage: boolean }[];
  byHour: { dow: number; hour: number; bookings: number; expectedPerWeek: number }[];
  byCategory: { category: string; bookings: number }[];
  byVehicleClass: { vehicleClass: string; bookings: number }[];
  zones: { id: string; name: string; drivers: number; trucks: number; bookings: number }[];
  methodology: string;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function HeatGrid({ cells }: { cells: Demand['byHour'] }) {
  const col = useChartColors();
  const map = useMemo(() => new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c])), [cells]);
  const max = Math.max(1, ...cells.map((c) => c.bookings));
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '40px repeat(24, minmax(18px, 1fr))', gap: '2px', minWidth: 560 }} role="table" aria-label="Bookings by weekday and hour">
        <Box />
        {Array.from({ length: 24 }, (_, h) => (
          <Typography key={h} variant="caption" color="text.secondary" sx={{ textAlign: 'center', fontSize: 10 }}>{h % 3 === 0 ? h : ''}</Typography>
        ))}
        {order.map((d) => (
          <Fragment key={d}>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>{DOW[d]}</Typography>
            {Array.from({ length: 24 }, (_, h) => {
              const c = map.get(`${d}-${h}`);
              const v = c?.bookings ?? 0;
              return (
                <MuiTooltip key={h} title={`${DOW[d]} ${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00 · ${v} booking${v === 1 ? '' : 's'} · ~${c?.expectedPerWeek ?? 0}/week (historical avg)`}>
                  <Box role="cell" sx={{ height: 22, borderRadius: 0.5, bgcolor: v ? alpha(col.revenue, 0.12 + 0.88 * (v / max)) : 'action.hover' }} />
                </MuiTooltip>
              );
            })}
          </Fragment>
        ))}
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">Fewer</Typography>
        {[0.15, 0.4, 0.65, 1].map((a) => <Box key={a} sx={{ width: 18, height: 10, borderRadius: 0.5, bgcolor: alpha(col.revenue, a) }} />)}
        <Typography variant="caption" color="text.secondary">More (max {max})</Typography>
      </Stack>
    </Box>
  );
}

function SimpleBars({ data, dataKey, nameKey, label }: { data: object[]; dataKey: string; nameKey: string; label: string }) {
  const col = useChartColors();
  if (!data.length) return <Typography variant="body2" color="text.secondary">No data.</Typography>;
  return (
    <Box sx={{ height: Math.max(180, data.length * 30 + 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={col.grid} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={axisTick(col.axis)} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey={nameKey} width={140} tick={axisTick(col.axis)} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip valueFormatter={(v) => v.toLocaleString('en-IN')} />} cursor={{ fill: col.grid }} />
          <Bar dataKey={dataKey} name={label} fill={col.revenue} radius={[0, 4, 4, 0]} maxBarSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function DemandReport({ q }: { q: ReportQuery }) {
  const r = useQuery({ queryKey: ['admin', 'reports', 'demand', q], queryFn: () => api.get<Demand>('/admin/reports/demand', q) });
  const markers: MapMarker[] = useMemo(
    () =>
      (r.data?.hotspots ?? []).map((h, i) => ({
        id: `h${i}`,
        lat: h.lat,
        lng: h.lng,
        kind: h.insufficientCoverage ? 'alert' : 'truck',
        label: h.bookings > 99 ? '99+' : String(h.bookings),
        popup: (
          <Box>
            <strong>{h.bookings} bookings</strong> (~2 km cell)
            <br />
            Unfulfilled: {h.unfulfilled}
            <br />
            Avg response: {h.avgResponseMin != null ? `${h.avgResponseMin} min` : '—'}
            {h.insufficientCoverage && (<><br /><strong>Coverage gap</strong></>)}
          </Box>
        ),
      })),
    [r.data],
  );
  if (r.isLoading) return <LoadingBlock rows={4} height={100} />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={() => void r.refetch()} title="Could not load demand analysis" />;
  const d = r.data;
  const gaps = d.hotspots.filter((h) => h.insufficientCoverage).length;
  return (
    <Stack spacing={2}>
      <Alert severity="info">Historical analysis of recorded bookings — not a forecast. {d.methodology}</Alert>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title={`Pickup hotspots${gaps ? ` · ${gaps} coverage gap${gaps === 1 ? '' : 's'}` : ''}`}>
            {markers.length ? <MapView markers={markers} height={400} ariaLabel="Demand hotspots map" /> : <EmptyState title="No bookings in this period" />}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Each marker is a ~2 km grid cell labelled with its booking count. Red “!”-style markers flag insufficient coverage: unfulfilled requests, or response times well above the median.
            </Typography>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Zone coverage (live supply vs period demand)">
            <SimpleTable rows={d.zones} rowKey={(z) => z.id} empty="No active zones." columns={[
              { key: 'n', header: 'Zone', render: (z) => z.name },
              { key: 'b', header: 'Bookings', align: 'right', render: (z) => z.bookings },
              { key: 'd', header: 'Drivers available', align: 'right', render: (z) => z.drivers },
              { key: 't', header: 'Trucks in service', align: 'right', render: (z) => z.trucks },
            ]} />
          </SectionCard>
        </Grid>
      </Grid>
      <SectionCard title="When requests arrive (weekday × hour, business timezone)">
        <HeatGrid cells={d.byHour} />
      </SectionCard>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}><SectionCard title="By service"><SimpleBars data={d.byCategory} dataKey="bookings" nameKey="category" label="Bookings" /></SectionCard></Grid>
        <Grid size={{ xs: 12, md: 6 }}><SectionCard title="By vehicle class"><SimpleBars data={d.byVehicleClass.map((v) => ({ ...v, label: VEHICLE_CLASS_LABELS[v.vehicleClass] ?? v.vehicleClass }))} dataKey="bookings" nameKey="label" label="Bookings" /></SectionCard></Grid>
      </Grid>
    </Stack>
  );
}

