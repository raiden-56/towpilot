import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { api, ApiError, idempotencyKey } from '@/api/client';
import { errorMessage, PaymentChip } from '@/components/common';
import { useConfig } from '@/hooks/useConfig';
import { useIsOnline } from '@/hooks/useOnline';
import { useAppSelector } from '@/store';
import { inr } from '@/lib/format';
import { payableOf, rupeeAmountSchema, rupeeStringToPaise, type InvoiceDetailData, type PaymentOrder, type PaymentPoll } from './billingTypes';

// ─── Razorpay checkout loader ────────────────────────────────────────

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  close?(): void;
}
type RazorpayCtor = new (opts: Record<string, unknown>) => RazorpayInstance;

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let checkoutPromise: Promise<RazorpayCtor> | null = null;

function loadRazorpay(): Promise<RazorpayCtor> {
  const existing = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  if (!checkoutPromise) {
    checkoutPromise = new Promise<RazorpayCtor>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CHECKOUT_SRC;
      s.async = true;
      s.onload = () => {
        const ctor = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
        if (ctor) resolve(ctor);
        else reject(new Error('The payment window could not be started.'));
      };
      s.onerror = () => {
        s.remove();
        reject(new Error('Could not load the secure payment window. Check your connection and try again.'));
      };
      document.body.appendChild(s);
    }).catch((e: unknown) => {
      checkoutPromise = null; // allow a later retry
      throw e;
    });
  }
  return checkoutPromise;
}

// ─── Pay dialog ──────────────────────────────────────────────────────

type Phase = 'choose' | 'creating' | 'sandbox' | 'gateway' | 'dismissed' | 'confirming' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';

const POLL_MS = 2000;
const POLL_MAX_MS = 60_000;

export interface PayResult {
  status: PaymentPoll['status'];
  receiptNumber: string | null;
}

/**
 * Online payment for an invoice. Kept mounted by the parent so confirmation polling continues
 * even if the dialog is closed. Never reports success from client state — only once the API says
 * the payment SUCCEEDED (confirmed by the gateway webhook).
 */
export function PayDialog({ invoice, open, onClose, onSettled }: { invoice: InvoiceDetailData; open: boolean; onClose: () => void; onSettled: (r: PayResult) => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const qc = useQueryClient();
  const online = useIsOnline();
  const { data: config } = useConfig();
  const user = useAppSelector((s) => s.auth.user);

  const payable = payableOf(invoice);
  const [phase, setPhase] = useState<Phase>('choose');
  const [mode, setMode] = useState<'full' | 'part'>('full');
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [result, setResult] = useState<PaymentPoll | null>(null);
  const [busy, setBusy] = useState(false);

  /** One idempotency key per attempt; reused if the same attempt is retried. */
  const attempt = useRef<{ key: string; amount: number | null; sent: boolean } | null>(null);
  const pollToken = useRef(0);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const schema = z.object({ amount: rupeeAmountSchema({ minPaise: 100, maxPaise: Math.max(100, payable), label: 'the amount to pay' }) });
  const form = useForm<{ amount: string }>({ resolver: zodResolver(schema), defaultValues: { amount: '' } });

  const newAttempt = useCallback(() => {
    attempt.current = { key: idempotencyKey(), amount: null, sent: false };
  }, []);

  const resetToChoose = useCallback(() => {
    newAttempt();
    setOrder(null);
    setResult(null);
    setError(null);
    setPhase('choose');
  }, [newAttempt]);

  // A fresh attempt (and key) starts each time the dialog is opened after a finished attempt.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    if (!open) return;
    const p = phaseRef.current;
    if (p === 'succeeded' || p === 'failed' || p === 'cancelled' || p === 'dismissed') resetToChoose();
    else if (p === 'choose' && (!attempt.current || attempt.current.sent)) newAttempt();
  }, [open, newAttempt, resetToChoose]);

  // Stop polling when unmounted.
  useEffect(() => () => void (pollToken.current += 1), []);

  const startPolling = useCallback(
    async (paymentId: string) => {
      const token = ++pollToken.current;
      setPhase('confirming');
      setError(null);
      const started = Date.now();
      while (pollToken.current === token) {
        try {
          const p = await api.get<PaymentPoll>(`/payments/${paymentId}`);
          if (pollToken.current !== token) return;
          if (p.status === 'SUCCEEDED' || p.status === 'FAILED' || p.status === 'CANCELLED') {
            // Re-read the invoice from the server before reporting anything.
            await qc.invalidateQueries({ queryKey: ['invoices'] });
            if (pollToken.current !== token) return;
            setResult(p);
            setPhase(p.status === 'SUCCEEDED' ? 'succeeded' : p.status === 'FAILED' ? 'failed' : 'cancelled');
            onSettledRef.current({ status: p.status, receiptNumber: p.receiptNumber });
            return;
          }
        } catch {
          /* transient — keep polling until the deadline */
        }
        if (Date.now() - started > POLL_MAX_MS) {
          if (pollToken.current === token) {
            await qc.invalidateQueries({ queryKey: ['invoices'] });
            setPhase('timeout');
          }
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    },
    [qc],
  );

  const openRazorpay = useCallback(
    async (o: PaymentOrder) => {
      setPhase('gateway');
      try {
        const Razorpay = await loadRazorpay();
        const rzp = new Razorpay({
          key: o.keyId,
          order_id: o.orderId,
          amount: o.amount,
          currency: o.currency,
          name: config?.business.brandName ?? 'TowPilot',
          description: o.invoiceNumber,
          prefill: { name: user?.fullName ?? '', contact: user?.phone ?? '', email: user?.email ?? undefined },
          theme: { color: theme.palette.primary.main },
          handler: (r: RazorpayResponse) => {
            void (async () => {
              setPhase('confirming');
              try {
                await api.post(`/payments/${o.paymentId}/checkout-callback`, { orderId: r.razorpay_order_id, providerPaymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
              } catch (e) {
                // The webhook still confirms the payment; polling reports the real outcome.
                setError(errorMessage(e));
              }
              void startPolling(o.paymentId);
            })();
          },
          modal: { ondismiss: () => setPhase((p) => (p === 'gateway' ? 'dismissed' : p)) },
        });
        rzp.open();
      } catch (e) {
        setError(errorMessage(e));
        setPhase('dismissed');
      }
    },
    [config?.business.brandName, startPolling, theme.palette.primary.main, user?.email, user?.fullName, user?.phone],
  );

  const createOrder = useCallback(
    async (amountPaise: number | null) => {
      if (!attempt.current) newAttempt();
      // A different amount is a different attempt: never reuse a key for another amount.
      if (attempt.current!.sent && attempt.current!.amount !== amountPaise) newAttempt();
      const a = attempt.current!;
      a.amount = amountPaise;
      a.sent = true;
      setError(null);
      setPhase('creating');
      try {
        const body = amountPaise == null ? {} : { amount: amountPaise / 100 };
        const o = await api.post<PaymentOrder>(`/invoices/${invoice.id}/pay`, body, { 'Idempotency-Key': a.key });
        setOrder(o);
        void qc.invalidateQueries({ queryKey: ['invoices'] });
        if (o.status !== 'CREATED') return void startPolling(o.paymentId);
        if (o.sandbox) setPhase('sandbox');
        else if (o.provider === 'RAZORPAY') void openRazorpay(o);
        else {
          setError('Online payments are not available right now. Please try again later.');
          setPhase('choose');
        }
      } catch (e) {
        // Network/server failures keep the same key so a retry cannot create a duplicate order;
        // a rejected request (4xx) created nothing, so the next try is a new attempt.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) newAttempt();
        if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: ['invoices'] });
        setError(errorMessage(e));
        setPhase('choose');
      }
    },
    [invoice.id, newAttempt, openRazorpay, qc, startPolling],
  );

  const simulate = async (outcome: 'success' | 'failure') => {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/payments/${order.paymentId}/sandbox-complete`, { outcome });
      void startPolling(order.paymentId);
    } catch (e) {
      setError(errorMessage(e));
      // The payment may already be settled; let polling report the real status.
      if (e instanceof ApiError && e.status === 409) void startPolling(order.paymentId);
    } finally {
      setBusy(false);
    }
  };

  const submitChoice = form.handleSubmit((v) => createOrder(mode === 'full' ? null : rupeeStringToPaise(v.amount)));
  const onSubmit = (e: React.FormEvent) => {
    if (mode === 'part') return void submitChoice(e);
    e.preventDefault();
    void createOrder(null);
  };

  const closable = phase !== 'creating';
  const amountLabel = order ? inr(order.amount) : null;

  let content: React.ReactNode;
  let actions: React.ReactNode;

  switch (phase) {
    case 'choose':
    case 'creating':
      content = (
        <Stack spacing={2} component="form" id="pay-form" noValidate onSubmit={onSubmit}>
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Typography variant="body2" color="text.secondary">
              Amount due on {invoice.number}
            </Typography>
            <Typography variant="h3" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {inr(payable)}
            </Typography>
            {invoice.amountPendingCash > 0 && (
              <Typography variant="caption" color="text.secondary">
                Excludes {inr(invoice.amountPendingCash)} cash awaiting confirmation by our finance team.
              </Typography>
            )}
          </Box>
          <RadioGroup aria-label="How much do you want to pay?" value={mode} onChange={(e) => setMode(e.target.value as 'full' | 'part')}>
            <FormControlLabel value="full" control={<Radio />} label={`Pay full amount (${inr(payable)})`} disabled={phase === 'creating'} />
            <FormControlLabel value="part" control={<Radio />} label="Pay part of the amount" disabled={phase === 'creating' || payable < 200} />
          </RadioGroup>
          {mode === 'part' && (
            <TextField
              label="Amount to pay"
              autoFocus
              disabled={phase === 'creating'}
              {...form.register('amount')}
              error={!!form.formState.errors.amount}
              helperText={form.formState.errors.amount?.message ?? `Between ₹1.00 and ${inr(payable)}`}
              slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'decimal', autoComplete: 'off' } }}
            />
          )}
          {config?.payments.sandbox && (
            <Alert severity="warning" icon={<ScienceOutlinedIcon />}>
              Payments are in sandbox mode. No real money will move.
            </Alert>
          )}
          {!online && <Alert severity="error">You are offline. Reconnect to pay — nothing is charged while offline.</Alert>}
          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
            <LockOutlinedIcon fontSize="small" />
            <Typography variant="caption">Your invoice is marked paid only after the payment gateway confirms it.</Typography>
          </Stack>
        </Stack>
      );
      actions = (
        <>
          <Button onClick={onClose} disabled={!closable}>
            Cancel
          </Button>
          <Button type="submit" form="pay-form" variant="contained" disabled={!online || phase === 'creating' || payable <= 0} startIcon={phase === 'creating' ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {phase === 'creating' ? 'Starting payment…' : 'Continue to pay'}
          </Button>
        </>
      );
      break;
    case 'sandbox':
      content = (
        <Stack spacing={2}>
          <Alert severity="warning" icon={<ScienceOutlinedIcon />}>
            <AlertTitle>Sandbox checkout — no real money moves</AlertTitle>
            This is a simulated payment gateway for testing. Choose the outcome to simulate. The result is confirmed through the same signed webhook a real gateway uses.
          </Alert>
          <Box sx={{ p: 2, borderRadius: 2, border: 1, borderColor: 'divider' }}>
            <Typography variant="body2" color="text.secondary">
              {order?.invoiceNumber}
            </Typography>
            <Typography variant="h3" component="p">
              {amountLabel}
            </Typography>
            <Chip size="small" color="warning" variant="outlined" label="Sandbox — not real money" sx={{ mt: 1 }} />
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      );
      actions = (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button color="error" variant="outlined" disabled={busy || !online} onClick={() => simulate('failure')}>
            Simulate failed payment
          </Button>
          <Button color="success" variant="contained" disabled={busy || !online} onClick={() => simulate('success')}>
            Simulate successful payment
          </Button>
        </Stack>
      );
      break;
    case 'gateway':
      content = (
        <Stack spacing={2} alignItems="center" sx={{ py: 3, textAlign: 'center' }} role="status">
          <CircularProgress />
          <Typography>Complete the payment in the secure payment window.</Typography>
        </Stack>
      );
      actions = null;
      break;
    case 'dismissed':
      content = (
        <Stack spacing={2}>
          <Alert severity={error ? 'error' : 'info'}>{error ?? 'The payment window was closed before the payment finished. You have not been charged for this attempt.'}</Alert>
          <Typography variant="body2" color="text.secondary">
            If money was debited from your account, it will be matched automatically and this invoice will update.
          </Typography>
        </Stack>
      );
      actions = (
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="contained" disabled={!online} onClick={() => (order && !error ? void openRazorpay(order) : resetToChoose())}>
            Try again
          </Button>
        </>
      );
      break;
    case 'confirming':
      content = (
        <Stack spacing={2} alignItems="center" sx={{ py: 3, textAlign: 'center' }} role="status" aria-live="polite">
          <CircularProgress />
          <Typography variant="h5">Confirming your payment…</Typography>
          <Typography variant="body2" color="text.secondary">
            We are waiting for the payment gateway to confirm. This usually takes a few seconds. Please don&apos;t pay again.
          </Typography>
          {error && <Alert severity="warning">{error}</Alert>}
        </Stack>
      );
      actions = <Button onClick={onClose}>Hide — keep checking</Button>;
      break;
    case 'succeeded':
      content = (
        <Stack spacing={2} alignItems="center" sx={{ py: 2, textAlign: 'center' }} role="status" aria-live="polite">
          <CheckCircleOutlineIcon color="success" sx={{ fontSize: 56 }} />
          <Typography variant="h4">Payment successful</Typography>
          <Typography>
            {inr(result?.amount)} received{result?.receiptNumber ? ` · Receipt ${result.receiptNumber}` : ''}.
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              Invoice status:
            </Typography>
            <PaymentChip status={invoice.paymentStatus} />
          </Stack>
          {invoice.outstanding > 0 && (
            <Typography variant="body2" color="text.secondary">
              Remaining balance: {inr(invoice.outstanding)}
            </Typography>
          )}
          {result?.isSandbox && <Chip size="small" color="warning" variant="outlined" label="Sandbox — not real money" />}
        </Stack>
      );
      actions = (
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      );
      break;
    case 'failed':
    case 'cancelled':
      content = (
        <Stack spacing={2}>
          <Alert severity="error" role="alert">
            <AlertTitle>{phase === 'failed' ? 'Payment failed' : 'Payment cancelled'}</AlertTitle>
            {result?.failureReason ?? 'The payment did not go through. You have not been charged.'}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            You can try again. A new payment attempt will be started.
          </Typography>
        </Stack>
      );
      actions = (
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="contained" disabled={!online || payable <= 0} onClick={resetToChoose}>
            Try again
          </Button>
        </>
      );
      break;
    case 'timeout':
      content = (
        <Alert severity="info" role="status">
          <AlertTitle>Still confirming</AlertTitle>
          Your payment is still being confirmed by the gateway. The invoice status will update automatically — there&apos;s no need to pay again.
        </Alert>
      );
      actions = (
        <>
          <Button onClick={() => order && void startPolling(order.paymentId)}>Check again</Button>
          <Button variant="contained" onClick={onClose}>
            Close
          </Button>
        </>
      );
      break;
  }

  return (
    <Dialog open={open && phase !== 'gateway'} onClose={closable ? onClose : undefined} fullWidth maxWidth="xs" fullScreen={fullScreen} aria-labelledby="pay-dialog-title">
      <DialogTitle id="pay-dialog-title">{phase === 'sandbox' ? 'Sandbox checkout' : `Pay ${invoice.number}`}</DialogTitle>
      <DialogContent>{content}</DialogContent>
      {actions && <DialogActions sx={{ px: 3, pb: 2 }}>{actions}</DialogActions>}
    </Dialog>
  );
}

