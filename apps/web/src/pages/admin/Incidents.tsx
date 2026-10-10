import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Button, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import { api } from '@/api/client';
import type { BookingStatus } from '@/api/types';
import { PageHeader, StatusChip } from '@/components/common';
import { DataTable, type Column } from '@/components/DataTable';
import { useAuth } from '@/hooks/useAuth';
import { dateTime, humanize, relative } from '@/lib/format';
import { BookingLink, ESCALATION_COLOR, FilterSelect, PriorityChip, ReasonDialog, useNotice } from './ops/shared';
import type { Escalation, Incident } from './ops/types';

const STATUSES = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { value: 'RESOLVED', label: 'Resolved' },
];

export default function Incidents() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { notify, node } = useNotice();
  const [params, setParams] = useSearchParams();
  const canEsc = can('dispatch:manage') || can('incident:manage');
  const canInc = can('incident:manage');
  const tab = params.get('tab') === 'incidents' || !canEsc ? 'incidents' : 'escalations';
  const status = params.get('status') ?? 'OPEN';
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [resolveEsc, setResolveEsc] = useState<Escalation | null>(null);
  const [resolveInc, setResolveInc] = useState<Incident | null>(null);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
    setPage(1);
  };

  const esc = useQuery({
    queryKey: ['dispatch', 'escalations', status, page, pageSize],
    queryFn: () => api.page<Escalation>('/dispatch/escalations', { status: status || undefined, page, pageSize }),
    enabled: tab === 'escalations' && canEsc,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const inc = useQuery({
    queryKey: ['dispatch', 'incidents', status, page, pageSize],
    queryFn: () => api.page<Incident>('/dispatch/incidents', { status: status || undefined, page, pageSize }),
    enabled: tab === 'incidents' && canInc,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const act = useMutation({
    mutationFn: (v: { kind: 'escalations' | 'incidents'; id: string; action: 'ack' | 'resolve'; resolution?: string }) => api.post(`/dispatch/${v.kind}/${v.id}/${v.action}`, v.resolution ? { resolution: v.resolution } : {}),
    onSuccess: (_, v) => {
      void qc.invalidateQueries({ queryKey: ['dispatch'] });
      setResolveEsc(null);
      setResolveInc(null);
      notify(`${v.kind === 'incidents' ? 'Incident' : 'Escalation'} ${v.action === 'ack' ? 'acknowledged' : 'resolved'}`);
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });

  const actions = (kind: 'escalations' | 'incidents', row: Escalation | Incident) =>
    row.status === 'RESOLVED' ? (
      <Typography variant="caption" color="text.secondary">
        Resolved {dateTime(row.resolvedAt)}
      </Typography>
    ) : (
      <Stack direction="row" spacing={1} onClick={(e) => e.stopPropagation()}>
        {row.status === 'OPEN' && (
          <Button size="small" variant="outlined" disabled={act.isPending} onClick={() => act.mutate({ kind, id: row.id, action: 'ack' })}>
            Acknowledge
          </Button>
        )}
        <Button size="small" variant="contained" disabled={act.isPending} onClick={() => (kind === 'escalations' ? setResolveEsc(row as Escalation) : setResolveInc(row as Incident))}>
          Resolve
        </Button>
      </Stack>
    );

  const escColumns: Column<Escalation>[] = [
    { key: 'type', header: 'Escalation', primary: true, render: (e) => <Typography variant="body2" sx={{ fontWeight: 700 }}>{humanize(e.type)}</Typography> },
    { key: 'booking', header: 'Booking', render: (e) => <BookingLink id={e.bookingId} code={e.booking?.code} /> },
    { key: 'bstatus', header: 'Booking status', hideOnMobile: true, render: (e) => (e.booking?.status ? <StatusChip status={e.booking.status as BookingStatus} /> : '—') },
    {
      key: 'detail',
      header: 'Detail',
      render: (e) => (
        <Box sx={{ maxWidth: 420 }}>
          <Typography variant="body2">{e.detail}</Typography>
          {e.resolution && (
            <Typography variant="caption" color="text.secondary">
              Resolution: {e.resolution}
            </Typography>
          )}
        </Box>
      ),
    },
    { key: 'status', header: 'Status', render: (e) => <Chip size="small" color={ESCALATION_COLOR(e.status)} label={humanize(e.status)} /> },
    { key: 'raised', header: 'Raised', render: (e) => <span title={dateTime(e.createdAt)}>{relative(e.createdAt)}</span> },
    { key: 'actions', header: '', align: 'right', render: (e) => actions('escalations', e) },
  ];
  const incColumns: Column<Incident>[] = [
    { key: 'type', header: 'Incident', primary: true, render: (i) => <Typography variant="body2" sx={{ fontWeight: 700 }}>{humanize(i.type)}</Typography> },
    { key: 'severity', header: 'Severity', render: (i) => <PriorityChip priority={i.severity} /> },
    { key: 'booking', header: 'Booking', render: (i) => (i.bookingId ? <BookingLink id={i.bookingId} code={i.booking?.code} /> : '—') },
    {
      key: 'desc',
      header: 'Description',
      render: (i) => (
        <Box sx={{ maxWidth: 420 }}>
          <Typography variant="body2">{i.description}</Typography>
          {i.resolution && (
            <Typography variant="caption" color="text.secondary">
              Resolution: {i.resolution}
            </Typography>
          )}
        </Box>
      ),
    },
    { key: 'status', header: 'Status', render: (i) => <Chip size="small" color={ESCALATION_COLOR(i.status)} label={humanize(i.status)} /> },
    { key: 'reported', header: 'Reported', render: (i) => <span title={dateTime(i.createdAt)}>{relative(i.createdAt)}</span> },
    { key: 'actions', header: '', align: 'right', render: (i) => actions('incidents', i) },
  ];

  const current = tab === 'escalations' ? esc : inc;

  return (
    <Box>
      <PageHeader title="Incidents & escalations" subtitle="Automatic escalations (declines, timeouts, missed ETAs, stale locations, no provider) and incidents reported by field teams." />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setParam('tab', v)}>
          {canEsc && <Tab value="escalations" label="Escalations" />}
          {canInc && <Tab value="incidents" label="Incidents" />}
        </Tabs>
        <FilterSelect label="Status" value={status} onChange={(v) => setParam('status', v)} options={STATUSES} allLabel="All statuses" />
      </Stack>
      {tab === 'escalations' ? (
        <DataTable
          rows={esc.data?.data}
          columns={escColumns}
          rowKey={(e) => e.id}
          loading={esc.isLoading}
          error={esc.error}
          onRetry={() => void esc.refetch()}
          emptyTitle={status === 'OPEN' ? 'No open escalations' : 'No escalations'}
          page={page}
          pageSize={pageSize}
          total={esc.data?.meta.total}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      ) : canInc ? (
        <DataTable
          rows={inc.data?.data}
          columns={incColumns}
          rowKey={(i) => i.id}
          loading={inc.isLoading}
          error={inc.error}
          onRetry={() => void inc.refetch()}
          emptyTitle={status === 'OPEN' ? 'No open incidents' : 'No incidents'}
          page={page}
          pageSize={pageSize}
          total={inc.data?.meta.total}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      ) : (
        <Typography color="text.secondary">You do not have permission to manage incidents.</Typography>
      )}
      {current.isFetching && !current.isLoading && (
        <Typography variant="caption" color="text.secondary">
          Refreshing…
        </Typography>
      )}
      <ReasonDialog
        open={!!resolveEsc}
        title="Resolve escalation?"
        body={`${humanize(resolveEsc?.type)} on ${resolveEsc?.booking?.code ?? 'booking'}: ${resolveEsc?.detail ?? ''}`}
        label="Resolution note"
        optional
        maxLength={2000}
        confirmLabel="Resolve"
        loading={act.isPending}
        onClose={() => setResolveEsc(null)}
        onConfirm={(r) => resolveEsc && act.mutate({ kind: 'escalations', id: resolveEsc.id, action: 'resolve', resolution: r || undefined })}
      />
      <ReasonDialog
        open={!!resolveInc}
        title={`Resolve ${humanize(resolveInc?.type)} incident`}
        body={resolveInc?.description}
        label="Resolution"
        maxLength={2000}
        loading={act.isPending}
        confirmLabel="Resolve incident"
        onClose={() => setResolveInc(null)}
        onConfirm={(r) => resolveInc && act.mutate({ kind: 'incidents', id: resolveInc.id, action: 'resolve', resolution: r })}
      />
      {node}
    </Box>
  );
}
