import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Box, Button, Card, CardContent, Checkbox, Chip, InputAdornment, ListItemText, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '@/api/client';
import type { BookingStatus, BookingSummary } from '@/api/types';
import { Money, PageHeader, PaymentChip, StatusChip } from '@/components/common';
import { DataTable, type Column } from '@/components/DataTable';
import { dateTime, humanize, STATUS_LABELS } from '@/lib/format';
import { FilterSelect, FlagChips, PriorityChip, useDebounced, useServiceCategories, useZones } from './ops/shared';

const GROUPS = [
  ['active', 'Active (open)'],
  ['unassigned', 'Needs provider'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled / failed'],
] as const;

const ALL_STATUSES = Object.keys(STATUS_LABELS) as BookingStatus[];

/** List item as returned to staff (the shared BookingSummary type predates `contactName`). */
type Row = BookingSummary & { contactName?: string | null };

/** Local-midnight ISO timestamp for a yyyy-mm-dd input; `plusDays` makes an exclusive upper bound. */
function dayStartIso(d: string, plusDays = 0) {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + plusDays);
  return x.toISOString();
}

export default function Bookings() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const page = Number(params.get('page') ?? 1) || 1;
  const pageSize = Number(params.get('pageSize') ?? 20) || 20;
  const statuses = get('status') ? get('status').split(',') : [];
  const urlQ = get('q');
  const [search, setSearch] = useState(urlQ);
  const debounced = useDebounced(search.trim());
  const zones = useZones();
  const services = useServiceCategories();

  const update = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  // Global search in the top bar navigates here with ?q=; keep the box in sync.
  useEffect(() => {
    setSearch(urlQ);
  }, [urlQ]);
  useEffect(() => {
    if (debounced !== urlQ) update({ q: debounced || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const query = {
    page,
    pageSize,
    q: urlQ || undefined,
    group: statuses.length ? undefined : get('group') || undefined,
    status: statuses.length ? statuses.join(',') : undefined,
    zoneId: get('zoneId') || undefined,
    serviceCategoryId: get('serviceCategoryId') || undefined,
    from: get('from') ? dayStartIso(get('from')) : undefined,
    to: get('to') ? dayStartIso(get('to'), 1) : undefined,
  };
  const list = useQuery({
    queryKey: ['bookings', 'admin', query],
    queryFn: () => api.page<Row>('/bookings', query),
    placeholderData: keepPreviousData,
  });

  const filtersActive = ['q', 'group', 'status', 'zoneId', 'serviceCategoryId', 'from', 'to'].some((k) => params.get(k));

  const columns: Column<Row>[] = [
    {
      key: 'code',
      header: 'Booking',
      primary: true,
      render: (b) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {b.code}
          </Typography>
          {b.type === 'SCHEDULED' && (
            <Typography variant="caption" color="text.secondary">
              Scheduled {dateTime(b.scheduledFor)}
            </Typography>
          )}
        </Box>
      ),
    },
    { key: 'created', header: 'Created', render: (b) => <Box sx={{ whiteSpace: 'nowrap' }}>{dateTime(b.createdAt)}</Box> },
    { key: 'contact', header: 'Customer / contact', render: (b) => b.contactName ?? '—' },
    { key: 'service', header: 'Service', render: (b) => b.serviceCategory.name },
    {
      key: 'vehicle',
      header: 'Vehicle',
      render: (b) =>
        b.vehicle ? (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {b.vehicle.registrationNumber}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {b.vehicle.make} {b.vehicle.model}
            </Typography>
          </Box>
        ) : (
          '—'
        ),
    },
    { key: 'zone', header: 'Zone', hideOnMobile: true, render: (b) => b.zone?.name ?? '—' },
    { key: 'status', header: 'Status', render: (b) => <StatusChip status={b.status} /> },
    {
      key: 'flags',
      header: 'Priority / flags',
      hideOnMobile: true,
      render: (b) => (
        <Stack spacing={0.5} alignItems="flex-start">
          <Stack direction="row" spacing={0.5}>
            <PriorityChip priority={b.priority} hideNormal />
            {b.requiresManualReview && <Chip size="small" color="warning" label="Review" />}
          </Stack>
          <FlagChips flags={b.safetyFlags} max={1} />
          {b.priority === 'NORMAL' && !b.requiresManualReview && !b.safetyFlags.length && '—'}
        </Stack>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (b) =>
        b.invoice ? (
          <Tooltip title={`Invoice ${b.invoice.number}`}>
            <span>
              <Money value={b.invoice.total} strong />
            </span>
          </Tooltip>
        ) : b.quotes[0] ? (
          <Box>
            <Money value={b.quotes[0].total} />
            <Typography variant="caption" color="text.secondary" display="block">
              quote · {humanize(b.quotes[0].status).toLowerCase()}
            </Typography>
          </Box>
        ) : (
          '—'
        ),
    },
    { key: 'payment', header: 'Payment', render: (b) => (b.invoice ? <PaymentChip status={b.invoice.paymentStatus} /> : <Typography variant="caption" color="text.secondary">Not invoiced</Typography>) },
  ];

  return (
    <Box>
      <PageHeader title="Bookings" subtitle={list.data ? `${list.data.meta.total.toLocaleString('en-IN')} booking${list.data.meta.total === 1 ? '' : 's'} match` : 'All customer bookings'} />
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <TextField
              size="small"
              placeholder="Code, vehicle number or contact name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ flex: '1 1 260px' }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Search bookings', maxLength: 60 } }}
            />
            <FilterSelect label="Group" value={statuses.length ? '' : get('group')} onChange={(v) => update({ group: v || null, status: null })} options={GROUPS.map(([value, label]) => ({ value, label }))} allLabel="All bookings" />
            <TextField
              select
              size="small"
              label="Status"
              value={statuses}
              onChange={(e) => {
                const v = e.target.value as unknown as string[];
                update({ status: v.length ? v.join(',') : null, group: null });
              }}
              sx={{ minWidth: 200, flex: { xs: '1 1 200px', md: '0 0 auto' } }}
              slotProps={{
                select: {
                  multiple: true,
                  renderValue: (v) => {
                    const arr = v as string[];
                    return arr.length === 1 ? STATUS_LABELS[arr[0] as BookingStatus] : `${arr.length} statuses`;
                  },
                },
              }}
            >
              {ALL_STATUSES.map((s) => (
                <MenuItem key={s} value={s} dense>
                  <Checkbox size="small" checked={statuses.includes(s)} sx={{ py: 0 }} />
                  <ListItemText primary={STATUS_LABELS[s]} />
                </MenuItem>
              ))}
            </TextField>
            <FilterSelect label="Zone" value={get('zoneId')} onChange={(v) => update({ zoneId: v || null })} options={(zones.data ?? []).map((z) => ({ value: z.id, label: z.name }))} allLabel="All zones" />
            <FilterSelect label="Service" value={get('serviceCategoryId')} onChange={(v) => update({ serviceCategoryId: v || null })} options={(services.data ?? []).map((s) => ({ value: s.id, label: s.name }))} allLabel="All services" />
            <TextField size="small" type="date" label="Created from" value={get('from')} onChange={(e) => update({ from: e.target.value || null })} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: { xs: '1 1 150px', md: '0 0 auto' } }} />
            <TextField size="small" type="date" label="Created to" value={get('to')} onChange={(e) => update({ to: e.target.value || null })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: get('from') || undefined } }} sx={{ flex: { xs: '1 1 150px', md: '0 0 auto' } }} />
            {filtersActive && (
              <Button
                onClick={() => {
                  setSearch('');
                  setParams(new URLSearchParams(), { replace: true });
                }}
              >
                Clear filters
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>
      <DataTable
        rows={list.data?.data}
        columns={columns}
        rowKey={(b) => b.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(b) => nav(`/admin/bookings/${b.id}`)}
        emptyTitle={filtersActive ? 'No bookings match these filters' : 'No bookings yet'}
        emptyBody={filtersActive ? 'Try widening the date range or clearing filters.' : undefined}
        page={page}
        pageSize={pageSize}
        total={list.data?.meta.total}
        onPageChange={(p) => update({ page: String(p) }, false)}
        onPageSizeChange={(s) => update({ pageSize: String(s) })}
      />
    </Box>
  );
}
