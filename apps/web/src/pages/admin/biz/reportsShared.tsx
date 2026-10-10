import type { ReactNode } from 'react';
import { Box, Paper, Stack, Typography, useTheme } from '@mui/material';
import { inr } from '@/lib/format';

export type ReportQuery = { period: string; from?: string; to?: string; excludeSample?: true; zoneId?: string; serviceCategoryId?: string };

/**
 * Chart colours (validated with the dataviz palette checker for both modes):
 * revenue = blue, costs = amber, profit = green. Profit is always drawn as a line with dots
 * (secondary encoding) so amber/green are never told apart by colour alone.
 */
export function useChartColors() {
  const t = useTheme();
  const dark = t.palette.mode === 'dark';
  return {
    revenue: dark ? '#3b82f6' : '#1d4ed8',
    costs: dark ? '#d97706' : '#b45309',
    profit: dark ? '#22a35a' : '#15803d',
    neutral: dark ? '#64748b' : '#94a3b8',
    alert: dark ? '#f87171' : '#b91c1c',
    grid: dark ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.08)',
    axis: t.palette.text.secondary,
    surface: t.palette.background.paper,
  };
}

export const axisTick = (color: string) => ({ fill: color, fontSize: 12 });

/** Tooltip body shared by all charts: text in ink colours, a colour swatch carries identity. */
export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter = (v: number) => inr(v) }: { active?: boolean; payload?: readonly { name?: string | number; value?: unknown; color?: string; dataKey?: unknown }[]; label?: unknown; labelFormatter?: (l: unknown) => ReactNode; valueFormatter?: (v: number, name: string) => ReactNode }) {
  if (!active || !payload?.length) return null;
  return (
    <Paper elevation={4} sx={{ px: 1.5, py: 1, minWidth: 160 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
        {labelFormatter ? labelFormatter(label) : String(label ?? '')}
      </Typography>
      {payload.map((p) => (
        <Stack key={String(p.dataKey ?? p.name)} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: p.color }} />
            <Typography variant="body2">{p.name}</Typography>
          </Stack>
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {valueFormatter(Number(p.value), String(p.name))}
          </Typography>
        </Stack>
      ))}
    </Paper>
  );
}

export function FilterScopeNote({ applies, q }: { applies: ('zone' | 'service' | 'sample')[]; q: ReportQuery }) {
  const ignored = [q.zoneId && !applies.includes('zone') && 'zone', q.serviceCategoryId && !applies.includes('service') && 'service', q.excludeSample && !applies.includes('sample') && '“exclude sample data”'].filter(Boolean);
  if (!ignored.length) return null;
  return (
    <Typography variant="caption" color="warning.main" display="block" sx={{ mb: 1 }}>
      The {ignored.join(' and ')} filter{ignored.length > 1 ? 's do' : ' does'} not apply to this view; figures cover all {ignored.includes('zone') ? 'zones' : 'records'}.
    </Typography>
  );
}
