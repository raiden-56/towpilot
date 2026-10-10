import { useState, type ReactNode } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import PhoneIcon from '@mui/icons-material/Phone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/api/client';
import type { BookingDetail, BookingStatus } from '@/api/types';
import { errorMessage } from '@/components/common';
import { useIsOnline } from '@/hooks/useOnline';
import { dateTime } from '@/lib/format';

export type StepState = 'done' | 'current' | 'pending' | 'optional';

/** One row of the guided checklist. Current step is expanded and outlined; pending steps are muted. */
export function JobStep({ n, title, state, at, summary, children, last }: { n: number; title: string; state: StepState; at?: string | null; summary?: ReactNode; children?: ReactNode; last?: boolean }) {
  const done = state === 'done';
  const current = state === 'current';
  const optional = state === 'optional';
  return (
    <Box component="li" sx={{ display: 'flex', gap: 1.5, listStyle: 'none' }} aria-current={current ? 'step' : undefined}>
      <Stack alignItems="center" sx={{ flexShrink: 0 }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 800,
            fontSize: 15,
            bgcolor: done ? 'success.main' : current ? 'primary.main' : 'transparent',
            color: done || current ? '#fff' : 'text.secondary',
            border: done || current ? 0 : 2,
            borderColor: optional ? 'info.main' : 'divider',
            borderStyle: optional ? 'dashed' : 'solid',
          }}
          aria-hidden
        >
          {done ? <CheckIcon fontSize="small" /> : n}
        </Box>
        {!last && <Box sx={{ width: 3, flex: 1, minHeight: 16, my: 0.5, bgcolor: done ? 'success.main' : 'divider', borderRadius: 2 }} />}
      </Stack>
      <Box sx={{ flex: 1, minWidth: 0, pb: last ? 0 : 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minHeight: 34 }}>
          <Typography sx={{ fontWeight: current ? 800 : 700, fontSize: current ? '1.12rem' : '1rem', color: state === 'pending' ? 'text.secondary' : 'text.primary' }}>{title}</Typography>
          {optional && <Chip size="small" label="If needed" color="info" variant="outlined" />}
          {current && <Chip size="small" label="Now" color="primary" />}
        </Stack>
        {done && at && (
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
            {dateTime(at)}
          </Typography>
        )}
        {done && summary && <Box sx={{ mt: 0.5 }}>{summary}</Box>}
        {(current || optional) && children && <Box sx={{ mt: 1.25, p: current ? { xs: 1.5, sm: 2 } : 0, border: current ? 2 : 0, borderColor: 'primary.main', borderRadius: 2 }}>{children}</Box>}
      </Box>
    </Box>
  );
}

const RELEASING: BookingStatus[] = ['FAILED', 'REASSIGNMENT_REQUIRED'];

/**
 * Field status transition. After FAILED / REASSIGNMENT_REQUIRED the server releases the team, so the
 * follow-up read can 404 even though the transition committed — we confirm via /driver/jobs/active.
 */
export function useJobTransition(bookingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ to, reason }: { to: BookingStatus; reason?: string }): Promise<BookingDetail | null> => {
      try {
        return await api.post<BookingDetail>(`/driver/jobs/${bookingId}/transition`, { to, reason });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404 && RELEASING.includes(to)) {
          const active = await api.get<BookingDetail | null>('/driver/jobs/active');
          if (active?.id !== bookingId) return null; // released — no longer our job
        }
        throw e;
      }
    },
    onSuccess: (b) => {
      if (b) qc.setQueryData(['booking', bookingId], b);
      void qc.invalidateQueries({ queryKey: ['driver'] });
    },
  });
}

export function TransitionButton({ booking, to, label, color = 'primary', icon, onDone }: { booking: BookingDetail; to: BookingStatus; label: string; color?: 'primary' | 'success' | 'secondary'; icon?: ReactNode; onDone?: () => void }) {
  const online = useIsOnline();
  const t = useJobTransition(booking.id);
  if (!booking.allowedNext?.includes(to)) return null;
  return (
    <Stack spacing={1}>
      <Button size="large" variant="contained" color={color} startIcon={icon} fullWidth disabled={!online || t.isPending} onClick={() => t.mutate({ to }, { onSuccess: () => onDone?.() })} sx={{ minHeight: 60, fontSize: '1.1rem', fontWeight: 800 }}>
        {t.isPending ? 'Updating…' : label}
      </Button>
      {t.error && <Alert severity="error">{errorMessage(t.error)}</Alert>}
    </Stack>
  );
}

/** Reason-required dialog with quick picks (minimal typing at the roadside). */
export function ReasonDialog({
  open,
  title,
  body,
  quick,
  confirmLabel,
  danger,
  loading,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  quick: string[];
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  error?: unknown;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const online = useIsOnline();
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Typography variant="body2">{body}</Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
            {quick.map((q) => (
              <Chip key={q} label={q} onClick={() => setReason(q)} color={reason === q ? 'primary' : 'default'} sx={{ minHeight: 40 }} />
            ))}
          </Stack>
          <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} required slotProps={{ htmlInput: { maxLength: 500 } }} helperText="Required" />
          {!!error && <Alert severity="error">{errorMessage(error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="large" onClick={onClose}>
          Back
        </Button>
        <Button size="large" variant="contained" color={danger ? 'error' : 'primary'} disabled={reason.trim().length < 3 || loading || !online} onClick={() => onConfirm(reason.trim())}>
          {loading ? 'Sending…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Reveals the customer's number via POST /bookings/:id/contact (masking hook) and dials it. */
export function CallCustomerButton({ bookingId }: { bookingId: string }) {
  const online = useIsOnline();
  const c = useMutation({
    mutationFn: () => api.post<{ name: string; phone: string | null; note?: string }>(`/bookings/${bookingId}/contact`),
    onSuccess: (r) => {
      if (r.phone) window.location.href = `tel:${r.phone}`;
    },
  });
  const phone = c.data?.phone;
  return (
    <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
      <Button size="large" variant="contained" color="secondary" startIcon={<PhoneIcon />} fullWidth disabled={c.isPending || (!phone && !online)} onClick={() => (phone ? (window.location.href = `tel:${phone}`) : c.mutate())}>
        {c.isPending ? 'Getting number…' : 'Call customer'}
      </Button>
      {phone && (
        <Typography variant="body2" sx={{ textAlign: 'center', fontWeight: 700 }}>
          {c.data?.name}: <a href={`tel:${phone}`}>{phone}</a>
        </Typography>
      )}
      {c.data && !phone && <Typography variant="caption">No phone number on this booking. Call dispatch.</Typography>}
      {c.error && (
        <Typography variant="caption" color="error">
          {errorMessage(c.error)}
        </Typography>
      )}
    </Stack>
  );
}
