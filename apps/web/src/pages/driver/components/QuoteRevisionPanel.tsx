import { useState } from 'react';
import { Alert, AlertTitle, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, InputAdornment, Stack, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { BookingDetail, Quote } from '@/api/types';
import { errorMessage } from '@/components/common';
import { QuoteBreakdown } from '@/components/QuoteBreakdown';
import { useIsOnline } from '@/hooks/useOnline';
import { dateTime, inr } from '@/lib/format';
import { parseRupees } from './driverShared';

interface ItemDraft {
  description: string;
  amount: string;
  reason: string;
}
const emptyItem = (): ItemDraft => ({ description: '', amount: '', reason: '' });

/** Revised-scope request: extra work needs customer approval; reductions need operations approval. */
function RevisionDialog({ booking, open, onClose }: { booking: BookingDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const theme = useTheme();
  const full = useMediaQuery(theme.breakpoints.down('sm'));
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const parsed = items.map((i) => parseRupees(i.amount));
  const itemErrors = items.map((i, idx) => {
    const a = parsed[idx];
    if (i.description.trim().length < 3) return 'Describe the work (3+ characters)';
    if (a == null || Number.isNaN(a)) return 'Enter an amount in rupees (max 2 decimals)';
    if (a === 0) return 'Amount cannot be zero';
    if (i.reason.trim().length < 3) return 'Give a reason (3+ characters)';
    return null;
  });
  const valid = reason.trim().length >= 5 && itemErrors.every((e) => !e);
  const change = parsed.reduce<number>((s, a) => s + (a && !Number.isNaN(a) ? a : 0), 0);

  const submit = useMutation({
    mutationFn: () => api.post<Quote>(`/driver/jobs/${booking.id}/quote-revision`, { reason: reason.trim(), items: items.map((i, idx) => ({ description: i.description.trim(), amount: parsed[idx], reason: i.reason.trim() })) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['booking', booking.id] });
      setReason('');
      setItems([emptyItem()]);
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} fullScreen={full} fullWidth maxWidth="sm">
      <DialogTitle>Request revised approval</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            Do not start extra work until it is approved. Extra charges go to the customer for approval; reductions (negative amounts) go to operations first. Amounts are in rupees before GST.
          </Alert>
          <TextField label="What changed on site?" placeholder="e.g. vehicle stuck in ditch — winching needed" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} required slotProps={{ htmlInput: { maxLength: 500 } }} />
          {items.map((it, i) => (
            <Box key={i} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="h6">Item {i + 1}</Typography>
                {items.length > 1 && (
                  <IconButton aria-label={`Remove item ${i + 1}`} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} sx={{ width: 48, height: 48 }}>
                    <DeleteOutlineIcon />
                  </IconButton>
                )}
              </Stack>
              <Stack spacing={1.5}>
                <TextField label="Work / charge" value={it.description} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} slotProps={{ htmlInput: { maxLength: 200 } }} />
                <TextField
                  label="Amount"
                  value={it.amount}
                  onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d.-]/g, '') } : x)))}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }}
                  helperText="Use a minus sign for a reduction"
                />
                <TextField label="Why is it needed?" value={it.reason} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} slotProps={{ htmlInput: { maxLength: 300 } }} />
                {itemErrors[i] && (it.description || it.amount || it.reason) && (
                  <Typography variant="caption" color="error">
                    {itemErrors[i]}
                  </Typography>
                )}
              </Stack>
            </Box>
          ))}
          <Button size="large" variant="outlined" startIcon={<AddIcon />} disabled={items.length >= 10} onClick={() => setItems((xs) => [...xs, emptyItem()])}>
            Add another item
          </Button>
          <Typography sx={{ fontWeight: 700 }}>
            Change before GST: {change >= 0 ? '+' : '−'}
            {inr(Math.abs(Math.round(change * 100)))}
          </Typography>
          {submit.error && <Alert severity="error">{errorMessage(submit.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="large" onClick={onClose}>
          Cancel
        </Button>
        <Button size="large" variant="contained" disabled={!valid || submit.isPending || !online} onClick={() => submit.mutate()}>
          {submit.isPending ? 'Sending…' : 'Send for approval'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Shows the pending revised quote (waiting state), the latest decision, and — for the team leader
 * during inspection/recovery — the form to request a revision.
 */
export function QuoteRevisionPanel({ booking, canRequest }: { booking: BookingDetail; canRequest: boolean }) {
  const [open, setOpen] = useState(false);
  const online = useIsOnline();
  const quotes = booking.quotes ?? [];
  const approved = quotes.find((q) => q.id === booking.approvedQuoteId) ?? null;
  const pending = quotes.find((q) => q.id === booking.pendingQuoteId) ?? null;
  const lastRevision = quotes.filter((q) => q.kind === 'REVISION' && q.status !== 'SUPERSEDED').sort((a, b) => b.version - a.version)[0];
  const inWindow = ['INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING'].includes(booking.status);

  return (
    <Stack spacing={1.5}>
      {approved && (
        <Typography variant="body2">
          Approved quote v{approved.version}: <strong>{inr(approved.total)}</strong>
        </Typography>
      )}
      {pending ? (
        <Alert severity="warning" icon={<CircularProgress size={22} color="inherit" />} sx={{ '& .MuiAlert-message': { width: '100%' } }}>
          <AlertTitle sx={{ fontWeight: 800 }}>{pending.status === 'PENDING_INTERNAL_APPROVAL' ? 'Waiting for operations approval' : 'Waiting for customer approval'}</AlertTitle>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Revision v{pending.version} sent {dateTime(pending.createdAt)}{pending.reason ? ` — ${pending.reason}` : ''}. Do not start the extra work yet. This updates automatically.
          </Typography>
          <Divider sx={{ my: 1 }} />
          <QuoteBreakdown quote={pending} compareTo={approved} showConditions={false} />
        </Alert>
      ) : (
        lastRevision &&
        lastRevision.status !== 'PENDING_CUSTOMER_APPROVAL' && (
          <Alert severity={lastRevision.status === 'APPROVED' ? 'success' : lastRevision.status === 'REJECTED' ? 'error' : 'info'}>
            Revision v{lastRevision.version} {lastRevision.status === 'APPROVED' ? 'approved — you may carry out the revised scope.' : lastRevision.status === 'REJECTED' ? 'declined — continue only with the originally approved scope, or contact dispatch.' : lastRevision.status.toLowerCase().replace(/_/g, ' ')}
          </Alert>
        )
      )}
      {canRequest && inWindow && !pending && (
        <>
          <Button size="large" variant="outlined" startIcon={<RequestQuoteIcon />} disabled={!online} onClick={() => setOpen(true)}>
            Scope or price changed? Request approval
          </Button>
          <RevisionDialog booking={booking} open={open} onClose={() => setOpen(false)} />
        </>
      )}
      {!inWindow && !pending && !lastRevision && (
        <Typography variant="body2" color="text.secondary">
          Revisions can be requested during inspection, recovery or loading.
        </Typography>
      )}
    </Stack>
  );
}
