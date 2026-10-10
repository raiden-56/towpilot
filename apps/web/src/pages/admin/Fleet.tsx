import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardContent, Chip, Grid, InputAdornment, Link, List, ListItem, ListItemText, Stack, TextField, Tooltip, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import RuleOutlinedIcon from '@mui/icons-material/RuleOutlined';
import { api } from '@/api/client';
import { EmptyState, ErrorState, LoadingBlock, PageHeader, SampleTag, SectionCard } from '@/components/common';
import { DataTable, type Column } from '@/components/DataTable';
import { useAuth } from '@/hooks/useAuth';
import { date, humanize, VEHICLE_CLASS_LABELS } from '@/lib/format';
import { TruckFormDialog } from './ops/TruckFormDialog';
import { FilterSelect, opts, REMINDER_BASIS_LABEL, ReminderBadges, TRUCK_STATUS_COLOR, TRUCK_STATUSES, TRUCK_TYPES, useDebounced, useNotice, useZones } from './ops/shared';
import type { Reminder, Truck } from './ops/types';

interface RemindersResponse {
  items: { truck: { id: string; registrationNumber: string; truckType: string; status: string }; reminders: Reminder[] }[];
  basis: string;
}

function RemindersPanel() {
  const q = useQuery({ queryKey: ['admin', 'fleet', 'reminders'], queryFn: () => api.get<RemindersResponse>('/admin/fleet/reminders') });
  const items = q.data?.items ?? [];
  const sorted = [...items].sort((a, b) => b.reminders.filter((r) => r.severity === 'OVERDUE').length - a.reminders.filter((r) => r.severity === 'OVERDUE').length);
  return (
    <SectionCard
      title={
        <Box>
          <Typography variant="h5">Maintenance reminders</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.25 }}>
            <RuleOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="caption" color="text.secondary">
              {REMINDER_BASIS_LABEL}
            </Typography>
          </Stack>
        </Box>
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <LoadingBlock rows={3} />
      ) : !sorted.length ? (
        <EmptyState title="Nothing due" body="No service, inspection or document reminders in the next 30 days." />
      ) : (
        <List dense disablePadding sx={{ maxHeight: 520, overflow: 'auto' }}>
          {sorted.map(({ truck, reminders }) => (
            <ListItem key={truck.id} disableGutters divider alignItems="flex-start">
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Link component={RouterLink} to={`/admin/fleet/${truck.id}`} sx={{ fontWeight: 700 }}>
                      {truck.registrationNumber}
                    </Link>
                    <Typography variant="caption" color="text.secondary">
                      {humanize(truck.truckType)} · {humanize(truck.status).toLowerCase()}
                    </Typography>
                  </Stack>
                }
                secondary={
                  <Box component="span" sx={{ display: 'block' }}>
                    {reminders.map((r, i) => (
                      <Box component="span" key={i} sx={{ display: 'block', color: r.severity === 'OVERDUE' ? 'error.main' : 'warning.main' }}>
                        {r.severity === 'OVERDUE' ? 'Overdue: ' : 'Due soon: '}
                        {r.message}
                        {r.dueAt && ` (${date(r.dueAt)})`}
                        {r.basis === 'RULE_BASED_PROJECTION' && ' · linear projection from odometer history'}
                      </Box>
                    ))}
                  </Box>
                }
                slotProps={{ secondary: { component: 'span' } }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </SectionCard>
  );
}

export default function Fleet() {
  const nav = useNavigate();
  const { can } = useAuth();
  const { notify, fail, node } = useNotice();
  const zones = useZones();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const page = Number(get('page') || 1);
  const pageSize = Number(get('pageSize') || 20);
  const [search, setSearch] = useState(get('q'));
  const q = useDebounced(search.trim());
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);

  const update = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if (q !== get('q')) update({ q: q || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = { status: get('status') || undefined, zoneId: get('zoneId') || undefined, truckType: get('truckType') || undefined, q: get('q') || undefined, page, pageSize };
  const list = useQuery({ queryKey: ['admin', 'fleet', 'trucks', query], queryFn: () => api.page<Truck>('/admin/fleet/trucks', query), placeholderData: keepPreviousData });

  const doExport = async () => {
    setExporting(true);
    try {
      await api.download('/admin/fleet/trucks.csv', 'fleet.csv');
      notify('Fleet CSV downloaded');
    } catch (e) {
      fail(e);
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<Truck>[] = [
    {
      key: 'reg',
      header: 'Truck',
      primary: true,
      render: (t) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {t.registrationNumber}
            <SampleTag show={t.isSample} />
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t.make} {t.model}
          </Typography>
        </Box>
      ),
    },
    { key: 'type', header: 'Type', render: (t) => humanize(t.truckType) },
    { key: 'status', header: 'Status', render: (t) => <Chip size="small" color={TRUCK_STATUS_COLOR(t.status)} label={humanize(t.status)} /> },
    { key: 'capacity', header: 'Capacity', hideOnMobile: true, render: (t) => `${t.maxLoadKg.toLocaleString('en-IN')} kg · up to ${VEHICLE_CLASS_LABELS[t.maxVehicleClass] ?? t.maxVehicleClass}` },
    { key: 'zone', header: 'Zone', hideOnMobile: true, render: (t) => t.zone?.name ?? '—' },
    { key: 'driver', header: 'Driver', render: (t) => t.assignedDriver?.fullName ?? <Typography variant="caption" color="text.secondary">Unassigned</Typography> },
    { key: 'odo', header: 'Odometer', align: 'right', hideOnMobile: true, render: (t) => `${t.odometerKm.toLocaleString('en-IN')} km` },
    {
      key: 'equipment',
      header: 'Equipment',
      hideOnMobile: true,
      render: (t) => {
        const bad = t.equipment.filter((e) => e.status !== 'OK');
        return bad.length ? (
          <Tooltip title={bad.map((e) => `${humanize(e.type)}: ${humanize(e.status).toLowerCase()}`).join(', ')}>
            <Chip size="small" color="error" variant="outlined" label={`${bad.length} issue${bad.length > 1 ? 's' : ''}`} />
          </Tooltip>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {t.equipment.length} items OK
          </Typography>
        );
      },
    },
    { key: 'reminders', header: 'Reminders', render: (t) => <ReminderBadges reminders={t.reminders} /> },
  ];
  const filtersActive = ['status', 'zoneId', 'truckType', 'q'].some((k) => params.get(k));

  return (
    <Box>
      <PageHeader
        title="Fleet"
        subtitle={list.data ? `${list.data.meta.total} truck${list.data.meta.total === 1 ? '' : 's'}${get('status') ? '' : ' (retired trucks hidden — filter by status to see them)'}` : 'Tow trucks, equipment and maintenance'}
        actions={
          <>
            <Button variant="outlined" startIcon={<FileDownloadOutlinedIcon />} disabled={exporting} onClick={() => void doExport()}>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
            {can('fleet:manage') && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
                Add truck
              </Button>
            )}
          </>
        }
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, xl: 8 }}>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <TextField
                  size="small"
                  placeholder="Registration number"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  sx={{ flex: '1 1 200px' }}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Search trucks', maxLength: 30 } }}
                />
                <FilterSelect label="Status" value={get('status')} onChange={(v) => update({ status: v })} options={opts(TRUCK_STATUSES)} allLabel="Active fleet" />
                <FilterSelect label="Type" value={get('truckType')} onChange={(v) => update({ truckType: v })} options={opts(TRUCK_TYPES)} />
                <FilterSelect label="Zone" value={get('zoneId')} onChange={(v) => update({ zoneId: v })} options={(zones.data ?? []).map((z) => ({ value: z.id, label: z.name }))} />
                {filtersActive && (
                  <Button
                    onClick={() => {
                      setSearch('');
                      setParams(new URLSearchParams(), { replace: true });
                    }}
                  >
                    Clear
                  </Button>
                )}
              </Stack>
            </CardContent>
          </Card>
          <DataTable
            rows={list.data?.data}
            columns={columns}
            rowKey={(t) => t.id}
            loading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            onRowClick={(t) => nav(`/admin/fleet/${t.id}`)}
            emptyTitle={filtersActive ? 'No trucks match these filters' : 'No trucks yet'}
            emptyBody={!filtersActive && can('fleet:manage') ? 'Add your first tow truck to start dispatching.' : undefined}
            page={page}
            pageSize={pageSize}
            total={list.data?.meta.total}
            onPageChange={(p) => update({ page: String(p) }, false)}
            onPageSizeChange={(s) => update({ pageSize: String(s) })}
          />
        </Grid>
        <Grid size={{ xs: 12, xl: 4 }}>
          <RemindersPanel />
          <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
            Trucks in maintenance, out of service, or with expired insurance/fitness/permit/PUC or missing required equipment are excluded from dispatch automatically.
          </Alert>
        </Grid>
      </Grid>
      <TruckFormDialog open={adding} onClose={() => setAdding(false)} notify={notify} onSaved={(t) => nav(`/admin/fleet/${t.id}`)} />
      {node}
    </Box>
  );
}
