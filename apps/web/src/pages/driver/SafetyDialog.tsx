import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { BookingDetail } from '@/api/types';
import { useConfig } from '@/hooks/useConfig';
import { errorMessage } from '@/components/common';
import { useIsOnline } from '@/hooks/useOnline';
import { quickPosition } from './components/driverShared';

const TYPES = [
  ['UNSAFE_LOCATION', 'Unsafe location'],
  ['ACCIDENT', 'Accident'],
  ['INJURY', 'Injury'],
  ['EQUIPMENT_DAMAGE', 'Equipment damaged'],
  ['DISPUTE', 'Dispute with customer'],
  ['CUSTOMER_UNAVAILABLE', 'Customer unavailable'],
  ['OTHER', 'Other'],
] as const;

/** Persistent safety action for field workers: emergency call, dispatch call, incident report, safety hold. */
export function SafetyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cfg = useConfig();
  const qc = useQueryClient();
  const online = useIsOnline();
  const active = useQuery({ queryKey: ['driver', 'active'], queryFn: () => api.get<BookingDetail | null>('/driver/jobs/active'), enabled: open });
  const [type, setType] = useState<string>('UNSAFE_LOCATION');
  const [severity, setSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('HIGH');
  const [description, setDescription] = useState('');
  const [hold, setHold] = useState(true);
  const [done, setDone] = useState(false);

  const report = useMutation({
    mutationFn: async () => {
      // getCurrentPosition returns void, so the old `?? res(null)` always resolved null — use a real timeout.
      const pos = await quickPosition(5000);
      const job = active.data;
      await api.post('/driver/incidents', { bookingId: job?.id, type, severity, description: description.trim(), lat: pos?.lat, lng: pos?.lng });
      if (job && hold && job.allowedNext?.includes('SAFETY_HOLD')) await api.post(`/driver/jobs/${job.id}/transition`, { to: 'SAFETY_HOLD', reason: `${type.replace(/_/g, ' ').toLowerCase()}: ${description.trim()}`.slice(0, 500) });
    },
    onSuccess: () => {
      setDone(true);
      setDescription('');
      void qc.invalidateQueries({ queryKey: ['driver'] });
      if (active.data) void qc.invalidateQueries({ queryKey: ['booking', active.data.id] });
    },
  });

  const emergency = cfg.data?.business.emergencyNumber ?? '112';
  const support = cfg.data?.business.supportPhone;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Safety</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1}>
            <Button fullWidth size="large" variant="contained" color="error" startIcon={<PhoneIcon />} href={`tel:${emergency}`}>
              Call {emergency}
            </Button>
            {support && (
              <Button fullWidth size="large" variant="outlined" startIcon={<PhoneIcon />} href={`tel:${support.replace(/\s/g, '')}`}>
                Call dispatch
              </Button>
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            If anyone is hurt or in danger, call emergency services first. Then report below so dispatch can support you.
          </Typography>
          {done ? (
            <Alert severity="success">Reported. Dispatch has been alerted{hold && active.data ? ' and the job is on safety hold' : ''}.</Alert>
          ) : (
            <>
              <TextField select label="What happened?" value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map(([v, l]) => (
                  <MenuItem key={v} value={v}>
                    {l}
                  </MenuItem>
                ))}
              </TextField>
              <ToggleButtonGroup exclusive value={severity} onChange={(_, v) => v && setSeverity(v)} fullWidth size="large">
                {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((s) => (
                  <ToggleButton key={s} value={s}>
                    {s.toLowerCase()}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <TextField label="Describe briefly" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={3} required helperText="At least 5 characters" slotProps={{ htmlInput: { maxLength: 2000 } }} />
              {active.data && (
                <ToggleButtonGroup exclusive value={hold ? 'hold' : 'continue'} onChange={(_, v) => v && setHold(v === 'hold')} fullWidth>
                  <ToggleButton value="hold">Pause job ({active.data.code})</ToggleButton>
                  <ToggleButton value="continue">Report only</ToggleButton>
                </ToggleButtonGroup>
              )}
              {!online && <Alert severity="warning">You are offline — the report cannot be sent. Call {emergency} or dispatch instead.</Alert>}
              {report.error && <Alert severity="error">{errorMessage(report.error)}</Alert>}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => (setDone(false), onClose())}>Close</Button>
        {!done && (
          <Button size="large" variant="contained" color="error" disabled={description.trim().length < 5 || report.isPending || !online} onClick={() => report.mutate()}>
            {report.isPending ? 'Sending…' : 'Send report'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
