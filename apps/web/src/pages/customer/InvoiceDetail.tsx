import { useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertTitle, Box, Button, Chip, Divider, Grid, Link, List, ListItem, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/DownloadOutlined';
import PaymentIcon from '@mui/icons-material/PaymentOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { api, ApiError } from '@/api/client';
import { ErrorState, KeyValue, LoadingBlock, Money, PageHeader, PaymentChip, SampleTag, SectionCard } from '@/components/common';
import { useIsOnline } from '@/hooks/useOnline';
import { date, dateTime, inr } from '@/lib/format';
import { BackLink, useToast } from './components/shared';
import {
  fileNameFor,
  INVOICE_TYPE_LABELS,
  METHOD_LABELS,
  payableOf,
  REFUND_LABELS,
  refundColor,
  refundableOf,
  TXN_LABELS,
  txnColor,
  type InvoiceDetailData,
  type PriceDifference,
} from './components/billingTypes';
import { PayDialog, type PayResult } from './components/billingPay';
import { DisputeForm, RefundRequestForm } from './components/billingForms';
import { CATEGORY_LABELS, TICKET_STATUS_LABELS, ticketStatusColor, type TicketCategory } from './components/supportTypes';

const qtyText = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

function SandboxChip() {
  return <Chip size="small" color="warning" variant="outlined" icon={<ScienceOutlinedIcon />} label="Sandbox — not real money" />;
}

function Delta({ value }: { value: number }) {
  if (value === 0) return <Typography variant="body2">No change</Typography>;
  return (
    <Typography variant="body2" sx={{ fontWeight: 700, color: value > 0 ? 'error.main' : 'success.main', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {value > 0 ? '+' : '−'}
      {inr(Math.abs(value))}
    </Typography>
  );
}

function PriceDifferenceSection({ diff }: { diff: PriceDifference }) {
  return (
    <SectionCard
      title={
        <Stack direction="row" spacing={1} alignItems="center">
          <VerifiedUserOutlinedIcon color="primary" />
          <Typography variant="h5">Transparent price-difference protection</Typography>
        </Stack>
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Here is every difference between the quote you approved and this final invoice. Chargeable increases beyond your approved quote need your prior approval of a revised quote. Pass-through costs (such as tolls and parking) are billed at actuals.
      </Typography>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Typography variant="caption" color="text.secondary">
            Approved quote
          </Typography>
          <Typography fontWeight={700}>{inr(diff.approvedTotal)}</Typography>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Typography variant="caption" color="text.secondary">
            Final invoice
          </Typography>
          <Typography fontWeight={700}>{inr(diff.finalTotal)}</Typography>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Typography variant="caption" color="text.secondary">
            Difference
          </Typography>
          <Delta value={diff.totalDelta} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Typography variant="caption" color="text.secondary">
            Chargeable increase
          </Typography>
          <Typography fontWeight={700}>{inr(diff.chargeableIncrease)}</Typography>
        </Grid>
      </Grid>
      {diff.changes.length === 0 ? (
        <Alert severity="success">Your final invoice matches the approved quote line for line.</Alert>
      ) : (
        <Stack divider={<Divider flexItem />} sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
          {diff.changes.map((c) => (
            <Box key={c.code} sx={{ p: 1.5 }}>
              <Stack direction="row" justifyContent="space-between" spacing={1.5} alignItems="flex-start">
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
                    {c.description}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Approved {inr(c.approved)} → Final {inr(c.final)}
                  </Typography>
                </Box>
                <Delta value={c.delta} />
              </Stack>
              {(c.isPassThrough || c.reason) && (
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                  {c.isPassThrough && <Chip size="small" variant="outlined" label="Pass-through at actuals" />}
                  {c.reason && (
                    <Typography variant="caption" color="text.secondary">
                      Reason: {c.reason}
                    </Typography>
                  )}
                </Stack>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </SectionCard>
  );
}

function Row({ left, right, sub }: { left: ReactNode; right: ReactNode; sub?: ReactNode }) {
  return (
    <Box sx={{ py: 1.25 }}>
      <Stack direction="row" justifyContent="space-between" spacing={1.5} alignItems="flex-start">
        <Box sx={{ minWidth: 0, flex: 1 }}>{left}</Box>
        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>{right}</Box>
      </Stack>
      {sub}
    </Box>
  );
}

export default function InvoiceDetail() {
  const { id = '' } = useParams();
  const online = useIsOnline();
  const { toast, toastNode } = useToast();
  const [payOpen, setPayOpen] = useState(false);
  const payOpenRef = useRef(payOpen);
  payOpenRef.current = payOpen;
  const [downloading, setDownloading] = useState(false);

  const q = useQuery({ queryKey: ['invoices', id], queryFn: () => api.get<InvoiceDetailData>(`/invoices/${id}`), enabled: !!id });
  const inv = q.data;

  const back = <BackLink to="/app/billing" label="Billing" />;

  if (q.isPending)
    return (
      <Box>
        <PageHeader back={back} title="Invoice" />
        <LoadingBlock rows={5} height={72} />
      </Box>
    );
  if (q.isError || !inv)
    return (
      <Box>
        <PageHeader back={back} title="Invoice" />
        <ErrorState error={q.error} title={q.error instanceof ApiError && q.error.status === 404 ? 'Invoice not found' : 'Could not load this invoice'} onRetry={() => void q.refetch()} />
      </Box>
    );

  const isVoid = inv.status === 'VOID';
  const payable = payableOf(inv);
  const refundable = refundableOf(inv);
  const canPay = !isVoid && payable > 0;

  const download = async () => {
    setDownloading(true);
    try {
      await api.download(`/invoices/${id}/pdf`, fileNameFor(inv.number));
    } catch (e) {
      toast(e instanceof Error ? `Could not download the PDF: ${e.message}` : 'Could not download the PDF', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const onSettled = (r: PayResult) => {
    if (payOpenRef.current) return; // the dialog shows the outcome itself
    if (r.status === 'SUCCEEDED') toast(`Payment confirmed${r.receiptNumber ? ` — receipt ${r.receiptNumber}` : ''}.`);
    else toast(r.status === 'FAILED' ? 'Your payment failed. You can try again.' : 'Your payment was cancelled.', 'error');
  };

  const showQuoteComparison = !inv.priceDifference && inv.approvedQuoteTotal != null && inv.approvedQuoteTotal !== inv.total;

  return (
    <Box sx={{ pb: { xs: 10, sm: 2 } }}>
      <PageHeader
        back={back}
        title={
          <>
            {inv.number}
            <SampleTag show={inv.isSample} />
          </>
        }
        subtitle={`${INVOICE_TYPE_LABELS[inv.type]} invoice · Issued ${date(inv.issuedAt)}${inv.dueAt ? ` · Due ${date(inv.dueAt)}` : ''}`}
        actions={
          <>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => void download()} disabled={downloading || !online} aria-label={`Download ${inv.number} as PDF`}>
              {downloading ? 'Downloading…' : 'Download PDF'}
            </Button>
            {canPay && (
              <Button variant="contained" startIcon={<PaymentIcon />} onClick={() => setPayOpen(true)} disabled={!online}>
                Pay {inr(payable)}
              </Button>
            )}
          </>
        }
      />

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mb: 2 }}>
        <PaymentChip status={inv.paymentStatus} size="medium" />
        {isVoid && <Chip label="Void" variant="outlined" />}
        {inv.disputed && <Chip color="error" label="Dispute open" />}
        {inv.booking && (
          <Chip component={RouterLink} to={`/app/bookings/${inv.booking.id}`} clickable variant="outlined" label={`Booking ${inv.booking.code}`} icon={<ChevronRightIcon />} />
        )}
      </Stack>

      <Stack spacing={2}>
        {isVoid && (
          <Alert severity="info">
            <AlertTitle>This invoice is void</AlertTitle>
            {inv.voidReason ?? 'It has been cancelled and nothing is payable.'}
            {inv.voidedAt ? ` (voided ${dateTime(inv.voidedAt)})` : ''}
          </Alert>
        )}
        {inv.type === 'MEMBERSHIP' && canPay && <Alert severity="info">Your membership activates as soon as this payment is confirmed.</Alert>}
        {canPay && !online && <Alert severity="warning">You are offline. Payments are disabled until you reconnect — nothing is charged while offline.</Alert>}
        {inv.paymentStatus === 'PAYMENT_PENDING' && (
          <Alert severity="info">A payment attempt is in progress. If you completed it, it will be confirmed automatically — there is no need to pay twice.</Alert>
        )}
        {inv.paymentStatus === 'PAYMENT_FAILED' && canPay && <Alert severity="error">Your last payment attempt failed. You can try again.</Alert>}
        {inv.amountPendingCash > 0 && (
          <Alert severity="info">
            {inr(inv.amountPendingCash)} paid in cash is awaiting confirmation by our finance team. It will show as paid once confirmed.
          </Alert>
        )}

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Stack spacing={2}>
              <SectionCard title="Charges">
                {inv.booking && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {[inv.booking.serviceCategory?.name, inv.booking.vehicle?.registrationNumber].filter(Boolean).join(' · ')}
                  </Typography>
                )}
                {inv.items.length === 0 ? (
                  <Typography color="text.secondary">No line items.</Typography>
                ) : (
                  <Stack divider={<Divider flexItem />}>
                    {inv.items.map((it) => (
                      <Row
                        key={it.id}
                        left={
                          <>
                            <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
                              {it.description}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {qtyText(it.quantity)} × {inr(it.unitAmount)}
                              {!it.taxable && !it.isPassThrough ? ' · No GST' : ''}
                            </Typography>
                          </>
                        }
                        right={<Money value={it.amount} />}
                        sub={
                          (it.isPassThrough || it.isAdditional || it.reason) && (
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                              {it.isPassThrough && <Chip size="small" variant="outlined" label="Pass-through at actuals" />}
                              {it.isAdditional && <Chip size="small" color="warning" variant="outlined" label="Additional charge" />}
                              {it.reason && (
                                <Typography variant="caption" color="text.secondary">
                                  Reason: {it.reason}
                                </Typography>
                              )}
                            </Stack>
                          )
                        }
                      />
                    ))}
                  </Stack>
                )}
                <Divider sx={{ my: 1.5 }} />
                <KeyValue label="Subtotal" value={<Money value={inv.subtotal} />} />
                {inv.discountTotal > 0 && <KeyValue label="Discount" value={<>−{inr(inv.discountTotal)}</>} />}
                <KeyValue label="Taxable value" value={<Money value={inv.taxableValue} />} />
                <KeyValue label="GST" value={<Money value={inv.taxTotal} />} />
                {inv.passThroughTotal > 0 && <KeyValue label="Pass-through charges (no GST)" value={<Money value={inv.passThroughTotal} />} />}
                <Divider sx={{ my: 1 }} />
                <KeyValue label={<strong>Total</strong>} value={<Money value={inv.total} strong />} />
              </SectionCard>

              {inv.priceDifference && <PriceDifferenceSection diff={inv.priceDifference} />}
              {showQuoteComparison && (
                <SectionCard
                  title={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <VerifiedUserOutlinedIcon color="primary" />
                      <Typography variant="h5">Transparent price-difference protection</Typography>
                    </Stack>
                  }
                >
                  <KeyValue label="Approved quote total" value={<Money value={inv.approvedQuoteTotal} />} />
                  <KeyValue label="Final invoice total" value={<Money value={inv.total} strong />} />
                  <KeyValue label="Difference" value={<Delta value={inv.total - (inv.approvedQuoteTotal ?? 0)} />} />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Chargeable increases beyond your approved quote need your prior approval. Differences can come from pass-through costs at actuals (such as tolls) or revisions you approved. If something looks wrong, raise a dispute.
                  </Typography>
                </SectionCard>
              )}

              <SectionCard title="Payments">
                {inv.payments.length === 0 ? (
                  <Typography color="text.secondary">No payments yet.</Typography>
                ) : (
                  <Stack divider={<Divider flexItem />}>
                    {inv.payments.map((p) => (
                      <Row
                        key={p.id}
                        left={
                          <>
                            <Typography variant="body2" fontWeight={600}>
                              {METHOD_LABELS[p.method] ?? p.method}
                              {p.receiptNumber ? ` · ${p.receiptNumber}` : ''}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {dateTime(p.succeededAt ?? p.createdAt)}
                            </Typography>
                          </>
                        }
                        right={
                          <Stack spacing={0.5} alignItems="flex-end">
                            <Money value={p.amount} strong />
                            <Chip size="small" color={txnColor(p.status)} variant={p.status === 'SUCCEEDED' ? 'filled' : 'outlined'} label={p.method === 'CASH' && p.status === 'PENDING' ? 'Awaiting finance confirmation' : TXN_LABELS[p.status]} />
                          </Stack>
                        }
                        sub={
                          (p.isSandbox || p.failureReason) && (
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                              {p.isSandbox && <SandboxChip />}
                              {p.failureReason && (
                                <Typography variant="caption" color="error.main">
                                  {p.failureReason}
                                </Typography>
                              )}
                            </Stack>
                          )
                        }
                      />
                    ))}
                  </Stack>
                )}
              </SectionCard>

              {inv.refunds.length > 0 && (
                <SectionCard title="Refunds">
                  <Stack divider={<Divider flexItem />}>
                    {inv.refunds.map((r) => (
                      <Row
                        key={r.id}
                        left={
                          <>
                            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                              {r.reason}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Requested {dateTime(r.createdAt)}
                              {r.processedAt ? ` · Processed ${dateTime(r.processedAt)}` : ''}
                            </Typography>
                            {r.failureReason && (
                              <Typography variant="caption" color="error.main" component="p">
                                {r.failureReason}
                              </Typography>
                            )}
                          </>
                        }
                        right={
                          <Stack spacing={0.5} alignItems="flex-end">
                            <Money value={r.amount} strong />
                            <Chip size="small" color={refundColor(r.status)} variant="outlined" label={REFUND_LABELS[r.status]} />
                            {r.isSandbox && <SandboxChip />}
                          </Stack>
                        }
                      />
                    ))}
                  </Stack>
                </SectionCard>
              )}

              {inv.creditNotes.length > 0 && (
                <SectionCard title="Credit notes">
                  <Stack divider={<Divider flexItem />}>
                    {inv.creditNotes.map((c) => (
                      <Row
                        key={c.id}
                        left={
                          <>
                            <Typography variant="body2" fontWeight={600}>
                              {c.number}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                              {c.reason} · {date(c.createdAt)}
                            </Typography>
                          </>
                        }
                        right={<Money value={c.amount} strong />}
                      />
                    ))}
                  </Stack>
                </SectionCard>
              )}
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <Stack spacing={2}>
              <SectionCard title="Balance">
                <KeyValue label="Invoice total" value={<Money value={inv.total} />} />
                <KeyValue label="Paid" value={<Money value={inv.amountPaid} />} />
                {inv.amountCredited > 0 && <KeyValue label="Credited" value={<Money value={inv.amountCredited} />} />}
                {inv.amountRefunded > 0 && <KeyValue label="Refunded" value={<Money value={inv.amountRefunded} />} />}
                {inv.amountWrittenOff > 0 && <KeyValue label="Written off" value={<Money value={inv.amountWrittenOff} />} />}
                {inv.amountPendingCash > 0 && (
                  <KeyValue
                    label={
                      <>
                        Pending cash
                        <Typography variant="caption" display="block" color="text.secondary">
                          Awaiting confirmation by our finance team
                        </Typography>
                      </>
                    }
                    value={<Money value={inv.amountPendingCash} />}
                  />
                )}
                <Divider sx={{ my: 1 }} />
                <KeyValue label={<strong>Outstanding</strong>} value={<Money value={inv.outstanding} strong negative={inv.outstanding > 0} />} />
                {canPay && (
                  <Box sx={{ mt: 2 }}>
                    <Button fullWidth size="large" variant="contained" startIcon={<PaymentIcon />} onClick={() => setPayOpen(true)} disabled={!online}>
                      Pay {inr(payable)}
                    </Button>
                    {!online && (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                        Reconnect to the internet to pay.
                      </Typography>
                    )}
                  </Box>
                )}
              </SectionCard>

              {refundable > 0 && !isVoid && (
                <SectionCard title="Refund">
                  <RefundRequestForm invoiceId={inv.id} refundable={refundable} toast={toast} />
                </SectionCard>
              )}

              {!isVoid && (
                <SectionCard title="Billing dispute">
                  {inv.disputed ? (
                    <Alert severity="warning">A dispute is open for this invoice. Our team is reviewing it — follow updates in the related ticket below.</Alert>
                  ) : (
                    <DisputeForm invoiceId={inv.id} toast={toast} />
                  )}
                </SectionCard>
              )}

              <SectionCard title="Related tickets" dense>
                {inv.tickets.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No tickets yet. Questions about this invoice?{' '}
                    <Link component={RouterLink} to={inv.bookingId ? `/app/support?bookingId=${inv.bookingId}` : '/app/support?category=GENERAL'}>
                      Contact support
                    </Link>
                    .
                  </Typography>
                ) : (
                  <List disablePadding>
                    {inv.tickets.map((t) => (
                      <ListItem key={t.id} disablePadding>
                        <ListItemButton component={RouterLink} to={`/app/support/${t.id}`} sx={{ px: 1 }}>
                          <ListItemText primary={t.number} secondary={CATEGORY_LABELS[t.category as TicketCategory] ?? t.category} />
                          <Chip size="small" color={ticketStatusColor(t.status)} variant="outlined" label={TICKET_STATUS_LABELS[t.status] ?? t.status} />
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                )}
              </SectionCard>
            </Stack>
          </Grid>
        </Grid>
      </Stack>

      {/* Kept mounted so payment confirmation continues even if the dialog is hidden. */}
      <PayDialog invoice={inv} open={payOpen} onClose={() => setPayOpen(false)} onSettled={onSettled} />

      {canPay && (
        <Box sx={{ display: { xs: 'block', sm: 'none' }, position: 'fixed', left: 0, right: 0, bottom: 'calc(56px + env(safe-area-inset-bottom))', p: 1.5, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider', zIndex: 9 }}>
          <Button fullWidth size="large" variant="contained" startIcon={<PaymentIcon />} onClick={() => setPayOpen(true)} disabled={!online}>
            {online ? `Pay ${inr(payable)}` : 'Offline — reconnect to pay'}
          </Button>
        </Box>
      )}
      {toastNode}
    </Box>
  );
}
