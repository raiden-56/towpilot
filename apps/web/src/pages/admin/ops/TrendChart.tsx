import { Box, Stack, Typography, useTheme } from '@mui/material';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { inr, inrCompact, TZ } from '@/lib/format';
import type { TrendPoint } from './types';

export function bucketLabel(bucket: string, granularity: string) {
  const d = new Date(`${bucket}T00:00:00Z`);
  if (granularity === 'month') return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (granularity === 'quarter') return `Q from ${d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' })}`;
  if (granularity === 'year') return String(d.getUTCFullYear());
  const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return granularity === 'week' ? `Wk of ${label}` : label;
}

/**
 * Revenue vs costs as paired bars, profit as a line — different mark types so series stay
 * distinguishable without relying on colour alone. One axis (all values are money).
 */
export function TrendChart({ series, granularity, height = 300 }: { series: TrendPoint[]; granularity: string; height?: number }) {
  const theme = useTheme();
  const p = theme.palette;
  const data = series.map((s) => ({ ...s, label: bucketLabel(s.bucket, granularity) }));
  const totals = series.reduce((a, s) => ({ revenue: a.revenue + s.revenue, costs: a.costs + s.costs, profit: a.profit + s.profit }), { revenue: 0, costs: 0, profit: 0 });
  return (
    <Box>
      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        {(
          [
            ['Revenue', totals.revenue],
            ['Costs', totals.costs],
            ['Profit', totals.profit],
          ] as const
        ).map(([l, v]) => (
          <Box key={l}>
            <Typography variant="caption" color="text.secondary">
              {l} (period)
            </Typography>
            <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }} color={l === 'Profit' && v < 0 ? 'error.main' : 'text.primary'}>
              {inr(v, { decimals: false })}
            </Typography>
          </Box>
        ))}
      </Stack>
      <Box sx={{ width: '100%', height }} role="img" aria-label={`Revenue, costs and profit by ${granularity}. Totals: revenue ${inr(totals.revenue)}, costs ${inr(totals.costs)}, profit ${inr(totals.profit)}.`}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke={p.divider} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: p.text.secondary, fontSize: 12 }} tickLine={false} axisLine={{ stroke: p.divider }} minTickGap={12} />
            <YAxis tickFormatter={(v: number) => inrCompact(v)} tick={{ fill: p.text.secondary, fontSize: 12 }} tickLine={false} axisLine={false} width={64} />
            <ReferenceLine y={0} stroke={p.text.secondary} strokeOpacity={0.4} />
            <Tooltip
              cursor={{ fill: p.action.hover }}
              contentStyle={{ background: p.background.paper, border: `1px solid ${p.divider}`, borderRadius: 8, color: p.text.primary }}
              labelStyle={{ color: p.text.primary, fontWeight: 700 }}
              formatter={(v, name) => [inr(Number(v)), String(name)]}
              labelFormatter={(l, payload) => {
                const b = (payload?.[0]?.payload as TrendPoint | undefined)?.bookings;
                return `${String(l)}${b != null ? ` · ${b} completed booking${b === 1 ? '' : 's'}` : ''}`;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: p.text.secondary }} />
            <Bar dataKey="revenue" name="Revenue (net of credit notes)" fill={p.info.main} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="costs" name="Costs" fill={p.primary.main} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Line dataKey="profit" name="Operating profit" type="monotone" stroke={p.success.main} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: p.background.paper }} activeDot={{ r: 5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Revenue: taxable value of issued invoices less credit notes. Costs: driver earnings, salary obligations, approved expenses and gateway fees. Buckets in {TZ}.
      </Typography>
    </Box>
  );
}
