import { useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  Link,
  List,
  ListItemButton,
  MenuItem,
  Pagination,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { api } from '@/api/client';
import { EmptyState, ErrorState, KeyValue, LoadingBlock, PageHeader, SectionCard } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { dateTime, humanize, relative } from '@/lib/format';
import { BackLink, FilterSelect, opts, PriorityChip, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUS_COLOR, TICKET_STATUSES, useNotice, type Notify } from './ops/shared';
import type { Employee, TicketDetail, TicketSummary } from './ops/types';

const QUEUES = [
  { value: 'OPEN,IN_PROGRESS,AWAITING_CUSTOMER', label: 'Unresolved' },
  ...TICKET_STATUSES.map((s) => ({ value: s, label: humanize(s) })),
];

function TicketPanel({ id, summary, notify }: { id: string; summary?: TicketSummary; notify: Notify }) {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['support', 'ticket', id], queryFn: () => api.get<TicketDetail>(`/support/tickets/${id}`), refetchInterval: 30_000 });
  const t = q.data;
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [resolution, setResolution] = useState('');
  const [verified, setVerified] = useState<'' | 'true' | 'false'>('');
  const [subject, setSubject] = useState<Employee | null>(null);
  const employees = useQuery({
    queryKey: ['admin', 'employees', 'field-staff'],
    queryFn: () => api.page<Employee>('/admin/employees', { pageSize: 100 }),
    enabled: !!t && t.category === 'COMPLAINT' && can('employee:read'),
    staleTime: 5 * 60_000,
  });
  const fieldStaff = (employees.data?.data ?? []).filter((e) => e.roles.includes('driver') || e.roles.includes('worker'));

  useEffect(() => {
    setReply('');
    setInternal(false);
  }, [id]);
  useEffect(() => {
    if (!t) return;
    setResolution(t.resolution ?? '');
    setVerified(t.verified == null ? '' : t.verified ? 'true' : 'false');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id, t?.resolution, t?.verified]);
  useEffect(() => {
    if (t) setSubject(fieldStaff.find((e) => e.id === t.subjectUserId) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.subjectUserId, employees.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['support', 'ticket', id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'tickets'] });
  };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<TicketSummary>(`/admin/system/tickets/${id}`, body),
    onSuccess: (_, body) => {
      refresh();
      notify(body.status === 'RESOLVED' ? 'Ticket resolved — the customer has been notified' : body.assignToMe ? 'Ticket assigned to you' : 'Ticket updated');
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  const send = useMutation({
    mutationFn: () => api.post(`/support/tickets/${id}/messages`, { body: reply.trim(), internal }),
    onSuccess: () => {
      refresh();
      notify(internal ? 'Internal note added' : 'Reply sent — status set to awaiting customer');
      setReply('');
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });

  if (q.isLoading) return <LoadingBlock rows={5} />;
  if (q.error || !t) return <ErrorState error={q.error ?? new Error('Not found')} onRetry={() => void q.refetch()} />;
  const closed = t.status === 'RESOLVED' || t.status === 'CLOSED';
  const mine = t.assignedToId === user?.id;

  return (
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="h4" component="h2">
            {t.number}
          </Typography>
          <Chip size="small" label={humanize(t.category)} variant="outlined" />
          <Chip size="small" color={TICKET_STATUS_COLOR(t.status)} label={humanize(t.status)} />
          <PriorityChip priority={t.priority} />
          {mine ? <Chip size="small" color="info" label="Assigned to you" /> : t.assignedToId ? <Chip size="small" label="Assigned to a colleague" /> : <Chip size="small" variant="outlined" label="Unassigned" />}
        </Stack>
        <Typography sx={{ mt: 0.5, fontWeight: 600 }}>{t.subject}</Typography>
        <Typography variant="body2" color="text.secondary">
          Raised by {summary?.user?.fullName ?? t.messages.find((m) => m.fromCustomer)?.authorName ?? 'user'}
          {summary?.user?.phone && ` (${summary.user.phone})`} · {dateTime(t.createdAt)}
          {t.booking && (
            <>
              {' · '}
              <Link component={RouterLink} to={`/admin/bookings/${t.booking.id}`}>
                {t.booking.code}
              </Link>
            </>
          )}
          {t.invoice && (
            <>
              {' · '}
              {can('finance:read') ? (
                <Link component={RouterLink} to={`/admin/finance/invoices/${t.invoice.id}`}>
                  {t.invoice.number}
                </Link>
              ) : (
                t.invoice.number
              )}
            </>
          )}
        </Typography>
      </Box>

      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        <TextField select size="small" label="Status" value={t.status} disabled={patch.isPending} onChange={(e) => patch.mutate({ status: e.target.value })} sx={{ minWidth: 180 }}>
          {TICKET_STATUSES.map((s) => (
            <MenuItem key={s} value={s} disabled={s === 'RESOLVED'}>
              {humanize(s)}
              {s === 'RESOLVED' ? ' (use Resolve below)' : ''}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Priority" value={t.priority} disabled={patch.isPending} onChange={(e) => patch.mutate({ priority: e.target.value })} sx={{ minWidth: 140 }}>
          {TICKET_PRIORITIES.map((s) => (
            <MenuItem key={s} value={s}>
              {humanize(s)}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="outlined" disabled={mine || patch.isPending} onClick={() => patch.mutate({ assignToMe: true })}>
          {mine ? 'Assigned to you' : 'Assign to me'}
        </Button>
      </Stack>

      {t.category === 'COMPLAINT' && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6">Complaint review</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Only complaints marked <strong>verified</strong> count against the worker’s performance score (for the worker concerned, or the team leader of the linked booking). Mark a complaint verified only after checking evidence; unverified complaints have no effect.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField select size="small" label="Verification" value={verified} onChange={(e) => setVerified(e.target.value as typeof verified)} sx={{ minWidth: 200 }}>
                <MenuItem value="" disabled>
                  Not reviewed yet
                </MenuItem>
                <MenuItem value="true">Verified complaint</MenuItem>
                <MenuItem value="false">Not verified</MenuItem>
              </TextField>
              <Autocomplete
                size="small"
                sx={{ flex: 1, minWidth: 220 }}
                options={fieldStaff}
                value={subject}
                onChange={(_, v) => setSubject(v)}
                loading={employees.isLoading}
                getOptionLabel={(o) => `${o.fullName} · ${o.workerProfile?.employeeCode ?? ''}`}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                renderInput={(p) => <TextField {...p} label="Worker concerned" helperText={!can('employee:read') ? 'Requires employee directory access' : 'Verified complaints also count against the linked booking’s team leader'} />}
              />
              <Button
                variant="contained"
                disabled={patch.isPending || (verified === '' && (subject?.id ?? null) === (t.subjectUserId ?? null))}
                onClick={() => patch.mutate({ ...(verified ? { verified: verified === 'true' } : {}), subjectUserId: subject?.id ?? null })}
              >
                Save
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
      {t.category === 'PERFORMANCE_CHALLENGE' && (
        <Alert severity="info">
          A worker is disputing a performance record. To resolve in the worker’s favour, open the related <strong>complaint</strong> ticket (filter by category “Complaint”) and set it to <strong>Not verified</strong> — the score recalculates from verified complaints only. Then resolve this ticket with an explanation.
        </Alert>
      )}

      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Conversation
        </Typography>
        <Stack spacing={1.25}>
          {t.messages.map((m) => (
            <Box
              key={m.id}
              sx={{
                alignSelf: m.fromCustomer ? 'flex-start' : 'flex-end',
                maxWidth: { xs: '100%', sm: '85%' },
                p: 1.5,
                borderRadius: 2,
                border: 1,
                borderColor: m.internal ? 'warning.main' : 'divider',
                bgcolor: m.internal ? 'action.selected' : m.fromCustomer ? 'background.default' : 'action.hover',
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                {m.internal && <LockOutlinedIcon sx={{ fontSize: 14, color: 'warning.main' }} />}
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  {m.authorName ?? (m.fromCustomer ? 'Customer' : 'Staff')}
                  {m.internal ? ' · internal note (not visible to the customer)' : m.fromCustomer ? '' : ' · staff reply'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {dateTime(m.createdAt)}
                </Typography>
              </Stack>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.body}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      <Box>
        <TextField
          fullWidth
          multiline
          minRows={3}
          label={internal ? 'Internal note (staff only)' : 'Reply to the customer'}
          value={reply}
          onChange={(e) => setReply(e.target.value.slice(0, 4000))}
          helperText={internal ? 'Visible to support staff only.' : 'The customer is notified by email; the ticket moves to “Awaiting customer”.'}
        />
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
          <FormControlLabel control={<Switch checked={internal} onChange={(e) => setInternal(e.target.checked)} />} label="Internal note" />
          <Button variant="contained" color={internal ? 'warning' : 'primary'} disabled={!reply.trim() || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? 'Sending…' : internal ? 'Add note' : 'Send reply'}
          </Button>
        </Stack>
      </Box>

      <Divider />
      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Resolution
        </Typography>
        {closed && t.resolvedAt && <KeyValue label="Resolved" value={dateTime(t.resolvedAt)} />}
        <TextField fullWidth multiline minRows={2} label="Resolution summary (sent to the customer)" value={resolution} onChange={(e) => setResolution(e.target.value.slice(0, 2000))} />
        <Stack direction="row" spacing={1} sx={{ mt: 1 }} justifyContent="flex-end">
          {closed ? (
            <Button variant="outlined" disabled={patch.isPending || resolution.trim() === (t.resolution ?? '')} onClick={() => patch.mutate({ resolution: resolution.trim() })}>
              Update resolution
            </Button>
          ) : (
            <Button variant="contained" color="success" disabled={patch.isPending || resolution.trim().length < 3} onClick={() => patch.mutate({ status: 'RESOLVED', resolution: resolution.trim() })}>
              Resolve ticket
            </Button>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}

export default function SupportDesk() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const { notify, node } = useNotice();
  const [params, setParams] = useSearchParams();
  const selected = params.get('ticket');
  const status = params.get('status') ?? QUEUES[0]!.value;
  const category = params.get('category') ?? '';
  const mine = params.get('mine') === '1';
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const filter = (patch: Record<string, string | null>) => {
    set(patch);
    setPage(1);
  };

  const list = useQuery({
    queryKey: ['admin', 'tickets', status, category, mine, page],
    queryFn: () => api.page<TicketSummary>('/admin/system/tickets', { status: status || undefined, category: category || undefined, assignedToMe: mine ? 'true' : undefined, page, pageSize }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const summary = list.data?.data.find((t) => t.id === selected);

  const listView = (
    <SectionCard dense>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        <FilterSelect label="Queue" value={status} onChange={(v) => filter({ status: v })} options={QUEUES} allLabel="All tickets" />
        <FilterSelect label="Category" value={category} onChange={(v) => filter({ category: v || null })} options={opts(TICKET_CATEGORIES)} allLabel="All categories" />
        <FormControlLabel control={<Switch checked={mine} onChange={(e) => filter({ mine: e.target.checked ? '1' : null })} />} label="Assigned to me" />
      </Stack>
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <LoadingBlock rows={5} />
      ) : !list.data?.data.length ? (
        <EmptyState title="No tickets in this queue" body="Customer and worker tickets (complaints, billing disputes, refund and privacy requests, performance challenges, safety) appear here." />
      ) : (
        <>
          <List disablePadding>
            {list.data.data.map((t) => (
              <ListItemButton key={t.id} selected={t.id === selected} onClick={() => set({ ticket: t.id })} sx={{ borderRadius: 2, mb: 0.5, border: 1, borderColor: t.id === selected ? 'primary.main' : 'divider', display: 'block' }}>
                <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {t.number}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {relative(t.updatedAt)}
                  </Typography>
                </Stack>
                <Typography variant="body2" noWrap>
                  {t.subject}
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                  <Chip size="small" variant="outlined" label={humanize(t.category)} />
                  <Chip size="small" color={TICKET_STATUS_COLOR(t.status)} label={humanize(t.status)} />
                  {t.priority !== 'MEDIUM' && t.priority !== 'LOW' && <PriorityChip priority={t.priority} />}
                  {t.category === 'COMPLAINT' && t.verified != null && <Chip size="small" color={t.verified ? 'error' : 'default'} variant="outlined" label={t.verified ? 'Verified' : 'Unverified'} />}
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
                  {t.user?.fullName ?? '—'}
                  {t.booking ? ` · ${t.booking.code}` : ''}
                  {t.invoice ? ` · ${t.invoice.number}` : ''}
                </Typography>
              </ListItemButton>
            ))}
          </List>
          {list.data.meta.totalPages > 1 && <Pagination sx={{ mt: 1 }} count={list.data.meta.totalPages} page={page} onChange={(_, p) => setPage(p)} size="small" />}
        </>
      )}
    </SectionCard>
  );

  const detail = selected ? (
    <SectionCard>
      <TicketPanel key={selected} id={selected} summary={summary} notify={notify} />
    </SectionCard>
  ) : (
    <Card>
      <EmptyState title="Select a ticket" body="Pick a ticket to read the conversation, reply, add internal notes and resolve it." />
    </Card>
  );

  return (
    <Box>
      <PageHeader title="Support desk" subtitle={list.data ? `${list.data.meta.total} ticket${list.data.meta.total === 1 ? '' : 's'} in this view` : 'Customer and worker tickets'} />
      {desktop ? (
        <Grid container spacing={2}>
          <Grid size={{ md: 5, lg: 4 }}>{listView}</Grid>
          <Grid size={{ md: 7, lg: 8 }}>{detail}</Grid>
        </Grid>
      ) : selected ? (
        <Box>
          <BackLink to={`/admin/support?${(() => { const p = new URLSearchParams(params); p.delete('ticket'); return p.toString(); })()}`} label="All tickets" />
          {detail}
        </Box>
      ) : (
        listView
      )}
      {node}
    </Box>
  );
}
