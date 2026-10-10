import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { api } from '@/api/client';
import { ErrorState, KeyValue, LoadingBlock, StatusChip } from '@/components/common';
import { joinBookingRoom, leaveBookingRoom } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { dateTime, humanize, inr, relative, time, VEHICLE_CLASS_LABELS } from '@/lib/format';
import { AssignmentsTable, BookingActions, CandidatesPanel, ProviderStatus, reviewPending, TeamManager } from './BookingActions';
import { FlagChips, NEEDS_PROVIDER, PriorityChip, type Notify } from './shared';
import type { StaffBooking } from './types';

export function useStaffBooking(id: string | null | undefined) {
  return useQuery({ queryKey: ['booking', id], queryFn: () => api.get<StaffBooking>(`/bookings/${id}`), enabled: !!id, refetchInterval: 30_000 });
}

/** Short recommendation summary used in the dispatch panel and booking detail. */
export function RecommendationSummary({ booking }: { booking: StaffBooking }) {
  const rec = booking.recommendation;
  if (!rec) return <Typography color="text.secondary" variant="body2">No recommendation recorded.</Typography>;
  const notes = (rec as unknown as { reviewNotes?: string }).reviewNotes;
  return (
    <Box>
      <KeyValue label="Truck types" value={rec.truckTypes.map(humanize).join(', ') || 'Any'} />
      <KeyValue label="Equipment" value={rec.equipment.map(humanize).join(', ') || 'None specific'} />
      <KeyValue label="Crew" value={`${rec.crew} recommended${booking.crewRequested && booking.crewRequested !== rec.crew ? ` · ${booking.crewRequested} requested by customer` : ''}`} />
      <KeyValue label="Priority" value={<PriorityChip priority={rec.priority} />} />
      {rec.reasons.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {rec.reasons.map((r) => (
            <Typography component="li" variant="caption" color="text.secondary" key={r}>
              {r}
            </Typography>
          ))}
        </Box>
      )}
      {booking.requiresManualReview && (
        <Alert severity={reviewPending(booking) ? 'warning' : 'success'} sx={{ mt: 1 }}>
          {reviewPending(booking) ? 'Manual safety review required' : `Safety review completed ${dateTime(booking.reviewedAt)}`}
          {(booking.manualReviewReasons ?? []).length > 0 && `: ${(booking.manualReviewReasons ?? []).join('; ')}`}
          {notes && (
            <>
              <br />
              Reviewer notes: {notes}
            </>
          )}
        </Alert>
      )}
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        {rec.crewNote}
      </Typography>
    </Box>
  );
}

export function BookingPanel({ id, onClose, notify }: { id: string; onClose: () => void; notify: Notify }) {
  const { can } = useAuth();
  const q = useStaffBooking(id);
  const b = q.data;
  const needs = b ? NEEDS_PROVIDER.includes(b.status) : false;
  const [tab, setTab] = useState<'candidates' | 'history' | 'team'>(() => (can('dispatch:manage') ? 'candidates' : 'history'));
  useEffect(() => {
    joinBookingRoom(id);
    return () => leaveBookingRoom(id);
  }, [id]);
  useEffect(() => {
    if (b) setTab(NEEDS_PROVIDER.includes(b.status) && can('dispatch:manage') ? 'candidates' : 'history');
    // Only when switching bookings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!b]);

  return (
    <Box>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1} sx={{ mb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h2">
            {b?.code ?? 'Booking'}
          </Typography>
          {b && (
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              <StatusChip status={b.status} />
              <PriorityChip priority={b.priority} hideNormal />
              {b.type === 'SCHEDULED' && <Chip size="small" label={`Scheduled ${dateTime(b.scheduledFor)}`} />}
            </Stack>
          )}
        </Box>
        <Stack direction="row">
          <Tooltip title="Open full booking">
            <IconButton component={RouterLink} to={`/admin/bookings/${id}`} aria-label="Open full booking">
              <OpenInNewIcon />
            </IconButton>
          </Tooltip>
          <IconButton onClick={onClose} aria-label="Close panel">
            <CloseIcon />
          </IconButton>
        </Stack>
      </Stack>
      {q.isLoading && <LoadingBlock rows={5} />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {b && (
        <Stack spacing={2}>
          <ProviderStatus booking={b} />
          <BookingActions booking={b} notify={notify} />
          <Box>
            <KeyValue label="Service" value={b.serviceCategory.name} />
            <KeyValue label="Vehicle" value={b.vehicle ? `${b.vehicle.registrationNumber} · ${b.vehicle.make} ${b.vehicle.model} (${VEHICLE_CLASS_LABELS[b.vehicle.vehicleClass] ?? b.vehicle.vehicleClass})` : '—'} />
            <KeyValue label="Pickup" value={[b.pickup?.address, b.pickup?.landmark].filter(Boolean).join(' · ') || '—'} />
            {b.dropoff && <KeyValue label="Drop-off" value={b.dropoff.placeName ?? b.dropoff.address ?? '—'} />}
            <KeyValue label="Zone" value={b.zone?.name ?? 'Outside zones'} />
            <KeyValue label="Contact" value={`${b.contactName ?? '—'}${b.contactPhone ? ` · ${b.contactPhone}` : ''}`} />
            <KeyValue label="Created" value={`${time(b.createdAt)} (${relative(b.createdAt)})`} />
            <KeyValue label="Dispatch attempts" value={(b.assignments ?? []).length} />
            {b.etaAt && <KeyValue label="ETA at pickup" value={time(b.etaAt)} />}
            {b.quotes?.[0] && <KeyValue label="Latest quote" value={`${inr(b.quotes[0].total)} (${humanize(b.quotes[0].status)})`} />}
            {b.safetyFlags.length > 0 && <KeyValue label="Safety flags" value={<FlagChips flags={b.safetyFlags} max={6} />} />}
          </Box>
          {b.instructions && <Alert severity="info">Customer instructions: {b.instructions}</Alert>}
          <Box>
            <Typography variant="h6" sx={{ mb: 0.5 }}>
              Recommendation
            </Typography>
            <RecommendationSummary booking={b} />
          </Box>
          <Box>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: 1, borderColor: 'divider', mb: 1.5 }}>
              {can('dispatch:manage') && <Tab value="candidates" label={needs ? 'Candidates' : 'Candidates (info)'} />}
              <Tab value="history" label={`Offer history (${(b.assignments ?? []).length})`} />
              <Tab value="team" label={`Team (${(b.team ?? []).length})`} />
            </Tabs>
            {tab === 'candidates' && can('dispatch:manage') && <CandidatesPanel booking={b} notify={notify} />}
            {tab === 'history' && <AssignmentsTable assignments={b.assignments ?? []} />}
            {tab === 'team' && <TeamManager booking={b} notify={notify} />}
          </Box>
          <Button component={RouterLink} to={`/admin/bookings/${id}`} variant="text" endIcon={<OpenInNewIcon />} sx={{ alignSelf: 'flex-start' }}>
            Full booking: quotes, evidence, timeline
          </Button>
        </Stack>
      )}
    </Box>
  );
}
