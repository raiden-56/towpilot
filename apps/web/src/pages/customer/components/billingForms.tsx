import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Collapse, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { api, ApiError } from '@/api/client';
import { errorMessage } from '@/components/common';
import { useIsOnline } from '@/hooks/useOnline';
import { inr } from '@/lib/format';
import { paiseToRupeeString, rupeeAmountSchema, rupeeStringToPaise } from './billingTypes';

type Toast = (text: string, severity?: 'success' | 'error' | 'info' | 'warning') => void;

function applyFieldErrors<T extends string>(e: unknown, fields: readonly T[], setError: (name: T, err: { message: string }) => void) {
  if (!(e instanceof ApiError)) return false;
  let hit = false;
  for (const [path, message] of Object.entries(e.fieldErrors)) {
    const f = fields.find((x) => x === path || path.endsWith(`.${x}`));
    if (f) {
      setError(f, { message });
      hit = true;
    }
  }
  return hit;
}

/** Customer refund request. Finance reviews every request before money is returned. */
export function RefundRequestForm({ invoiceId, refundable, toast }: { invoiceId: string; refundable: number; toast: Toast }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const [open, setOpen] = useState(false);
  const schema = z.object({
    amount: rupeeAmountSchema({ minPaise: 1, maxPaise: refundable, label: 'the refund amount' }),
    reason: z.string().trim().min(10, 'Please explain in at least 10 characters').max(1000, 'Keep it under 1000 characters'),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { amount: paiseToRupeeString(refundable), reason: '' } });

  const m = useMutation({
    mutationFn: (v: Values) => api.post<{ refund: { id: string }; ticket: { id: string; number: string } }>(`/invoices/${invoiceId}/refund-request`, { amount: rupeeStringToPaise(v.amount) / 100, reason: v.reason.trim() }),
    onSuccess: (r) => {
      toast(`Refund requested. Ticket ${r.ticket.number} created — our finance team will review it.`);
      form.reset({ amount: '', reason: '' });
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['support'] });
    },
    onError: (e) => {
      if (!applyFieldErrors(e, ['amount', 'reason'] as const, form.setError)) toast(errorMessage(e), 'error');
    },
  });

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        You can request a refund of up to <strong>{inr(refundable)}</strong>. Every refund request is reviewed by our finance team; approved refunds go back to the original payment method.
      </Typography>
      {!open ? (
        <Button variant="outlined" onClick={() => setOpen(true)} sx={{ alignSelf: 'flex-start' }}>
          Request a refund
        </Button>
      ) : null}
      <Collapse in={open} unmountOnExit>
        <Stack component="form" noValidate spacing={2} onSubmit={form.handleSubmit((v) => m.mutate(v))} sx={{ pt: 0.5 }}>
          <TextField
            label="Refund amount"
            {...form.register('amount')}
            error={!!form.formState.errors.amount}
            helperText={form.formState.errors.amount?.message ?? `Up to ${inr(refundable)}`}
            slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'decimal', autoComplete: 'off' } }}
          />
          <TextField
            label="Why are you requesting a refund?"
            multiline
            minRows={3}
            {...form.register('reason')}
            error={!!form.formState.errors.reason}
            helperText={form.formState.errors.reason?.message ?? 'At least 10 characters'}
          />
          {!online && <Alert severity="error">You are offline. Reconnect to submit.</Alert>}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={() => setOpen(false)} disabled={m.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={m.isPending || !online}>
              {m.isPending ? 'Submitting…' : 'Submit refund request'}
            </Button>
          </Stack>
        </Stack>
      </Collapse>
    </Stack>
  );
}

/** Raise a billing dispute; opens a high-priority support ticket. */
export function DisputeForm({ invoiceId, toast, onCreated }: { invoiceId: string; toast: Toast; onCreated?: (ticketId: string) => void }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const [open, setOpen] = useState(false);
  const schema = z.object({ reason: z.string().trim().min(10, 'Please describe the problem in at least 10 characters').max(2000, 'Keep it under 2000 characters') });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { reason: '' } });

  const m = useMutation({
    mutationFn: (v: Values) => api.post<{ id: string; number: string }>(`/invoices/${invoiceId}/dispute`, { reason: v.reason.trim() }),
    onSuccess: (t) => {
      toast(`Dispute raised. Ticket ${t.number} created — we'll get back to you.`);
      form.reset();
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['support'] });
      onCreated?.(t.id);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: ['invoices'] });
      if (!applyFieldErrors(e, ['reason'] as const, form.setError)) toast(errorMessage(e), 'error');
    },
  });

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        Think something on this invoice is wrong? Tell us what and why. A support agent will review it with our finance team.
      </Typography>
      {!open && (
        <Button variant="outlined" color="secondary" onClick={() => setOpen(true)} sx={{ alignSelf: 'flex-start' }}>
          Dispute this invoice
        </Button>
      )}
      <Collapse in={open} unmountOnExit>
        <Stack component="form" noValidate spacing={2} onSubmit={form.handleSubmit((v) => m.mutate(v))} sx={{ pt: 0.5 }}>
          <TextField label="What's wrong with this invoice?" multiline minRows={3} {...form.register('reason')} error={!!form.formState.errors.reason} helperText={form.formState.errors.reason?.message ?? 'At least 10 characters'} />
          {!online && <Alert severity="error">You are offline. Reconnect to submit.</Alert>}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={() => setOpen(false)} disabled={m.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={m.isPending || !online}>
              {m.isPending ? 'Submitting…' : 'Raise dispute'}
            </Button>
          </Stack>
        </Stack>
      </Collapse>
    </Stack>
  );
}
