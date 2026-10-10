import { Box, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ErrorIcon from '@mui/icons-material/Error';
import type { BookingStatus, StatusHistory } from '@/api/types';
import { STATUS_LABELS, time, TIMELINE_STEPS } from '@/lib/format';

/**
 * Timeline built from the real status history. Steps that genuinely happened show their time;
 * exceptions (declines, holds, cancellations) are shown inline. Future steps are greyed out.
 * On-site services hide loading/transit steps.
 */
export function BookingTimeline({ history, current, onsite }: { history: StatusHistory[]; current: BookingStatus; onsite?: boolean }) {
  const reached = new Map<BookingStatus, string>();
  for (const h of history) if (!reached.has(h.toStatus)) reached.set(h.toStatus, h.createdAt);
  const steps = TIMELINE_STEPS.filter((s) => !(onsite && (s === 'LOADING' || s === 'IN_TRANSIT')));
  const exceptions = history.filter((h) => ['REJECTED', 'REASSIGNMENT_REQUIRED', 'SAFETY_HOLD', 'CUSTOMER_UNAVAILABLE', 'CANCELLED', 'FAILED', 'DISPUTED'].includes(h.toStatus) || h.isOverride);
  const terminalBad = current === 'CANCELLED' || current === 'FAILED';

  return (
    <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Booking progress">
      {steps.map((s, idx) => {
        const at = reached.get(s);
        const isCurrent = s === current;
        if (terminalBad && !at) return null;
        return (
          <Box component="li" key={s} sx={{ display: 'flex', gap: 1.5, position: 'relative', pb: idx === steps.length - 1 ? 0 : 1.5 }}>
            <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {at ? <CheckCircleIcon color={isCurrent ? 'primary' : 'success'} fontSize="small" /> : <RadioButtonUncheckedIcon sx={{ color: 'text.disabled' }} fontSize="small" />}
              {idx < steps.length - 1 && <Box sx={{ width: 2, flex: 1, bgcolor: at ? 'success.main' : 'divider', opacity: at ? 0.5 : 1, mt: 0.5 }} />}
            </Box>
            <Stack sx={{ pb: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: isCurrent ? 800 : at ? 600 : 400, color: at ? 'text.primary' : 'text.disabled' }}>
                {STATUS_LABELS[s]}
              </Typography>
              {at && (
                <Typography variant="caption" color="text.secondary">
                  {time(at)}
                </Typography>
              )}
            </Stack>
          </Box>
        );
      })}
      {exceptions.map((h) => (
        <Box component="li" key={h.id} sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
          <ErrorIcon color={h.toStatus === 'CANCELLED' ? 'disabled' : 'warning'} fontSize="small" />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {h.isOverride && h.fromStatus === h.toStatus ? 'Authorised override' : STATUS_LABELS[h.toStatus]} · {time(h.createdAt)}
            </Typography>
            {h.reason && (
              <Typography variant="caption" color="text.secondary">
                {h.reason}
              </Typography>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
