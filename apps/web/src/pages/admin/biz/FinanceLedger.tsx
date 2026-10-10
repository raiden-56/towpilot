/** Finance → Invoices, Payments and Refunds tabs. */
import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Checkbox, FormControlLabel, Grid, InputAdornment, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import DownloadIcon from '@mui/icons-material/Download';
import { api } from '@/api/client';
import type { PaymentStatus } from '@/api/types';
import { DataTable, type Column } from '@/components/DataTable';
import { ErrorState, KpiCard, LoadingBlock, Money, PaymentChip, SampleTag, SectionCard } from '@/components/common';
import { date, dateTime, humanize, inr, PAYMENT_LABELS } from '@/lib/format';
import type { InvoiceRow, PaymentRow, RefundRow } from './types';
import { daysPastDue, EnumChip, FilterBar, FormDialog, localDateEndIso, localDateToIso, MultiSelect, SandboxChip, SimpleTable, useDebounced } from './shared';
import { useFleetAccountsAll } from './queries';

type Toasts = { toast: (m: string) => void; toastError: (e: unknown) => void; canManage: boolean };

// ─── Invoices ────────────────────────────────────────────────────────

export function InvoicesTab({ toastError }: Toasts) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [account, setAccount] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [exporting, setExporting] = useState(false);
  const dq = useDebounced(q.trim());
  const accounts = useFleetAccountsAll();
  const query = { q: dq || undefined, paymentStatus: statuses.join(',') || undefined, type: type || undefined, from: from ? localDateToIso(from) : undefined, to: to ? localDateEndIso(to) : undefined, overdue: overdue ? true : undefined, fleetAccountId: account || undefined };
  const list = useQuery({
    queryKey: ['admin', 'finance', 'invoices', query, page, pageSize],
    queryFn: () => api.page<InvoiceRow>('/admin/finance/invoices', { ...query, page, pageSize }),
    placeholderData: keepPreviousData,
  });
  const sums = (list.data?.meta.sums ?? null) as { total: number | null; amountPaid: number | null; outstanding: number | null } | null;
  const reset = () => setPage(1);

  const columns: Column<InvoiceRow>[] = [
    { key: 'n', header: 'Invoice', primary: true, render: (i) => (<Box><Typography variant="body2" component="span" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{i.number}</Typography><SampleTag show={i.isSample} />{i.booking?.code && <Typography variant="caption" color="text.secondary" display="block">{i.booking.code}</Typography>}</Box>) },
    { key: 'b', header: 'Bill to', render: (i) => i.billingName },
    { key: 't', header: 'Type', render: (i) => humanize(i.type), hideOnMobile: true },
    { key: 'd', header: 'Issued', render: (i) => <Box sx={{ whiteSpace: 'nowrap' }}>{date(i.issuedAt)}</Box> },
    { key: 'due', header: 'Due', hideOnMobile: true, render: (i) => { const d = i.status === 'ISSUED' && i.outstanding > 0 ? daysPastDue(i.dueAt, i.issuedAt) : 0; return <Box sx={{ whiteSpace: 'nowrap' }}>{date(i.dueAt)}{d > 0 && <Typography variant="caption" color="error.main" display="block">{d} days overdue</Typography>}</Box>; } },
    { key: 'tot', header: 'Total', align: 'right', render: (i) => <Money value={i.total} /> },
    { key: 'paid', header: 'Paid', align: 'right', render: (i) => <Money value={i.amountPaid} />, hideOnMobile: true },
    { key: 'out', header: 'Outstanding', align: 'right', render: (i) => <Money value={i.outstanding} strong={i.outstanding > 0} /> },
    { key: 's', header: 'Status', render: (i) => (<Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{i.status === 'VOID' ? <EnumChip value="VOID" /> : <PaymentChip status={i.paymentStatus} />}{i.disputed && <EnumChip value="DISPUTED" label="Dispute" color="error" />}</Stack>) },
  ];

  return (
    <Box>
      <FilterBar
        actions={
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await api.download('/admin/finance/invoices.csv', `invoices${from ? `-${from}` : ''}${to ? `-to-${to}` : ''}.csv`, query);
              } catch (e) {
                toastError(e);
              } finally {
                setExporting(false);
              }
            }}
          >
            Export CSV
          </Button>
        }
      >
        <TextField size="small" placeholder="Invoice no., customer or booking" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} sx={{ minWidth: { md: 260 } }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Search invoices', maxLength: 60 } }} />
        <Box sx={{ minWidth: { md: 220 } }}>
          <MultiSelect size="small" label="Payment status" options={(Object.keys(PAYMENT_LABELS) as PaymentStatus[]).map((s) => ({ value: s, label: PAYMENT_LABELS[s] }))} value={statuses} onChange={(v) => { setStatuses(v); reset(); }} />
        </Box>
        <TextField select size="small" label="Type" value={type} onChange={(e) => { setType(e.target.value); reset(); }} sx={{ minWidth: 150 }}>
          <MenuItem value="">All types</MenuItem>
          <MenuItem value="SERVICE">Service</MenuItem>
          <MenuItem value="CANCELLATION">Cancellation</MenuItem>
          <MenuItem value="MEMBERSHIP">Membership</MenuItem>
        </TextField>
        <TextField select size="small" label="Business account" value={account} onChange={(e) => { setAccount(e.target.value); reset(); }} sx={{ minWidth: 190 }}>
          <MenuItem value="">All customers</MenuItem>
          {(accounts.data?.data ?? []).map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
        </TextField>
        <TextField size="small" type="date" label="Issued from" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="Issued to" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} slotProps={{ inputLabel: { shrink: true } }} />
        <FormControlLabel control={<Checkbox checked={overdue} onChange={(e) => { setOverdue(e.target.checked); reset(); }} />} label="Overdue only" />
      </FilterBar>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="Invoiced (filtered)" value={inr(sums?.total ?? 0)} hint={`${list.data?.meta.total ?? 0} invoices · excludes void`} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="Collected" value={inr(sums?.amountPaid ?? 0)} hint="Confirmed payments on these invoices" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><KpiCard label="Outstanding" value={inr(sums?.outstanding ?? 0)} hint="Receivable on these invoices" /></Grid>
      </Grid>
      <DataTable
        rows={list.data?.data}
        columns={columns}
        rowKey={(i) => i.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(i) => nav(`/admin/finance/invoices/${i.id}`)}
        emptyTitle="No invoices match"
        emptyBody="Adjust the filters or date range."
        page={page}
        pageSize={pageSize}
        total={list.data?.meta.total}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        dense
      />
    </Box>
  );
}

// ─── Payments ────────────────────────────────────────────────────────

function CashQueue({ toast, toastError, canManage }: Toasts) {
  const qc = useQueryClient();
  const pending = useQuery({ queryKey: ['admin', 'finance', 'payments', 'cash-pending'], queryFn: () => api.page<PaymentRow>('/admin/finance/payments', { method: 'CASH', status: 'PENDING', pageSize: 100 }) });
  const [decision, setDecision] = useState<{ p: PaymentRow; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => api.post(`/admin/finance/payments/${id}/cash-decision`, { approve, note }),
    onSuccess: (_d, v) => {
      toast(v.approve ? 'Cash collection confirmed' : 'Cash collection rejected');
      setDecision(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'finance'] });
    },
  });
  useEffect(() => {
    if (decision) {
      setNote('');
      decide.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision]);
  void toastError;
  const rows = pending.data?.data ?? [];
  const total = rows.reduce((a, p) => a + p.amount, 0);
  return (
    <SectionCard title={`Cash collections awaiting confirmation${rows.length ? ` (${rows.length} · ${inr(total)})` : ''}`}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Field cash is not counted as received until finance confirms the deposit. Confirmed amounts reduce the invoice balance; rejected entries return it to unpaid.
      </Typography>
      {pending.isLoading ? <LoadingBlock rows={2} /> : pending.error ? <ErrorState error={pending.error} onRetry={() => void pending.refetch()} /> : (
        <SimpleTable
          rows={rows}
          rowKey={(p) => p.id}
          empty="No unconfirmed cash collections."
          minWidth={760}
          columns={[
            { key: 'd', header: 'Collected', render: (p) => dateTime(p.createdAt), nowrap: true },
            { key: 'c', header: 'Collected by', render: (p) => p.collectedBy ?? '—' },
            { key: 'i', header: 'Invoice', render: (p) => <Link component={RouterLink} to={`/admin/finance/invoices/${p.invoiceId}`}>{p.invoice?.number}</Link> },
            { key: 'b', header: 'Customer', render: (p) => p.invoice?.billingName },
            { key: 'n', header: 'Note', render: (p) => p.notes ?? '—' },
            { key: 'a', header: 'Amount', align: 'right', render: (p) => <Money value={p.amount} strong /> },
            {
              key: 'x',
              header: '',
              align: 'right',
              render: (p) =>
                canManage && (
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Button size="small" variant="contained" color="success" onClick={() => setDecision({ p, approve: true })}>Confirm</Button>
                    <Button size="small" color="error" onClick={() => setDecision({ p, approve: false })}>Reject</Button>
                  </Stack>
                ),
            },
          ]}
        />
      )}
      <FormDialog
        open={!!decision}
        title={decision?.approve ? 'Confirm cash received' : 'Reject cash collection'}
        onClose={() => setDecision(null)}
        onSubmit={() => decision && decide.mutate({ id: decision.p.id, approve: decision.approve, note: note.trim() || undefined })}
        submitting={decide.isPending}
        submitLabel={decision?.approve ? 'Confirm receipt' : 'Reject'}
        danger={!decision?.approve}
        submitDisabled={!decision?.approve && note.trim().length < 3}
        error={decide.error}
        maxWidth="xs"
      >
        <Typography variant="body2" sx={{ mb: 2 }}>
          {decision?.approve ? 'Confirm that' : 'Reject'} <strong>{inr(decision?.p.amount)}</strong> collected by {decision?.p.collectedBy ?? 'the field team'} for {decision?.p.invoice?.number}
          {decision?.approve ? ' has been deposited.' : '. The invoice balance becomes payable again.'}
        </Typography>
        <TextField label={decision?.approve ? 'Note (optional)' : 'Reason'} required={!decision?.approve} fullWidth multiline minRows={2} value={note} onChange={(e) => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} helperText={decision?.approve ? 'e.g. deposit slip reference' : 'At least 3 characters; shared with the collector'} />
      </FormDialog>
    </SectionCard>
  );
}

export function PaymentsTab(props: Toasts) {
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const list = useQuery({
    queryKey: ['admin', 'finance', 'payments', { status, method, page, pageSize }],
    queryFn: () => api.page<PaymentRow>('/admin/finance/payments', { status: status || undefined, method: method || undefined, page, pageSize }),
    placeholderData: keepPreviousData,
  });
  const columns: Column<PaymentRow>[] = [
    { key: 'd', header: 'Date', render: (p) => <Box sx={{ whiteSpace: 'nowrap' }}>{dateTime(p.succeededAt ?? p.createdAt)}</Box> },
    { key: 'i', header: 'Invoice', primary: true, render: (p) => (<Box><Link component={RouterLink} to={`/admin/finance/invoices/${p.invoiceId}`} onClick={(e) => e.stopPropagation()} sx={{ whiteSpace: 'nowrap' }}>{p.invoice?.number}</Link><Typography variant="caption" color="text.secondary" display="block">{p.invoice?.billingName}</Typography></Box>) },
    { key: 'm', header: 'Method', render: (p) => (<Box sx={{ whiteSpace: 'nowrap' }}>{humanize(p.method)}<SandboxChip show={p.isSandbox} /></Box>) },
    { key: 's', header: 'Status', render: (p) => <EnumChip value={p.status} label={p.method === 'CASH' && p.status === 'PENDING' ? 'Awaiting confirmation' : undefined} /> },
    { key: 'r', header: 'Receipt / ref', hideOnMobile: true, render: (p) => <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{p.receiptNumber ?? p.providerPaymentId ?? p.providerOrderId ?? '—'}</Typography> },
    { key: 'c', header: 'Collector', hideOnMobile: true, render: (p) => p.collectedBy ?? '—' },
    { key: 'f', header: 'Gateway fee', align: 'right', hideOnMobile: true, render: (p) => (p.gatewayFee || p.gatewayTax ? <Money value={p.gatewayFee + p.gatewayTax} /> : '—') },
    { key: 'a', header: 'Amount', align: 'right', render: (p) => <Money value={p.amount} strong={p.status === 'SUCCEEDED'} /> },
  ];
  return (
    <Stack spacing={2}>
      <CashQueue {...props} />
      <Box>
        <FilterBar>
          <Typography variant="h5" sx={{ mr: 1 }}>All payments</Typography>
          <TextField select size="small" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 170 }}>
            <MenuItem value="">All statuses</MenuItem>
            {['CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Method" value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }} sx={{ minWidth: 170 }}>
            <MenuItem value="">All methods</MenuItem>
            {['ONLINE', 'CASH', 'BANK_TRANSFER', 'PREPAID_CREDIT'].map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
          </TextField>
        </FilterBar>
        <DataTable rows={list.data?.data} columns={columns} rowKey={(p) => p.id} loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()} emptyTitle="No payments match" page={page} pageSize={pageSize} total={list.data?.meta.total} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} dense />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          “Sandbox” payments were made through the simulated gateway — no real money moved. Gateway fee includes GST on the fee.
        </Typography>
      </Box>
    </Stack>
  );
}

// ─── Refunds ─────────────────────────────────────────────────────────

function RefundDecisionDialog({ refund, approve, onClose, onDone }: { refund: RefundRow | null; approve: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [note, setNote] = useState('');
  const [ref, setRef] = useState('');
  const [creditNote, setCreditNote] = useState(true);
  const manual = !!refund?.payment && refund.payment.method !== 'ONLINE';
  const m = useMutation({
    mutationFn: () => api.post(`/admin/finance/refunds/${refund!.id}/decision`, { approve, note: note.trim(), ...(approve && manual ? { manualReference: ref.trim() } : {}), issueCreditNote: creditNote }),
    onSuccess: () => onDone(approve ? (manual ? 'Refund recorded as paid' : 'Refund approved and sent to the gateway') : 'Refund rejected'),
  });
  useEffect(() => {
    if (refund) {
      setNote('');
      setRef('');
      setCreditNote(true);
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refund, approve]);
  const ok = note.trim().length >= 3 && (!approve || !manual || ref.trim().length >= 2);
  return (
    <FormDialog open={!!refund} title={approve ? 'Approve refund' : 'Reject refund'} onClose={onClose} onSubmit={() => ok && m.mutate()} submitting={m.isPending} submitDisabled={!ok} danger={!approve} submitLabel={approve ? 'Approve refund' : 'Reject refund'} error={m.error} maxWidth="sm">
      <Typography variant="body2" sx={{ mb: 2 }}>
        <strong>{inr(refund?.amount)}</strong> on {refund?.invoice?.number} ({refund?.invoice?.billingName}). Customer’s reason: “{refund?.reason}”.
      </Typography>
      {approve && (
        <Alert severity={manual ? 'warning' : 'info'} sx={{ mb: 2 }}>
          {manual
            ? `The original payment was ${humanize(refund?.payment?.method).toLowerCase()}. Pay the customer by bank transfer or cash first, then enter the transfer/cash reference — the refund is recorded as completed immediately.`
            : refund?.payment
              ? `The refund will be submitted to the payment gateway${refund.isSandbox || refund.payment.isSandbox ? ' (sandbox — simulated)' : ''}. It settles when the gateway confirms.`
              : 'No payment is linked to this refund.'}
        </Alert>
      )}
      <Stack spacing={2}>
        <TextField label={approve ? 'Approval note' : 'Reason for rejection'} required fullWidth multiline minRows={2} value={note} onChange={(e) => setNote(e.target.value)} helperText="At least 3 characters; recorded in the audit log" slotProps={{ htmlInput: { maxLength: 500 } }} />
        {approve && manual && <TextField label="Manual refund reference (UTR / cash receipt)" required fullWidth value={ref} onChange={(e) => setRef(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />}
        {approve && (
          <FormControlLabel
            control={<Checkbox checked={creditNote} onChange={(e) => setCreditNote(e.target.checked)} />}
            label={<Box><Typography variant="body2">Issue a credit note for the refund amount</Typography><Typography variant="caption" color="text.secondary">Recommended. Reverses revenue and GST so the invoice’s tax position stays correct.</Typography></Box>}
          />
        )}
      </Stack>
    </FormDialog>
  );
}

export function RefundsTab({ toast, toastError, canManage }: Toasts) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('REQUESTED');
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<{ r: RefundRow; approve: boolean } | null>(null);
  const list = useQuery({ queryKey: ['admin', 'finance', 'refunds', { status, page }], queryFn: () => api.page<RefundRow>('/admin/finance/refunds', { status: status || undefined, page, pageSize: 20 }), placeholderData: keepPreviousData });
  const retry = useMutation({
    mutationFn: (id: string) => api.post<RefundRow>(`/admin/finance/refunds/${id}/retry`),
    onSuccess: (r) => {
      toast(r.status === 'FAILED' ? `Retry failed: ${r.failureReason ?? 'gateway error'}` : 'Refund resubmitted to the gateway');
      void qc.invalidateQueries({ queryKey: ['admin', 'finance'] });
    },
    onError: toastError,
  });
  const columns: Column<RefundRow>[] = [
    { key: 'd', header: 'Requested', render: (r) => <Box sx={{ whiteSpace: 'nowrap' }}>{dateTime(r.createdAt)}</Box> },
    { key: 'i', header: 'Invoice', primary: true, render: (r) => (<Box><Link component={RouterLink} to={`/admin/finance/invoices/${r.invoiceId}`} sx={{ whiteSpace: 'nowrap' }}>{r.invoice?.number}</Link><Typography variant="caption" color="text.secondary" display="block">{r.invoice?.billingName}</Typography></Box>) },
    { key: 'why', header: 'Reason', render: (r) => <Typography variant="body2" sx={{ maxWidth: 280 }}>{r.reason}</Typography> },
    { key: 'm', header: 'Original payment', render: (r) => (r.payment ? <Box sx={{ whiteSpace: 'nowrap' }}>{humanize(r.payment.method)}<SandboxChip show={r.isSandbox || r.payment.isSandbox} /></Box> : '—') },
    { key: 's', header: 'Status', render: (r) => (<Box><EnumChip value={r.status} />{r.failureReason && <Typography variant="caption" color={r.status === 'FAILED' ? 'error.main' : 'text.secondary'} display="block">{r.failureReason}</Typography>}{r.processedAt && <Typography variant="caption" color="text.secondary" display="block">Processed {date(r.processedAt)}</Typography>}</Box>) },
    { key: 'ref', header: 'Reference', hideOnMobile: true, render: (r) => <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.providerRefundId ?? '—'}</Typography> },
    { key: 'a', header: 'Amount', align: 'right', render: (r) => <Money value={r.amount} strong /> },
    {
      key: 'x',
      header: '',
      align: 'right',
      render: (r) =>
        canManage && (
          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
            {r.status === 'REQUESTED' && (
              <>
                <Button size="small" variant="contained" onClick={() => setDecision({ r, approve: true })}>Approve</Button>
                <Button size="small" color="error" onClick={() => setDecision({ r, approve: false })}>Reject</Button>
              </>
            )}
            {r.status === 'FAILED' && <Button size="small" variant="outlined" disabled={retry.isPending} onClick={() => retry.mutate(r.id)}>Retry</Button>}
          </Stack>
        ),
    },
  ];
  return (
    <Box>
      <FilterBar>
        <TextField select size="small" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 200 }}>
          <MenuItem value="">All refunds</MenuItem>
          <MenuItem value="REQUESTED">Awaiting decision</MenuItem>
          <MenuItem value="APPROVED,PROCESSING">In progress</MenuItem>
          <MenuItem value="FAILED">Failed</MenuItem>
          <MenuItem value="SUCCEEDED">Succeeded</MenuItem>
          <MenuItem value="REJECTED">Rejected</MenuItem>
        </TextField>
      </FilterBar>
      <DataTable rows={list.data?.data} columns={columns} rowKey={(r) => r.id} loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()} emptyTitle={status === 'REQUESTED' ? 'No refunds awaiting a decision' : 'No refunds'} emptyBody="Refund requests from customers and support appear here." page={page} pageSize={20} total={list.data?.meta.total} onPageChange={setPage} dense />
      <RefundDecisionDialog refund={decision?.r ?? null} approve={decision?.approve ?? true} onClose={() => setDecision(null)} onDone={(m) => { toast(m); setDecision(null); void qc.invalidateQueries({ queryKey: ['admin', 'finance'] }); }} />
    </Box>
  );
}

