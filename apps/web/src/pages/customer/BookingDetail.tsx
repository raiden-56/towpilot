import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Accordion, AccordionDetails, AccordionSummary, Alert, AlertTitle, Box, Button, Chip, CircularProgress, Divider, Stack, Typography, type AlertColor } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReplayIcon from '@mui/icons-material/Replay';
import DownloadIcon from '@mui/icons-material/Download';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import { api, ApiError } from '@/api/client';
import type { BookingDetail as Booking, BookingStatus } from '@/api/types';
import { BookingTimeline } from '@/components/BookingTimeline';
import { MapView, type MapMarker } from '@/components/MapView';
import { QuoteBreakdown } from '@/components/QuoteBreakdown';
import { EmptyState, ErrorState, KeyValue, LoadingBlock, Money, PageHeader, PaymentChip, SectionCard, StatusChip, errorMessage } from '@/components/common';
import { joinBookingRoom, leaveBookingRoom } from '@/hooks/useRealtime';
import { useIsOnline } from '@/hooks/useOnline';
import { dateTime, humanize, inr, relative, time, VEHICLE_CLASS_LABELS } from '@/lib/format';
import { ACCESS_LABELS, BREAKDOWN_LABELS, CLOSED_STATUSES, DESTINATION_LABELS, LIVE_STATUSES, SEARCHING_STATUSES, TRI_LABELS, TRI_QUESTIONS, flagLabel, placeLabel } from './components/bookingParts';
import { CodesCard, DriverCard, EvidenceCard, RatingCard, ReasonDialog, RevisionCard, ShareCard, SupportLine } from './components/bookingDetailParts';
import { QuoteConfirmPanel } from './components/QuoteConfirm';
import { BackLink, useToast } from './components/shared';

interface Tracking {
  status: BookingStatus;
  etaAt: string | null;
  driverLocation: { lat: number; lng: number; at: string; accuracyM?: number | null } | null;
  serverTime: string;
}
interface CancelPreview {
  status: BookingStatus;
  stage: 'FREE' | 'ACCEPTED' | 'ARRIVED';
  fee: number;
  policy: { description: string; acceptedFee: number; arrivedFee: number };
}

function statusBanner(b: Booking): { severity: AlertColor; title: string; body: React.ReactNode } | null {
  switch (b.status) {
    case 'REQUESTED':
      return { severity: 'info', title: 'Preparing your quote', body: 'This usually takes a few seconds.' };
    case 'QUOTED':
      return { severity: 'warning', title: 'Waiting for your confirmation', body: 'Review the quote below. Nothing is dispatched until you confirm.' };
    case 'CONFIRMED':
      if (b.requiresManualReview && !b.reviewedAt) return { severity: 'info', title: 'A coordinator is reviewing your request', body: <>Because of the reported conditions, our team checks the details before dispatching a provider. They may call you. <SupportLine /> if you have questions.</> };
      if (b.type === 'SCHEDULED') return { severity: 'success', title: `Scheduled for ${dateTime(b.scheduledFor)}`, body: 'We will assign a provider ahead of your scheduled time and notify you.' };
      return { severity: 'info', title: 'Booking confirmed', body: 'We are finding a provider for you.' };
    case 'SEARCHING_FOR_PROVIDER':
      return { severity: 'info', title: 'Still looking for a provider', body: <>We're contacting nearby verified providers and will notify you the moment one accepts. This can take a little longer at busy times. <SupportLine /> if it's urgent.</> };
    case 'ASSIGNED':
      return { severity: 'info', title: 'Waiting for the driver to accept', body: 'A provider has been offered your job. If they decline, we automatically look for another.' };
    case 'REJECTED':
    case 'REASSIGNMENT_REQUIRED':
      return { severity: 'warning', title: 'Still looking for a provider', body: <>The previous provider couldn't take the job, so we're finding another one. <SupportLine /> if you need an update.</> };
    case 'ACCEPTED':
    case 'EN_ROUTE':
      return { severity: 'success', title: b.status === 'ACCEPTED' ? 'Driver accepted your job' : 'Driver is on the way', body: b.etaAt ? `Estimated arrival ${time(b.etaAt)} (${relative(b.etaAt)}).` : 'Arrival time will appear once the driver shares their location.' };
    case 'ARRIVED':
      return { severity: 'success', title: 'Your driver has arrived', body: 'Check the driver name and truck number, then share your pickup code in person.' };
    case 'INSPECTING':
      return { severity: 'info', title: 'Inspecting your vehicle', body: 'The crew is checking the vehicle. Any extra chargeable work needs your approval first.' };
    case 'RECOVERY_AUTHORIZED':
    case 'LOADING':
      return { severity: 'info', title: STATUS_TEXT[b.status] ?? '', body: 'The crew is working on your vehicle.' };
    case 'IN_TRANSIT':
      return { severity: 'info', title: 'Your vehicle is on its way', body: 'Share the handover code with the person receiving it at the destination.' };
    case 'DELIVERED':
      return { severity: 'success', title: b.serviceCategory.kind === 'TOWING' ? 'Vehicle handed over' : 'Service completed on site', body: 'The crew is closing the job. Your invoice will appear here.' };
    case 'COMPLETED':
      return { severity: 'success', title: 'Job completed', body: b.completedAt ? `Completed ${dateTime(b.completedAt)}.` : '' };
    case 'CUSTOMER_UNAVAILABLE':
      return { severity: 'error', title: 'The driver could not reach you', body: <>Please call the driver now, or <SupportLine />. Waiting time may be charged as per the quote.</> };
    case 'SAFETY_HOLD':
      return { severity: 'error', title: 'Paused for safety', body: <>The job is on hold while our team makes the scene safe. Stay away from traffic. <SupportLine /> if you need help.</> };
    case 'CANCELLED':
      return { severity: 'info', title: 'Booking cancelled', body: `${b.cancellationReason ? `Reason: ${b.cancellationReason}. ` : ''}${b.cancellationFee ? `Cancellation fee: ${inr(b.cancellationFee)}.` : 'No cancellation fee.'}` };
    case 'FAILED':
      return { severity: 'error', title: 'We could not complete this job', body: <>{b.failureReason ? `${b.failureReason}. ` : ''}<SupportLine /> for next steps.</> };
    case 'DISPUTED':
      return { severity: 'warning', title: 'Under dispute', body: 'Our support team is reviewing your dispute and will contact you.' };
    default:
      return null;
  }
}
const STATUS_TEXT: Partial<Record<BookingStatus, string>> = { RECOVERY_AUTHORIZED: 'Recovery authorised', LOADING: 'Loading your vehicle' };

export default function BookingDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const online = useIsOnline();
  const { toast, toastNode } = useToast();
  const [justConfirmed, setJustConfirmed] = useState(!!(loc.state as { justConfirmed?: boolean } | null)?.justConfirmed);
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeTicket, setDisputeTicket] = useState<{ id: string; number: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const q = useQuery({ queryKey: ['booking', id], queryFn: () => api.get<Booking>(`/bookings/${id}`), enabled: !!id });
  const b = q.data;
  const active = !!b && !CLOSED_STATUSES.includes(b.status);

  // Realtime room for this booking; events invalidate ['booking', id].
  useEffect(() => {
    if (!id) return;
    joinBookingRoom(id);
    return () => leaveBookingRoom(id);
  }, [id]);

  // Reconciliation poll in case socket events are missed.
  const tracking = useQuery({
    queryKey: ['booking', id, 'tracking'],
    queryFn: () => api.get<Tracking>(`/bookings/${id}/tracking`),
    enabled: !!id && active,
    refetchInterval: 20_000,
  });
  useEffect(() => {
    if (tracking.data && b && (tracking.data.status !== b.status || tracking.data.etaAt !== b.etaAt)) qc.invalidateQueries({ queryKey: ['booking', id], exact: true });
  }, [tracking.data, b, qc, id]);

  const driverLocation = tracking.data?.driverLocation ?? b?.driverLocation ?? null;

  const markers = useMemo<MapMarker[]>(() => {
    if (!b) return [];
    const m: MapMarker[] = [];
    if (b.pickup) m.push({ id: 'pickup', lat: b.pickup.lat, lng: b.pickup.lng, kind: 'pickup', popup: `Pickup: ${placeLabel(b.pickup)}` });
    if (b.dropoff) m.push({ id: 'dropoff', lat: b.dropoff.lat, lng: b.dropoff.lng, kind: 'dropoff', popup: `Destination: ${placeLabel(b.dropoff)}` });
    if (driverLocation) m.push({ id: 'driver', lat: driverLocation.lat, lng: driverLocation.lng, kind: 'driver', popup: `${b.driver?.name ?? 'Driver'} · updated ${relative(driverLocation.at)}` });
    return m;
  }, [b, driverLocation]);

  const previewM = useMutation({
    mutationFn: () => api.get<CancelPreview>(`/bookings/${id}/cancellation`),
    onSuccess: (p) => {
      setCancelPreview(p);
      setCancelOpen(true);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const cancelM = useMutation({
    mutationFn: (reason: string) => api.post<{ fee: number; booking: Booking }>(`/bookings/${id}/cancel`, { reason, acceptFee: (cancelPreview?.fee ?? 0) > 0 ? true : undefined }),
    onSuccess: (r) => {
      setCancelOpen(false);
      qc.setQueryData(['booking', id], r.booking);
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast(r.fee > 0 ? `Booking cancelled. A cancellation invoice of ${inr(r.fee)} has been issued.` : 'Booking cancelled. No fee was charged.');
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.details as { code?: string } | undefined)?.code === 'CANCELLATION_FEE_REQUIRED') {
        const d = e.details as { fee: number; stage: CancelPreview['stage']; policy: CancelPreview['policy'] };
        setCancelPreview((p) => ({ status: p?.status ?? b!.status, fee: d.fee, stage: d.stage, policy: d.policy }));
        toast('The job progressed and a cancellation fee now applies. Please review it.', 'warning');
      } else {
        toast(errorMessage(e), 'error');
        setCancelOpen(false);
      }
      qc.invalidateQueries({ queryKey: ['booking', id] });
    },
  });
  const disputeM = useMutation({
    mutationFn: (reason: string) => api.post<{ id: string; number: string }>(`/bookings/${id}/dispute`, { reason }),
    onSuccess: (t) => {
      setDisputeOpen(false);
      setDisputeTicket(t);
      qc.invalidateQueries({ queryKey: ['booking', id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  async function downloadCustody() {
    setDownloading(true);
    try {
      await api.download(`/bookings/${id}/custody-report`, `custody-${b?.code ?? id}.pdf`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setDownloading(false);
    }
  }

  if (q.isLoading) return <LoadingBlock rows={6} height={80} />;
  if (q.error) {
    if (q.error instanceof ApiError && q.error.status === 404)
      return (
        <EmptyState
          title="Booking not found"
          body="It may have been removed, or it belongs to a different account."
          action={
            <Button component={RouterLink} to="/app/bookings" variant="contained">
              My bookings
            </Button>
          }
        />
      );
    return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load this booking" />;
  }
  if (!b) return null;

  const banner = statusBanner(b);
  const towing = b.serviceCategory.kind === 'TOWING';
  const approved = b.quotes?.find((x) => x.id === b.approvedQuoteId) ?? null;
  const pendingRevision = b.quotes?.find((x) => x.id === b.pendingQuoteId && x.kind === 'REVISION') ?? null;
  const searching = SEARCHING_STATUSES.includes(b.status);
  const showCodes = !!(b.pickupOtp || b.handoverOtp) && !['REQUESTED', 'QUOTED'].includes(b.status);
  const lead = b.team?.find((t) => t.role === 'TEAM_LEADER');
  const canRate = ['COMPLETED', 'DELIVERED', 'DISPUTED'].includes(b.status) && (!!lead || (b.ratings?.length ?? 0) > 0);
  const canDispute = ['COMPLETED', 'DELIVERED'].includes(b.status);
  const hasCustodyData = (b.custody?.length ?? 0) > 0 || (b.conditionReports?.length ?? 0) > 0;
  const a = b.assessment;

  return (
    <Box>
      <PageHeader
        back={<BackLink to="/app/bookings" label="My bookings" />}
        title={b.serviceCategory.name}
        subtitle={
          <>
            {b.code} · {b.type === 'SCHEDULED' && b.scheduledFor ? `Scheduled for ${dateTime(b.scheduledFor)}` : `Requested ${dateTime(b.createdAt)}`}
          </>
        }
        actions={<StatusChip status={b.status} size="medium" />}
      />

      <Stack spacing={2}>
        {justConfirmed && (
          <Alert severity="success" onClose={() => setJustConfirmed(false)}>
            <AlertTitle>Booking confirmed</AlertTitle>
            We'll keep this page updated live and notify you at every step.
          </Alert>
        )}
        {disputeTicket && (
          <Alert
            severity="success"
            action={
              <Button color="inherit" component={RouterLink} to={`/app/support/${disputeTicket.id}`}>
                Open
              </Button>
            }
          >
            Dispute raised. Support ticket {disputeTicket.number} has been created.
          </Alert>
        )}
        {banner && (
          <Alert severity={banner.severity} icon={searching ? <CircularProgress size={20} /> : undefined} role="status">
            <AlertTitle>{banner.title}</AlertTitle>
            {banner.body}
          </Alert>
        )}

        {pendingRevision && <RevisionCard booking={b} quote={pendingRevision} toast={toast} />}

        {b.status === 'QUOTED' && (
          <QuoteConfirmPanel
            booking={b}
            onUpdated={(nb) => qc.setQueryData(['booking', id], nb)}
            onConfirmed={(nb) => {
              qc.setQueryData(['booking', id], nb);
              qc.invalidateQueries({ queryKey: ['bookings'] });
              setJustConfirmed(true);
            }}
          />
        )}

        {b.pickup && (
          <Box>
            <MapView markers={markers} height={280} ariaLabel="Map showing pickup, destination and driver location" />
            {driverLocation ? (
              <Typography variant="caption" color="text.secondary">
                Driver location updated {relative(driverLocation.at)} ({time(driverLocation.at)}).
              </Typography>
            ) : (
              LIVE_STATUSES.includes(b.status) && (
                <Typography variant="caption" color="text.secondary">
                  The driver's live location will appear once their device shares it.
                </Typography>
              )
            )}
          </Box>
        )}

        {b.driver && LIVE_STATUSES.concat(['CUSTOMER_UNAVAILABLE', 'SAFETY_HOLD']).includes(b.status) && <DriverCard booking={b} toast={toast} />}

        {showCodes && <CodesCard booking={b} />}

        {b.invoice && (
          <SectionCard
            title="Invoice"
            action={
              <Button component={RouterLink} to={`/app/billing/${b.invoice.id}`} variant={b.invoice.outstanding > 0 ? 'contained' : 'outlined'} startIcon={<ReceiptLongOutlinedIcon />}>
                {b.invoice.outstanding > 0 ? 'View & pay' : 'View'}
              </Button>
            }
          >
            <KeyValue label="Invoice" value={b.invoice.number} />
            <KeyValue label="Total" value={<Money value={b.invoice.total} strong />} />
            <KeyValue label="Paid" value={<Money value={b.invoice.amountPaid} />} />
            {b.invoice.amountPendingCash > 0 && <KeyValue label="Cash awaiting confirmation" value={<Money value={b.invoice.amountPendingCash} />} />}
            <KeyValue label="Outstanding" value={<Money value={b.invoice.outstanding} strong />} />
            <KeyValue label="Status" value={<PaymentChip status={b.invoice.paymentStatus} />} />
          </SectionCard>
        )}

        {canRate && (
          <Box>
            {lead && !b.ratings?.length && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                Your crew lead was {lead.name}.
              </Typography>
            )}
            <RatingCard booking={b} toast={toast} />
          </Box>
        )}

        <SectionCard title="Progress">
          <BookingTimeline history={b.statusHistory ?? []} current={b.status} onsite={!towing} />
        </SectionCard>

        {active && b.status !== 'QUOTED' && b.status !== 'REQUESTED' && <ShareCard booking={b} toast={toast} />}

        <SectionCard title="Booking details">
          {b.vehicle && <KeyValue label="Vehicle" value={`${b.vehicle.registrationNumber} · ${b.vehicle.make} ${b.vehicle.model} (${VEHICLE_CLASS_LABELS[b.vehicle.vehicleClass] ?? b.vehicle.vehicleClass})`} />}
          {b.pickup && (
            <KeyValue
              label="Pickup"
              value={
                <>
                  {placeLabel(b.pickup)}
                  {b.pickup.landmark && b.pickup.address && <Box sx={{ color: 'text.secondary' }}>Near {b.pickup.landmark}</Box>}
                  {[b.pickup.highway, b.pickup.kmMarker && `KM ${b.pickup.kmMarker}`, b.pickup.gateNumber && `Gate ${b.pickup.gateNumber}`, b.pickup.floor && `Floor ${b.pickup.floor}`, b.pickup.parkingLevel && `Level ${b.pickup.parkingLevel}`].filter(Boolean).length > 0 && (
                    <Box sx={{ color: 'text.secondary' }}>{[b.pickup.highway, b.pickup.kmMarker && `KM ${b.pickup.kmMarker}`, b.pickup.gateNumber && `Gate ${b.pickup.gateNumber}`, b.pickup.floor && `Floor ${b.pickup.floor}`, b.pickup.parkingLevel && `Level ${b.pickup.parkingLevel}`].filter(Boolean).join(' · ')}</Box>
                  )}
                </>
              }
            />
          )}
          {b.dropoff && (
            <KeyValue
              label="Destination"
              value={
                <>
                  {placeLabel(b.dropoff)}
                  {b.dropoff.destinationType && <Box sx={{ color: 'text.secondary' }}>{DESTINATION_LABELS[b.dropoff.destinationType]}</Box>}
                </>
              }
            />
          )}
          {b.towDistanceKm != null && <KeyValue label="Towing distance" value={`${b.towDistanceKm.toFixed(1)} km${b.distanceSource === 'estimate' ? ' (estimated)' : ''}`} />}
          {a && <KeyValue label="Problem" value={BREAKDOWN_LABELS[a.breakdownType] ?? humanize(a.breakdownType)} />}
          {a && (
            <KeyValue
              label="Condition reported"
              value={
                TRI_QUESTIONS.filter((tq) => a[tq.key] !== 'NOT_SURE')
                  .map((tq) => `${tq.label.replace(/\?$/, '')}: ${TRI_LABELS[a[tq.key]]}`)
                  .join(' · ') || 'Not sure (crew will inspect)'
              }
            />
          )}
          {a && a.accessRestriction !== 'NONE' && <KeyValue label="Access" value={ACCESS_LABELS[a.accessRestriction] ?? humanize(a.accessRestriction)} />}
          {b.safetyFlags.length > 0 && (
            <KeyValue
              label="Safety notes"
              value={
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap justifyContent="flex-end">
                  {b.safetyFlags.map((f) => (
                    <Chip key={f} size="small" color="warning" variant="outlined" label={flagLabel(f)} />
                  ))}
                </Stack>
              }
            />
          )}
          {b.contactName && <KeyValue label="Contact" value={`${b.contactName}${b.contactPhone ? ` · ${b.contactPhone}` : ''}`} />}
          {b.instructions && <KeyValue label="Instructions" value={b.instructions} />}
          {(b.waitingMinutes ?? 0) > 0 && <KeyValue label="Waiting time" value={`${b.waitingMinutes} min`} />}
        </SectionCard>

        {approved && (
          <Accordion disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" justifyContent="space-between" sx={{ width: '100%', pr: 1 }}>
                <Typography variant="h5" component="h2">
                  Approved quote
                </Typography>
                <Money value={approved.total} strong />
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <QuoteBreakdown quote={approved} />
            </AccordionDetails>
          </Accordion>
        )}

        <EvidenceCard booking={b} closed={CLOSED_STATUSES.includes(b.status)} toast={toast} />

        {/* Actions */}
        <SectionCard title="Actions">
          <Stack spacing={1}>
            {b.cancellable && (
              <Button variant="outlined" color="error" size="large" startIcon={previewM.isPending ? <CircularProgress size={18} /> : <CancelOutlinedIcon />} onClick={() => previewM.mutate()} disabled={previewM.isPending || !online}>
                Cancel booking
              </Button>
            )}
            {canDispute && (
              <Button variant="outlined" startIcon={<ReportProblemOutlinedIcon />} onClick={() => setDisputeOpen(true)} disabled={!online}>
                Report a problem with this job
              </Button>
            )}
            {hasCustodyData && (
              <Button variant="outlined" startIcon={downloading ? <CircularProgress size={18} /> : <DownloadIcon />} onClick={downloadCustody} disabled={downloading}>
                Download custody report (PDF)
              </Button>
            )}
            {CLOSED_STATUSES.concat(['DELIVERED', 'DISPUTED']).includes(b.status) && b.vehicle && (
              <Button variant="contained" startIcon={<ReplayIcon />} onClick={() => nav(`/app/request?repeat=${b.id}`)}>
                Book again
              </Button>
            )}
            <Button component={RouterLink} to={`/app/support?bookingId=${b.id}`}>
              Get help with this booking
            </Button>
          </Stack>
          {!online && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Some actions are unavailable while you're offline.
            </Typography>
          )}
        </SectionCard>
      </Stack>

      <ReasonDialog
        open={cancelOpen}
        title="Cancel this booking?"
        label="Why are you cancelling?"
        minLength={3}
        confirmLabel={cancelPreview && cancelPreview.fee > 0 ? `Cancel and pay ${inr(cancelPreview.fee)}` : 'Cancel booking'}
        danger
        loading={cancelM.isPending}
        onClose={() => setCancelOpen(false)}
        onConfirm={(r) => cancelM.mutate(r)}
      >
        {cancelPreview && (
          <Box sx={{ mb: 1 }}>
            {cancelPreview.fee > 0 ? (
              <Alert severity="warning">
                <AlertTitle>A cancellation fee of {inr(cancelPreview.fee)} applies</AlertTitle>
                {cancelPreview.stage === 'ARRIVED' ? 'The driver has already reached you.' : 'A driver has already accepted and is on the way.'} An invoice for the fee will be issued.
              </Alert>
            ) : (
              <Alert severity="success">Free cancellation at this stage — no fee will be charged.</Alert>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Policy: {cancelPreview.policy.description}
            </Typography>
            <Divider sx={{ mt: 1.5 }} />
          </Box>
        )}
      </ReasonDialog>
      <ReasonDialog
        open={disputeOpen}
        title="Report a problem"
        body="Tell us what went wrong (damage, overcharging, conduct, delays). This opens a dispute and a priority support ticket. Please describe it in at least 10 characters."
        label="What happened?"
        minLength={10}
        confirmLabel="Raise dispute"
        loading={disputeM.isPending}
        onClose={() => setDisputeOpen(false)}
        onConfirm={(r) => disputeM.mutate(r)}
      />
      {toastNode}
    </Box>
  );
}
