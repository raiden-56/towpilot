import { useEffect, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { Alert, AlertTitle, Box, Button, Card, CardActionArea, CardContent, Chip, MenuItem, Snackbar, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { BookingDetail } from '@/api/types';
import { EmptyState, ErrorState, errorMessage, LoadingBlock, SectionCard, StatusChip } from '@/components/common';
import { useRealtimeEvent } from '@/hooks/useRealtime';
import { useIsOnline } from '@/hooks/useOnline';
import { date, humanize, relative } from '@/lib/format';
import { useDriverMe, type DriverMe } from './locationSharing';
import { OfferCard } from './components/OfferCard';
import { AVAILABILITY_LABELS, EQUIPMENT_LABELS, OfflineActionsNotice, TRUCK_TYPE_LABELS, daysUntil, label, type OfferItem } from './components/driverShared';

type Settable = 'AVAILABLE' | 'BUSY' | 'ON_BREAK' | 'OFF_DUTY';
const SETTABLE: { v: Settable; label: string; color: 'success' | 'warning' | 'info' | 'standard' }[] = [
  { v: 'AVAILABLE', label: 'Available', color: 'success' },
  { v: 'BUSY', label: 'Busy', color: 'warning' },
  { v: 'ON_BREAK', label: 'On break', color: 'info' },
  { v: 'OFF_DUTY', label: 'Off duty', color: 'standard' },
];

const VERIFICATION_TEXT: Record<string, string> = {
  PENDING: 'Your documents are being verified. You can go on duty once verification is approved.',
  DOCUMENTS_REQUESTED: 'More documents are needed to complete your verification. Contact your operations manager.',
  REJECTED: 'Your verification was not approved. Contact your operations manager.',
  SUSPENDED: 'Your account is suspended. You cannot take jobs until operations restore it.',
};

function AvailabilityControl({ me, hasActiveJob }: { me: DriverMe; hasActiveJob: boolean }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const zones = me.workerProfile?.zones ?? [];
  const status = me.availability?.status ?? 'OFF_DUTY';
  const [zoneId, setZoneId] = useState<string>(me.availability?.zoneId ?? zones[0]?.id ?? '');
  useEffect(() => {
    if (me.availability?.zoneId) setZoneId(me.availability.zoneId);
  }, [me.availability?.zoneId]);
  const approved = me.workerProfile?.verificationStatus === 'APPROVED';
  const set = useMutation({
    mutationFn: (v: { status: Settable; zoneId: string }) => api.put('/driver/availability', { status: v.status, zoneId: v.zoneId || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver'] }),
  });
  const onJob = status === 'ON_JOB' || hasActiveJob;
  const settable = status !== 'ON_JOB';

  return (
    <SectionCard title="Your status">
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
          <Typography sx={{ fontSize: '1.4rem', fontWeight: 900 }}>{AVAILABILITY_LABELS[status]}</Typography>
          {me.availability?.statusSince && (
            <Typography variant="body2" color="text.secondary">
              since {relative(me.availability.statusSince)}
            </Typography>
          )}
        </Stack>
        {zones.length > 0 && (
          <TextField
            select
            label="Service zone"
            value={zoneId}
            disabled={!online || set.isPending || onJob}
            onChange={(e) => {
              setZoneId(e.target.value);
              if (settable && status !== 'OFF_DUTY') set.mutate({ status: status as Settable, zoneId: e.target.value });
            }}
          >
            {zones.map((z) => (
              <MenuItem key={z.id} value={z.id}>
                {z.name} · {z.city}
              </MenuItem>
            ))}
          </TextField>
        )}
        {zones.length === 0 && <Alert severity="warning">You are not assigned to any service zone yet. Ask operations to add one.</Alert>}
        <ToggleButtonGroup
          exclusive
          fullWidth
          value={settable ? status : null}
          onChange={(_, v: Settable | null) => v && v !== status && set.mutate({ status: v, zoneId })}
          disabled={!online || set.isPending || onJob}
          aria-label="Set availability"
          sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, '& .MuiToggleButtonGroup-grouped': { border: 2, borderColor: 'divider', borderRadius: '10px !important', m: 0 } }}
        >
          {SETTABLE.map((s) => (
            <ToggleButton key={s.v} value={s.v} color={s.color} disabled={s.v === 'AVAILABLE' && !approved} sx={{ minHeight: 56, fontWeight: 800, fontSize: '1rem' }}>
              {s.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {onJob && <Alert severity="info">You are on a job. Finish or hand it over before changing your status.</Alert>}
        {set.error && <Alert severity="error">{errorMessage(set.error)}</Alert>}
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <GpsFixedIcon fontSize="small" color="action" sx={{ mt: 0.25 }} />
          <Typography variant="body2" color="text.secondary">
            Your location is shared with dispatch only while you are on duty (Available, Busy, On break or on a job) so the nearest truck gets the job. Choosing <strong>Off duty</strong> stops location sharing. Customers see your position only during their own active job.
          </Typography>
        </Stack>
      </Stack>
    </SectionCard>
  );
}

function TruckSummary({ truck }: { truck: NonNullable<DriverMe['assignedTruck']> }) {
  const issues = truck.equipment.filter((e) => e.status !== 'OK');
  const docs = (
    [
      ['Insurance', truck.insuranceExpiry],
      ['Fitness', truck.fitnessExpiry],
      ['Permit', truck.permitExpiry],
      ['PUC', truck.pucExpiry],
      ['Inspection', truck.nextInspectionDue],
    ] as const
  )
    .map(([n, d]) => ({ n, d, days: daysUntil(d) }))
    .filter((x) => x.days != null && x.days < 30);
  return (
    <SectionCard title="Your truck">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <LocalShippingIcon />
          <Typography sx={{ fontSize: '1.3rem', fontWeight: 900 }}>{truck.registrationNumber}</Typography>
          <Chip label={humanize(truck.status)} color={truck.status === 'AVAILABLE' || truck.status === 'IN_USE' ? 'success' : 'error'} />
        </Stack>
        <Typography color="text.secondary">
          {label(TRUCK_TYPE_LABELS, truck.truckType)} · {truck.make} {truck.model} · {truck.odometerKm.toLocaleString('en-IN')} km
        </Typography>
        {issues.length > 0 ? (
          <Alert severity="error">Equipment problem: {issues.map((e) => `${label(EQUIPMENT_LABELS, e.type)} (${e.status.toLowerCase()})`).join(', ')}. Report it to operations — jobs needing it cannot be assigned to you.</Alert>
        ) : (
          <Typography variant="body2" color="success.main" sx={{ fontWeight: 600 }}>
            All {truck.equipment.length} equipment items OK
          </Typography>
        )}
        {docs.map((x) => (
          <Alert key={x.n} severity={x.days! < 0 ? 'error' : 'warning'}>
            {x.n} {x.days! < 0 ? 'expired' : 'due'} {date(x.d)}
          </Alert>
        ))}
      </Stack>
    </SectionCard>
  );
}

function ActiveJobCard({ job }: { job: BookingDetail }) {
  const nav = useNavigate();
  return (
    <Card sx={{ border: 3, borderColor: 'primary.main' }}>
      <CardActionArea onClick={() => nav(`/driver/jobs/${job.id}`)}>
        <CardContent>
          <Typography variant="overline" color="primary" sx={{ fontWeight: 800 }}>
            Your active job
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
            <Typography variant="h4" component="h2">
              {job.vehicle?.registrationNumber ?? job.code}
            </Typography>
            <StatusChip status={job.status} size="medium" />
          </Stack>
          <Typography sx={{ fontWeight: 600 }}>
            {job.serviceCategory.name} · {job.code}
          </Typography>
          {job.pickup && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Pickup: {job.pickup.address ?? job.pickup.landmark ?? 'see job'}
            </Typography>
          )}
          {job.safetyFlags.length > 0 && <Chip color="error" label={`${job.safetyFlags.length} safety flag${job.safetyFlags.length > 1 ? 's' : ''}`} sx={{ mt: 1 }} />}
          <Button component="span" size="large" variant="contained" fullWidth endIcon={<ArrowForwardIcon />} sx={{ mt: 1.5, minHeight: 56 }}>
            Open job
          </Button>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default function DriverHome() {
  const me = useDriverMe();
  const online = useIsOnline();
  const loc = useLocation();
  const nav = useNavigate();
  const [flash, setFlash] = useState<string | null>((loc.state as { flash?: string } | null)?.flash ?? null);
  useEffect(() => {
    if ((loc.state as { flash?: string } | null)?.flash) nav('.', { replace: true, state: null });
  }, [loc.state, nav]);

  const active = useQuery({ queryKey: ['driver', 'active'], queryFn: () => api.get<BookingDetail | null>('/driver/jobs/active'), refetchInterval: 30_000 });
  const offers = useQuery({ queryKey: ['driver', 'offers'], queryFn: () => api.get<OfferItem[]>('/driver/offers'), refetchInterval: 10_000 });

  useRealtimeEvent((e) => {
    if (e.type === 'job.offer' || e.type === 'job.offerExpired' || e.type === 'job.cancelled') {
      void offers.refetch();
      void active.refetch();
      if (e.type === 'job.offer') {
        try {
          navigator.vibrate?.([300, 150, 300]);
        } catch {
          /* vibration unsupported */
        }
      }
    }
  });

  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data) return <LoadingBlock rows={4} height={96} />;
  const d = me.data;
  const wp = d.workerProfile;
  const status = d.availability?.status ?? 'OFF_DUTY';
  const liveOffers = (offers.data ?? []).filter((o) => new Date(o.expiresAt).getTime() > Date.now() - 2000);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h2" component="h1">
          Hi, {d.fullName.split(' ')[0]}
        </Typography>
        <Typography color="text.secondary">{wp ? `Employee ${wp.employeeCode}` : 'Field team'}</Typography>
      </Box>
      <OfflineActionsNotice online={online} />

      {!wp && <Alert severity="error">No worker profile is linked to your account. Contact operations.</Alert>}
      {wp && wp.verificationStatus !== 'APPROVED' && (
        <Alert severity={wp.verificationStatus === 'PENDING' ? 'warning' : 'error'}>
          <AlertTitle sx={{ fontWeight: 800 }}>Verification: {humanize(wp.verificationStatus)}</AlertTitle>
          {VERIFICATION_TEXT[wp.verificationStatus] ?? 'Your verification is not complete.'}
          {wp.verificationNote && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              Note from operations: {wp.verificationNote}
            </Typography>
          )}
        </Alert>
      )}

      {active.data && <ActiveJobCard job={active.data} />}
      {active.error && <ErrorState error={active.error} title="Could not check your active job" onRetry={() => active.refetch()} />}

      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h3" component="h2">
            Job offers
          </Typography>
          {liveOffers.length > 0 && <Chip color="primary" label={liveOffers.length} />}
        </Stack>
        {offers.error ? (
          <ErrorState error={offers.error} title="Could not load offers" onRetry={() => offers.refetch()} />
        ) : offers.isLoading ? (
          <LoadingBlock rows={1} height={160} />
        ) : liveOffers.length ? (
          <Stack spacing={2}>
            {liveOffers.map((o) => (
              <OfferCard key={o.assignmentId} offer={o} blocked={active.data ? 'Finish your active job before accepting another.' : null} />
            ))}
          </Stack>
        ) : (
          <Card>
            <EmptyState
              title={status === 'AVAILABLE' ? 'Waiting for offers' : 'No offers'}
              body={
                status === 'AVAILABLE'
                  ? 'New jobs near you appear here automatically (the phone vibrates where supported).'
                  : status === 'OFF_DUTY'
                    ? 'You are off duty. Set yourself Available to start receiving jobs.'
                    : status === 'ON_JOB'
                      ? 'You will get new offers after your current job.'
                      : `You are ${AVAILABILITY_LABELS[status]?.toLowerCase()}. Set yourself Available to receive jobs.`
              }
            />
          </Card>
        )}
      </Box>

      <AvailabilityControl me={d} hasActiveJob={!!active.data} />
      {d.assignedTruck ? (
        <TruckSummary truck={d.assignedTruck} />
      ) : (
        <SectionCard title="Your truck">
          <Typography color="text.secondary">No truck is assigned to you. You may still join jobs as a crew member.</Typography>
        </SectionCard>
      )}

      <Button component={RouterLink} to="/driver/jobs" size="large" variant="text" endIcon={<ArrowForwardIcon />}>
        Job history
      </Button>
      <Snackbar open={!!flash} autoHideDuration={6000} onClose={() => setFlash(null)} message={flash} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} />
    </Stack>
  );
}
