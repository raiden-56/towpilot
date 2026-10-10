/** Finance → Expenses, Reconciliation and Ageing tabs. */
import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Card, Checkbox, Chip, FormControlLabel, Grid, LinearProgress, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { api } from '@/api/client';
import { DataTable, type Column } from '@/components/DataTable';
import { ErrorState, KpiCard, LoadingBlock, Money, SampleTag, SectionCard } from '@/components/common';
import { date, dateTime, humanize, inr } from '@/lib/format';
import { AGEING_KEYS, AGEING_LABELS, type AgeingKey, type ExpenseRow } from './types';
import { addDaysInput, daysPastDue, EnumChip, EXPENSE_CATEGORIES, FilterBar, FormDialog, localDateEndIso, localDateToIso, num, numOpt, PromptDialog, RupeeField, SimpleTable, todayInput } from './shared';
import { useTrucksLite, useZones } from './queries';

type Toasts = { toast: (m: string) => void; toastError: (e: unknown) => void; canManage: boolean };

// ─── Expenses ────────────────────────────────────────────────────────

const expenseSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES),
    source: z.enum(['DIRECT', 'VENDOR_BILL']),
    description: z.string().trim().min(3, 'Describe the expense').max(300),
    vendorName: z.string().max(120),
    vendorBillRef: z.string().max(60),
    amount: z.number({ error: 'Enter the amount' }).positive('Must be more than 0'),
    taxAmount: z.number().min(0).optional(),
    expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
    truckId: z.string(),
    zoneId: z.string(),
    fuelLitres: z.number().positive().optional(),
    odometerKm: z.number().int().min(0).optional(),
    paid: z.boolean(),
    paymentRef: z.string().max(60),
  })
  .refine((v) => v.source !== 'VENDOR_BILL' || v.vendorName.trim().length > 1, { path: ['vendorName'], message: 'Vendor name is required for vendor bills' })
  .refine((v) => !v.paid || v.paymentRef.trim().length >= 2, { path: ['paymentRef'], message: 'Enter the payment reference' });
type ExpenseValues = z.infer<typeof expenseSchema>;

function ExpenseDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const trucks = useTrucksLite(open);
  const zones = useZones(open);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { register, handleSubmit, reset, control, watch, formState } = useForm<ExpenseValues>({ resolver: zodResolver(expenseSchema) });
  const save = useMutation({
    mutationFn: (v: ExpenseValues) => {
      const f = new FormData();
      f.set('category', v.category);
      f.set('source', v.source);
      f.set('description', v.description);
      if (v.vendorName) f.set('vendorName', v.vendorName);
      if (v.vendorBillRef) f.set('vendorBillRef', v.vendorBillRef);
      f.set('amount', String(v.amount));
      f.set('taxAmount', String(v.taxAmount ?? 0));
      f.set('expenseDate', localDateToIso(v.expenseDate));
      if (v.truckId) f.set('truckId', v.truckId);
      if (v.zoneId) f.set('zoneId', v.zoneId);
      if (v.fuelLitres != null) f.set('fuelLitres', String(v.fuelLitres));
      if (v.odometerKm != null) f.set('odometerKm', String(v.odometerKm));
      f.set('paid', v.paid ? 'true' : 'false');
      if (v.paid && v.paymentRef) f.set('paymentRef', v.paymentRef);
      if (file) f.set('receipt', file);
      return api.upload('/admin/finance/expenses', f);
    },
    onSuccess: onSaved,
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    setFile(null);
    reset({ category: 'FUEL', source: 'DIRECT', description: '', vendorName: '', vendorBillRef: '', amount: undefined as unknown as number, taxAmount: undefined, expenseDate: todayInput(), truckId: '', zoneId: '', fuelLitres: undefined, odometerKm: undefined, paid: false, paymentRef: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const e = formState.errors;
  const source = watch('source');
  const category = watch('category');
  const paid = watch('paid');
  return (
    <FormDialog open={open} title="Record expense or vendor bill" onClose={onClose} onSubmit={handleSubmit((v) => save.mutate(v))} submitting={save.isPending} error={save.error} maxWidth="md" submitLabel="Save expense"
      intro={<Typography variant="body2" color="text.secondary">Expenses recorded by finance are approved on entry. Enter the amount before GST; recoverable GST input tax goes in the GST field and is excluded from operating costs.</Typography>}
    >
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Controller control={control} name="source" render={({ field }) => (
            <TextField select label="Source" fullWidth {...field}>
              <MenuItem value="DIRECT">Direct expense</MenuItem>
              <MenuItem value="VENDOR_BILL">Vendor bill</MenuItem>
            </TextField>
          )} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Controller control={control} name="category" render={({ field }) => (
            <TextField select label="Category" fullWidth {...field}>
              {EXPENSE_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{humanize(c)}</MenuItem>)}
            </TextField>
          )} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField label="Expense date" type="date" fullWidth required {...register('expenseDate')} error={!!e.expenseDate} helperText={e.expenseDate?.message} slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
        <Grid size={12}>
          <TextField label="Description" fullWidth required {...register('description')} error={!!e.description} helperText={e.description?.message} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Vendor name" fullWidth required={source === 'VENDOR_BILL'} {...register('vendorName')} error={!!e.vendorName} helperText={e.vendorName?.message} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Vendor bill / invoice no." fullWidth {...register('vendorBillRef')} error={!!e.vendorBillRef} helperText={e.vendorBillRef?.message} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <RupeeField label="Amount (excl. GST)" fullWidth required {...register('amount', numOpt)} error={!!e.amount} helperText={e.amount?.message} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <RupeeField label="GST (input tax)" fullWidth {...register('taxAmount', numOpt)} error={!!e.taxAmount} helperText={e.taxAmount?.message ?? 'Optional'} />
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <Controller control={control} name="truckId" render={({ field }) => (
            <TextField select label="Truck" fullWidth {...field}>
              <MenuItem value="">Not truck-specific</MenuItem>
              {(trucks.data?.data ?? []).map((t) => <MenuItem key={t.id} value={t.id}>{t.registrationNumber} · {humanize(t.truckType)}</MenuItem>)}
            </TextField>
          )} />
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <Controller control={control} name="zoneId" render={({ field }) => (
            <TextField select label="Zone" fullWidth {...field}>
              <MenuItem value="">Company-wide</MenuItem>
              {(zones.data ?? []).map((z) => <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>)}
            </TextField>
          )} />
        </Grid>
        {category === 'FUEL' && (
          <>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="Fuel (litres)" type="number" fullWidth {...register('fuelLitres', numOpt)} error={!!e.fuelLitres} helperText={e.fuelLitres?.message} slotProps={{ htmlInput: { step: 0.01, min: 0 } }} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="Odometer (km)" type="number" fullWidth {...register('odometerKm', numOpt)} error={!!e.odometerKm} helperText={e.odometerKm?.message} slotProps={{ htmlInput: { min: 0 } }} />
            </Grid>
          </>
        )}
        <Grid size={{ xs: 12, sm: category === 'FUEL' ? 6 : 12 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button variant="outlined" startIcon={<AttachFileIcon />} onClick={() => fileRef.current?.click()}>
              {file ? 'Change receipt' : 'Attach receipt'}
            </Button>
            <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>{file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : 'PDF or image, optional'}</Typography>
            <input ref={fileRef} type="file" hidden accept="application/pdf,image/*" onChange={(ev) => { setFile(ev.target.files?.[0] ?? null); ev.target.value = ''; }} />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Controller control={control} name="paid" render={({ field }) => <FormControlLabel control={<Checkbox checked={!!field.value} onChange={(ev) => field.onChange(ev.target.checked)} />} label="Already paid" />} />
        </Grid>
        {paid && (
          <Grid size={{ xs: 12, sm: 8 }}>
            <TextField label="Payment reference (UTR / cheque / txn id)" fullWidth required {...register('paymentRef')} error={!!e.paymentRef} helperText={e.paymentRef?.message} />
          </Grid>
        )}
      </Grid>
    </FormDialog>
  );
}

function MarkPaidDialog({ expense, onClose, onDone }: { expense: ExpenseRow | null; onClose: () => void; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const [paidAt, setPaidAt] = useState(todayInput());
  const m = useMutation({ mutationFn: () => api.post(`/admin/finance/expenses/${expense!.id}/paid`, { paymentRef: ref.trim(), paidAt: localDateToIso(paidAt) }), onSuccess: onDone });
  useEffect(() => {
    if (expense) {
      setRef('');
      setPaidAt(todayInput());
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expense]);
  return (
    <FormDialog open={!!expense} title={`Mark ${expense?.number ?? ''} paid`} onClose={onClose} onSubmit={() => m.mutate()} submitting={m.isPending} submitDisabled={ref.trim().length < 2 || !paidAt} error={m.error} submitLabel="Mark paid" maxWidth="xs">
      <Typography variant="body2" sx={{ mb: 2 }}>
        {expense?.vendorName ?? expense?.description}: <strong>{inr((expense?.amount ?? 0) + (expense?.taxAmount ?? 0))}</strong> incl. GST. This records cash out in the cash-flow report on the paid date.
      </Typography>
      <Stack spacing={2}>
        <TextField label="Payment reference" required fullWidth value={ref} onChange={(e) => setRef(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />
        <TextField label="Paid on" type="date" required fullWidth value={paidAt} onChange={(e) => setPaidAt(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>
    </FormDialog>
  );
}

export function ExpensesTab({ toast, toastError, canManage }: Toasts) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [truckId, setTruckId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [rejecting, setRejecting] = useState<ExpenseRow | null>(null);
  const [paying, setPaying] = useState<ExpenseRow | null>(null);
  const trucks = useTrucksLite();
  const query = { status: status || undefined, category: category || undefined, truckId: truckId || undefined, from: from ? localDateToIso(from) : undefined, to: to ? localDateEndIso(to) : undefined };
  const list = useQuery({ queryKey: ['admin', 'finance', 'expenses', query, page, pageSize], queryFn: () => api.page<ExpenseRow>('/admin/finance/expenses', { ...query, page, pageSize }), placeholderData: keepPreviousData });
  const sum = (list.data?.meta.sum ?? null) as { amount: number | null; taxAmount: number | null } | null;
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin', 'finance', 'expenses'] });
  const decide = useMutation({
    mutationFn: ({ id, approve, reason }: { id: string; approve: boolean; reason?: string }) => api.post(`/admin/finance/expenses/${id}/decision`, { approve, reason }),
    onSuccess: (_d, v) => {
      toast(v.approve ? 'Expense approved' : 'Expense rejected');
      setRejecting(null);
      invalidate();
    },
    onError: toastError,
  });
  const reset = () => setPage(1);
  const columns: Column<ExpenseRow>[] = [
    { key: 'd', header: 'Date', render: (x) => <Box sx={{ whiteSpace: 'nowrap' }}>{date(x.expenseDate)}</Box> },
    { key: 'desc', header: 'Expense', primary: true, render: (x) => (<Box><Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>{x.description}</Typography><SampleTag show={x.isSample} /><Typography variant="caption" color="text.secondary" display="block">{x.number} · {humanize(x.category)}{x.source === 'VENDOR_BILL' ? ' · vendor bill' : ''}{x.fuelLitres ? ` · ${x.fuelLitres} L` : ''}</Typography></Box>) },
    { key: 'v', header: 'Vendor / claimant', render: (x) => (x.claimant ? (<Box>{x.claimant}{x.reimbursable && <Chip size="small" label="Reimbursable claim" variant="outlined" color="info" sx={{ ml: 0.5, height: 20, fontSize: 11 }} />}</Box>) : x.vendorName ? <Box>{x.vendorName}{x.vendorBillRef && <Typography variant="caption" color="text.secondary" display="block">Bill {x.vendorBillRef}</Typography>}</Box> : '—') },
    { key: 't', header: 'Truck / booking', hideOnMobile: true, render: (x) => [x.truck?.registrationNumber, x.booking?.code].filter(Boolean).join(' · ') || '—' },
    { key: 'a', header: 'Amount', align: 'right', render: (x) => <Money value={x.amount} /> },
    { key: 'g', header: 'GST', align: 'right', hideOnMobile: true, render: (x) => (x.taxAmount ? <Money value={x.taxAmount} /> : '—') },
    { key: 's', header: 'Status', render: (x) => (<Box><EnumChip value={x.status} />{x.status === 'REJECTED' && x.rejectionReason && <Typography variant="caption" color="text.secondary" display="block">{x.rejectionReason}</Typography>}{x.status === 'PAID' && <Typography variant="caption" color="text.secondary" display="block">{date(x.paidAt)}{x.paymentRef ? ` · ${x.paymentRef}` : ''}</Typography>}</Box>) },
    { key: 'r', header: 'Receipt', hideOnMobile: true, render: (x) => (x.attachmentUrl ? <Link href={x.attachmentUrl} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>View</Link> : '—') },
    {
      key: 'x',
      header: '',
      align: 'right',
      render: (x) =>
        canManage && (
          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
            {x.status === 'SUBMITTED' && (
              <>
                <Button size="small" variant="contained" disabled={decide.isPending} onClick={() => decide.mutate({ id: x.id, approve: true })}>Approve</Button>
                <Button size="small" color="error" onClick={() => setRejecting(x)}>Reject</Button>
              </>
            )}
            {x.status === 'APPROVED' && !x.reimbursable && <Button size="small" variant="outlined" onClick={() => setPaying(x)}>Mark paid</Button>}
            {x.status === 'APPROVED' && x.reimbursable && <Typography variant="caption" color="text.secondary">Paid via next payout</Typography>}
          </Stack>
        ),
    },
  ];
  return (
    <Box>
      <FilterBar actions={canManage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>Record expense</Button>}>
        <TextField select size="small" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} sx={{ minWidth: 170 }}>
          <MenuItem value="">All statuses</MenuItem>
          <MenuItem value="SUBMITTED">Submitted (needs decision)</MenuItem>
          <MenuItem value="APPROVED">Approved (unpaid)</MenuItem>
          <MenuItem value="PAID">Paid</MenuItem>
          <MenuItem value="REJECTED">Rejected</MenuItem>
        </TextField>
        <TextField select size="small" label="Category" value={category} onChange={(e) => { setCategory(e.target.value); reset(); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">All categories</MenuItem>
          {EXPENSE_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{humanize(c)}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Truck" value={truckId} onChange={(e) => { setTruckId(e.target.value); reset(); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">All trucks</MenuItem>
          {(trucks.data?.data ?? []).map((t) => <MenuItem key={t.id} value={t.id}>{t.registrationNumber}</MenuItem>)}
        </TextField>
        <TextField size="small" type="date" label="From" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="To" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} slotProps={{ inputLabel: { shrink: true } }} />
      </FilterBar>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="Expenses (filtered, excl. GST)" value={inr(sum?.amount ?? 0)} hint={`${list.data?.meta.total ?? 0} entries`} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="GST input tax" value={inr(sum?.taxAmount ?? 0)} hint="Recoverable; not an operating cost" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="Total incl. GST" value={inr((sum?.amount ?? 0) + (sum?.taxAmount ?? 0))} hint="Cash required when paid" /></Grid>
      </Grid>
      <Alert severity="info" sx={{ mb: 2 }}>
        Approving an employee claim marked reimbursable adds it to the worker’s pending earnings; it is paid (and marked paid here) when their payout is paid in Payroll — not with “Mark paid”.
      </Alert>
      <DataTable rows={list.data?.data} columns={columns} rowKey={(x) => x.id} loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()} emptyTitle="No expenses match" page={page} pageSize={pageSize} total={list.data?.meta.total} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} dense />
      <ExpenseDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => { toast('Expense recorded'); setCreateOpen(false); invalidate(); }} />
      <PromptDialog open={!!rejecting} title={`Reject ${rejecting?.number ?? ''}`} body={`${rejecting?.claimant ?? 'The submitter'} will be notified with this reason.`} label="Reason" confirmLabel="Reject expense" danger maxLength={300} loading={decide.isPending} onClose={() => setRejecting(null)} onConfirm={(reason) => rejecting && decide.mutate({ id: rejecting.id, approve: false, reason })} />
      <MarkPaidDialog expense={paying} onClose={() => setPaying(null)} onDone={() => { toast('Expense marked paid'); setPaying(null); invalidate(); }} />
    </Box>
  );
}

// ─── Reconciliation ──────────────────────────────────────────────────

interface Recon {
  range: { from: string; to: string };
  totals: { ordersCreated: number; succeeded: number; succeededAmount: number; gatewayFees: number; sandboxAmount: number; webhookEvents: number; duplicateOrIgnored: number; refundsSucceeded: number };
  issues: { type: string; ref: string; detail: string }[];
  events: { id: string; provider: string; eventId: string; eventType: string; signatureValid: boolean; status: string; error: string | null; receivedAt: string; processedAt: string | null }[];
}

export function ReconciliationTab() {
  const [from, setFrom] = useState(addDaysInput(todayInput(), -7));
  const [to, setTo] = useState(todayInput());
  const valid = from && to && to >= from;
  const q = useQuery({ queryKey: ['admin', 'finance', 'reconciliation', from, to], queryFn: () => api.get<Recon>('/admin/finance/reconciliation', { from: localDateToIso(from), to: localDateEndIso(to) }), enabled: !!valid });
  const t = q.data?.totals;
  return (
    <Box>
      <FilterBar>
        <TextField size="small" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} error={!valid} helperText={!valid ? 'End must be on/after start' : undefined} />
        <Typography variant="body2" color="text.secondary">Online gateway orders vs verified webhook events vs refunds.</Typography>
      </FilterBar>
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : t && (
        <Stack spacing={2}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 3 }}><KpiCard label="Gateway orders" value={t.ordersCreated} hint={`${t.succeeded} succeeded`} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><KpiCard label="Captured online" value={inr(t.succeededAmount)} hint={t.sandboxAmount ? `${inr(t.sandboxAmount)} sandbox (not real money)` : 'All live'} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><KpiCard label="Gateway fees" value={inr(t.gatewayFees)} hint="Fees incl. GST, deducted at settlement" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><KpiCard label="Refunds settled" value={inr(t.refundsSucceeded)} hint={`${t.webhookEvents} webhook events · ${t.duplicateOrIgnored} duplicate/ignored`} /></Grid>
          </Grid>
          <SectionCard title={`Issues (${q.data!.issues.length})`}>
            {q.data!.issues.length === 0 ? (
              <Alert severity="success">No reconciliation issues in this range.</Alert>
            ) : (
              <SimpleTable rows={q.data!.issues} rowKey={(i) => `${i.type}-${i.ref}`} columns={[
                { key: 't', header: 'Type', render: (i) => <EnumChip value={i.type} color={i.type.includes('FAILED') || i.type === 'INVALID_SIGNATURE' ? 'error' : 'warning'} /> },
                { key: 'r', header: 'Reference', render: (i) => <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{i.ref}</Typography> },
                { key: 'd', header: 'Detail', render: (i) => i.detail },
              ]} />
            )}
          </SectionCard>
          <SectionCard title="Recent webhook events">
            <SimpleTable rows={q.data!.events} rowKey={(e) => e.id} empty="No webhook events received in this range." minWidth={760} columns={[
              { key: 'r', header: 'Received', render: (e) => dateTime(e.receivedAt), nowrap: true },
              { key: 'p', header: 'Provider', render: (e) => humanize(e.provider) },
              { key: 't', header: 'Event', render: (e) => <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{e.eventType}</Typography> },
              { key: 'id', header: 'Event id', render: (e) => <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{e.eventId}</Typography> },
              { key: 'sig', header: 'Signature', render: (e) => (e.signatureValid ? <Chip size="small" color="success" variant="outlined" label="Valid" /> : <Chip size="small" color="error" label="Invalid" />) },
              { key: 's', header: 'Status', render: (e) => (<Box><EnumChip value={e.status} />{e.error && <Typography variant="caption" color="error.main" display="block">{e.error}</Typography>}</Box>) },
            ]} />
          </SectionCard>
        </Stack>
      )}
    </Box>
  );
}

// ─── Ageing ──────────────────────────────────────────────────────────

interface Ageing {
  buckets: Record<AgeingKey, { count: number; amount: number }>;
  invoices: { id: string; number: string; billingName: string; outstanding: number; dueAt: string | null; issuedAt: string; fleetAccountId: string | null; bucket: AgeingKey }[];
}

export function AgeingTab() {
  const q = useQuery({ queryKey: ['admin', 'finance', 'ageing'], queryFn: () => api.get<Ageing>('/admin/finance/ageing') });
  const [bucket, setBucket] = useState<AgeingKey | ''>('');
  if (q.isLoading) return <LoadingBlock />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const total = AGEING_KEYS.reduce((a, k) => a + q.data.buckets[k].amount, 0);
  const rows = q.data.invoices.filter((i) => !bucket || i.bucket === bucket);
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        {AGEING_KEYS.map((k) => {
          const b = q.data.buckets[k];
          const pct = total ? (b.amount / total) * 100 : 0;
          return (
            <Grid key={k} size={{ xs: 6, md: 12 / 5 }} sx={{ flexBasis: { md: '20%' }, maxWidth: { md: '20%' } }}>
              <Card sx={{ p: 2, height: '100%', cursor: 'pointer', outline: bucket === k ? 2 : 0, outlineColor: 'primary.main' }} onClick={() => setBucket(bucket === k ? '' : k)} role="button" aria-pressed={bucket === k}>
                <Typography variant="overline" color="text.secondary">{AGEING_LABELS[k]}</Typography>
                <Typography variant="h4" sx={num}>{inr(b.amount)}</Typography>
                <LinearProgress variant="determinate" value={pct} color={k === 'current' ? 'info' : k === '1-30' ? 'warning' : 'error'} sx={{ my: 0.75, height: 5, borderRadius: 3 }} />
                <Typography variant="caption" color="text.secondary">{b.count} invoice{b.count === 1 ? '' : 's'} · {pct.toFixed(0)}%</Typography>
              </Card>
            </Grid>
          );
        })}
      </Grid>
      <SectionCard title={`Open invoices${bucket ? ` · ${AGEING_LABELS[bucket]}` : ''} (${rows.length})`} action={bucket && <Button size="small" onClick={() => setBucket('')}>Show all</Button>}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Total receivable {inr(total)}. Buckets are days past the due date (or issue date when no terms apply), oldest first.</Typography>
        <SimpleTable rows={rows} rowKey={(i) => i.id} empty="No outstanding invoices." minWidth={680} columns={[
          { key: 'n', header: 'Invoice', render: (i) => <Link component={RouterLink} to={`/admin/finance/invoices/${i.id}`}>{i.number}</Link>, nowrap: true },
          { key: 'b', header: 'Bill to', render: (i) => (i.fleetAccountId ? <Link component={RouterLink} to={`/admin/accounts/${i.fleetAccountId}`}>{i.billingName}</Link> : i.billingName) },
          { key: 'i', header: 'Issued', render: (i) => date(i.issuedAt), nowrap: true },
          { key: 'd', header: 'Due', render: (i) => date(i.dueAt ?? i.issuedAt), nowrap: true },
          { key: 'od', header: 'Days overdue', align: 'right', render: (i) => { const d = daysPastDue(i.dueAt, i.issuedAt); return d > 0 ? <Typography variant="body2" color={d > 30 ? 'error.main' : 'warning.main'} sx={num}>{d}</Typography> : '—'; } },
          { key: 'bk', header: 'Bucket', render: (i) => <EnumChip value={i.bucket} label={AGEING_LABELS[i.bucket]} color={i.bucket === 'current' ? 'info' : i.bucket === '1-30' ? 'warning' : 'error'} /> },
          { key: 'o', header: 'Outstanding', align: 'right', render: (i) => <Money value={i.outstanding} strong /> },
        ]} />
      </SectionCard>
    </Stack>
  );
}
