import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, Chip, FormControlLabel, Grid, Link, List, ListItem, ListItemText, MenuItem, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { api } from '@/api/client';
import { EmptyState, ErrorState, KpiCard, LoadingBlock, PageHeader, SectionCard, StatusChip } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { date, humanize, inr, inrCompact, relative } from '@/lib/format';
import { reviewPending } from './ops/BookingActions';
import { ESCALATION_COLOR, NEEDS_PROVIDER, PriorityChip } from './ops/shared';
import { TrendChart } from './ops/TrendChart';
import type { DispatchBoard, KpiItem, TrendPoint } from './ops/types';

const PERIODS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this_week', 'This week'],
  ['last_week', 'Last week'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'],
  ['this_fy', 'This financial year'],
  ['last_fy', 'Last financial year'],
] as const;
type Period = (typeof PERIODS)[number][0];

const granularityFor = (p: Period) => (p === 'this_quarter' ? 'week' : p === 'this_fy' || p === 'last_fy' ? 'month' : 'day');

const LIVE_KEYS = ['activeBookings', 'unassignedBookings', 'availableDrivers', 'availableTrucks', 'completedToday'];
const SERVICE_KEYS = ['avgResponseMin', 'avgPickupMin', 'cancellationRate', 'satisfaction', 'newCustomers', 'totalCustomers'];

function formatKpi(k: KpiItem) {
  if (k.value == null) return '—';
  switch (k.unit) {
    case 'paise':
      return (
        <Tooltip title={inr(k.value)}>
          <span>{inrCompact(k.value)}</span>
        </Tooltip>
      );
    case 'minutes':
      return `${k.value} min`;
    case 'percent':
      return `${k.value}%`;
    case 'rating':
      return `${k.value} / 5`;
    default:
      return k.value.toLocaleString('en-IN');
  }
}

function KpiGrid({ items, onClick }: { items: KpiItem[]; onClick?: (k: KpiItem) => (() => void) | undefined }) {
  return (
    <Grid container spacing={2}>
      {items.map((k) => (
        <Grid key={k.key} size={{ xs: 6, md: 4, lg: 2.4 }}>
          <KpiCard label={k.label} value={formatKpi(k)} definition={k.definition} onClick={onClick?.(k)} />
        </Grid>
      ))}
    </Grid>
  );
}

export default function Dashboard() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [period, setPeriod] = useState<Period>('this_month');
  const [excludeSample, setExcludeSample] = useState(false);
  const finance = can('finance:read');
  const ops = can('reports:read');
  const boardAllowed = can('dispatch:manage') || can('booking:read_any');
  const granularity = granularityFor(period);

  const overview = useQuery({
    queryKey: ['admin', 'reports', 'overview', period, excludeSample],
    queryFn: () => api.get<{ range: { from: string; to: string }; kpis: KpiItem[] }>('/admin/reports/overview', { period, excludeSample: excludeSample || undefined }),
    refetchInterval: 60_000,
  });
  const trends = useQuery({
    queryKey: ['admin', 'reports', 'trends', period, granularity, excludeSample],
    queryFn: () => api.get<{ series: TrendPoint[]; granularity: string }>('/admin/reports/trends', { period, granularity, excludeSample: excludeSample || undefined }),
    enabled: finance,
  });
  const board = useQuery({ queryKey: ['dispatch', 'board'], queryFn: () => api.get<DispatchBoard>('/dispatch/board'), enabled: boardAllowed, refetchInterval: 30_000 });

  const kpis = overview.data?.kpis ?? [];
  const live = kpis.filter((k) => LIVE_KEYS.includes(k.key));
  const service = kpis.filter((k) => SERVICE_KEYS.includes(k.key));
  const money = kpis.filter((k) => k.unit === 'paise');
  const range = overview.data?.range;

  const kpiLink = (k: KpiItem) => {
    if (k.key === 'unassignedBookings') return () => nav(can('dispatch:manage') ? '/admin/dispatch' : '/admin/bookings?group=unassigned');
    if (k.key === 'activeBookings' && can('booking:read_any')) return () => nav('/admin/bookings?group=active');
    if (k.key === 'availableDrivers' && can('employee:read')) return () => nav('/admin/employees?availability=AVAILABLE');
    if (k.key === 'availableTrucks' && can('fleet:read')) return () => nav('/admin/fleet?status=AVAILABLE');
    return undefined;
  };

  const attention = (board.data?.bookings ?? []).filter((b) => NEEDS_PROVIDER.includes(b.status) || reviewPending(b) || b.status === 'SAFETY_HOLD');
  const escalations = (board.data?.escalations ?? []).filter((e) => e.status !== 'RESOLVED');
  const bookingHref = (id: string) => (can('dispatch:manage') ? `/admin/dispatch?booking=${id}` : `/admin/bookings/${id}`);

  return (
    <Box>
      <PageHeader
        title="Overview"
        subtitle={range ? `${date(range.from)} – ${date(new Date(new Date(range.to).getTime() - 1))} · figures computed from live records` : 'Operations and financial health'}
        actions={
          <>
            <FormControlLabel control={<Switch size="small" checked={excludeSample} onChange={(e) => setExcludeSample(e.target.checked)} />} label="Exclude sample data" />
            <TextField select size="small" label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} sx={{ minWidth: 190 }}>
              {PERIODS.map(([v, l]) => (
                <MenuItem key={v} value={v}>
                  {l}
                </MenuItem>
              ))}
            </TextField>
          </>
        }
      />
      {overview.error ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} title="Could not load KPIs" />
      ) : overview.isLoading ? (
        <LoadingBlock rows={3} height={110} />
      ) : (
        <Stack spacing={3}>
          {ops && live.length > 0 && (
            <Box>
              <Typography variant="h5" sx={{ mb: 1.25 }}>
                Live operations <Chip size="small" label="right now" sx={{ ml: 0.5 }} />
              </Typography>
              <KpiGrid items={live} onClick={kpiLink} />
            </Box>
          )}
          {ops && service.length > 0 && (
            <Box>
              <Typography variant="h5" sx={{ mb: 1.25 }}>
                Service performance
              </Typography>
              <KpiGrid items={service} />
            </Box>
          )}
          {finance && money.length > 0 && (
            <Box>
              <Typography variant="h5" sx={{ mb: 1.25 }}>
                Financial
              </Typography>
              <KpiGrid items={money} />
            </Box>
          )}
          {finance && (
            <SectionCard
              title="Revenue, costs & profit"
              action={
                <Button component={RouterLink} to="/admin/reports" size="small">
                  Full reports
                </Button>
              }
            >
              {trends.error ? (
                <ErrorState error={trends.error} onRetry={() => void trends.refetch()} />
              ) : trends.isLoading ? (
                <LoadingBlock rows={1} height={300} />
              ) : !trends.data?.series.length ? (
                <EmptyState title="No financial activity in this period" body="Issued invoices, earnings and expenses will appear here." />
              ) : (
                <TrendChart series={trends.data.series} granularity={trends.data.granularity} />
              )}
            </SectionCard>
          )}
          {boardAllowed && (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <SectionCard
                  title={`Needs attention (${attention.length})`}
                  action={
                    can('dispatch:manage') && (
                      <Button component={RouterLink} to="/admin/dispatch" size="small">
                        Dispatch centre
                      </Button>
                    )
                  }
                >
                  {board.error ? (
                    <ErrorState error={board.error} onRetry={() => void board.refetch()} />
                  ) : board.isLoading ? (
                    <LoadingBlock rows={3} />
                  ) : !attention.length ? (
                    <EmptyState title="Nothing waiting" body="No bookings need a provider, a safety review or are on safety hold." />
                  ) : (
                    <List dense disablePadding>
                      {attention.slice(0, 8).map((b) => (
                        <ListItem key={b.id} disableGutters divider>
                          <ListItemText
                            primary={
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Link component={RouterLink} to={bookingHref(b.id)} sx={{ fontWeight: 700 }}>
                                  {b.code}
                                </Link>
                                <StatusChip status={b.status} />
                                {reviewPending(b) && <Chip size="small" color="warning" label="Safety review" />}
                                <PriorityChip priority={b.priority} hideNormal />
                              </Stack>
                            }
                            secondary={`${b.serviceCategory.name}${b.vehicle ? ` · ${b.vehicle.registrationNumber}` : ''} · ${relative(b.createdAt)}`}
                          />
                        </ListItem>
                      ))}
                      {attention.length > 8 && (
                        <Typography variant="caption" color="text.secondary">
                          +{attention.length - 8} more
                        </Typography>
                      )}
                    </List>
                  )}
                </SectionCard>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <SectionCard
                  title={`Open escalations (${escalations.length})`}
                  action={
                    (can('incident:manage') || can('dispatch:manage')) && (
                      <Button component={RouterLink} to="/admin/incidents" size="small">
                        All escalations
                      </Button>
                    )
                  }
                >
                  {board.isLoading ? (
                    <LoadingBlock rows={3} />
                  ) : !escalations.length ? (
                    <EmptyState title="No open escalations" />
                  ) : (
                    <List dense disablePadding>
                      {escalations.slice(0, 8).map((e) => (
                        <ListItem key={e.id} disableGutters divider>
                          <ListItemText
                            primary={
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                  {humanize(e.type)}
                                </Typography>
                                <Chip size="small" color={ESCALATION_COLOR(e.status)} label={humanize(e.status)} />
                                <Link component={RouterLink} to={bookingHref(e.bookingId)}>
                                  {e.booking?.code ?? 'Booking'}
                                </Link>
                              </Stack>
                            }
                            secondary={`${e.detail} · ${relative(e.createdAt)}`}
                          />
                        </ListItem>
                      ))}
                    </List>
                  )}
                </SectionCard>
              </Grid>
            </Grid>
          )}
          {!ops && !finance && <EmptyState title="No dashboard access" body="Your role does not include reports or finance permissions." />}
        </Stack>
      )}
    </Box>
  );
}
