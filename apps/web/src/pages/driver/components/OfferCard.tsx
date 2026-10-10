import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, TextField, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import TimerIcon from '@mui/icons-material/Timer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { BookingDetail } from '@/api/types';
import { errorMessage, Money } from '@/components/common';
import { useIsOnline } from '@/hooks/useOnline';
import { humanize, VEHICLE_CLASS_LABELS } from '@/lib/format';
import { ACCESS_LABELS, ChipList, EQUIPMENT_LABELS, Fact, SafetyFlagsAlert, TRUCK_TYPE_LABELS, assessmentSummary, countdown, label, peopleSummary, useNow, type OfferItem } from './driverShared';

const REJECT_REASONS = ['Too far away', 'Truck not suitable', 'Missing equipment', 'Truck problem', 'Taking a break'];

/**
 * A job offer. Before acceptance the API sends only the approximate area — never the exact
 * pickup point or customer contact — so the card says so explicitly.
 */
export function OfferCard({ offer, blocked }: { offer: OfferItem; blocked?: string | null }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const online = useIsOnline();
  const now = useNow(1000);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const b = offer.booking;
  const left = new Date(offer.expiresAt).getTime() - now;
  const expired = left <= 0;
  const rec = b.recommendation;
  const a = b.assessment;
  const people = peopleSummary(a);

  const accept = useMutation({
    mutationFn: () => api.post<BookingDetail>(`/driver/offers/${offer.assignmentId}/accept`),
    onSuccess: (detail) => {
      qc.setQueryData(['booking', detail.id], detail);
      void qc.invalidateQueries({ queryKey: ['driver'] });
      nav(`/driver/jobs/${detail.id}`);
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['driver', 'offers'] }),
  });
  const reject = useMutation({
    mutationFn: () => api.post(`/driver/offers/${offer.assignmentId}/reject`, { reason: reason.trim() || undefined }),
    onSuccess: () => {
      setRejectOpen(false);
      void qc.invalidateQueries({ queryKey: ['driver', 'offers'] });
    },
  });

  return (
    <Card sx={{ border: 3, borderColor: expired ? 'divider' : 'primary.main', opacity: expired ? 0.7 : 1 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack spacing={1.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" color="primary" sx={{ fontWeight: 800 }}>
                New job offer
              </Typography>
              <Typography variant="h4" component="h3">
                {b.serviceCategory.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {b.code}
                {b.type === 'SCHEDULED' && b.scheduledFor ? ` · Scheduled ${new Date(b.scheduledFor).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}` : ''}
              </Typography>
            </Box>
            <Stack alignItems="flex-end" sx={{ flexShrink: 0 }}>
              <Chip icon={<TimerIcon />} label={expired ? 'Expired' : countdown(left)} color={expired ? 'default' : left < 30_000 ? 'error' : 'warning'} sx={{ fontSize: '1.1rem', fontWeight: 800, height: 40, fontVariantNumeric: 'tabular-nums' }} aria-live="polite" />
              {b.priority !== 'NORMAL' && <Chip size="small" color="error" label={`${b.priority.toLowerCase()} priority`} sx={{ mt: 0.5 }} />}
            </Stack>
          </Stack>

          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="caption" color="text.secondary">
                To pickup
              </Typography>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 900 }}>{b.offer?.distanceKm != null ? `~${b.offer.distanceKm} km` : '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Est. drive
              </Typography>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 900 }}>{b.offer?.etaMinutes != null ? `~${b.offer.etaMinutes} min` : '—'}</Typography>
            </Box>
            {b.towDistanceKm != null && b.serviceCategory.kind === 'TOWING' && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Tow distance
                </Typography>
                <Typography sx={{ fontSize: '1.5rem', fontWeight: 900 }}>~{b.towDistanceKm} km</Typography>
              </Box>
            )}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Quote total
              </Typography>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 900 }}>{b.quoteTotal != null ? <Money value={b.quoteTotal} /> : '—'}</Typography>
            </Box>
          </Stack>

          <Box>
            <Fact label="Approximate area">
              {[b.pickupArea?.landmark, b.zone?.name].filter(Boolean).join(' · ') || 'Area not specified'}
            </Fact>
            {b.dropoffArea && <Fact label="Destination (approx.)">{b.dropoffArea.placeName ?? 'Destination set'}</Fact>}
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              Exact location and customer contact are shown after you accept.
            </Typography>
          </Box>

          {b.vehicle && (
            <Fact label="Vehicle">
              {[b.vehicle.make, b.vehicle.model, b.vehicle.color].filter(Boolean).join(' ')} · {VEHICLE_CLASS_LABELS[b.vehicle.vehicleClass] ?? b.vehicle.vehicleClass} · {humanize(b.vehicle.fuelType)}
            </Fact>
          )}

          <SafetyFlagsAlert flags={b.safetyFlags} title="Safety flags" />
          {a && a.accessRestriction !== 'NONE' && <Alert severity="warning">Access: {label(ACCESS_LABELS, a.accessRestriction)}</Alert>}
          {people.length > 0 && <Alert severity="info">{people.join(' · ')}</Alert>}

          <Box>
            <Typography variant="h6" gutterBottom>
              Reported condition
            </Typography>
            <ChipList items={assessmentSummary(a)} empty={<Typography variant="body2">Not provided</Typography>} />
            {a?.notes && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                “{a.notes}”
              </Typography>
            )}
          </Box>

          {rec && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Recommended setup
              </Typography>
              <Stack spacing={0.75}>
                <Typography variant="body2">
                  <strong>Truck:</strong> {rec.truckTypes.length ? rec.truckTypes.map((t) => label(TRUCK_TYPE_LABELS, t)).join(' / ') : 'Any'} · <strong>Crew:</strong> {b.crewRecommended ?? rec.crew}
                </Typography>
                {rec.equipment.length > 0 && <ChipList items={rec.equipment.map((e) => label(EQUIPMENT_LABELS, e))} />}
                {rec.reasons.map((r) => (
                  <Typography key={r} variant="body2" color="text.secondary">
                    • {r}
                  </Typography>
                ))}
              </Stack>
            </Box>
          )}

          <Divider />
          {blocked && <Alert severity="info">{blocked}</Alert>}
          {accept.error && <Alert severity="error">{errorMessage(accept.error)}</Alert>}
          <Stack direction="row" spacing={1}>
            <Button size="large" variant="outlined" color="inherit" startIcon={<CloseIcon />} disabled={expired || !online || accept.isPending} onClick={() => (reject.reset(), setRejectOpen(true))} sx={{ flex: 1, minHeight: 60, borderWidth: 2 }}>
              Reject
            </Button>
            <Button size="large" variant="contained" color="success" startIcon={<CheckCircleIcon />} disabled={expired || !online || accept.isPending || !!blocked} onClick={() => accept.mutate()} sx={{ flex: 2, minHeight: 60, fontSize: '1.15rem', fontWeight: 900 }}>
              {accept.isPending ? 'Accepting…' : 'Accept job'}
            </Button>
          </Stack>
        </Stack>
      </CardContent>

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Reject this offer?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2">The job goes to the next available provider. A reason helps dispatch (optional).</Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
              {REJECT_REASONS.map((r) => (
                <Chip key={r} label={r} onClick={() => setReason(r)} color={reason === r ? 'primary' : 'default'} sx={{ minHeight: 40 }} />
              ))}
            </Stack>
            <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
            {reject.error && <Alert severity="error">{errorMessage(reject.error)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button size="large" onClick={() => setRejectOpen(false)}>
            Back
          </Button>
          <Button size="large" variant="contained" color="error" disabled={reject.isPending || !online} onClick={() => reject.mutate()}>
            {reject.isPending ? 'Rejecting…' : 'Reject offer'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
