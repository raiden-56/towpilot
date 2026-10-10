import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Pagination,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import AddIcon from '@mui/icons-material/Add';
import GavelIcon from '@mui/icons-material/Gavel';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { EmptyState, ErrorState, errorMessage, LoadingBlock, Money, PageHeader, SectionCard } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { useIsOnline } from '@/hooks/useOnline';
import { date, dateTime, humanize, relative } from '@/lib/format';
import { useDriverMe } from './locationSharing';
import { AVAILABILITY_LABELS, EQUIPMENT_LABELS, Fact, OfflineActionsNotice, TRUCK_TYPE_LABELS, daysUntil, label, type AttendanceRow, type DriverJobRow, type ExpenseRow, type PerformanceResponse, type TicketDetail, type TicketRow } from './components/driverShared';

// ─── Performance ─────────────────────────────────────────────────────

const COMPONENTS: { key: keyof PerformanceResponse['components']; label: string; help: string }[] = [
  { key: 'punctuality', label: 'Punctuality', help: 'Arrivals within the ETA plus grace time' },
  { key: 'completion', label: 'Completion', help: 'Accepted jobs you completed' },
  { key: 'safety', label: 'Safety & evidence', help: 'Jobs with full pickup/delivery evidence and handover; verified complaints reduce it' },
  { key: 'feedback', label: 'Customer feedback', help: 'Average customer rating' },
  { key: 'difficulty', label: 'Difficult jobs (bonus)', help: 'Share of hard jobs — only ever adds to your score' },
];

function PerformanceCard({ onChallenge }: { onChallenge: () => void }) {
  const q = useQuery({ queryKey: ['driver', 'performance'], queryFn: () => api.get<PerformanceResponse>('/driver/performance') });
  const p = q.data;
  return (
    <SectionCard title="Performance" action={p && <Typography variant="body2" color="text.secondary">Last {p.windowDays} days</Typography>}>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !p ? (
        <LoadingBlock rows={3} />
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ width: 84, height: 84, borderRadius: '50%', border: 6, borderColor: p.score == null ? 'divider' : p.score >= 75 ? 'success.main' : p.score >= 50 ? 'warning.main' : 'error.main', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Typography sx={{ fontSize: '1.8rem', fontWeight: 900 }}>{p.score ?? '—'}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 800 }}>{p.score == null ? 'No score yet' : 'Overall score (out of 100)'}</Typography>
              {!p.sufficientData && <Typography variant="body2" color="warning.main">Based on few jobs so far ({p.inputs.completed} completed) — it will settle as you do more jobs.</Typography>}
            </Box>
          </Stack>
          {COMPONENTS.map((c) => {
            const v = p.components[c.key];
            return (
              <Box key={c.key}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography sx={{ fontWeight: 700 }}>
                    {c.label}{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      weight {Math.round(p.weights[c.key] * 100)}%
                    </Typography>
                  </Typography>
                  <Typography sx={{ fontWeight: 800 }}>{v == null ? 'No data' : `${v}%`}</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={v ?? 0} sx={{ height: 10, borderRadius: 5, my: 0.5 }} color={v == null ? 'inherit' : v >= 75 ? 'success' : v >= 50 ? 'warning' : 'error'} />
                <Typography variant="caption" color="text.secondary">
                  {c.help}
                </Typography>
              </Box>
            );
          })}
          <Typography variant="body2" color="text.secondary">
            Records used: {p.inputs.assignmentsOffered} offers, {p.inputs.accepted} accepted, {p.inputs.completed} completed, {p.inputs.cancelledByWorker} released by you, {p.inputs.onTimeArrivals}/{p.inputs.arrivals} on time, {p.inputs.ratingsCount} ratings
            {p.inputs.ratingsAvg != null ? ` (avg ${p.inputs.ratingsAvg.toFixed(1)}★)` : ''}, {p.inputs.verifiedComplaints} verified complaints, {p.inputs.checklistComplete} jobs with complete evidence, {p.inputs.difficultJobs} difficult jobs. Incidents you reported: {p.inputs.safetyIncidentsReported} (never penalised).
          </Typography>
          <Alert severity="info">{p.explanation}</Alert>
          <Button size="large" variant="outlined" startIcon={<GavelIcon />} onClick={onChallenge}>
            Challenge a record
          </Button>
        </Stack>
      )}
    </SectionCard>
  );
}

// ─── Support tickets ─────────────────────────────────────────────────

type DriverTicketCategory = 'PERFORMANCE_CHALLENGE' | 'GENERAL' | 'SAFETY';
const TICKET_CATEGORY_LABELS: Record<DriverTicketCategory, string> = { PERFORMANCE_CHALLENGE: 'Performance challenge', GENERAL: 'General / pay query', SAFETY: 'Safety concern' };

function NewTicketDialog({ open, initialCategory, onClose }: { open: boolean; initialCategory: DriverTicketCategory; onClose: () => void }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const theme = useTheme();
  const full = useMediaQuery(theme.breakpoints.down('sm'));
  const [category, setCategory] = useState<DriverTicketCategory>(initialCategory);
  const [subject, setSubject] = useState(initialCategory === 'PERFORMANCE_CHALLENGE' ? 'Performance record challenge' : '');
  const [message, setMessage] = useState('');
  const [bookingId, setBookingId] = useState('');
  const jobs = useQuery({ queryKey: ['driver', 'jobs', 'pick'], queryFn: () => api.page<DriverJobRow>('/driver/jobs', { page: 1, pageSize: 50 }), enabled: open });
  const create = useMutation({
    mutationFn: () => api.post<TicketRow>('/support/tickets', { category, subject: subject.trim(), message: message.trim(), bookingId: bookingId || undefined }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['support', 'tickets'] });
    },
  });
  const close = () => {
    create.reset();
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} fullScreen={full} fullWidth maxWidth="sm">
      <DialogTitle>{category === 'PERFORMANCE_CHALLENGE' ? 'Challenge a performance record' : 'New support ticket'}</DialogTitle>
      <DialogContent>
        {create.data ? (
          <Alert severity="success" sx={{ mt: 1 }}>
            Ticket {create.data.number} created. Operations will review it and reply here — you can follow it under “My tickets”.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField select label="Type" value={category} onChange={(e) => setCategory(e.target.value as DriverTicketCategory)}>
              {(Object.keys(TICKET_CATEGORY_LABELS) as DriverTicketCategory[]).map((c) => (
                <MenuItem key={c} value={c}>
                  {TICKET_CATEGORY_LABELS[c]}
                </MenuItem>
              ))}
            </TextField>
            {category === 'PERFORMANCE_CHALLENGE' && <Typography variant="body2" color="text.secondary">Say which record is wrong (late arrival, complaint, rating, cancellation…) and why. Link the job if it relates to one.</Typography>}
            <TextField select label="Related job (optional)" value={bookingId} onChange={(e) => setBookingId(e.target.value)} helperText={jobs.isLoading ? 'Loading your jobs…' : undefined}>
              <MenuItem value="">None</MenuItem>
              {(jobs.data?.data ?? []).map((j) => (
                <MenuItem key={j.id} value={j.id}>
                  {j.code} · {j.vehicle?.registrationNumber ?? ''} · {date(j.createdAt)}
                </MenuItem>
              ))}
            </TextField>
            <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required slotProps={{ htmlInput: { maxLength: 150 } }} helperText="At least 3 characters" />
            <TextField label="Details" value={message} onChange={(e) => setMessage(e.target.value)} required multiline minRows={4} slotProps={{ htmlInput: { maxLength: 4000 } }} helperText="At least 5 characters" />
            {create.error && <Alert severity="error">{errorMessage(create.error)}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="large" onClick={close}>
          {create.data ? 'Done' : 'Cancel'}
        </Button>
        {!create.data && (
          <Button size="large" variant="contained" disabled={subject.trim().length < 3 || message.trim().length < 5 || create.isPending || !online} onClick={() => create.mutate()}>
            {create.isPending ? 'Sending…' : 'Submit'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function TicketDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const theme = useTheme();
  const full = useMediaQuery(theme.breakpoints.down('sm'));
  const [reply, setReply] = useState('');
  const q = useQuery({ queryKey: ['support', 'tickets', id], queryFn: () => api.get<TicketDetail>(`/support/tickets/${id}`) });
  const send = useMutation({
    mutationFn: () => api.post(`/support/tickets/${id}/messages`, { body: reply.trim() }),
    onSuccess: async () => {
      setReply('');
      await qc.invalidateQueries({ queryKey: ['support', 'tickets'] });
    },
  });
  const t = q.data;
  const closed = t?.status === 'CLOSED';
  return (
    <Dialog open onClose={onClose} fullScreen={full} fullWidth maxWidth="sm">
      <DialogTitle>{t ? `${t.number} · ${t.subject}` : 'Ticket'}</DialogTitle>
      <DialogContent>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !t ? (
          <LoadingBlock rows={3} />
        ) : (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={humanize(t.category)} />
              <Chip label={humanize(t.status)} color={t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'success' : t.status === 'AWAITING_CUSTOMER' ? 'warning' : 'info'} />
              {t.booking && <Chip label={t.booking.code} variant="outlined" />}
            </Stack>
            {t.resolution && <Alert severity="success">Resolution: {t.resolution}</Alert>}
            {t.messages.map((m) => (
              <Box key={m.id} sx={{ p: 1.5, borderRadius: 2, bgcolor: m.fromCustomer ? 'action.hover' : 'background.default', border: 1, borderColor: 'divider', ml: m.fromCustomer ? 4 : 0, mr: m.fromCustomer ? 0 : 4 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                  {m.fromCustomer ? 'You' : (m.authorName ?? 'Support team')} · {dateTime(m.createdAt)}
                </Typography>
                <Typography sx={{ whiteSpace: 'pre-wrap' }}>{m.body}</Typography>
              </Box>
            ))}
            {!closed && (
              <>
                <TextField label="Reply" value={reply} onChange={(e) => setReply(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 4000 } }} />
                {send.error && <Alert severity="error">{errorMessage(send.error)}</Alert>}
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="large" onClick={onClose}>
          Close
        </Button>
        {t && !closed && (
          <Button size="large" variant="contained" disabled={!reply.trim() || send.isPending || !online} onClick={() => send.mutate()}>
            {send.isPending ? 'Sending…' : 'Send reply'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function TicketsCard({ onNew }: { onNew: () => void }) {
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['support', 'tickets', 'list', page], queryFn: () => api.page<TicketRow>('/support/tickets', { page, pageSize: 10 }), placeholderData: keepPreviousData });
  return (
    <SectionCard
      title="My tickets"
      action={
        <Button startIcon={<AddIcon />} onClick={onNew} sx={{ minHeight: 44 }}>
          New
        </Button>
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <LoadingBlock rows={2} />
      ) : q.data.data.length === 0 ? (
        <Typography color="text.secondary">No tickets. Use “New” for pay questions, safety concerns or to challenge a performance record.</Typography>
      ) : (
        <>
          <List disablePadding>
            {q.data.data.map((t) => (
              <ListItemButton key={t.id} onClick={() => setOpenId(t.id)} sx={{ minHeight: 56, px: 1 }}>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography sx={{ fontWeight: 700, minWidth: 0 }} noWrap>
                        {t.subject}
                      </Typography>
                      <Chip size="small" label={humanize(t.status)} color={t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'success' : t.status === 'AWAITING_CUSTOMER' ? 'warning' : 'info'} />
                    </Stack>
                  }
                  secondary={`${t.number} · ${humanize(t.category)}${t.booking ? ` · ${t.booking.code}` : ''} · updated ${relative(t.updatedAt)}`}
                />
              </ListItemButton>
            ))}
          </List>
          {q.data.meta.totalPages > 1 && <Pagination count={q.data.meta.totalPages} page={page} onChange={(_, p) => setPage(p)} size="large" sx={{ mt: 1, display: 'flex', justifyContent: 'center' }} />}
        </>
      )}
      {openId && <TicketDialog id={openId} onClose={() => setOpenId(null)} />}
    </SectionCard>
  );
}

// ─── Attendance ──────────────────────────────────────────────────────

function duration(from: string, to: string | null) {
  const mins = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return h ? `${h} h ${mins % 60} min` : `${mins} min`;
}

function AttendanceCard({ zoneNames }: { zoneNames: Map<string, string> }) {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['driver', 'attendance', page], queryFn: () => api.page<AttendanceRow>('/driver/attendance', { page, pageSize: 10 }), placeholderData: keepPreviousData });
  return (
    <SectionCard title="Attendance log">
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <LoadingBlock rows={3} />
      ) : q.data.data.length === 0 ? (
        <Typography color="text.secondary">No status changes recorded yet. Each time you change your status it is logged here.</Typography>
      ) : (
        <>
          <Stack divider={<Divider />}>
            {q.data.data.map((a) => (
              <Stack key={a.id} direction="row" justifyContent="space-between" spacing={1} sx={{ py: 1 }}>
                <Box>
                  <Typography sx={{ fontWeight: 700 }}>{AVAILABILITY_LABELS[a.status] ?? a.status}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {dateTime(a.startedAt)} → {a.endedAt ? dateTime(a.endedAt) : 'now'}
                    {a.zoneId && zoneNames.get(a.zoneId) ? ` · ${zoneNames.get(a.zoneId)}` : ''}
                  </Typography>
                </Box>
                <Typography sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{duration(a.startedAt, a.endedAt)}</Typography>
              </Stack>
            ))}
          </Stack>
          {q.data.meta.totalPages > 1 && <Pagination count={q.data.meta.totalPages} page={page} onChange={(_, p) => setPage(p)} size="large" sx={{ mt: 1, display: 'flex', justifyContent: 'center' }} />}
        </>
      )}
    </SectionCard>
  );
}

// ─── Expense claims ──────────────────────────────────────────────────

const EXPENSE_CATEGORIES = { FUEL: 'Fuel', MAINTENANCE: 'Maintenance', REPAIR: 'Repair', TOLLS_PARKING: 'Tolls / parking', OTHER: 'Other' } as const;
const EXPENSE_STATUS_COLORS = { SUBMITTED: 'warning', APPROVED: 'info', REJECTED: 'error', PAID: 'success' } as const;
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const expenseSchema = z
  .object({
    category: z.enum(['FUEL', 'MAINTENANCE', 'REPAIR', 'TOLLS_PARKING', 'OTHER']),
    amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Rupees with at most 2 decimals').refine((v) => Number(v) > 0, 'Must be more than ₹0'),
    description: z.string().trim().min(3, 'At least 3 characters').max(200),
    expenseDate: z.string().min(1, 'Required').refine((v) => v <= todayIso(), 'Cannot be in the future'),
    fuelLitres: z.string().trim().regex(/^(\d+(\.\d{1,2})?)?$/, 'Litres, e.g. 25.5'),
    odometerKm: z.string().trim().regex(/^\d{0,7}$/, 'Whole kilometres'),
  })
  .refine((v) => v.category !== 'FUEL' || v.fuelLitres === '' || Number(v.fuelLitres) > 0, { path: ['fuelLitres'], message: 'Must be more than 0' });
type ExpenseForm = z.infer<typeof expenseSchema>;

function NewExpenseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const theme = useTheme();
  const full = useMediaQuery(theme.breakpoints.down('sm'));
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const form = useForm<ExpenseForm>({ resolver: zodResolver(expenseSchema), defaultValues: { category: 'FUEL', amount: '', description: '', expenseDate: todayIso(), fuelLitres: '', odometerKm: '' } });
  const category = form.watch('category');
  const create = useMutation({
    mutationFn: (v: ExpenseForm) => {
      const fd = new FormData();
      fd.append('category', v.category);
      fd.append('amount', v.amount);
      fd.append('description', v.description.trim());
      fd.append('expenseDate', v.expenseDate);
      if (v.category === 'FUEL' && v.fuelLitres) fd.append('fuelLitres', v.fuelLitres);
      if (v.odometerKm) fd.append('odometerKm', v.odometerKm);
      if (file) fd.append('receipt', file);
      return api.upload<ExpenseRow>('/driver/expenses', fd);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['driver', 'expenses'] });
      form.reset();
      setFile(null);
      onClose();
    },
  });
  const err = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} fullScreen={full} fullWidth maxWidth="sm">
      <DialogTitle>New expense claim</DialogTitle>
      <DialogContent>
        <Stack component="form" id="expense-form" spacing={2} sx={{ pt: 1 }} onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
          <Controller
            name="category"
            control={form.control}
            render={({ field }) => (
              <TextField select label="Category" {...field}>
                {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => (
                  <MenuItem key={k} value={k}>
                    {v}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
          <TextField label="Amount" {...form.register('amount')} error={!!err.amount} helperText={err.amount?.message} slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }} />
          <TextField label="Description" {...form.register('description')} error={!!err.description} helperText={err.description?.message} slotProps={{ htmlInput: { maxLength: 200 } }} />
          <TextField label="Date of expense" type="date" {...form.register('expenseDate')} error={!!err.expenseDate} helperText={err.expenseDate?.message} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayIso() } }} />
          {category === 'FUEL' && <TextField label="Litres (optional)" {...form.register('fuelLitres')} error={!!err.fuelLitres} helperText={err.fuelLitres?.message} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />}
          <TextField label="Truck odometer km (optional)" {...form.register('odometerKm')} error={!!err.odometerKm} helperText={err.odometerKm?.message} slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
          <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button size="large" variant="outlined" startIcon={<AttachFileIcon />} onClick={() => fileRef.current?.click()}>
            {file ? `Receipt: ${file.name}` : 'Attach receipt (photo or PDF)'}
          </Button>
          {!file && <Typography variant="caption" color="text.secondary">A receipt is strongly recommended — finance may reject claims without one.</Typography>}
          {create.error && <Alert severity="error">{errorMessage(create.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="large" onClick={onClose}>
          Cancel
        </Button>
        <Button size="large" variant="contained" type="submit" form="expense-form" disabled={create.isPending || !online}>
          {create.isPending ? 'Submitting…' : 'Submit claim'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ExpensesCard() {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['driver', 'expenses'], queryFn: () => api.get<ExpenseRow[]>('/driver/expenses') });
  return (
    <SectionCard
      title="Expense claims"
      action={
        <Button startIcon={<AddIcon />} onClick={() => setOpen(true)} sx={{ minHeight: 44 }}>
          New claim
        </Button>
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <LoadingBlock rows={2} />
      ) : q.data.length === 0 ? (
        <EmptyState title="No claims" body="Claim fuel, repairs or tolls you paid for yourself. Finance reviews each claim." />
      ) : (
        <Stack divider={<Divider />}>
          {q.data.map((e) => (
            <Box key={e.id} sx={{ py: 1 }}>
              <Stack direction="row" justifyContent="space-between" spacing={1}>
                <Typography sx={{ fontWeight: 700, minWidth: 0 }}>{e.description}</Typography>
                <Typography sx={{ fontWeight: 800 }}>
                  <Money value={e.amount} />
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                <Chip size="small" label={humanize(e.status)} color={EXPENSE_STATUS_COLORS[e.status]} />
                <Typography variant="body2" color="text.secondary">
                  {e.number} · {EXPENSE_CATEGORIES[e.category as keyof typeof EXPENSE_CATEGORIES] ?? humanize(e.category)} · {date(e.expenseDate)}
                  {e.fuelLitres ? ` · ${e.fuelLitres} L` : ''}
                </Typography>
              </Stack>
              {e.status === 'REJECTED' && e.rejectionReason && (
                <Typography variant="body2" color="error.main">
                  Rejected: {e.rejectionReason}
                </Typography>
              )}
              {e.paidAt && (
                <Typography variant="body2" color="text.secondary">
                  Paid {date(e.paidAt)}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
      <NewExpenseDialog open={open} onClose={() => setOpen(false)} />
    </SectionCard>
  );
}

// ─── Page ────────────────────────────────────────────────────────────

export default function DriverProfile() {
  const me = useDriverMe();
  const { logout } = useAuth();
  const online = useIsOnline();
  const [ticketCategory, setTicketCategory] = useState<DriverTicketCategory | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data) return <LoadingBlock rows={4} height={96} />;
  const d = me.data;
  const wp = d.workerProfile;
  const dp = d.driverProfile;
  const licenceDays = daysUntil(dp?.licenceExpiry);
  const zoneNames = new Map((wp?.zones ?? []).map((z) => [z.id, z.name]));
  const truck = d.assignedTruck;

  return (
    <Stack spacing={2}>
      <PageHeader title="Profile" />
      <OfflineActionsNotice online={online} />
      <SectionCard>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar src={d.photoUrl ?? undefined} alt={d.fullName} sx={{ width: 72, height: 72, fontSize: 28, fontWeight: 800 }}>
            {d.fullName.charAt(0)}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h3" component="h2" sx={{ wordBreak: 'break-word' }}>
              {d.fullName}
            </Typography>
            <Typography color="text.secondary">{d.phone}</Typography>
            {wp && (
              <Chip
                sx={{ mt: 0.5 }}
                label={wp.verificationStatus === 'APPROVED' ? 'Verified' : `Verification: ${humanize(wp.verificationStatus)}`}
                color={wp.verificationStatus === 'APPROVED' ? 'success' : wp.verificationStatus === 'PENDING' ? 'warning' : 'error'}
              />
            )}
          </Box>
        </Stack>
        {wp?.verificationNote && (
          <Alert severity={wp.verificationStatus === 'APPROVED' ? 'info' : 'warning'} sx={{ mt: 1.5 }}>
            {wp.verificationNote}
          </Alert>
        )}
        {wp ? (
          <Stack spacing={0.5} sx={{ mt: 1.5 }}>
            <Fact label="Employee code">{wp.employeeCode}</Fact>
            <Fact label="Employment">
              {humanize(wp.employmentType)}
              {wp.partnerCompany ? ` · ${wp.partnerCompany}` : ''}
            </Fact>
            <Fact label="Service zones">{wp.zones.length ? wp.zones.map((z) => `${z.name} (${z.city})`).join(', ') : 'None assigned'}</Fact>
            {wp.skills.length > 0 && <Fact label="Skills">{wp.skills.map(humanize).join(', ')}</Fact>}
          </Stack>
        ) : (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            No worker profile is linked to this account.
          </Alert>
        )}
      </SectionCard>

      {dp && (
        <SectionCard title="Driving licence">
          <Fact label="Class">{dp.licenceClass}</Fact>
          <Fact label="Valid until">{date(dp.licenceExpiry)}</Fact>
          <Fact label="Can lead a team">{dp.canLeadTeam ? 'Yes' : 'No'}</Fact>
          {licenceDays != null && licenceDays < 30 && (
            <Alert severity={licenceDays < 0 ? 'error' : 'warning'} sx={{ mt: 1 }}>
              {licenceDays < 0 ? 'Your licence has expired. You cannot be dispatched until operations record a renewed licence.' : `Your licence expires in ${licenceDays} day${licenceDays === 1 ? '' : 's'}. Renew it and share the new copy with operations.`}
            </Alert>
          )}
        </SectionCard>
      )}

      <SectionCard title="Truck & equipment">
        {truck ? (
          <Stack spacing={1}>
            <Typography sx={{ fontSize: '1.2rem', fontWeight: 900 }}>
              {truck.registrationNumber} · {label(TRUCK_TYPE_LABELS, truck.truckType)}
            </Typography>
            <Typography color="text.secondary">
              {truck.make} {truck.model} · {humanize(truck.status)} · {truck.odometerKm.toLocaleString('en-IN')} km
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75}>
              {truck.equipment.map((e) => (
                <Chip key={e.id} label={`${label(EQUIPMENT_LABELS, e.type)}${e.status === 'OK' ? '' : ` — ${e.status.toLowerCase()}`}`} color={e.status === 'OK' ? 'success' : 'error'} variant={e.status === 'OK' ? 'outlined' : 'filled'} />
              ))}
            </Stack>
            {(
              [
                ['Insurance', truck.insuranceExpiry],
                ['Fitness certificate', truck.fitnessExpiry],
                ['Permit', truck.permitExpiry],
                ['PUC', truck.pucExpiry],
                ['Next inspection', truck.nextInspectionDue],
              ] as const
            ).map(([n, dt]) => {
              const days = daysUntil(dt);
              return (
                <Stack key={n} direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    {n}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} color={days == null ? undefined : days < 0 ? 'error.main' : days < 30 ? 'warning.main' : undefined}>
                    {dt ? date(dt) : 'Not recorded'}
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
        ) : (
          <Typography color="text.secondary">No truck is assigned to you.</Typography>
        )}
      </SectionCard>

      <PerformanceCard onChallenge={() => setTicketCategory('PERFORMANCE_CHALLENGE')} />
      <AttendanceCard zoneNames={zoneNames} />
      <ExpensesCard />
      <TicketsCard onNew={() => setTicketCategory('GENERAL')} />
      {ticketCategory && <NewTicketDialog key={ticketCategory} open initialCategory={ticketCategory} onClose={() => setTicketCategory(null)} />}

      <Button
        size="large"
        variant="outlined"
        color="error"
        startIcon={<LogoutIcon />}
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          try {
            await logout();
          } finally {
            setSigningOut(false);
          }
        }}
        sx={{ borderWidth: 2 }}
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </Button>
      {d.availability && d.availability.status !== 'OFF_DUTY' && (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
          Tip: set yourself Off duty on the Today tab before signing out so location sharing stops.
        </Typography>
      )}
    </Stack>
  );
}
