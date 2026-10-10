import { useState } from 'react';
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { BookingDetail } from '@/api/types';
import { errorMessage } from '@/components/common';
import { useIsOnline } from '@/hooks/useOnline';
import { quickPosition } from './driverShared';

const RELATIONS = ['Owner', 'Family member', 'Garage staff', 'Service centre', 'Company driver', 'Security / reception'];

function CodeField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      autoComplete="one-time-code"
      slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*', maxLength: 4, 'aria-label': label, style: { fontSize: 34, letterSpacing: '0.6em', textAlign: 'center', fontWeight: 800, paddingBlock: 12 } } }}
    />
  );
}

/** Ask dispatch to authorise a code override (customer phone dead, recipient absent…). */
function OverrideRequest({ bookingId, stage }: { bookingId: string; stage: 'PICKUP' | 'HANDOVER' }) {
  const online = useIsOnline();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const req = useMutation({ mutationFn: () => api.post(`/driver/jobs/${bookingId}/override-request`, { stage, reason: reason.trim() }), onSuccess: () => setOpen(false) });
  if (req.isSuccess)
    return (
      <Alert severity="info">
        Override requested. Dispatch will verify and confirm — this screen updates automatically once they do. Do not {stage === 'PICKUP' ? 'move the vehicle' : 'leave the vehicle'} until it is confirmed.
      </Alert>
    );
  return (
    <>
      <Button size="large" variant="text" onClick={() => setOpen(true)} disabled={!online}>
        Can't verify? Request override
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Request {stage === 'PICKUP' ? 'pickup' : 'handover'} override</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Dispatch will check identity another way and record an authorised override. Explain what happened.
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
              {(stage === 'PICKUP' ? ['Customer phone switched off', 'Customer did not receive the code', 'Code rejected repeatedly'] : ['Recipient has no code', 'Garage closed — handed to security', 'Code rejected repeatedly']).map((r) => (
                <Chip key={r} label={r} onClick={() => setReason(r)} color={reason === r ? 'primary' : 'default'} sx={{ minHeight: 40 }} />
              ))}
            </Stack>
            <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} required slotProps={{ htmlInput: { maxLength: 500 } }} helperText="At least 5 characters" />
            {req.error && <Alert severity="error">{errorMessage(req.error)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button size="large" onClick={() => setOpen(false)}>
            Back
          </Button>
          <Button size="large" variant="contained" disabled={reason.trim().length < 5 || req.isPending || !online} onClick={() => req.mutate()}>
            Send request
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function PickupCodeCard({ booking }: { booking: BookingDetail }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const [code, setCode] = useState('');
  const verify = useMutation({
    mutationFn: async () => {
      const pos = await quickPosition();
      return api.post<{ verified: boolean; waitingMinutes?: number }>(`/driver/jobs/${booking.id}/verify-pickup`, { code, ...(pos ?? {}) });
    },
    onSuccess: async () => {
      setCode('');
      await qc.invalidateQueries({ queryKey: ['booking', booking.id] });
    },
  });
  return (
    <Stack spacing={1.5}>
      <Typography>
        Ask <strong>{booking.contactName ?? 'the customer'}</strong> for the 4-digit <strong>pickup code</strong> shown in their app or SMS. Do not touch the vehicle before the code is verified.
      </Typography>
      <CodeField label="Pickup code" value={code} onChange={setCode} />
      {verify.error && <Alert severity="error">{errorMessage(verify.error)}</Alert>}
      <Button size="large" variant="contained" startIcon={<VerifiedUserIcon />} disabled={code.length !== 4 || verify.isPending || !online} onClick={() => verify.mutate()}>
        {verify.isPending ? 'Verifying…' : 'Verify pickup code'}
      </Button>
      <OverrideRequest bookingId={booking.id} stage="PICKUP" />
    </Stack>
  );
}

export function HandoverCodeCard({ booking }: { booking: BookingDetail }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const onsite = booking.serviceCategory.kind === 'ONSITE';
  const [code, setCode] = useState('');
  const [name, setName] = useState(onsite ? (booking.contactName ?? '') : '');
  const [relation, setRelation] = useState(onsite ? 'Owner' : '');
  const confirm = useMutation({
    mutationFn: async () => {
      const pos = await quickPosition();
      return api.post(`/driver/jobs/${booking.id}/handover`, { code, recipientName: name.trim(), recipientRelation: relation.trim() || undefined, ...(pos ?? {}) });
    },
    onSuccess: async () => {
      setCode('');
      await qc.invalidateQueries({ queryKey: ['booking', booking.id] });
    },
  });
  return (
    <Stack spacing={1.5}>
      <Typography>
        {onsite ? 'Ask the customer' : 'Ask the person receiving the vehicle'} for the 4-digit <strong>handover code</strong>. The customer shares it from their app or SMS.
      </Typography>
      <TextField label="Recipient's name" value={name} onChange={(e) => setName(e.target.value)} required slotProps={{ htmlInput: { maxLength: 100 } }} />
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
        {RELATIONS.map((r) => (
          <Chip key={r} label={r} onClick={() => setRelation(r)} color={relation === r ? 'primary' : 'default'} sx={{ minHeight: 40 }} />
        ))}
      </Stack>
      <TextField label="Relation to customer" value={relation} onChange={(e) => setRelation(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />
      <CodeField label="Handover code" value={code} onChange={setCode} />
      {confirm.error && <Alert severity="error">{errorMessage(confirm.error)}</Alert>}
      <Button size="large" variant="contained" startIcon={<VerifiedUserIcon />} disabled={code.length !== 4 || name.trim().length < 2 || confirm.isPending || !online} onClick={() => confirm.mutate()}>
        {confirm.isPending ? 'Confirming…' : 'Confirm handover'}
      </Button>
      <OverrideRequest bookingId={booking.id} stage="HANDOVER" />
    </Stack>
  );
}
