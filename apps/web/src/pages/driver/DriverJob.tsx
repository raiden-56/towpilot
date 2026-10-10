import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Accordion, AccordionDetails, AccordionSummary, Alert, AlertTitle, Box, Button, Chip, Divider, Snackbar, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import NavigationIcon from '@mui/icons-material/Navigation';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import PlaceIcon from '@mui/icons-material/Place';
import FlagIcon from '@mui/icons-material/Flag';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import SearchIcon from '@mui/icons-material/Search';
import BuildIcon from '@mui/icons-material/Build';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import BlockIcon from '@mui/icons-material/Block';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/api/client';
import type { BookingDetail, BookingStatus, Location } from '@/api/types';
import { EmptyState, ErrorState, LoadingBlock, SectionCard, StatusChip, errorMessage } from '@/components/common';
import { MapView, type MapMarker } from '@/components/MapView';
import { BookingTimeline } from '@/components/BookingTimeline';
import { QuoteBreakdown } from '@/components/QuoteBreakdown';
import { joinBookingRoom, leaveBookingRoom, useRealtimeEvent } from '@/hooks/useRealtime';
import { useIsOnline } from '@/hooks/useOnline';
import { useAuth } from '@/hooks/useAuth';
import { dateTime, humanize, inr, time, VEHICLE_CLASS_LABELS } from '@/lib/format';
import { useDriverMe } from './locationSharing';
import { ChipList, EQUIPMENT_LABELS, Fact, OfflineActionsNotice, SafetyFlagsAlert, TEAM_ROLE_LABELS, TRUCK_TYPE_LABELS, assessmentSummary, label, mapsDirUrl, peopleSummary, type ConditionReport } from './components/driverShared';
import { CallCustomerButton, JobStep, ReasonDialog, TransitionButton, useJobTransition, type StepState } from './components/JobParts';
import { ConditionReportForm, ConditionReportSummary } from './components/ConditionReportForm';
import { HandoverCodeCard, PickupCodeCard } from './components/CodeEntry';
import { QuoteRevisionPanel } from './components/QuoteRevisionPanel';
import { CloseJobForm, InvoiceAndCash } from './components/CloseJobPanel';

const ORDER: BookingStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
const WORKING: BookingStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'CUSTOMER_UNAVAILABLE', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT', 'DELIVERED'];
const rank = (s: BookingStatus) => ORDER.indexOf(s);

/** Last "happy path" status reached — used to place exception states (hold, unreachable) on the checklist. */
function progressOf(b: BookingDetail): BookingStatus {
  if (ORDER.includes(b.status)) return b.status;
  if (b.status === 'CUSTOMER_UNAVAILABLE') return 'ARRIVED';
  const h = [...(b.statusHistory ?? [])].reverse().find((x) => ORDER.includes(x.toStatus));
  return h?.toStatus ?? 'ACCEPTED';
}

function useSessionFlag(key: string): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  return [
    v,
    (nv: boolean) => {
      setV(nv);
      try {
        if (nv) sessionStorage.setItem(key, '1');
        else sessionStorage.removeItem(key);
      } catch {
        /* storage unavailable */
      }
    },
  ];
}

function MapsButton({ loc, label: text }: { loc: Location | null | undefined; label: string }) {
  if (!loc) return null;
  return (
    <Button size="large" variant="outlined" fullWidth startIcon={<NavigationIcon />} href={mapsDirUrl(loc.lat, loc.lng)} target="_blank" rel="noopener noreferrer" sx={{ borderWidth: 2, '&:hover': { borderWidth: 2 } }}>
      {text}
    </Button>
  );
}

function DrivingReminder() {
  return (
    <Alert severity="warning" sx={{ fontWeight: 600 }}>
      Pull over safely before using the phone. Never read or type while driving.
    </Alert>
  );
}

function LocationLines({ loc, instructions }: { loc: Location; instructions?: string | null }) {
  const road = [loc.highway, loc.roadDirection && `towards ${loc.roadDirection}`, loc.kmMarker && `km ${loc.kmMarker}`].filter(Boolean).join(' · ');
  const building = [loc.gateNumber && `Gate ${loc.gateNumber}`, loc.floor && `Floor ${loc.floor}`, loc.parkingLevel && `Parking ${loc.parkingLevel}`].filter(Boolean).join(' · ');
  return (
    <Stack spacing={0.25}>
      {loc.placeName && <Fact label="Place">{loc.placeName}</Fact>}
      <Fact label="Address">{loc.address ?? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`}</Fact>
      {loc.landmark && <Fact label="Landmark">{loc.landmark}</Fact>}
      {road && <Fact label="Road">{road}</Fact>}
      {building && <Fact label="Building">{building}</Fact>}
      {loc.accessNotes && <Fact label="Access notes">{loc.accessNotes}</Fact>}
      {instructions && <Fact label="Customer instructions">{instructions}</Fact>}
      {loc.isSafeLocation === false && (
        <Alert severity="error" sx={{ mt: 1 }}>
          Customer said this spot is not safe. Assess the scene before stopping; use cones and hazard lights.
        </Alert>
      )}
    </Stack>
  );
}

const EXCEPTIONS: { to: BookingStatus; label: string; icon: ReactNode; title: string; body: string; quick: string[]; color: 'warning' | 'error' | 'inherit' }[] = [
  {
    to: 'CUSTOMER_UNAVAILABLE',
    label: 'Customer not reachable',
    icon: <PersonOffIcon />,
    title: 'Customer not reachable',
    body: 'Records that you are at the pickup point and cannot reach the customer. The customer is notified and dispatch can see it. If they turn up, verify the pickup code to continue.',
    quick: ['Called 3 times, no answer', 'Phone switched off', 'Not at the location'],
    color: 'warning',
  },
  {
    to: 'SAFETY_HOLD',
    label: 'Safety hold',
    icon: <PauseCircleIcon />,
    title: 'Put the job on safety hold',
    body: 'Pauses the job and alerts dispatch immediately. Only operations can resume it. If anyone is in danger, call emergency services first.',
    quick: ['Unsafe location / traffic', 'Aggressive behaviour', 'Fuel or battery leak', 'Weather'],
    color: 'error',
  },
  {
    to: 'REASSIGNMENT_REQUIRED',
    label: 'Release job (truck / personal problem)',
    icon: <SwapHorizIcon />,
    title: 'Release this job',
    body: 'The job goes back to dispatch for another provider and you are removed from it. Use this if your truck broke down or you cannot continue.',
    quick: ['Truck breakdown', 'Wrong equipment for this vehicle', 'Flat tyre on truck', 'Personal emergency'],
    color: 'inherit',
  },
  {
    to: 'FAILED',
    label: 'Unable to complete',
    icon: <BlockIcon />,
    title: 'Unable to complete the job',
    body: 'Ends the job as unsuccessful. Dispatch and the customer are informed and you are released from it.',
    quick: ['Vehicle cannot be recovered safely', 'Customer refused service', 'Access not possible'],
    color: 'error',
  },
];

function ExceptionActions({ booking, isLead, onReleased }: { booking: BookingDetail; isLead: boolean; onReleased: (msg: string) => void }) {
  const [open, setOpen] = useState<BookingStatus | null>(null);
  const t = useJobTransition(booking.id);
  const online = useIsOnline();
  const visible = EXCEPTIONS.filter((e) => booking.allowedNext?.includes(e.to) && (isLead || e.to === 'SAFETY_HOLD'));
  if (!visible.length) return null;
  const cur = EXCEPTIONS.find((e) => e.to === open);
  return (
    <SectionCard title="Problem on this job?">
      <Stack spacing={1}>
        {visible.map((e) => (
          <Button key={e.to} size="large" variant="outlined" color={e.color} startIcon={e.icon} disabled={!online} onClick={() => (t.reset(), setOpen(e.to))} sx={{ justifyContent: 'flex-start', borderWidth: 2, '&:hover': { borderWidth: 2 } }}>
            {e.label}
          </Button>
        ))}
      </Stack>
      {cur && (
        <ReasonDialog
          key={cur.to}
          open
          title={cur.title}
          body={cur.body}
          quick={cur.quick}
          confirmLabel="Confirm"
          danger={cur.color === 'error'}
          loading={t.isPending}
          error={t.error}
          onClose={() => setOpen(null)}
          onConfirm={(reason) =>
            t.mutate(
              { to: cur.to, reason },
              {
                onSuccess: (b) => {
                  setOpen(null);
                  if (!b) onReleased(cur.to === 'FAILED' ? 'Job closed as unable to complete. Dispatch has been informed.' : 'Job released back to dispatch.');
                },
              },
            )
          }
        />
      )}
    </SectionCard>
  );
}

function EquipmentCheck({ booking }: { booking: BookingDetail }) {
  const me = useDriverMe();
  const rec = booking.recommendation;
  const truck = booking.driver?.truck ?? null;
  const myTruck = me.data?.assignedTruck && truck && me.data.assignedTruck.id === truck.id ? me.data.assignedTruck : null;
  const truckOk = !rec?.truckTypes.length || (truck && rec.truckTypes.includes(truck.truckType));
  const team = booking.team ?? [];
  return (
    <Stack spacing={1.5}>
      {truck ? (
        <Alert severity={truckOk ? 'success' : 'warning'}>
          Your truck {truck.registrationNumber} ({label(TRUCK_TYPE_LABELS, truck.truckType)}) {truckOk ? 'matches the recommendation.' : `is not a recommended type (${rec?.truckTypes.map((x) => label(TRUCK_TYPE_LABELS, x)).join(' / ')}).`}
        </Alert>
      ) : (
        <Alert severity="info">No truck is linked to this job.</Alert>
      )}
      {!!rec?.equipment.length && (
        <Box>
          <Typography variant="h6" gutterBottom>
            Equipment needed
          </Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75}>
            {rec.equipment.map((eq) => {
              const st = myTruck?.equipment.find((x) => x.type === eq)?.status;
              const color = !myTruck ? 'default' : st === 'OK' ? 'success' : 'error';
              const suffix = !myTruck ? '' : st === 'OK' ? ' ✓' : st ? ` — ${st.toLowerCase()}` : ' — not on truck';
              return <Chip key={eq} label={`${label(EQUIPMENT_LABELS, eq)}${suffix}`} color={color} variant={color === 'default' ? 'outlined' : 'filled'} />;
            })}
          </Stack>
        </Box>
      )}
      <Box>
        <Typography variant="h6" gutterBottom>
          Crew: {team.length} on job · {booking.crewRecommended ?? rec?.crew ?? 1} recommended
        </Typography>
        {team.map((m) => (
          <Typography key={m.userId} variant="body2">
            • {m.name} — {label(TEAM_ROLE_LABELS, m.role)}
            {m.responsibility ? ` (${m.responsibility})` : ''}
          </Typography>
        ))}
        {rec?.crewNote && (
          <Typography variant="caption" color="text.secondary">
            {rec.crewNote}
          </Typography>
        )}
      </Box>
      {!!rec?.reasons.length && (
        <Box>
          <Typography variant="h6" gutterBottom>
            Why
          </Typography>
          {rec.reasons.map((r) => (
            <Typography key={r} variant="body2">
              • {r}
            </Typography>
          ))}
        </Box>
      )}
    </Stack>
  );
}

export default function DriverJob() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const online = useIsOnline();
  const [toast, setToast] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<'PICKUP' | 'DELIVERY' | null>(null);
  const qc = useQueryClient();
  const equipCheck = useMutation({
    mutationFn: () => api.post(`/driver/jobs/${id}/equipment-check`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['booking', id] }),
  });
  const [skipOnsiteReport, setSkipOnsiteReport] = useSessionFlag(`tp.job.${id}.skipReport`);
  const q = useQuery({
    queryKey: ['booking', id],
    queryFn: () => api.get<BookingDetail>(`/bookings/${id}`),
    refetchInterval: 30_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });

  useEffect(() => {
    if (!id) return;
    joinBookingRoom(id);
    return () => leaveBookingRoom(id);
  }, [id]);

  useRealtimeEvent((e) => {
    if (e.bookingId !== id) return;
    if (e.type === 'quote.decision') setToast((e.data as { approved?: boolean }).approved ? 'Revised quote approved — you can carry out the revised scope.' : 'Revised quote declined — continue only with the approved scope.');
    if (e.type === 'booking.custody') setToast('Custody confirmed.');
    if (e.type === 'job.cancelled') setToast('This job was cancelled.');
  });

  const b = q.data;
  const derived = useMemo(() => {
    if (!b) return null;
    const history = b.statusHistory ?? [];
    const at = (s: BookingStatus) => history.find((h) => h.toStatus === s && h.fromStatus !== s)?.createdAt ?? null;
    const reports = (b.conditionReports ?? []) as ConditionReport[];
    const latest = (stage: string) => [...reports].reverse().find((r) => r.stage === stage) ?? null;
    return {
      at,
      progress: progressOf(b),
      towing: b.serviceCategory.kind === 'TOWING',
      pickupCustody: b.custody?.find((c) => c.stage === 'PICKUP') ?? null,
      handoverCustody: b.custody?.find((c) => c.stage === 'HANDOVER') ?? null,
      pickupReport: latest('PICKUP'),
      deliveryReport: latest('DELIVERY'),
      pendingQuote: b.quotes?.find((x) => x.id === b.pendingQuoteId) ?? null,
      approvedQuote: b.quotes?.find((x) => x.id === b.approvedQuoteId) ?? null,
    };
  }, [b]);

  if (q.error) {
    if (q.error instanceof ApiError && q.error.status === 404)
      return (
        <EmptyState
          title="This job is no longer assigned to you"
          body="It may have been cancelled, reassigned or released. Check with dispatch if you think this is wrong."
          action={
            <Button size="large" variant="contained" component={RouterLink} to="/driver">
              Back to today
            </Button>
          }
        />
      );
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!b || !derived) return <LoadingBlock rows={6} height={72} />;

  const { at, progress, towing, pickupCustody, handoverCustody, pickupReport, deliveryReport, pendingQuote, approvedQuote } = derived;
  const r = rank(progress);
  const me = b.team?.find((t) => t.userId === user?.id);
  const leader = b.team?.find((t) => t.role === 'TEAM_LEADER');
  const isLead = me?.role === 'TEAM_LEADER';
  const working = WORKING.includes(b.status);
  const canAct = isLead && working;
  const vehicleLine = b.vehicle ? [b.vehicle.make, b.vehicle.model, b.vehicle.color, VEHICLE_CLASS_LABELS[b.vehicle.vehicleClass], humanize(b.vehicle.fuelType)].filter(Boolean).join(' · ') : null;
  const navTarget = r >= rank('LOADING') && towing ? b.dropoff : b.pickup;
  const lastHold = [...(b.statusHistory ?? [])].reverse().find((h) => h.toStatus === b.status);
  const pickupReportWindow = ['INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING'].includes(b.status);
  const waitingFor = (what: string) => (
    <Typography variant="body2" color="text.secondary">
      Waiting for {leader?.name ?? 'the team leader'} to {what}.
    </Typography>
  );

  // ─── Checklist definition ───
  interface Step {
    key: string;
    title: string;
    done: boolean;
    at?: string | null;
    optional?: boolean;
    summary?: ReactNode;
    body?: () => ReactNode;
  }
  const steps: Step[] = [
    { key: 'accepted', title: 'Job accepted', done: true, at: at('ACCEPTED') },
    {
      key: 'drive',
      title: 'Drive to pickup',
      done: r >= rank('EN_ROUTE'),
      at: at('EN_ROUTE'),
      body: () =>
        canAct ? (
          <Stack spacing={1.5}>
            <DrivingReminder />
            <TransitionButton booking={b} to="EN_ROUTE" label="Start driving" icon={<PlayArrowIcon />} />
            <MapsButton loc={b.pickup} label="Open pickup in Maps" />
          </Stack>
        ) : (
          waitingFor('start driving')
        ),
    },
    {
      key: 'arrive',
      title: 'Arrive & verify customer',
      done: !!pickupCustody || !!b.pickupVerifiedAt,
      at: pickupCustody?.createdAt ?? b.pickupVerifiedAt,
      summary: (
        <Typography variant="body2">
          Arrived {time(at('ARRIVED'))} ·{' '}
          {pickupCustody?.method === 'AUTHORIZED_OVERRIDE' ? `Authorised override${pickupCustody.overrideReason ? `: ${pickupCustody.overrideReason}` : ''}` : 'Pickup code verified'}
          {b.waitingMinutes ? ` · waited ${b.waitingMinutes} min` : ''}
        </Typography>
      ),
      body: () =>
        !canAct ? (
          waitingFor(b.status === 'EN_ROUTE' ? 'arrive' : 'verify the customer')
        ) : b.status === 'EN_ROUTE' ? (
          <Stack spacing={1.5}>
            <DrivingReminder />
            <MapsButton loc={b.pickup} label="Open pickup in Maps" />
            <TransitionButton booking={b} to="ARRIVED" label="I've arrived at pickup" icon={<FlagIcon />} />
          </Stack>
        ) : ['ARRIVED', 'CUSTOMER_UNAVAILABLE'].includes(b.status) ? (
          <Stack spacing={1}>
            {at('ARRIVED') && (
              <Typography variant="body2" color="text.secondary">
                Arrived at {time(at('ARRIVED'))}
              </Typography>
            )}
            <PickupCodeCard booking={b} />
          </Stack>
        ) : null,
    },
    {
      key: 'inspect',
      title: towing ? 'Inspect & record pickup condition' : 'Inspect the vehicle',
      done: towing ? r >= rank('INSPECTING') && !!pickupReport : r >= rank('RECOVERY_AUTHORIZED') || (r >= rank('INSPECTING') && (!!pickupReport || skipOnsiteReport)),
      at: pickupReport?.createdAt ?? at('INSPECTING'),
      summary: pickupReport ? (
        <Stack spacing={1}>
          <ConditionReportSummary report={pickupReport} booking={b} />
          {isLead && pickupReportWindow && correcting !== 'PICKUP' && (
            <Button size="large" variant="text" onClick={() => setCorrecting('PICKUP')} sx={{ alignSelf: 'flex-start' }}>
              Correct this report
            </Button>
          )}
          {correcting === 'PICKUP' && <ConditionReportForm booking={b} stage="PICKUP" supersedes={pickupReport} onDone={() => setCorrecting(null)} onCancel={() => setCorrecting(null)} />}
        </Stack>
      ) : (
        <Typography variant="body2">No condition report (on-site service).</Typography>
      ),
      body: () =>
        !canAct ? (
          waitingFor('complete the inspection')
        ) : b.status === 'CUSTOMER_UNAVAILABLE' ? (
          <TransitionButton booking={b} to="ARRIVED" label="Customer is here — resume" icon={<PlayArrowIcon />} />
        ) : b.status === 'ARRIVED' ? (
          <TransitionButton booking={b} to="INSPECTING" label="Start inspection" icon={<SearchIcon />} />
        ) : b.status === 'INSPECTING' ? (
          <Stack spacing={1.5}>
            {!towing && <Alert severity="info">Photos are recommended before you start on-site work, but not required.</Alert>}
            <ConditionReportForm booking={b} stage="PICKUP" />
            {!towing && (
              <Button size="large" variant="text" onClick={() => setSkipOnsiteReport(true)}>
                Continue without a report
              </Button>
            )}
          </Stack>
        ) : null,
    },
    {
      key: 'equipment',
      title: 'Confirm equipment & crew are suitable',
      done: r >= rank('RECOVERY_AUTHORIZED') || !!b.statusHistory?.some((h) => h.reason?.startsWith('Equipment & crew confirmed')),
      summary: <Typography variant="body2">Confirmed suitable.</Typography>,
      body: () =>
        canAct ? (
          <Stack spacing={1.5}>
            <EquipmentCheck booking={b} />
            <Button size="large" variant="contained" startIcon={<TaskAltIcon />} disabled={!online || equipCheck.isPending} onClick={() => equipCheck.mutate()} sx={{ minHeight: 56 }}>
              Equipment & crew are suitable
            </Button>
            {equipCheck.error && <Alert severity="error">{errorMessage(equipCheck.error)}</Alert>}
            <Typography variant="body2" color="text.secondary">
              Not suitable? Use “Release job” below or call dispatch before attempting the recovery.
            </Typography>
          </Stack>
        ) : (
          <EquipmentCheck booking={b} />
        ),
    },
    {
      key: 'revision',
      title: 'Revised approval (scope or price change)',
      done: false,
      optional: true,
      body: () => (r >= rank('INSPECTING') && working) || pendingQuote ? <QuoteRevisionPanel booking={b} canRequest={canAct} /> : null,
    },
    {
      key: 'authorise',
      title: towing ? 'Authorise recovery' : 'Authorise & start the service',
      done: r >= rank('RECOVERY_AUTHORIZED'),
      at: at('RECOVERY_AUTHORIZED'),
      body: () =>
        !canAct ? (
          waitingFor('authorise the work')
        ) : pendingQuote ? (
          <Alert severity="warning">A revised quote is waiting for approval. Wait for the decision before starting work.</Alert>
        ) : (
          <TransitionButton booking={b} to="RECOVERY_AUTHORIZED" label={towing ? 'Authorise recovery' : 'Start the service'} icon={<BuildIcon />} />
        ),
    },
    ...(towing
      ? [
          {
            key: 'loading',
            title: 'Load & secure the vehicle',
            done: r >= rank('LOADING'),
            at: at('LOADING'),
            body: () => (canAct ? <TransitionButton booking={b} to="LOADING" label="Start loading" icon={<LocalShippingIcon />} /> : waitingFor('start loading')),
          },
          {
            key: 'transit',
            title: 'Drive to destination',
            done: r >= rank('IN_TRANSIT'),
            at: at('IN_TRANSIT'),
            body: () =>
              canAct ? (
                <Stack spacing={1.5}>
                  <Typography variant="body2">Check straps, wheel chocks and lights before moving.</Typography>
                  <TransitionButton booking={b} to="IN_TRANSIT" label="Vehicle secured — start trip" icon={<PlayArrowIcon />} />
                  <MapsButton loc={b.dropoff} label="Open destination in Maps" />
                </Stack>
              ) : (
                waitingFor('start the trip')
              ),
          },
          {
            key: 'delivery',
            title: 'At destination: delivery photos & condition',
            done: !!deliveryReport || r >= rank('DELIVERED'),
            at: deliveryReport?.createdAt,
            summary: deliveryReport ? (
              <Stack spacing={1}>
                <ConditionReportSummary report={deliveryReport} booking={b} />
                {isLead && b.status === 'IN_TRANSIT' && correcting !== 'DELIVERY' && (
                  <Button size="large" variant="text" onClick={() => setCorrecting('DELIVERY')} sx={{ alignSelf: 'flex-start' }}>
                    Correct this report
                  </Button>
                )}
                {correcting === 'DELIVERY' && <ConditionReportForm booking={b} stage="DELIVERY" supersedes={deliveryReport} onDone={() => setCorrecting(null)} onCancel={() => setCorrecting(null)} />}
              </Stack>
            ) : undefined,
            body: () =>
              canAct ? (
                <Stack spacing={1.5}>
                  <DrivingReminder />
                  <MapsButton loc={b.dropoff} label="Open destination in Maps" />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    When parked at the destination:
                  </Typography>
                  <ConditionReportForm booking={b} stage="DELIVERY" />
                </Stack>
              ) : (
                waitingFor('record the delivery condition')
              ),
          } satisfies Step,
        ]
      : []),
    {
      key: 'handover',
      title: towing ? 'Hand over with code' : 'Customer confirms with handover code',
      done: !!handoverCustody,
      at: handoverCustody?.createdAt,
      summary: handoverCustody ? (
        <Typography variant="body2">
          Received by {handoverCustody.recipientName ?? '—'}
          {handoverCustody.recipientRelation ? ` (${handoverCustody.recipientRelation})` : ''} · {handoverCustody.method === 'AUTHORIZED_OVERRIDE' ? `Authorised override${handoverCustody.overrideReason ? `: ${handoverCustody.overrideReason}` : ''}` : 'Code verified'}
        </Typography>
      ) : undefined,
      body: () => (canAct ? <HandoverCodeCard booking={b} /> : waitingFor('confirm the handover')),
    },
    {
      key: 'delivered',
      title: towing ? 'Mark delivered' : 'Mark service completed',
      done: r >= rank('DELIVERED'),
      at: at('DELIVERED'),
      body: () => (canAct ? <TransitionButton booking={b} to="DELIVERED" color="success" label={towing ? 'Mark delivered' : 'Service completed'} icon={<TaskAltIcon />} /> : waitingFor('mark the job delivered')),
    },
    {
      key: 'close',
      title: 'Close job & invoice',
      done: b.status === 'COMPLETED' || !!b.invoice,
      at: at('COMPLETED'),
      summary: b.invoice ? (
        <Typography variant="body2">
          Invoice {b.invoice.number} · {inr(b.invoice.total)}
        </Typography>
      ) : undefined,
      body: () => (canAct ? <CloseJobForm booking={b} /> : waitingFor('close the job')),
    },
  ];
  // No "current" step while on safety hold or after the job has ended.
  const currentIdx = working ? steps.findIndex((s) => !s.optional && !s.done) : -1;
  const stateOf = (s: Step, i: number): StepState => (s.done ? 'done' : s.optional ? 'optional' : i === currentIdx ? 'current' : 'pending');

  const markers: MapMarker[] = [
    ...(b.pickup ? [{ id: 'pickup', lat: b.pickup.lat, lng: b.pickup.lng, kind: 'pickup' as const, popup: 'Pickup' }] : []),
    ...(b.dropoff ? [{ id: 'dropoff', lat: b.dropoff.lat, lng: b.dropoff.lng, kind: 'dropoff' as const, popup: b.dropoff.placeName ?? 'Destination' }] : []),
    ...(b.driverLocation ? [{ id: 'me', lat: b.driverLocation.lat, lng: b.driverLocation.lng, kind: 'truck' as const, popup: `Your truck · ${time(b.driverLocation.at)}` }] : []),
  ];
  const people = peopleSummary(b.assessment);

  return (
    <Stack spacing={2}>
      <Box>
        <Button component={RouterLink} to="/driver" startIcon={<ArrowBackIcon />} size="large" sx={{ ml: -1, mb: 0.5 }}>
          Today
        </Button>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body1" sx={{ fontWeight: 700 }}>
            {b.code}
          </Typography>
          <StatusChip status={b.status} size="medium" />
          {b.priority !== 'NORMAL' && <Chip label={`${b.priority.toLowerCase()} priority`} color="error" />}
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <DirectionsCarIcon />
          <Typography component="h1" sx={{ fontSize: '1.9rem', fontWeight: 900, letterSpacing: '0.02em', wordBreak: 'break-word' }}>
            {b.vehicle?.registrationNumber ?? 'Vehicle'}
          </Typography>
        </Stack>
        {vehicleLine && <Typography sx={{ fontWeight: 600 }}>{vehicleLine}</Typography>}
        <Typography color="text.secondary">
          {b.serviceCategory.name}
          {b.towDistanceKm != null && towing ? ` · ${b.towDistanceKm} km tow` : ''}
        </Typography>
      </Box>

      <OfflineActionsNotice online={online} />
      {!isLead && working && (
        <Alert severity="info">You are on this job as {me ? label(TEAM_ROLE_LABELS, me.role).toLowerCase() : 'a team member'}. Only the team leader{leader ? ` (${leader.name})` : ''} updates progress; you can follow along here and use Safety.</Alert>
      )}
      {b.status === 'SAFETY_HOLD' && (
        <Alert severity="error" variant="filled">
          <AlertTitle sx={{ fontWeight: 800 }}>Job on safety hold</AlertTitle>
          {lastHold?.reason ? `${lastHold.reason}. ` : ''}Dispatch has been alerted and will contact you. Only operations can resume this job.
        </Alert>
      )}
      {b.status === 'CUSTOMER_UNAVAILABLE' && (
        <Alert severity="warning">
          <AlertTitle sx={{ fontWeight: 800 }}>Customer marked unreachable {lastHold ? time(lastHold.createdAt) : ''}</AlertTitle>
          Keep trying to call. When the customer arrives, verify the pickup code to continue.
        </Alert>
      )}
      {b.status === 'CANCELLED' && <Alert severity="info">This job was cancelled{b.cancellationReason ? `: ${b.cancellationReason}` : '.'}</Alert>}
      {b.status === 'FAILED' && <Alert severity="info">Closed as unable to complete{b.failureReason ? `: ${b.failureReason}` : '.'}</Alert>}
      {b.status === 'DISPUTED' && <Alert severity="warning">The customer has raised a dispute on this job. Operations will handle it and may contact you.</Alert>}
      {b.status === 'COMPLETED' && <Alert severity="success">Job completed {dateTime(b.completedAt)}.</Alert>}

      <SafetyFlagsAlert flags={b.safetyFlags} extra={b.manualReviewReasons} />

      {working && (
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <CallCustomerButton bookingId={b.id} />
          {navTarget && (
            <Button size="large" variant="outlined" startIcon={<NavigationIcon />} href={mapsDirUrl(navTarget.lat, navTarget.lng)} target="_blank" rel="noopener noreferrer" sx={{ flex: 1, borderWidth: 2, '&:hover': { borderWidth: 2 } }}>
              {navTarget === b.dropoff ? 'To destination' : 'To pickup'}
            </Button>
          )}
        </Stack>
      )}

      {b.pickup && (
        <SectionCard dense title={<Stack direction="row" spacing={1} alignItems="center"><PlaceIcon color="error" /><Typography variant="h5">Pickup</Typography></Stack>}>
          <LocationLines loc={b.pickup} instructions={b.instructions} />
        </SectionCard>
      )}

      <SectionCard title="Recovery checklist">
        <Box component="ol" sx={{ p: 0, m: 0 }}>
          {steps.map((s, i) => (
            <JobStep key={s.key} n={i + 1} title={s.title} state={stateOf(s, i)} at={s.at} summary={s.summary} last={i === steps.length - 1}>
              {stateOf(s, i) === 'current' || stateOf(s, i) === 'optional' ? s.body?.() : null}
            </JobStep>
          ))}
        </Box>
        {(b.status === 'COMPLETED' || b.invoice) && (
          <>
            <Divider sx={{ my: 2 }} />
            <InvoiceAndCash booking={b} canRecord={isLead && online} />
          </>
        )}
      </SectionCard>

      <ExceptionActions booking={b} isLead={isLead} onReleased={(msg) => nav('/driver', { replace: true, state: { flash: msg } })} />

      {b.dropoff && (
        <SectionCard dense title={<Stack direction="row" spacing={1} alignItems="center"><PlaceIcon color="success" /><Typography variant="h5">Destination</Typography></Stack>}>
          <LocationLines loc={b.dropoff} />
        </SectionCard>
      )}

      {markers.length > 0 && <MapView markers={markers} height={260} ariaLabel="Job map: pickup, destination and your truck" />}

      <SectionCard title="Vehicle condition reported by customer" dense>
        <Stack spacing={1.5}>
          <ChipList items={assessmentSummary(b.assessment)} />
          {b.assessment?.accessRestriction && b.assessment.accessRestriction !== 'NONE' && <Alert severity="warning">Access: {humanize(b.assessment.accessRestriction)}</Alert>}
          {people.length > 0 && <Alert severity="info">{people.join(' · ')}</Alert>}
          {b.assessment?.notes && <Fact label="Customer notes">{b.assessment.notes}</Fact>}
          {(b.attachments ?? []).some((a) => a.kind === 'DAMAGE_PHOTO') && (
            <Typography variant="body2" color="text.secondary">
              The customer uploaded {(b.attachments ?? []).filter((a) => a.kind === 'DAMAGE_PHOTO').length} damage photo(s).
            </Typography>
          )}
        </Stack>
      </SectionCard>

      <Accordion disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 56 }}>
          <Typography variant="h5">Approved quote {approvedQuote ? `· ${inr(approvedQuote.total)}` : ''}</Typography>
        </AccordionSummary>
        <AccordionDetails>{approvedQuote ? <QuoteBreakdown quote={approvedQuote} showConditions={false} /> : <Typography color="text.secondary">No approved quote on record.</Typography>}</AccordionDetails>
      </Accordion>
      <Accordion disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 56 }}>
          <Typography variant="h5">Full status history</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <BookingTimeline history={b.statusHistory ?? []} current={b.status} onsite={!towing} />
        </AccordionDetails>
      </Accordion>

      <Snackbar open={!!toast} autoHideDuration={6000} onClose={() => setToast(null)} message={toast} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} />
    </Stack>
  );
}
