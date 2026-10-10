import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Autocomplete, Box, Button, Grid, Link, MenuItem, Stack, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { api } from '@/api/client';
import { ConfirmDialog, ErrorState, KpiCard, LoadingBlock, Money, PageHeader, SampleTag, SectionCard } from '@/components/common';
import { date, dateTime, humanize, inr } from '@/lib/format';
import { DataTable, type Column } from '@/components/DataTable';
import type { PayoutRow, PendingByWorker, SalaryRow } from './biz/types';
import { EnumChip, FilterBar, FormDialog, localDateEndIso, localDateToIso, num, numOpt, PromptDialog, rupees, RupeeField, SimpleTable, toDateInput, useTabParam, useToast } from './biz/shared';
import { useFieldWorkers } from './biz/queries';

const TABS = ['salaries', 'adjustments', 'earnings', 'payouts'] as const;
type TabKey = (typeof TABS)[number];
type Toasts = { toast: (m: string) => void; toastError: (e: unknown) => void };

/** Period end is stored exclusive (midnight after the last day); show the inclusive last day. */
const periodLabel = (s: string, e: string) => `${date(s)} – ${date(new Date(new Date(e).getTime() - 1))}`;

function monthBounds(offset = 0) {
  const t = toDateInput(new Date());
  const [y, m] = t.split('-').map(Number) as [number, number];
  const d0 = new Date(Date.UTC(y, m - 1 + offset, 1));
  const d1 = new Date(Date.UTC(y, m + offset, 0));
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return { from: f(d0), to: f(d1) };
}

function PeriodDialog({ open, title, intro, submitLabel, showFrequency, onClose, onSubmit, loading, error, defaultRange }: { open: boolean; title: string; intro: React.ReactNode; submitLabel: string; showFrequency?: boolean; onClose: () => void; onSubmit: (v: { periodStart: string; periodEnd: string; frequency: string }) => void; loading?: boolean; error?: unknown; defaultRange: { from: string; to: string } }) {
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [frequency, setFrequency] = useState('MONTHLY');
  useEffect(() => {
    if (open) {
      setFrom(defaultRange.from);
      setTo(defaultRange.to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ok = !!from && !!to && to >= from;
  return (
    <FormDialog open={open} title={title} onClose={onClose} onSubmit={() => ok && onSubmit({ periodStart: localDateToIso(from), periodEnd: localDateEndIso(to), frequency })} submitting={loading} submitDisabled={!ok} submitLabel={submitLabel} error={error} maxWidth="xs" intro={intro}>
      <Stack spacing={2}>
        {showFrequency && (
          <TextField select label="Pay frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)} fullWidth helperText="Only salaried staff on this frequency are included">
            <MenuItem value="WEEKLY">Weekly</MenuItem>
            <MenuItem value="MONTHLY">Monthly</MenuItem>
            <MenuItem value="ANNUAL">Annual</MenuItem>
          </TextField>
        )}
        <TextField label="First day" type="date" value={from} onChange={(e) => setFrom(e.target.value)} fullWidth required slotProps={{ inputLabel: { shrink: true } }} />
        <TextField label="Last day (inclusive)" type="date" value={to} onChange={(e) => setTo(e.target.value)} fullWidth required error={!ok} helperText={!ok ? 'Last day must be on or after the first day' : undefined} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>
    </FormDialog>
  );
}

// ─── Salaries ────────────────────────────────────────────────────────

function AdjustDialog({ rec, onClose, onDone }: { rec: SalaryRow | null; onClose: () => void; onDone: () => void }) {
  const [inc, setInc] = useState('');
  const [ded, setDed] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (rec) {
      setInc(String(rupees(rec.incentives) ?? 0));
      setDed(String(rupees(rec.deductions) ?? 0));
      setNotes(rec.notes ?? '');
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec]);
  const m = useMutation({ mutationFn: () => api.patch(`/admin/finance/salaries/${rec!.id}`, { incentives: Number(inc || 0), deductions: Number(ded || 0), notes: notes || undefined }), onSuccess: onDone });
  const net = rec ? rec.baseAmount + Math.round(Number(inc || 0) * 100) - Math.round(Number(ded || 0) * 100) : 0;
  const ok = Number(inc || 0) >= 0 && Number(ded || 0) >= 0 && net >= 0;
  return (
    <FormDialog open={!!rec} title={`Adjust salary · ${rec?.user.fullName ?? ''}`} onClose={onClose} onSubmit={() => ok && m.mutate()} submitting={m.isPending} submitDisabled={!ok} error={m.error} submitLabel="Save adjustment" maxWidth="xs">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{rec && periodLabel(rec.periodStart, rec.periodEnd)} · base {inr(rec?.baseAmount)}</Typography>
      <Stack spacing={2}>
        <RupeeField label="Incentives" value={inc} onChange={(e) => setInc(e.target.value)} fullWidth />
        <RupeeField label="Deductions" value={ded} onChange={(e) => setDed(e.target.value)} fullWidth />
        <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} helperText="Explain incentives/deductions (visible to payroll)" />
        <Stack direction="row" justifyContent="space-between"><Typography variant="subtitle2">Net obligation</Typography><Typography variant="subtitle2" sx={num} color={net < 0 ? 'error.main' : undefined}>{inr(net)}</Typography></Stack>
      </Stack>
    </FormDialog>
  );
}

function SalariesTab({ toast, toastError }: Toasts) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [genOpen, setGenOpen] = useState(false);
  const [adjust, setAdjust] = useState<SalaryRow | null>(null);
  const [act, setAct] = useState<{ rec: SalaryRow; action: 'approve' | 'pay' | 'cancel' } | null>(null);
  const all = useQuery({ queryKey: ['admin', 'payroll', 'salaries'], queryFn: () => api.page<SalaryRow>('/admin/finance/salaries', { pageSize: 100 }) });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin', 'payroll', 'salaries'] });
  const gen = useMutation({
    mutationFn: (b: { frequency: string; periodStart: string; periodEnd: string }) => api.post<{ created: number; eligible: number }>('/admin/finance/salaries/generate', b),
    onSuccess: (r) => {
      toast(r.eligible === 0 ? 'No salaried staff on this pay frequency' : `Created ${r.created} accrual(s); ${r.eligible - r.created} already existed for this period`);
      setGenOpen(false);
      invalidate();
    },
  });
  const run = useMutation({
    mutationFn: ({ id, action, paymentRef }: { id: string; action: string; paymentRef?: string }) => api.post(`/admin/finance/salaries/${id}/${action}`, { paymentRef }),
    onSuccess: (_d, v) => {
      toast(v.action === 'approve' ? 'Salary approved' : v.action === 'pay' ? 'Salary marked paid' : 'Salary accrual cancelled');
      setAct(null);
      invalidate();
    },
    onError: toastError,
  });
  const rows = useMemo(() => (all.data?.data ?? []).filter((r) => !status || r.status === status), [all.data, status]);
  const sumBy = (s: string[]) => (all.data?.data ?? []).filter((r) => s.includes(r.status)).reduce((a, r) => a + r.netAmount, 0);
  if (all.isLoading) return <LoadingBlock />;
  if (all.error) return <ErrorState error={all.error} onRetry={() => void all.refetch()} />;
  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="Obligation (accrued, not approved)" value={inr(sumBy(['ACCRUED']))} definition="Salary owed for completed pay periods, not yet approved. Counted as a cost in Profit & loss (accrual basis)." /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="Approved, awaiting payment" value={inr(sumBy(['APPROVED']))} definition="Approved salary obligations not yet paid. Still a liability; no cash has moved." /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="Cash paid" value={inr(sumBy(['PAID']))} definition="Salaries actually paid (cash out), reported in Cash flow on the paid date." /></Grid>
      </Grid>
      <FilterBar actions={<Button variant="contained" onClick={() => { gen.reset(); setGenOpen(true); }}>Generate accruals</Button>}>
        <ToggleButtonGroup size="small" exclusive value={status} onChange={(_, v) => setStatus(v ?? '')}>
          <ToggleButton value="">All</ToggleButton>
          <ToggleButton value="ACCRUED">Accrued</ToggleButton>
          <ToggleButton value="APPROVED">Approved</ToggleButton>
          <ToggleButton value="PAID">Paid</ToggleButton>
          <ToggleButton value="CANCELLED">Cancelled</ToggleButton>
        </ToggleButtonGroup>
      </FilterBar>
      <SectionCard>
        <SimpleTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No salary records. Generate accruals for a pay period."
          minWidth={1000}
          columns={[
            { key: 'e', header: 'Employee', render: (r) => (<Box><Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>{r.user.fullName}</Typography><SampleTag show={r.isSample} /><Typography variant="caption" color="text.secondary" display="block">{r.user.workerProfile?.employeeCode ?? ''} · {humanize(r.frequency)}</Typography></Box>) },
            { key: 'p', header: 'Pay period', render: (r) => periodLabel(r.periodStart, r.periodEnd), nowrap: true },
            { key: 'b', header: 'Base', align: 'right', render: (r) => <Money value={r.baseAmount} /> },
            { key: 'i', header: 'Incentives', align: 'right', render: (r) => (r.incentives ? <Money value={r.incentives} /> : '—') },
            { key: 'd', header: 'Deductions', align: 'right', render: (r) => (r.deductions ? <Money value={-r.deductions} negative /> : '—') },
            { key: 'n', header: 'Net', align: 'right', render: (r) => <Money value={r.netAmount} strong /> },
            { key: 's', header: 'Status', render: (r) => (<Box><EnumChip value={r.status} label={r.status === 'ACCRUED' ? 'Obligation (accrued)' : r.status === 'PAID' ? 'Cash paid' : undefined} />{r.status === 'PAID' && <Typography variant="caption" color="text.secondary" display="block">{date(r.paidAt)}{r.paymentRef ? ` · ${r.paymentRef}` : ''}</Typography>}{r.notes && <Typography variant="caption" color="text.secondary" display="block">{r.notes}</Typography>}</Box>) },
            {
              key: 'x',
              header: '',
              align: 'right',
              render: (r) => (
                <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                  {r.status === 'ACCRUED' && (
                    <>
                      <Button size="small" onClick={() => setAdjust(r)}>Adjust</Button>
                      <Button size="small" variant="contained" onClick={() => setAct({ rec: r, action: 'approve' })}>Approve</Button>
                      <Button size="small" color="error" onClick={() => setAct({ rec: r, action: 'cancel' })}>Cancel</Button>
                    </>
                  )}
                  {r.status === 'APPROVED' && <Button size="small" variant="contained" color="success" onClick={() => setAct({ rec: r, action: 'pay' })}>Pay</Button>}
                </Stack>
              ),
            },
          ]}
        />
        {(all.data?.meta.total ?? 0) > 100 && <Typography variant="caption" color="text.secondary">Showing the latest 100 of {all.data?.meta.total} records; totals above cover these records.</Typography>}
      </SectionCard>
      <PeriodDialog open={genOpen} title="Generate salary accruals" submitLabel="Generate" showFrequency defaultRange={monthBounds(-1)} loading={gen.isPending} error={gen.error} onClose={() => setGenOpen(false)} onSubmit={(v) => gen.mutate(v)}
        intro={<Typography variant="body2" color="text.secondary">Creates one accrued salary record (the obligation) per active salaried employee for the period, at their base salary. Re-running for the same period skips existing records. No money moves until you approve and pay.</Typography>}
      />
      <AdjustDialog rec={adjust} onClose={() => setAdjust(null)} onDone={() => { toast('Salary adjusted'); setAdjust(null); invalidate(); }} />
      <ConfirmDialog open={act?.action === 'approve'} title="Approve salary?" body={`Approve ${inr(act?.rec.netAmount)} for ${act?.rec.user.fullName}. It can no longer be adjusted or cancelled.`} confirmLabel="Approve" loading={run.isPending} onClose={() => setAct(null)} onConfirm={() => act && run.mutate({ id: act.rec.id, action: 'approve' })} />
      <ConfirmDialog open={act?.action === 'cancel'} title="Cancel salary accrual?" body={`The ${inr(act?.rec.netAmount)} obligation for ${act?.rec.user.fullName} will be removed from costs.`} confirmLabel="Cancel accrual" danger loading={run.isPending} onClose={() => setAct(null)} onConfirm={() => act && run.mutate({ id: act.rec.id, action: 'cancel' })} />
      <PromptDialog open={act?.action === 'pay'} title={`Pay ${act?.rec.user.fullName ?? ''}`} body={`Record that ${inr(act?.rec.netAmount)} was transferred. This is reported as cash out today.`} label="Payment reference (UTR / txn id)" confirmLabel="Mark paid" minLength={2} maxLength={60} multiline={false} loading={run.isPending} onClose={() => setAct(null)} onConfirm={(ref) => act && run.mutate({ id: act.rec.id, action: 'pay', paymentRef: ref })} />
    </Box>
  );
}

// ─── Earnings adjustments ────────────────────────────────────────────

const adjSchema = z.object({
  userId: z.string().min(1, 'Pick a worker'),
  kind: z.enum(['INCENTIVE', 'DEDUCTION']),
  amount: z.number({ error: 'Enter an amount' }).positive('Must be more than 0'),
  note: z.string().trim().min(3, 'Explain the adjustment (shared with the worker)').max(300),
  bookingCode: z.string().trim().max(40),
});
type AdjValues = z.infer<typeof adjSchema>;

function AdjustmentsTab({ toast }: Toasts) {
  const qc = useQueryClient();
  const workers = useFieldWorkers();
  const pending = useQuery({ queryKey: ['admin', 'payroll', 'payouts', 'pending'], queryFn: () => api.page<PayoutRow>('/admin/finance/payouts', { pageSize: 1 }) });
  const pendingBy = (pending.data?.meta.pendingByWorker ?? []) as PendingByWorker[];
  const { register, handleSubmit, reset, control, watch, formState } = useForm<AdjValues>({ resolver: zodResolver(adjSchema), defaultValues: { userId: '', kind: 'INCENTIVE', note: '', bookingCode: '' } });
  const m = useMutation({
    mutationFn: async (v: AdjValues) => {
      let bookingId: string | undefined;
      if (v.bookingCode) {
        const r = await api.page<{ id: string; code: string }>('/bookings', { q: v.bookingCode, pageSize: 5 });
        const hit = r.data.find((b) => b.code.toUpperCase() === v.bookingCode.toUpperCase());
        if (!hit) throw new Error(`Booking ${v.bookingCode} not found`);
        bookingId = hit.id;
      }
      return api.post('/admin/finance/earnings', { userId: v.userId, kind: v.kind, amount: v.amount, note: v.note, bookingId });
    },
    onSuccess: (_d, v) => {
      toast(`${v.kind === 'INCENTIVE' ? 'Incentive' : 'Deduction'} recorded; the worker has been notified`);
      reset({ userId: '', kind: v.kind, amount: undefined as unknown as number, note: '', bookingCode: '' });
      void qc.invalidateQueries({ queryKey: ['admin', 'payroll'] });
    },
  });
  const e = formState.errors;
  const kind = watch('kind');
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <SectionCard title="Record an incentive or deduction">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Adds a line to the worker’s pending earnings, settled in their next payout. Deductions reduce the payout. The worker is notified and can challenge it via support.
          </Typography>
          <Box component="form" noValidate onSubmit={handleSubmit((v) => m.mutate(v))}>
            <Stack spacing={2}>
              <Controller control={control} name="userId" render={({ field }) => (
                <Autocomplete
                  options={workers.data ?? []}
                  loading={workers.isLoading}
                  value={(workers.data ?? []).find((w) => w.id === field.value) ?? null}
                  onChange={(_, w) => field.onChange(w?.id ?? '')}
                  getOptionLabel={(w) => `${w.fullName}${w.workerProfile?.employeeCode ? ` · ${w.workerProfile.employeeCode}` : ''} (${w.roles.filter((r) => r === 'driver' || r === 'worker').join(', ')})`}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  renderInput={(p) => <TextField {...p} label="Driver / worker" required error={!!e.userId} helperText={e.userId?.message} />}
                />
              )} />
              <Controller control={control} name="kind" render={({ field }) => (
                <ToggleButtonGroup exclusive value={field.value} onChange={(_, v) => v && field.onChange(v)} size="small" color={kind === 'DEDUCTION' ? 'error' : 'success'}>
                  <ToggleButton value="INCENTIVE">Incentive</ToggleButton>
                  <ToggleButton value="DEDUCTION">Deduction</ToggleButton>
                </ToggleButtonGroup>
              )} />
              <RupeeField label="Amount" required fullWidth {...register('amount', numOpt)} error={!!e.amount} helperText={e.amount?.message} />
              <TextField label="Note" required fullWidth multiline minRows={2} {...register('note')} error={!!e.note} helperText={e.note?.message ?? 'Shared with the worker'} />
              <TextField label="Related booking code (optional)" fullWidth {...register('bookingCode')} error={!!e.bookingCode} helperText={e.bookingCode?.message ?? 'e.g. TP-261003-S040'} />
              {m.error != null && <Alert severity="error">{m.error instanceof Error ? m.error.message : 'Failed'}</Alert>}
              <Button type="submit" variant="contained" color={kind === 'DEDUCTION' ? 'error' : 'primary'} disabled={m.isPending} sx={{ alignSelf: 'flex-start' }}>
                {m.isPending ? 'Saving…' : kind === 'DEDUCTION' ? 'Record deduction' : 'Record incentive'}
              </Button>
            </Stack>
          </Box>
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <SectionCard title="Pending earnings by worker">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Accrued but not yet in a payout (includes approved reimbursements).</Typography>
          {pending.isLoading ? <LoadingBlock rows={3} /> : pending.error ? <ErrorState error={pending.error} /> : (
            <SimpleTable rows={pendingBy} rowKey={(p) => p.userId} empty="No pending earnings." columns={[
              { key: 'n', header: 'Worker', render: (p) => p.name ?? p.userId },
              { key: 'l', header: 'Lines', align: 'right', render: (p) => p.lines },
              { key: 'a', header: 'Pending', align: 'right', render: (p) => <Money value={p.amount} strong /> },
            ]} />
          )}
        </SectionCard>
      </Grid>
    </Grid>
  );
}

// ─── Earnings lines ──────────────────────────────────────────────────

interface EarningLine {
  id: string;
  userId: string;
  bookingId: string | null;
  kind: 'JOB_FIXED' | 'JOB_COMMISSION' | 'INCENTIVE' | 'DEDUCTION' | 'REIMBURSEMENT';
  amount: number;
  status: 'PENDING' | 'IN_PAYOUT' | 'VOID';
  note: string | null;
  earnedAt: string;
  user: { fullName: string };
  booking: { id: string; code: string } | null;
  payout: { id: string; status: string } | null;
}

const KIND_LABELS: Record<EarningLine['kind'], string> = { JOB_FIXED: 'Job (fixed)', JOB_COMMISSION: 'Job (commission)', INCENTIVE: 'Incentive', DEDUCTION: 'Deduction', REIMBURSEMENT: 'Reimbursement' };

function EarningsLinesTab() {
  const workers = useFieldWorkers();
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const list = useQuery({
    queryKey: ['admin', 'payroll', 'earnings', { userId, status, kind, page, pageSize }],
    queryFn: () => api.page<EarningLine>('/admin/finance/earnings', { userId: userId || undefined, status: status || undefined, kind: kind || undefined, page, pageSize }),
    placeholderData: keepPreviousData,
  });
  const columns: Column<EarningLine>[] = [
    { key: 'd', header: 'Earned', render: (e) => <Box sx={{ whiteSpace: 'nowrap' }}>{dateTime(e.earnedAt)}</Box> },
    { key: 'w', header: 'Worker', primary: true, render: (e) => e.user.fullName },
    { key: 'k', header: 'Type', render: (e) => KIND_LABELS[e.kind] ?? humanize(e.kind) },
    { key: 'n', header: 'Note', hideOnMobile: true, render: (e) => <Typography variant="body2" sx={{ maxWidth: 320 }}>{e.note ?? '—'}</Typography> },
    { key: 'b', header: 'Booking', render: (e) => (e.booking ? <Link component={RouterLink} to={`/admin/bookings/${e.booking.id}`}>{e.booking.code}</Link> : '—') },
    { key: 's', header: 'Status', render: (e) => (<Box><EnumChip value={e.status} label={e.status === 'IN_PAYOUT' ? 'In payout' : undefined} color={e.status === 'IN_PAYOUT' ? 'info' : e.status === 'VOID' ? 'default' : 'warning'} />{e.payout && <Typography variant="caption" color="text.secondary" display="block">Payout {humanize(e.payout.status).toLowerCase()}</Typography>}</Box>) },
    { key: 'a', header: 'Amount', align: 'right', render: (e) => <Money value={e.amount} strong negative={e.amount < 0} /> },
  ];
  return (
    <Box>
      <FilterBar>
        <Autocomplete
          size="small"
          sx={{ minWidth: 260 }}
          options={workers.data ?? []}
          loading={workers.isLoading}
          value={(workers.data ?? []).find((w) => w.id === userId) ?? null}
          onChange={(_, w) => { setUserId(w?.id ?? ''); setPage(1); }}
          getOptionLabel={(w) => `${w.fullName}${w.workerProfile?.employeeCode ? ` · ${w.workerProfile.employeeCode}` : ''}`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(p) => <TextField {...p} label="Worker" placeholder="All workers" />}
        />
        <TextField select size="small" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">All statuses</MenuItem>
          <MenuItem value="PENDING">Pending</MenuItem>
          <MenuItem value="IN_PAYOUT">In payout</MenuItem>
          <MenuItem value="VOID">Void</MenuItem>
        </TextField>
        <TextField select size="small" label="Type" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} sx={{ minWidth: 170 }}>
          <MenuItem value="">All types</MenuItem>
          {(Object.keys(KIND_LABELS) as EarningLine['kind'][]).map((k) => <MenuItem key={k} value={k}>{KIND_LABELS[k]}</MenuItem>)}
        </TextField>
      </FilterBar>
      <DataTable rows={list.data?.data} columns={columns} rowKey={(e) => e.id} loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()} emptyTitle="No earnings lines match" page={page} pageSize={pageSize} total={list.data?.meta.total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} dense />
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
        Pending lines are bundled into the next payout; deductions are negative. Reimbursements come from approved expense claims and are excluded from earnings in Profit &amp; loss (counted as expenses).
      </Typography>
    </Box>
  );
}

// ─── Payouts ─────────────────────────────────────────────────────────

function PayoutsTab({ toast, toastError }: Toasts) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [genOpen, setGenOpen] = useState(false);
  const [act, setAct] = useState<{ p: PayoutRow; action: 'approve' | 'pay' | 'cancel' } | null>(null);
  const list = useQuery({ queryKey: ['admin', 'payroll', 'payouts', { status, page }], queryFn: () => api.page<PayoutRow>('/admin/finance/payouts', { status: status || undefined, page, pageSize: 20 }), placeholderData: keepPreviousData });
  const pendingBy = (list.data?.meta.pendingByWorker ?? []) as PendingByWorker[];
  const pendingTotal = pendingBy.reduce((a, p) => a + p.amount, 0);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin', 'payroll'] });
  const gen = useMutation({
    mutationFn: (b: { periodStart: string; periodEnd: string }) => api.post<PayoutRow[]>('/admin/finance/payouts/generate', b),
    onSuccess: (r) => {
      toast(r.length ? `${r.length} draft payout(s) created` : 'No pending earnings in this period');
      setGenOpen(false);
      invalidate();
    },
  });
  const run = useMutation({
    mutationFn: ({ id, action, paymentRef }: { id: string; action: string; paymentRef?: string }) => api.post(`/admin/finance/payouts/${id}/${action}`, { paymentRef }),
    onSuccess: (_d, v) => {
      toast(v.action === 'approve' ? 'Payout approved' : v.action === 'pay' ? 'Payout marked paid; worker notified' : 'Payout cancelled; earnings returned to pending');
      setAct(null);
      invalidate();
      void qc.invalidateQueries({ queryKey: ['admin', 'finance', 'expenses'] });
    },
    onError: toastError,
  });
  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <SectionCard title="Pending earnings" sx={{ height: '100%' }}>
            <Typography variant="h3" sx={num}>{inr(pendingTotal)}</Typography>
            <Typography variant="caption" color="text.secondary">{pendingBy.length} worker(s) · not yet in a payout</Typography>
            <Box sx={{ mt: 1.5 }}>
              <SimpleTable rows={pendingBy} rowKey={(p) => p.userId} empty="Nothing pending." maxHeight={220} columns={[
                { key: 'n', header: 'Worker', render: (p) => p.name ?? p.userId },
                { key: 'a', header: 'Amount', align: 'right', render: (p) => <Money value={p.amount} /> },
              ]} />
            </Box>
            <Button variant="contained" fullWidth sx={{ mt: 1.5 }} disabled={!pendingBy.length} onClick={() => { gen.reset(); setGenOpen(true); }}>Generate draft payouts</Button>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <Alert severity="info" sx={{ height: '100%' }}>
            <strong>How payouts work.</strong> Generating bundles each worker’s pending earnings (job pay, incentives, deductions and approved expense reimbursements) earned before the period end into a draft. Approve, then pay and enter the transfer reference. Paying settles the included reimbursement claims (they show as Paid in Expenses). Cancelling a draft or approved payout returns its earnings to pending.
          </Alert>
        </Grid>
      </Grid>
      <FilterBar>
        <ToggleButtonGroup size="small" exclusive value={status} onChange={(_, v) => { setStatus(v ?? ''); setPage(1); }}>
          <ToggleButton value="">All</ToggleButton>
          <ToggleButton value="DRAFT">Draft</ToggleButton>
          <ToggleButton value="APPROVED">Approved</ToggleButton>
          <ToggleButton value="PAID">Paid</ToggleButton>
          <ToggleButton value="CANCELLED">Cancelled</ToggleButton>
        </ToggleButtonGroup>
      </FilterBar>
      <SectionCard>
        {list.isLoading ? <LoadingBlock /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : (
          <>
            <SimpleTable
              rows={list.data?.data}
              rowKey={(p) => p.id}
              empty="No payouts."
              minWidth={1040}
              columns={[
                { key: 'w', header: 'Worker', render: (p) => (<Box><Typography variant="body2" sx={{ fontWeight: 600 }}>{p.user.fullName}</Typography><Typography variant="caption" color="text.secondary">{p.user.workerProfile?.employeeCode}{p.user.workerProfile?.payoutMethod ? ` · ${p.user.workerProfile.payoutMethod} ${p.user.workerProfile.payoutDetailsMasked ?? ''}` : ' · no payout details'}</Typography></Box>) },
                { key: 'per', header: 'Period', render: (p) => periodLabel(p.periodStart, p.periodEnd), nowrap: true },
                { key: 'e', header: 'Job earnings', align: 'right', render: (p) => <Money value={p.earningsAmount} /> },
                { key: 'i', header: 'Incentives', align: 'right', render: (p) => (p.incentivesAmount ? <Money value={p.incentivesAmount} /> : '—') },
                { key: 'd', header: 'Deductions', align: 'right', render: (p) => (p.deductionsAmount ? <Money value={-p.deductionsAmount} negative /> : '—') },
                { key: 'r', header: 'Reimbursements', align: 'right', render: (p) => (p.reimbursementsAmount ? <Money value={p.reimbursementsAmount} /> : '—') },
                { key: 'n', header: 'Net payout', align: 'right', render: (p) => <Money value={p.netAmount} strong /> },
                { key: 's', header: 'Status', render: (p) => (<Box><EnumChip value={p.status} />{p.status === 'PAID' && <Typography variant="caption" color="text.secondary" display="block">{date(p.paidAt)} · {p.paymentRef}</Typography>}</Box>) },
                {
                  key: 'x',
                  header: '',
                  align: 'right',
                  render: (p) => (
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {p.status === 'DRAFT' && <Button size="small" variant="contained" onClick={() => setAct({ p, action: 'approve' })}>Approve</Button>}
                      {p.status === 'APPROVED' && <Button size="small" variant="contained" color="success" onClick={() => setAct({ p, action: 'pay' })}>Pay</Button>}
                      {(p.status === 'DRAFT' || p.status === 'APPROVED') && <Button size="small" color="error" onClick={() => setAct({ p, action: 'cancel' })}>Cancel</Button>}
                    </Stack>
                  ),
                },
              ]}
            />
            {(list.data?.meta.totalPages ?? 1) > 1 && (
              <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center" sx={{ mt: 1 }}>
                <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Typography variant="body2">Page {page} of {list.data?.meta.totalPages}</Typography>
                <Button size="small" disabled={page >= (list.data?.meta.totalPages ?? 1)} onClick={() => setPage(page + 1)}>Next</Button>
              </Stack>
            )}
          </>
        )}
      </SectionCard>
      <PeriodDialog open={genOpen} title="Generate draft payouts" submitLabel="Generate drafts" defaultRange={monthBounds(-1)} loading={gen.isPending} error={gen.error} onClose={() => setGenOpen(false)} onSubmit={(v) => gen.mutate({ periodStart: v.periodStart, periodEnd: v.periodEnd })}
        intro={<Typography variant="body2" color="text.secondary">All pending earnings earned before the end of the last day are bundled — including older unpaid lines. One draft per worker.</Typography>}
      />
      <ConfirmDialog open={act?.action === 'approve'} title="Approve payout?" body={`Approve ${inr(act?.p.netAmount)} for ${act?.p.user.fullName}.`} confirmLabel="Approve" loading={run.isPending} onClose={() => setAct(null)} onConfirm={() => act && run.mutate({ id: act.p.id, action: 'approve' })} />
      <ConfirmDialog open={act?.action === 'cancel'} title="Cancel payout?" body={`The ${act?.p.status.toLowerCase()} payout for ${act?.p.user.fullName} is cancelled and its earnings return to pending for a future payout.`} confirmLabel="Cancel payout" danger loading={run.isPending} onClose={() => setAct(null)} onConfirm={() => act && run.mutate({ id: act.p.id, action: 'cancel' })} />
      <PromptDialog open={act?.action === 'pay'} title={`Pay ${act?.p.user.fullName ?? ''}`} body={<>Record that <strong>{inr(act?.p.netAmount)}</strong> was transferred{act?.p.user.workerProfile?.payoutMethod ? ` via ${act.p.user.workerProfile.payoutMethod} ${act.p.user.workerProfile.payoutDetailsMasked ?? ''}` : ''}.{act?.p.reimbursementsAmount ? ` Includes ${inr(act.p.reimbursementsAmount)} of expense reimbursements, which will be marked paid.` : ''} The worker is notified by SMS.</>} label="Payment reference (UTR / txn id)" confirmLabel="Mark paid" minLength={2} maxLength={60} multiline={false} loading={run.isPending} onClose={() => setAct(null)} onConfirm={(ref) => act && run.mutate({ id: act.p.id, action: 'pay', paymentRef: ref })} />
    </Box>
  );
}

export default function Payroll() {
  const { toast, toastError, toastNode } = useToast();
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'salaries');
  return (
    <Box>
      <PageHeader title="Payroll & payouts" subtitle="Salary obligations for staff, and earnings payouts for drivers and recovery workers" />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="salaries" label="Salaries" />
        <Tab value="adjustments" label="Earnings adjustments" />
        <Tab value="earnings" label="Earnings lines" />
        <Tab value="payouts" label="Payouts" />
      </Tabs>
      {tab === 'salaries' && <SalariesTab toast={toast} toastError={toastError} />}
      {tab === 'adjustments' && <AdjustmentsTab toast={toast} toastError={toastError} />}
      {tab === 'earnings' && <EarningsLinesTab />}
      {tab === 'payouts' && <PayoutsTab toast={toast} toastError={toastError} />}
      {toastNode}
    </Box>
  );
}
