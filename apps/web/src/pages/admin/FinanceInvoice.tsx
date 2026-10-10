import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, Divider, Grid, Link, Stack, TableCell, TableRow, TextField, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { api } from '@/api/client';
import { ErrorState, KeyValue, LoadingBlock, Money, PageHeader, PaymentChip, SampleTag, SectionCard } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { date, dateTime, humanize, inr } from '@/lib/format';
import type { InvoiceDetail } from './biz/types';
import { BackLink, daysPastDue, EnumChip, FormDialog, num, PromptDialog, rupees, RupeeField, SandboxChip, SimpleTable, useToast } from './biz/shared';

type Action = 'credit' | 'writeoff' | 'bank' | 'dispute' | 'void' | null;

/** Amount + reason/reference dialog with client-side max validation (server re-validates). */
function AmountDialog({ open, title, intro, max, maxLabel, textLabel, textMin, textMax, submitLabel, danger, onClose, onSubmit, loading, error }: { open: boolean; title: string; intro: React.ReactNode; max: number; maxLabel: string; textLabel: string; textMin: number; textMax: number; submitLabel: string; danger?: boolean; onClose: () => void; onSubmit: (amountRupees: number, text: string) => void; loading?: boolean; error?: unknown }) {
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) {
      setAmount('');
      setText('');
    }
  }, [open]);
  const a = Number(amount);
  const amountErr = amount === '' ? null : !(a > 0) ? 'Enter an amount greater than 0' : Math.round(a * 100) > max ? `Cannot exceed ${inr(max)} (${maxLabel})` : Math.round(a * 100) !== Number((a * 100).toFixed(2)) ? 'At most two decimals' : null;
  const ok = amount !== '' && !amountErr && text.trim().length >= textMin;
  return (
    <FormDialog open={open} title={title} onClose={onClose} onSubmit={() => ok && onSubmit(a, text.trim())} submitting={loading} submitDisabled={!ok} submitLabel={submitLabel} danger={danger} error={error} maxWidth="xs" intro={intro}>
      <Stack spacing={2}>
        <RupeeField autoFocus label="Amount" required fullWidth value={amount} onChange={(e) => setAmount(e.target.value)} error={!!amountErr} helperText={amountErr ?? `Maximum ${inr(max)} (${maxLabel})`} />
        <Button size="small" sx={{ alignSelf: 'flex-start', mt: -1 }} onClick={() => setAmount(String(rupees(max)))} disabled={max <= 0}>Use maximum ({inr(max)})</Button>
        <TextField label={textLabel} required fullWidth multiline={textMax > 100} minRows={textMax > 100 ? 2 : undefined} value={text} onChange={(e) => setText(e.target.value)} helperText={`At least ${textMin} characters`} slotProps={{ htmlInput: { maxLength: textMax } }} />
      </Stack>
    </FormDialog>
  );
}

export default function FinanceInvoice() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can('finance:manage');
  const { toast, toastError, toastNode } = useToast();
  const [action, setAction] = useState<Action>(null);
  const [downloading, setDownloading] = useState(false);
  const q = useQuery({ queryKey: ['invoices', 'admin', id], queryFn: () => api.get<InvoiceDetail>(`/admin/finance/invoices/${id}`) });

  const done = (msg: string) => {
    toast(msg);
    setAction(null);
    void qc.invalidateQueries({ queryKey: ['invoices'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'finance'] });
  };
  const credit = useMutation({ mutationFn: (b: { amount: number; reason: string }) => api.post(`/admin/finance/invoices/${id}/credit-notes`, b), onSuccess: () => done('Credit note issued') });
  const writeOff = useMutation({ mutationFn: (b: { amount: number; reason: string }) => api.post(`/admin/finance/invoices/${id}/write-off`, b), onSuccess: () => done('Amount written off') });
  const bank = useMutation({ mutationFn: (b: { amount: number; reference: string }) => api.post(`/admin/finance/invoices/${id}/bank-transfer`, b), onSuccess: () => done('Bank transfer recorded') });
  const dispute = useMutation({ mutationFn: (b: { disputed: boolean; note: string }) => api.post(`/admin/finance/invoices/${id}/dispute`, b), onSuccess: (_d, b) => done(b.disputed ? 'Dispute opened' : 'Dispute resolved') });
  const voidInv = useMutation({ mutationFn: (reason: string) => api.post(`/admin/finance/invoices/${id}/void`, { reason }), onSuccess: () => done('Invoice voided') });

  useEffect(() => {
    [credit, writeOff, bank, dispute, voidInv].forEach((m) => m.reset());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error('Invoice not found')} onRetry={() => void q.refetch()} />;
  const inv = q.data;
  const isVoid = inv.status === 'VOID';
  const creditable = Math.max(0, inv.total - inv.passThroughTotal - inv.amountCredited);
  const overdueDays = !isVoid && inv.outstanding > 0 ? daysPastDue(inv.dueAt, inv.issuedAt) : 0;
  const serviceItems = inv.items.filter((i) => !i.isPassThrough);
  const passItems = inv.items.filter((i) => i.isPassThrough);
  const canVoid = !isVoid && inv.amountPaid === 0 && inv.amountPendingCash === 0;
  const gatewayFees = inv.payments.filter((p) => p.status === 'SUCCEEDED').reduce((a, p) => a + p.gatewayFee + p.gatewayTax, 0);

  const totalRow = (label: React.ReactNode, v: number, opts: { bold?: boolean; muted?: boolean; neg?: boolean } = {}) => (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.5 }}>
      <Typography variant="body2" color={opts.muted ? 'text.secondary' : undefined} sx={{ fontWeight: opts.bold ? 700 : 400 }}>{label}</Typography>
      <Typography variant="body2" sx={{ ...num, fontWeight: opts.bold ? 700 : 500, color: opts.neg && v ? 'success.main' : undefined }}>{opts.neg && v ? `−${inr(v)}` : inr(v)}</Typography>
    </Stack>
  );

  return (
    <Box>
      <PageHeader
        back={<BackLink to="/admin/finance?tab=invoices" label="Invoices" />}
        title={
          <>
            {inv.number}
            <SampleTag show={inv.isSample} />
          </>
        }
        subtitle={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap component="span">
            {isVoid ? <EnumChip value="VOID" /> : <PaymentChip status={inv.paymentStatus} />}
            {inv.disputed && <Chip size="small" color="error" label="Disputed" />}
            <span>{humanize(inv.type)} invoice · issued {date(inv.issuedAt)}{inv.dueAt ? ` · due ${date(inv.dueAt)}` : ''}</span>
            {overdueDays > 0 && <Chip size="small" color="error" variant="outlined" label={`${overdueDays} days overdue`} />}
          </Stack>
        }
        actions={
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                await api.download(`/invoices/${inv.id}/pdf`, `${inv.number.replace(/\//g, '-')}.pdf`);
              } catch (e) {
                toastError(e);
              } finally {
                setDownloading(false);
              }
            }}
          >
            Download PDF
          </Button>
        }
      />

      {isVoid && <Alert severity="warning" sx={{ mb: 2 }}>Voided {dateTime(inv.voidedAt)}{inv.voidReason ? `: ${inv.voidReason}` : ''}. A void invoice has no balance and is excluded from revenue.</Alert>}
      {inv.disputed && !isVoid && <Alert severity="error" sx={{ mb: 2 }}>This invoice is under dispute. Collection reminders are paused until the dispute is resolved.</Alert>}

      {canManage && !isVoid && (
        <SectionCard sx={{ mb: 2 }} dense>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <Typography variant="subtitle2" sx={{ mr: 1 }}>Actions</Typography>
            <Button size="small" variant="outlined" onClick={() => setAction('bank')} disabled={inv.outstanding <= 0}>Record bank transfer</Button>
            <Button size="small" variant="outlined" onClick={() => setAction('credit')} disabled={creditable <= 0}>Issue credit note</Button>
            <Button size="small" variant="outlined" color="warning" onClick={() => setAction('writeoff')} disabled={inv.outstanding <= 0}>Write off</Button>
            <Button size="small" variant="outlined" color={inv.disputed ? 'success' : 'error'} onClick={() => setAction('dispute')}>{inv.disputed ? 'Resolve dispute' : 'Flag dispute'}</Button>
            <Button size="small" color="error" onClick={() => setAction('void')} disabled={!canVoid} title={canVoid ? undefined : 'Invoices with payments cannot be voided — issue a credit note and refund instead'}>Void invoice</Button>
          </Stack>
        </SectionCard>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Stack spacing={2}>
            <SectionCard title="Line items">
              <SimpleTable
                rows={serviceItems}
                rowKey={(i) => i.id}
                minWidth={620}
                columns={[
                  { key: 'd', header: 'Description', render: (i) => (<Box><Typography variant="body2">{i.description}{i.isAdditional && <Chip size="small" color="warning" label="additional" sx={{ ml: 0.75, height: 18, fontSize: 11 }} />}{!i.taxable && <Chip size="small" variant="outlined" label="non-taxable" sx={{ ml: 0.75, height: 18, fontSize: 11 }} />}</Typography>{i.reason && <Typography variant="caption" color="text.secondary">Reason: {i.reason}</Typography>}</Box>) },
                  { key: 'c', header: 'Code', render: (i) => <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{i.code}</Typography> },
                  { key: 'q', header: 'Qty', align: 'right', render: (i) => i.quantity },
                  { key: 'u', header: 'Rate', align: 'right', render: (i) => inr(i.unitAmount) },
                  { key: 'a', header: 'Amount', align: 'right', render: (i) => <Box component="span" sx={{ color: i.amount < 0 ? 'success.main' : undefined }}>{inr(i.amount)}</Box> },
                ]}
                footer={passItems.length ? (
                  <>
                    <TableRow><TableCell colSpan={5} sx={{ fontWeight: 700, color: 'text.secondary', fontSize: 12, textTransform: 'uppercase', pt: 2 }}>Pass-through at actuals (not revenue, no GST)</TableCell></TableRow>
                    {passItems.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell colSpan={4}>{i.description}{i.reason ? ` — ${i.reason}` : ''}</TableCell>
                        <TableCell align="right" sx={num}>{inr(i.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </>
                ) : undefined}
              />
              {inv.approvedQuoteTotal != null && inv.approvedQuoteTotal !== inv.total && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  Customer-approved quote total was {inr(inv.approvedQuoteTotal)}; final invoice differs by {inr(inv.total - inv.approvedQuoteTotal)} (actual distance, waiting, approved additional work or pass-through tolls).
                </Typography>
              )}
            </SectionCard>

            <SectionCard title={`Payments (${inv.payments.length})`}>
              <SimpleTable rows={inv.payments} rowKey={(p) => p.id} empty="No payments recorded." minWidth={720} columns={[
                { key: 'd', header: 'Date', render: (p) => dateTime(p.succeededAt ?? p.createdAt), nowrap: true },
                { key: 'm', header: 'Method', render: (p) => (<Box sx={{ whiteSpace: 'nowrap' }}>{humanize(p.method)}<SandboxChip show={p.isSandbox} /></Box>) },
                { key: 's', header: 'Status', render: (p) => (<Box><EnumChip value={p.status} label={p.method === 'CASH' && p.status === 'PENDING' ? 'Cash awaiting confirmation' : undefined} />{p.failureReason && <Typography variant="caption" color="error.main" display="block">{p.failureReason}</Typography>}</Box>) },
                { key: 'r', header: 'Receipt / reference', render: (p) => <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{p.receiptNumber ?? '—'}{p.providerPaymentId ? <><br />{p.providerPaymentId}</> : null}</Typography> },
                { key: 'f', header: 'Gateway fee', align: 'right', render: (p) => (p.gatewayFee || p.gatewayTax ? inr(p.gatewayFee + p.gatewayTax) : '—') },
                { key: 'a', header: 'Amount', align: 'right', render: (p) => <Money value={p.amount} strong={p.status === 'SUCCEEDED'} /> },
              ]} />
              {gatewayFees > 0 && <Typography variant="caption" color="text.secondary">Gateway fees (incl. GST on fees) of {inr(gatewayFees)} are a cost to the business and do not reduce what the customer owes.</Typography>}
            </SectionCard>

            <SectionCard title={`Refunds (${inv.refunds.length})`}>
              <SimpleTable rows={inv.refunds} rowKey={(r) => r.id} empty="No refunds." columns={[
                { key: 'd', header: 'Requested', render: (r) => dateTime(r.createdAt), nowrap: true },
                { key: 'w', header: 'Reason', render: (r) => r.reason },
                { key: 's', header: 'Status', render: (r) => (<Box><EnumChip value={r.status} /><SandboxChip show={r.isSandbox} />{r.failureReason && <Typography variant="caption" color="text.secondary" display="block">{r.failureReason}</Typography>}</Box>) },
                { key: 'ref', header: 'Reference', render: (r) => <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.providerRefundId ?? '—'}</Typography> },
                { key: 'a', header: 'Amount', align: 'right', render: (r) => <Money value={r.amount} /> },
              ]} />
              {inv.refunds.some((r) => r.status === 'REQUESTED' || r.status === 'FAILED') && canManage && (
                <Button component={RouterLink} to="/admin/finance?tab=refunds" size="small" sx={{ mt: 1 }}>Decide in refunds queue</Button>
              )}
            </SectionCard>

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <SectionCard title={`Credit notes (${inv.creditNotes.length})`} sx={{ height: '100%' }}>
                  <SimpleTable rows={inv.creditNotes} rowKey={(c) => c.id} empty="No credit notes." columns={[
                    { key: 'n', header: 'Number', render: (c) => (<Box><Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>{c.number}</Typography><Typography variant="caption" color="text.secondary">{date(c.createdAt)} · {c.reason}</Typography></Box>) },
                    { key: 't', header: 'Taxable', align: 'right', render: (c) => inr(c.taxableAmount) },
                    { key: 'g', header: 'GST', align: 'right', render: (c) => inr(c.taxAmount) },
                    { key: 'a', header: 'Total', align: 'right', render: (c) => <Money value={c.amount} strong /> },
                  ]} />
                </SectionCard>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <SectionCard title={`Adjustments (${inv.adjustments.length})`} sx={{ height: '100%' }}>
                  <SimpleTable rows={inv.adjustments} rowKey={(a) => a.id} empty="No write-offs or adjustments." columns={[
                    { key: 't', header: 'Type', render: (a) => (<Box><Typography variant="body2">{humanize(a.type)}</Typography><Typography variant="caption" color="text.secondary">{date(a.createdAt)} · {a.reason}</Typography></Box>) },
                    { key: 'a', header: 'Amount', align: 'right', render: (a) => <Money value={a.amount} strong /> },
                  ]} />
                </SectionCard>
              </Grid>
            </Grid>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, lg: 4 }}>
          <Stack spacing={2}>
            <SectionCard title="Totals">
              {totalRow('Service value (before discounts)', inv.subtotal, { muted: true })}
              {totalRow('Discounts', inv.discountTotal, { muted: true, neg: true })}
              {totalRow('Taxable value', inv.taxableValue)}
              {totalRow('GST', inv.taxTotal, { muted: true })}
              {totalRow('Pass-through (tolls/parking)', inv.passThroughTotal, { muted: true })}
              <Divider sx={{ my: 1 }} />
              {totalRow('Invoice total', inv.total, { bold: true })}
              <Divider sx={{ my: 1 }} />
              <Typography variant="overline" color="text.secondary">Settlement</Typography>
              {totalRow('Paid (confirmed)', inv.amountPaid)}
              {inv.amountPendingCash > 0 && totalRow('Cash pending confirmation', inv.amountPendingCash, { muted: true })}
              {totalRow('Credited (credit notes)', inv.amountCredited, { muted: true })}
              {totalRow('Refunded', inv.amountRefunded, { muted: true })}
              {totalRow('Written off', inv.amountWrittenOff, { muted: true })}
              <Divider sx={{ my: 1 }} />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Outstanding</Typography>
                <Typography variant="subtitle1" sx={{ ...num, fontWeight: 700, color: inv.outstanding > 0 ? (overdueDays > 0 ? 'error.main' : 'warning.main') : 'success.main' }}>{inr(inv.outstanding)}</Typography>
              </Stack>
            </SectionCard>
            <SectionCard title="Bill to">
              <KeyValue label="Name" value={inv.billingName} />
              {inv.fleetAccountId && <KeyValue label="Business account" value={<Link component={RouterLink} to={`/admin/accounts/${inv.fleetAccountId}`}>{inv.fleetAccount?.name ?? 'View account'}</Link>} />}
              {inv.customerUserId && <KeyValue label="Customer" value={<Link component={RouterLink} to={`/admin/customers/${inv.customerUserId}`}>View profile</Link>} />}
              <KeyValue label="GSTIN" value={inv.billingGstin ?? '—'} />
              <KeyValue label="Phone" value={inv.billingPhone ?? '—'} />
              <KeyValue label="Email" value={inv.billingEmail ?? '—'} />
              {inv.billingAddress && <KeyValue label="Address" value={inv.billingAddress} />}
            </SectionCard>
            <SectionCard title="Linked records">
              <KeyValue label="Booking" value={inv.booking ? <Link component={RouterLink} to={`/admin/bookings/${inv.booking.id}`}>{inv.booking.code}</Link> : '—'} />
              {inv.tickets.length === 0 ? (
                <KeyValue label="Support tickets" value="None" />
              ) : (
                inv.tickets.map((t) => <KeyValue key={t.id} label={`${t.number} · ${humanize(t.category)}`} value={<EnumChip value={t.status} />} />)
              )}
              {inv.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Notes: {inv.notes}</Typography>}
            </SectionCard>
          </Stack>
        </Grid>
      </Grid>

      <AmountDialog
        open={action === 'credit'}
        title="Issue credit note"
        intro={<Typography variant="body2" color="text.secondary">Enter the amount <strong>including GST</strong>. It is split into taxable value and GST in the invoice’s proportion, reducing recognised revenue and GST liability. Pass-through tolls cannot be credited. To return money to the customer, also process a refund.</Typography>}
        max={creditable}
        maxLabel="total less pass-through and previous credits"
        textLabel="Reason"
        textMin={5}
        textMax={500}
        submitLabel="Issue credit note"
        loading={credit.isPending}
        error={credit.error}
        onClose={() => setAction(null)}
        onSubmit={(amount, reason) => credit.mutate({ amount, reason })}
      />
      <AmountDialog
        open={action === 'writeoff'}
        title="Write off receivable"
        intro={<Typography variant="body2" color="text.secondary">Records uncollectable debt as a cost (bad debt) in the period. GST already charged is not reversed — use a credit note if the charge itself was wrong.</Typography>}
        max={inv.outstanding}
        maxLabel="outstanding"
        textLabel="Reason"
        textMin={5}
        textMax={500}
        submitLabel="Write off"
        danger
        loading={writeOff.isPending}
        error={writeOff.error}
        onClose={() => setAction(null)}
        onSubmit={(amount, reason) => writeOff.mutate({ amount, reason })}
      />
      <AmountDialog
        open={action === 'bank'}
        title="Record bank transfer"
        intro={<Typography variant="body2" color="text.secondary">Record money received directly into the business bank account (NEFT/RTGS/IMPS). Check your bank statement before recording.</Typography>}
        max={inv.outstanding}
        maxLabel="outstanding"
        textLabel="Bank reference (UTR)"
        textMin={4}
        textMax={60}
        submitLabel="Record payment"
        loading={bank.isPending}
        error={bank.error}
        onClose={() => setAction(null)}
        onSubmit={(amount, reference) => bank.mutate({ amount, reference })}
      />
      <PromptDialog
        open={action === 'dispute'}
        title={inv.disputed ? 'Resolve dispute' : 'Flag invoice as disputed'}
        body={inv.disputed ? 'Clears the dispute flag; normal collection resumes.' : 'Marks the invoice as disputed while the customer’s objection is investigated.'}
        label={inv.disputed ? 'Resolution note' : 'What is disputed?'}
        confirmLabel={inv.disputed ? 'Resolve dispute' : 'Flag dispute'}
        danger={!inv.disputed}
        loading={dispute.isPending}
        error={dispute.error}
        onClose={() => setAction(null)}
        onConfirm={(note) => dispute.mutate({ disputed: !inv.disputed, note })}
      />
      <PromptDialog
        open={action === 'void'}
        title="Void invoice"
        body="Voiding cancels the invoice entirely: it is excluded from revenue and receivables. Only possible when nothing has been paid. This cannot be undone."
        label="Reason"
        minLength={5}
        confirmLabel="Void invoice"
        danger
        loading={voidInv.isPending}
        error={voidInv.error}
        onClose={() => setAction(null)}
        onConfirm={(reason) => voidInv.mutate(reason)}
      />
      {toastNode}
    </Box>
  );
}
