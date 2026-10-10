import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Drawer,
  Grid,
  List,
  ListItemButton,
  Stack,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { api } from '@/api/client';
import { EmptyState, ErrorState, LoadingBlock, PageHeader, SectionCard, StatusChip } from '@/components/common';
import { DataTable, type Column } from '@/components/DataTable';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeEvent } from '@/hooks/useRealtime';
import { useAppSelector } from '@/store';
import { dateTime, humanize, relative, time } from '@/lib/format';
import { reviewPending } from './ops/BookingActions';
import { BookingPanel } from './ops/BookingPanel';
import { DispatchMap, type LiveDriver } from './ops/DispatchMap';
import { BookingLink, Countdown, ESCALATION_COLOR, FIELD_ACTIVE, FilterSelect, FlagChips, NEEDS_PROVIDER, PriorityChip, ReasonDialog, useNotice, type Notify } from './ops/shared';
import type { BoardBooking, DispatchBoard, Escalation, Incident } from './ops/types';

type QueueKey = 'needs' | 'review' | 'active' | 'awaiting' | 'scheduled' | 'escalations' | 'incidents';

function classify(b: BoardBooking): Exclude<QueueKey, 'escalations' | 'incidents'> {
  if (reviewPending(b)) return 'review';
  if (b.type === 'SCHEDULED' && ['REQUESTED', 'QUOTED', 'CONFIRMED'].includes(b.status)) return 'scheduled';
  if (NEEDS_PROVIDER.includes(b.status)) return 'needs';
  if (b.status === 'REQUESTED' || b.status === 'QUOTED') return 'awaiting';
  return 'active';
}

function QueueRow({ b, selected, onClick }: { b: BoardBooking; selected: boolean; onClick: () => void }) {
  const offered = b.assignments.find((a) => a.status === 'OFFERED');
  const accepted = b.assignments.find((a) => a.status === 'ACCEPTED');
  const declines = b.assignments.filter((a) => a.status === 'REJECTED' || a.status === 'TIMED_OUT').length;
  const pickup = b.locations.find((l) => l.kind === 'PICKUP');
  return (
    <ListItemButton selected={selected} onClick={onClick} sx={{ borderRadius: 2, mb: 0.5, alignItems: 'flex-start', border: 1, borderColor: selected ? 'primary.main' : 'divider' }}>
      <Box sx={{ width: '100%', minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontWeight: 700 }}>{b.code}</Typography>
            <StatusChip status={b.status} />
            <PriorityChip priority={b.priority} hideNormal />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {b.type === 'SCHEDULED' && b.scheduledFor ? `for ${dateTime(b.scheduledFor)}` : relative(b.createdAt)}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ mt: 0.25 }} noWrap>
          {b.serviceCategory.name}
          {b.vehicle ? ` · ${b.vehicle.registrationNumber} (${humanize(b.vehicle.vehicleClass)})` : ''}
        </Typography>
        {pickup && (
          <Typography variant="caption" color="text.secondary" display="block" noWrap>
            {pickup.address ?? `${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)}`}
          </Typography>
        )}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
          {accepted && <Chip size="small" color="success" variant="outlined" label={`Accepted · ${accepted.driver.fullName}`} />}
          {offered && (
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label={
                <>
                  Offered to {offered.driver.fullName} · <Countdown to={offered.expiresAt} expiredLabel="timing out" />
                </>
              }
            />
          )}
          {declines > 0 && <Chip size="small" color="error" variant="outlined" label={`${declines} declined/timed out`} />}
          {b.etaAt && FIELD_ACTIVE.includes(b.status) && <Chip size="small" variant="outlined" label={`ETA ${time(b.etaAt)}`} />}
          <FlagChips flags={b.safetyFlags} max={2} />
        </Stack>
      </Box>
    </ListItemButton>
  );
}

function EscalationList({ items, onSelect, notify }: { items: Escalation[]; onSelect: (id: string) => void; notify: Notify }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can('dispatch:manage') || can('incident:manage');
  const [resolving, setResolving] = useState<Escalation | null>(null);
  const act = useMutation({
    mutationFn: (v: { id: string; action: 'ack' | 'resolve'; resolution?: string }) => api.post(`/dispatch/escalations/${v.id}/${v.action}`, v.resolution ? { resolution: v.resolution } : {}),
    onSuccess: (_, v) => {
      void qc.invalidateQueries({ queryKey: ['dispatch'] });
      setResolving(null);
      notify(v.action === 'ack' ? 'Escalation acknowledged' : 'Escalation resolved');
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  if (!items.length) return <EmptyState title="No open escalations" body="Driver declines, timeouts, missed ETAs and stale locations appear here." />;
  return (
    <Stack spacing={1}>
      {items.map((e) => (
        <Card key={e.id} variant="outlined">
          <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between">
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography sx={{ fontWeight: 700 }}>{humanize(e.type)}</Typography>
                  <Chip size="small" color={ESCALATION_COLOR(e.status)} label={humanize(e.status)} />
                  <Button size="small" onClick={() => onSelect(e.bookingId)} sx={{ minWidth: 0, p: 0 }}>
                    {e.booking?.code ?? 'Booking'}
                  </Button>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {e.detail}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {dateTime(e.createdAt)} ({relative(e.createdAt)})
                </Typography>
              </Box>
              {manage && <Stack direction="row" spacing={1} alignItems="center">
                {e.status === 'OPEN' && (
                  <Button size="small" variant="outlined" disabled={act.isPending} onClick={() => act.mutate({ id: e.id, action: 'ack' })}>
                    Acknowledge
                  </Button>
                )}
                <Button size="small" variant="contained" disabled={act.isPending} onClick={() => setResolving(e)}>
                  Resolve
                </Button>
              </Stack>}
            </Stack>
          </CardContent>
        </Card>
      ))}
      <ReasonDialog
        open={!!resolving}
        title="Resolve escalation?"
        body={`${humanize(resolving?.type)} on ${resolving?.booking?.code ?? 'booking'}: ${resolving?.detail ?? ''}. Resolve only once the underlying issue is handled; a new escalation is raised if it recurs.`}
        label="Resolution note"
        optional
        maxLength={2000}
        confirmLabel="Resolve"
        loading={act.isPending}
        onClose={() => setResolving(null)}
        onConfirm={(r) => resolving && act.mutate({ id: resolving.id, action: 'resolve', resolution: r || undefined })}
      />
    </Stack>
  );
}

function IncidentList({ items, onSelect, notify }: { items: Incident[]; onSelect: (id: string) => void; notify: Notify }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [resolving, setResolving] = useState<Incident | null>(null);
  const act = useMutation({
    mutationFn: (v: { id: string; action: 'ack' | 'resolve'; resolution?: string }) => api.post(`/dispatch/incidents/${v.id}/${v.action}`, v.resolution ? { resolution: v.resolution } : {}),
    onSuccess: (_, v) => {
      void qc.invalidateQueries({ queryKey: ['dispatch'] });
      setResolving(null);
      notify(v.action === 'ack' ? 'Incident acknowledged' : 'Incident resolved');
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  if (!items.length) return <EmptyState title="No open incidents" body="Incidents reported by field teams (accidents, unsafe locations, injuries) appear here." />;
  const manage = can('incident:manage');
  return (
    <Stack spacing={1}>
      {items.map((i) => (
        <Card key={i.id} variant="outlined" sx={{ borderColor: i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'error.main' : undefined }}>
          <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between">
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography sx={{ fontWeight: 700 }}>{humanize(i.type)}</Typography>
                  <PriorityChip priority={i.severity} />
                  <Chip size="small" color={ESCALATION_COLOR(i.status)} label={humanize(i.status)} />
                  {i.bookingId && (
                    <Button size="small" onClick={() => onSelect(i.bookingId!)} sx={{ minWidth: 0, p: 0 }}>
                      View booking
                    </Button>
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {i.description}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {dateTime(i.createdAt)} ({relative(i.createdAt)})
                </Typography>
              </Box>
              {manage && (
                <Stack direction="row" spacing={1} alignItems="center">
                  {i.status === 'OPEN' && (
                    <Button size="small" variant="outlined" disabled={act.isPending} onClick={() => act.mutate({ id: i.id, action: 'ack' })}>
                      Acknowledge
                    </Button>
                  )}
                  <Button size="small" variant="contained" disabled={act.isPending} onClick={() => setResolving(i)}>
                    Resolve
                  </Button>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      ))}
      <ReasonDialog
        open={!!resolving}
        title={`Resolve ${humanize(resolving?.type)} incident`}
        label="Resolution"
        maxLength={2000}
        loading={act.isPending}
        confirmLabel="Resolve"
        onClose={() => setResolving(null)}
        onConfirm={(r) => resolving && act.mutate({ id: resolving.id, action: 'resolve', resolution: r })}
      />
    </Stack>
  );
}

const HISTORY_STATUSES = ['REJECTED', 'TIMED_OUT'];

interface HistoryRow {
  id: string;
  bookingId: string;
  driverUserId: string;
  status: string;
  method: string;
  attempt: number;
  offeredAt: string;
  respondedAt: string | null;
  rejectionReason: string | null;
  distanceKm: number | null;
  etaMinutes: number | null;
  driver: { fullName: string };
  booking: { code: string };
}

function RejectionHistory() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const q = useQuery({
    queryKey: ['dispatch', 'assignment-history', status, page, pageSize],
    queryFn: () => api.page<HistoryRow>('/dispatch/assignments/history', { status: status || undefined, page, pageSize }),
  });
  const columns: Column<HistoryRow>[] = [
    { key: 'when', header: 'Offered', render: (r) => dateTime(r.offeredAt) },
    { key: 'booking', header: 'Booking', primary: true, render: (r) => <BookingLink id={r.bookingId} code={r.booking.code} /> },
    { key: 'driver', header: 'Driver', render: (r) => r.driver.fullName },
    { key: 'status', header: 'Outcome', render: (r) => <Chip size="small" variant="outlined" color={r.status === 'TIMED_OUT' ? 'warning' : 'error'} label={r.status === 'TIMED_OUT' ? 'Timed out' : 'Declined'} /> },
    { key: 'reason', header: 'Reason', render: (r) => r.rejectionReason ?? '—' },
    { key: 'method', header: 'Offer', hideOnMobile: true, render: (r) => `${humanize(r.method)} · attempt ${r.attempt}` },
    { key: 'distance', header: 'Distance / ETA', hideOnMobile: true, render: (r) => `${r.distanceKm != null ? `${r.distanceKm} km` : '—'} / ${r.etaMinutes != null ? `${r.etaMinutes} min` : '—'}` },
    { key: 'resp', header: 'Responded', hideOnMobile: true, render: (r) => dateTime(r.respondedAt) },
  ];
  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <FilterSelect
          label="Outcome"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={HISTORY_STATUSES.map((s) => ({ value: s, label: s === 'TIMED_OUT' ? 'Timed out' : 'Declined' }))}
          allLabel="Declined & timed out"
        />
      </Stack>
      <DataTable
        rows={q.data?.data}
        columns={columns}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        emptyTitle="No declined or timed-out offers"
        page={page}
        pageSize={pageSize}
        total={q.data?.meta.total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        dense
      />
    </Box>
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: number | string; tone?: 'error' | 'warning' | 'success'; onClick?: () => void }) {
  return (
    <Card sx={{ flex: '1 1 140px', cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.3, display: 'block' }}>
          {label}
        </Typography>
        <Typography variant="h3" component="div" color={tone ? `${tone}.main` : undefined} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function Dispatch() {
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('lg'));
  const { can } = useAuth();
  const socketConnected = useAppSelector((s) => s.ui.socketConnected);
  const { notify, node } = useNotice();
  const [params, setParams] = useSearchParams();
  const selected = params.get('booking');
  const view = params.get('view') === 'history' ? 'history' : 'live';
  const [queue, setQueue] = useState<QueueKey>('needs');
  const [live, setLive] = useState<Record<string, { lat: number; lng: number; at: string }>>({});

  const board = useQuery({ queryKey: ['dispatch', 'board'], queryFn: () => api.get<DispatchBoard>('/dispatch/board'), refetchInterval: 15_000 });

  useRealtimeEvent((e) => {
    if (e.type !== 'driver.location') return;
    const d = e.data as { userId?: string; lat?: number; lng?: number; at?: string };
    if (!d.userId || d.lat == null || d.lng == null) return;
    setLive((m) => ({ ...m, [d.userId!]: { lat: d.lat!, lng: d.lng!, at: d.at ?? e.ts } }));
  });

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('booking', id);
    else next.delete('booking');
    setParams(next, { replace: true });
  };
  const setView = (v: 'live' | 'history') => {
    const next = new URLSearchParams(params);
    if (v === 'history') next.set('view', 'history');
    else next.delete('view');
    setParams(next, { replace: true });
  };

  const data = board.data;
  const drivers: LiveDriver[] = useMemo(
    () =>
      (data?.drivers ?? []).map((d) => {
        const l = live[d.id];
        if (l && (!d.lastLocationAt || new Date(l.at) > new Date(d.lastLocationAt))) return { ...d, lat: l.lat, lng: l.lng, lastLocationAt: l.at, locationStale: false, live: true };
        return d;
      }),
    [data?.drivers, live],
  );
  const queues = useMemo(() => {
    const out: Record<Exclude<QueueKey, 'escalations' | 'incidents'>, BoardBooking[]> = { needs: [], review: [], active: [], awaiting: [], scheduled: [] };
    for (const b of data?.bookings ?? []) out[classify(b)].push(b);
    return out;
  }, [data?.bookings]);

  const available = drivers.filter((d) => d.status === 'AVAILABLE' && d.verification === 'APPROVED').length;
  const onShiftStale = drivers.filter((d) => d.status && d.status !== 'OFF_DUTY' && d.locationStale).length;
  const openEsc = (data?.escalations ?? []).filter((e) => e.status === 'OPEN').length;

  const queueTabs: { key: QueueKey; label: string; count: number; alert?: boolean }[] = [
    { key: 'needs', label: 'Needs provider', count: queues.needs.length, alert: queues.needs.length > 0 },
    { key: 'review', label: 'Safety review', count: queues.review.length, alert: queues.review.length > 0 },
    { key: 'active', label: 'Active jobs', count: queues.active.length },
    { key: 'escalations', label: 'Escalations', count: data?.escalations.length ?? 0, alert: openEsc > 0 },
    { key: 'incidents', label: 'Incidents', count: data?.incidents.length ?? 0, alert: (data?.incidents.length ?? 0) > 0 },
    { key: 'scheduled', label: 'Scheduled', count: queues.scheduled.length },
    { key: 'awaiting', label: 'Awaiting customer', count: queues.awaiting.length },
  ];

  const queueBody = () => {
    if (queue === 'escalations') return <EscalationList items={data?.escalations ?? []} onSelect={select} notify={notify} />;
    if (queue === 'incidents') return <IncidentList items={data?.incidents ?? []} onSelect={(id) => select(id)} notify={notify} />;
    const list = queues[queue];
    const empty: Record<string, string> = {
      needs: 'Every confirmed booking has a provider offer or acceptance.',
      review: 'No bookings are waiting for a manual safety review.',
      active: 'No jobs are in progress right now.',
      scheduled: 'No upcoming scheduled bookings.',
      awaiting: 'No bookings are waiting on customer quote approval.',
    };
    if (!list.length) return <EmptyState title="Queue is clear" body={empty[queue]} />;
    return (
      <List disablePadding>
        {list.map((b) => (
          <QueueRow key={b.id} b={b} selected={b.id === selected} onClick={() => select(b.id)} />
        ))}
      </List>
    );
  };

  const panel = selected ? <BookingPanel key={selected} id={selected} onClose={() => select(null)} notify={notify} /> : null;

  return (
    <Box>
      <PageHeader
        title="Dispatch centre"
        subtitle={
          <>
            Live board refreshes every 15 s and on realtime events · {socketConnected ? 'live updates connected' : 'live updates reconnecting'}
            {data && ` · updated ${time(data.serverTime)}`}
          </>
        }
        actions={
          <Tabs value={view} onChange={(_, v) => setView(v)}>
            <Tab value="live" label="Live board" />
            {can('dispatch:manage') && <Tab value="history" label="Rejections & timeouts" />}
          </Tabs>
        }
      />
      {view === 'history' && can('dispatch:manage') ? (
        <RejectionHistory />
      ) : board.isLoading ? (
        <LoadingBlock rows={6} height={80} />
      ) : board.error ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} title="Could not load the dispatch board" />
      ) : (
        <>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <Stat label="Needs provider" value={queues.needs.length} tone={queues.needs.length ? 'error' : undefined} onClick={() => setQueue('needs')} />
            <Stat label="Safety review" value={queues.review.length} tone={queues.review.length ? 'warning' : undefined} onClick={() => setQueue('review')} />
            <Stat label="Active jobs" value={queues.active.length} onClick={() => setQueue('active')} />
            <Stat label="Drivers available" value={`${available}/${drivers.length}`} tone={available ? 'success' : 'error'} />
            <Stat label="Stale locations (on shift)" value={onShiftStale} tone={onShiftStale ? 'warning' : undefined} />
            <Stat label="Open escalations" value={openEsc} tone={openEsc ? 'error' : undefined} onClick={() => setQueue('escalations')} />
          </Stack>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, lg: selected ? 7 : 12 }}>
              <Stack spacing={2}>
                <SectionCard
                  title="Live map"
                  action={
                    <Typography variant="caption" color="text.secondary">
                      {(data?.bookings ?? []).length} open bookings · {drivers.filter((d) => d.lat != null).length} drivers with a location
                    </Typography>
                  }
                >
                  <DispatchMap bookings={data?.bookings ?? []} drivers={drivers} zones={data?.zones ?? []} selectedId={selected} onSelect={select} height={wide ? 460 : 340} />
                </SectionCard>
                <SectionCard sx={{ minWidth: 0 }}>
                  <Tabs value={queue} onChange={(_, v) => setQueue(v)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ mb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                    {queueTabs.map((t) => (
                      <Tab
                        key={t.key}
                        value={t.key}
                        label={
                          <Stack direction="row" spacing={1} alignItems="center">
                            <span>{t.label}</span>
                            <Badge color={t.alert ? 'error' : 'default'} badgeContent={t.count} showZero max={99} sx={{ '& .MuiBadge-badge': { position: 'static', transform: 'none' } }} />
                          </Stack>
                        }
                      />
                    ))}
                  </Tabs>
                  {queueBody()}
                </SectionCard>
                <DriverRoster drivers={drivers} />
              </Stack>
            </Grid>
            {selected && wide && (
              <Grid size={{ xs: 12, lg: 5 }}>
                <Card sx={{ position: 'sticky', top: 80, maxHeight: 'calc(100dvh - 100px)', overflow: 'auto' }}>
                  <CardContent>{panel}</CardContent>
                </Card>
              </Grid>
            )}
          </Grid>
          {!wide && (
            <Drawer anchor="right" open={!!selected} onClose={() => select(null)} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 }, p: 2 } } }}>
              {panel}
            </Drawer>
          )}
        </>
      )}
      {node}
    </Box>
  );
}

function DriverRoster({ drivers }: { drivers: LiveDriver[] }) {
  const [filter, setFilter] = useState('');
  const shown = drivers.filter((d) => !filter || d.status === filter);
  return (
    <SectionCard
      title="Driver roster"
      action={
        <FilterSelect
          label="Availability"
          value={filter}
          onChange={setFilter}
          options={['AVAILABLE', 'ON_JOB', 'BUSY', 'ON_BREAK', 'OFF_DUTY'].map((s) => ({ value: s, label: humanize(s) }))}
          minWidth={140}
        />
      }
    >
      {!shown.length ? (
        <EmptyState title="No drivers match" />
      ) : (
        <Grid container spacing={1}>
          {shown.map((d) => (
            <Grid key={d.id} size={{ xs: 12, sm: 6, xl: 4 }}>
              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.25, height: '100%' }}>
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Typography sx={{ fontWeight: 700 }} noWrap>
                    {d.name}
                  </Typography>
                  <Chip size="small" color={d.status === 'AVAILABLE' ? 'success' : d.status === 'ON_JOB' || d.status === 'BUSY' ? 'info' : d.status === 'ON_BREAK' ? 'warning' : 'default'} label={humanize(d.status ?? 'OFF_DUTY')} />
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block">
                  {d.truck ? `${d.truck.registrationNumber} · ${humanize(d.truck.truckType)} · truck ${humanize(d.truck.status).toLowerCase()}` : 'No truck assigned'}
                  {d.verification !== 'APPROVED' && ` · verification ${humanize(d.verification).toLowerCase()}`}
                </Typography>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.25 }}>
                  {d.locationStale && <WarningAmberIcon sx={{ fontSize: 15, color: 'warning.main' }} />}
                  <Typography variant="caption" color={d.locationStale ? 'warning.main' : 'text.secondary'}>
                    {d.lastLocationAt ? `${d.locationStale ? 'Stale location · ' : d.live ? 'Live · ' : ''}last update ${relative(d.lastLocationAt)} (${time(d.lastLocationAt)})` : 'No location reported'}
                  </Typography>
                </Stack>
              </Box>
            </Grid>
          ))}
        </Grid>
      )}
    </SectionCard>
  );
}
