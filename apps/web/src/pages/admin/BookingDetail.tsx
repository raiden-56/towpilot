import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import { api } from '@/api/client';
import type { Location, Quote } from '@/api/types';
import { BookingTimeline } from '@/components/BookingTimeline';
import { ErrorState, KeyValue, LoadingBlock, Money, PageHeader, PaymentChip, SectionCard, StatusChip } from '@/components/common';
import { MapView, type MapMarker } from '@/components/MapView';
import { QuoteBreakdown } from '@/components/QuoteBreakdown';
import { useAuth } from '@/hooks/useAuth';
import { dateTime, humanize, inr, relative, STATUS_LABELS, VEHICLE_CLASS_LABELS } from '@/lib/format';
import { AssignmentsTable, BookingActions, ProviderStatus, TeamManager } from './ops/BookingActions';
import { RecommendationSummary, useStaffBooking } from './ops/BookingPanel';
import { BackLink, ESCALATION_COLOR, FlagChips, PriorityChip, ReasonDialog, useNotice, type Notify } from './ops/shared';
import type { StaffBooking } from './ops/types';

const QUOTE_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  APPROVED: 'success',
  PENDING_CUSTOMER_APPROVAL: 'warning',
  PENDING_INTERNAL_APPROVAL: 'warning',
  REJECTED: 'error',
  EXPIRED: 'default',
  SUPERSEDED: 'default',
};

function LocationBlock({ title, l }: { title: string; l: Location }) {
  const details: [string, string | null | undefined][] = [
    ['Landmark', l.landmark],
    ['Highway', [l.highway, l.roadDirection, l.kmMarker && `km ${l.kmMarker}`].filter(Boolean).join(' · ') || null],
    ['Gate', l.gateNumber],
    ['Floor / parking', [l.floor, l.parkingLevel].filter(Boolean).join(' · ') || null],
    ['Access notes', l.accessNotes],
    ['Destination type', l.destinationType ? humanize(l.destinationType) : null],
  ];
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      <Typography sx={{ fontWeight: 600 }}>{l.placeName ?? l.address ?? `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`}</Typography>
      {l.placeName && l.address && (
        <Typography variant="body2" color="text.secondary">
          {l.address}
        </Typography>
      )}
      {details
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <KeyValue key={k} label={k} value={v} />
        ))}
      <Typography variant="caption" color="text.secondary">
        {humanize(l.source)}
        {l.accuracyM != null && ` · ±${Math.round(l.accuracyM)} m`}
        {l.capturedAt && ` · captured ${dateTime(l.capturedAt)}`}
        {l.isSafeLocation === false && ' · customer reported an UNSAFE location'}
      </Typography>
    </Box>
  );
}

function QuotesSection({ booking, notify }: { booking: StaffBooking; notify: Notify }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [decision, setDecision] = useState<{ quote: Quote; approve: boolean } | null>(null);
  const m = useMutation({
    mutationFn: (v: { id: string; approve: boolean; note: string }) => api.post<{ status: string }>(`/dispatch/quotes/${v.id}/internal-decision`, { approve: v.approve, note: v.note }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['booking', booking.id] });
      setDecision(null);
      notify(r.status === 'PENDING_CUSTOMER_APPROVAL' ? 'Approved internally — now awaiting customer approval' : r.status === 'APPROVED' ? 'Revision approved' : 'Revision rejected');
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  const quotes = booking.quotes ?? [];
  if (!quotes.length) return <Typography color="text.secondary">No quotes yet.</Typography>;
  return (
    <Box>
      {quotes.map((q, i) => {
        const prev = quotes.find((x) => x.version === q.version - 1) ?? null;
        return (
          <Accordion key={q.id} defaultExpanded={i === 0} disableGutters variant="outlined" sx={{ '&:before': { display: 'none' }, mb: 1, borderRadius: 2 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ width: '100%', pr: 1 }}>
                <Typography sx={{ fontWeight: 700 }}>v{q.version}</Typography>
                <Chip size="small" variant="outlined" label={humanize(q.kind)} />
                <Chip size="small" color={QUOTE_COLOR[q.status] ?? 'default'} label={humanize(q.status)} />
                <Box sx={{ flex: 1 }} />
                <Money value={q.total} strong />
                <Typography variant="caption" color="text.secondary">
                  {dateTime(q.createdAt)}
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              {q.reason && (
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  Revision reason: {q.reason}
                </Alert>
              )}
              <QuoteBreakdown quote={q} compareTo={q.kind === 'REVISION' ? prev : null} />
              {q.status === 'PENDING_INTERNAL_APPROVAL' &&
                (can('pricing:approve_override') ? (
                  <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                    <Button variant="contained" onClick={() => setDecision({ quote: q, approve: true })}>
                      Approve price override…
                    </Button>
                    <Button variant="outlined" color="error" onClick={() => setDecision({ quote: q, approve: false })}>
                      Reject…
                    </Button>
                  </Stack>
                ) : (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    This revision needs internal approval by someone with price-override permission.
                  </Alert>
                ))}
            </AccordionDetails>
          </Accordion>
        );
      })}
      <ReasonDialog
        open={!!decision}
        title={decision?.approve ? `Approve v${decision.quote.version} (${inr(decision.quote.total)})?` : `Reject v${decision?.quote.version}?`}
        body={decision?.approve ? 'If the revision increases the price, the customer must still approve it before it applies.' : 'The field team is notified that the revision was rejected.'}
        label="Decision note"
        loading={m.isPending}
        danger={!decision?.approve}
        confirmLabel={decision?.approve ? 'Approve' : 'Reject'}
        onClose={() => setDecision(null)}
        onConfirm={(note) => decision && m.mutate({ id: decision.quote.id, approve: decision.approve, note })}
      />
    </Box>
  );
}

function EscalationsSection({ booking, notify }: { booking: StaffBooking; notify: Notify }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: { kind: 'escalations' | 'incidents'; id: string; action: 'ack' | 'resolve'; resolution?: string }) => api.post(`/dispatch/${v.kind}/${v.id}/${v.action}`, v.resolution ? { resolution: v.resolution } : {}),
    onSuccess: (_, v) => {
      void qc.invalidateQueries({ queryKey: ['booking', booking.id] });
      void qc.invalidateQueries({ queryKey: ['dispatch'] });
      setResolving(null);
      notify(`${v.kind === 'incidents' ? 'Incident' : 'Escalation'} ${v.action === 'ack' ? 'acknowledged' : 'resolved'}`);
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  const [resolving, setResolving] = useState<{ kind: 'escalations' | 'incidents'; id: string } | null>(null);
  const esc = booking.escalations ?? [];
  const inc = booking.incidents ?? [];
  const canEsc = can('dispatch:manage') || can('incident:manage');
  const canInc = can('incident:manage');
  if (!esc.length && !inc.length) return <Typography variant="body2" color="text.secondary">No escalations or incidents on this booking.</Typography>;
  const row = (kind: 'escalations' | 'incidents', id: string, title: string, status: string, text: string, createdAt: string, allowed: boolean, extra?: React.ReactNode) => (
    <Box key={id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.25 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Chip size="small" color={ESCALATION_COLOR(status)} label={humanize(status)} />
        {extra}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {dateTime(createdAt)}
      </Typography>
      {allowed && status !== 'RESOLVED' && (
        <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
          {status === 'OPEN' && (
            <Button size="small" disabled={m.isPending} onClick={() => m.mutate({ kind, id, action: 'ack' })}>
              Acknowledge
            </Button>
          )}
          <Button size="small" variant="outlined" disabled={m.isPending} onClick={() => setResolving({ kind, id })}>
            Resolve
          </Button>
        </Stack>
      )}
    </Box>
  );
  return (
    <Stack spacing={1}>
      {inc.map((i) => row('incidents', i.id, `Incident: ${humanize(i.type)}`, i.status, i.resolution ? `${i.description} — Resolution: ${i.resolution}` : i.description, i.createdAt, canInc, <PriorityChip priority={i.severity} />))}
      {esc.map((e) => row('escalations', e.id, humanize(e.type), e.status, e.resolution ? `${e.detail} — Resolution: ${e.resolution}` : e.detail, e.createdAt, canEsc))}
      <ReasonDialog
        open={!!resolving}
        title={resolving?.kind === 'incidents' ? 'Resolve incident' : 'Resolve escalation'}
        label={resolving?.kind === 'incidents' ? 'Resolution' : 'Resolution note'}
        optional={resolving?.kind === 'escalations'}
        maxLength={2000}
        loading={m.isPending}
        confirmLabel="Resolve"
        onClose={() => setResolving(null)}
        onConfirm={(r) => resolving && m.mutate({ ...resolving, action: 'resolve', resolution: r || undefined })}
      />
    </Stack>
  );
}

export default function BookingDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { notify, fail, node } = useNotice();
  const q = useStaffBooking(id);
  const [downloading, setDownloading] = useState(false);
  const b = q.data;

  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.error || !b)
    return (
      <Box>
        <BackLink to="/admin/bookings" label="Bookings" />
        <ErrorState error={q.error ?? new Error('Booking not found')} onRetry={() => void q.refetch()} title="Could not load this booking" />
      </Box>
    );

  const markers: MapMarker[] = [];
  if (b.pickup) markers.push({ id: 'pickup', kind: 'pickup', lat: b.pickup.lat, lng: b.pickup.lng, popup: <>Pickup: {b.pickup.address ?? b.pickup.landmark ?? ''}</> });
  if (b.dropoff) markers.push({ id: 'dropoff', kind: 'dropoff', lat: b.dropoff.lat, lng: b.dropoff.lng, popup: <>Drop-off: {b.dropoff.placeName ?? b.dropoff.address ?? ''}</> });
  if (b.driverLocation) markers.push({ id: 'driver', kind: 'driver', lat: b.driverLocation.lat, lng: b.driverLocation.lng, popup: <>Driver · {relative(b.driverLocation.at)}</> });
  const atts = b.attachments ?? [];
  const attById = new Map(atts.map((a) => [a.id, a]));
  const a = b.assessment;

  const downloadCustody = async () => {
    setDownloading(true);
    try {
      await api.download(`/bookings/${b.id}/custody-report`, `custody-${b.code}.pdf`);
    } catch (e) {
      fail(e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Box>
      <BackLink to="/admin/bookings" label="Bookings" />
      <PageHeader
        title={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap component="span">
            <span>{b.code}</span>
            <StatusChip status={b.status} size="medium" />
            <PriorityChip priority={b.priority} hideNormal />
            {b.type === 'SCHEDULED' && <Chip label={`Scheduled ${dateTime(b.scheduledFor)}`} />}
          </Stack>
        }
        subtitle={
          <>
            {b.serviceCategory.name} · created {dateTime(b.createdAt)} ({relative(b.createdAt)}) · {b.zone?.name ?? 'outside service zones'}
            {b.completedAt && ` · completed ${dateTime(b.completedAt)}`}
          </>
        }
        actions={
          <>
            {can('dispatch:manage') && (
              <Button component={RouterLink} to={`/admin/dispatch?booking=${b.id}`} startIcon={<MapOutlinedIcon />} variant="outlined">
                Open in dispatch
              </Button>
            )}
            <Button startIcon={<PictureAsPdfOutlinedIcon />} variant="outlined" disabled={downloading} onClick={() => void downloadCustody()}>
              {downloading ? 'Preparing…' : 'Custody report'}
            </Button>
          </>
        }
      />
      <Stack spacing={1} sx={{ mb: 2 }}>
        {b.safetyFlags.length > 0 && (
          <Alert severity="warning" icon={false}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <strong>Safety flags:</strong> <FlagChips flags={b.safetyFlags} max={10} />
            </Stack>
          </Alert>
        )}
        {b.status === 'CANCELLED' && (
          <Alert severity="info">
            Cancelled{b.cancellationReason ? `: ${b.cancellationReason}` : ''}. Cancellation fee: {inr(b.cancellationFee ?? 0)}.
          </Alert>
        )}
        {b.failureReason && <Alert severity="error">Failed: {b.failureReason}</Alert>}
        {b.status === 'SAFETY_HOLD' && <Alert severity="error">This job is on safety hold. Field work is paused until operations resumes it.</Alert>}
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack spacing={2}>
            <SectionCard title="Locations">
              {markers.length > 0 && <MapView markers={markers} height={300} ariaLabel="Booking locations" />}
              <Grid container spacing={2} sx={{ mt: 1 }}>
                {b.pickup && (
                  <Grid size={{ xs: 12, sm: b.dropoff ? 6 : 12 }}>
                    <LocationBlock title="Pickup" l={b.pickup} />
                  </Grid>
                )}
                {b.dropoff && (
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <LocationBlock title="Drop-off" l={b.dropoff} />
                  </Grid>
                )}
              </Grid>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Tow distance: {b.towDistanceKm != null ? `${b.towDistanceKm} km` : '—'} · provider distance at booking: {b.pickupDistanceKm != null ? `${b.pickupDistanceKm} km` : '—'}
                {b.distanceSource && ` (${humanize(b.distanceSource).toLowerCase()})`}
                {b.driverLocation && ` · driver location ${relative(b.driverLocation.at)}`}
              </Typography>
            </SectionCard>

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, lg: 6 }}>
                <SectionCard title="Vehicle & assessment" sx={{ height: '100%' }}>
                  {b.vehicle && <KeyValue label="Vehicle" value={`${b.vehicle.registrationNumber} · ${b.vehicle.make} ${b.vehicle.model}`} />}
                  {b.vehicle && <KeyValue label="Class / fuel" value={`${VEHICLE_CLASS_LABELS[b.vehicle.vehicleClass] ?? b.vehicle.vehicleClass} · ${humanize(b.vehicle.fuelType)}`} />}
                  {a ? (
                    <>
                      <KeyValue label="Problem" value={humanize(a.breakdownType)} />
                      <KeyValue label="Engine starts / wheels rotate" value={`${humanize(a.engineStarts)} / ${humanize(a.wheelsRotate)}`} />
                      <KeyValue label="Steering / brakes" value={`${humanize(a.steeringWorks)} / ${humanize(a.brakesWork)}`} />
                      <KeyValue label="Stuck / overturned / submerged" value={`${humanize(a.isStuck)} / ${humanize(a.isOverturned)} / ${humanize(a.isSubmerged)}`} />
                      <KeyValue label="Blocking traffic / major damage" value={`${humanize(a.blockingTraffic)} / ${humanize(a.majorDamage)}`} />
                      <KeyValue label="EV / hybrid" value={a.isEvOrHybrid ? 'Yes' : 'No'} />
                      <KeyValue label="Access" value={humanize(a.accessRestriction)} />
                      <KeyValue
                        label="People on site"
                        value={[a.hasChildren && 'children', a.hasElderly && 'elderly', a.needsAccessibility && 'accessibility needs', a.passengersNeedingTransport > 0 && `${a.passengersNeedingTransport} need transport`].filter(Boolean).join(', ') || 'No special needs'}
                      />
                      {a.notes && (
                        <Typography variant="body2" sx={{ mt: 1 }}>
                          Notes: {a.notes}
                        </Typography>
                      )}
                    </>
                  ) : (
                    <Typography color="text.secondary">No assessment recorded.</Typography>
                  )}
                </SectionCard>
              </Grid>
              <Grid size={{ xs: 12, lg: 6 }}>
                <SectionCard title="Recommendation & safety review" sx={{ height: '100%' }}>
                  <RecommendationSummary booking={b} />
                </SectionCard>
              </Grid>
            </Grid>

            <SectionCard title={`Quotes (${(b.quotes ?? []).length})`}>
              <QuotesSection booking={b} notify={notify} />
            </SectionCard>

            <SectionCard title="Dispatch offers & assignments">
              <AssignmentsTable assignments={b.assignments ?? []} />
            </SectionCard>

            <SectionCard title="Status history">
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>When</TableCell>
                      <TableCell>Change</TableCell>
                      <TableCell>Actor</TableCell>
                      <TableCell>Reason</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(b.statusHistory ?? []).map((h) => (
                      <TableRow key={h.id}>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{dateTime(h.createdAt)}</TableCell>
                        <TableCell>
                          {h.fromStatus === h.toStatus ? (
                            <>Override in {STATUS_LABELS[h.toStatus]}</>
                          ) : (
                            <>
                              {h.fromStatus ? STATUS_LABELS[h.fromStatus] : 'Created'} → <strong>{STATUS_LABELS[h.toStatus]}</strong>
                            </>
                          )}
                          {h.isOverride && <Chip size="small" color="warning" label="Override" sx={{ ml: 1 }} />}
                        </TableCell>
                        <TableCell>{humanize(h.actorRole)}</TableCell>
                        <TableCell>{h.reason ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </SectionCard>

            <SectionCard title={`Evidence (${atts.length})`}>
              {!atts.length ? (
                <Typography color="text.secondary">No photos, videos or receipts uploaded.</Typography>
              ) : (
                <Grid container spacing={1.5}>
                  {atts.map((x) => (
                    <Grid key={x.id} size={{ xs: 6, sm: 4, lg: 3 }}>
                      <Box component="a" href={x.url} target="_blank" rel="noreferrer" sx={{ display: 'block', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', textDecoration: 'none', color: 'inherit' }}>
                        {x.mimeType.startsWith('image/') ? (
                          <Box component="img" src={x.url} alt={x.caption ?? humanize(x.kind)} loading="lazy" sx={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <Box sx={{ height: 120, display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}>
                            <Typography variant="caption">{x.mimeType.startsWith('video/') ? 'Video' : 'Document'} — open</Typography>
                          </Box>
                        )}
                        <Box sx={{ p: 0.75 }}>
                          <Typography variant="caption" sx={{ fontWeight: 600 }} display="block">
                            {humanize(x.kind)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {dateTime(x.createdAt)}
                          </Typography>
                        </Box>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              )}
            </SectionCard>

            <SectionCard title="Condition reports & custody">
              {!(b.conditionReports ?? []).length ? (
                <Typography color="text.secondary" variant="body2">
                  No condition reports recorded.
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {(b.conditionReports ?? []).map((r) => (
                    <Box key={r.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                      <Typography sx={{ fontWeight: 700 }}>
                        {humanize(r.stage)} report · {dateTime(r.createdAt)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Odometer {r.odometerKm != null ? `${r.odometerKm} km` : '—'} · fuel {r.fuelLevel ? humanize(r.fuelLevel) : '—'}
                      </Typography>
                      {r.notes && <Typography variant="body2">{r.notes}</Typography>}
                      {r.damageMarks.length > 0 && (
                        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                          {r.damageMarks.map((d, i) => (
                            <Typography component="li" variant="body2" key={i}>
                              {d.area}: {d.description}
                            </Typography>
                          ))}
                        </Box>
                      )}
                      {r.attachmentIds.length > 0 && (
                        <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                          {r.attachmentIds.map((aid) => {
                            const x = attById.get(aid);
                            if (!x) return null;
                            return x.mimeType.startsWith('image/') ? (
                              <Box key={aid} component="a" href={x.url} target="_blank" rel="noreferrer">
                                <Box component="img" src={x.url} alt={humanize(x.kind)} loading="lazy" sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1, border: 1, borderColor: 'divider' }} />
                              </Box>
                            ) : (
                              <Link key={aid} href={x.url} target="_blank" rel="noreferrer" variant="caption">
                                {humanize(x.kind)}
                              </Link>
                            );
                          })}
                        </Stack>
                      )}
                    </Box>
                  ))}
                </Stack>
              )}
              <Typography variant="h6" sx={{ mt: 2, mb: 0.5 }}>
                Custody confirmations
              </Typography>
              {!(b.custody ?? []).length ? (
                <Typography color="text.secondary" variant="body2">
                  No custody confirmations yet.
                </Typography>
              ) : (
                (b.custody ?? []).map((c) => (
                  <KeyValue
                    key={c.stage}
                    label={`${humanize(c.stage)} · ${dateTime(c.createdAt)}`}
                    value={
                      <>
                        {humanize(c.method)}
                        {c.recipientName && ` · ${c.recipientName}${c.recipientRelation ? ` (${c.recipientRelation})` : ''}`}
                        {c.overrideReason && (
                          <Typography variant="caption" color="warning.main" display="block">
                            Override: {c.overrideReason}
                          </Typography>
                        )}
                      </>
                    }
                  />
                ))
              )}
              {b.pickupVerifiedAt && (
                <Typography variant="caption" color="text.secondary">
                  Pickup verified {dateTime(b.pickupVerifiedAt)} · waiting {b.waitingMinutes ?? 0} min
                </Typography>
              )}
            </SectionCard>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={2}>
            <SectionCard title="Provider & actions">
              <Stack spacing={1.5}>
                <ProviderStatus booking={b} />
                <BookingActions booking={b} notify={notify} allowCancel />
              </Stack>
            </SectionCard>
            <SectionCard title="Customer & contact">
              <KeyValue
                label="Account"
                value={
                  b.customer ? (
                    can('customer:read') ? (
                      <Link component={RouterLink} to={`/admin/customers/${b.customer.id}`}>
                        {b.customer.fullName}
                      </Link>
                    ) : (
                      b.customer.fullName
                    )
                  ) : (
                    '—'
                  )
                }
              />
              {b.customer?.phone && <KeyValue label="Account phone" value={<Link href={`tel:${b.customer.phone}`}>{b.customer.phone}</Link>} />}
              <KeyValue label="On-site contact" value={b.contactName ?? '—'} />
              {b.contactPhone && <KeyValue label="Contact phone" value={<Link href={`tel:${b.contactPhone}`}>{b.contactPhone}</Link>} />}
              {b.instructions && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  {b.instructions}
                </Alert>
              )}
            </SectionCard>
            <SectionCard title="Field team">
              <TeamManager booking={b} notify={notify} />
            </SectionCard>
            <SectionCard
              title="Invoice"
              action={
                b.invoice &&
                can('finance:read') && (
                  <Button size="small" component={RouterLink} to={`/admin/finance/invoices/${b.invoice.id}`}>
                    Open
                  </Button>
                )
              }
            >
              {b.invoice ? (
                <>
                  <KeyValue label="Number" value={b.invoice.number} />
                  <KeyValue label="Total" value={<Money value={b.invoice.total} strong />} />
                  <KeyValue label="Paid" value={<Money value={b.invoice.amountPaid} />} />
                  {b.invoice.amountPendingCash > 0 && <KeyValue label="Cash pending confirmation" value={<Money value={b.invoice.amountPendingCash} />} />}
                  <KeyValue label="Outstanding" value={<Money value={b.invoice.outstanding} negative={b.invoice.outstanding > 0} />} />
                  <KeyValue label="Payment" value={<PaymentChip status={b.invoice.paymentStatus} />} />
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Not invoiced yet. The invoice is issued when the field team closes the job (or on a chargeable cancellation).
                </Typography>
              )}
            </SectionCard>
            <SectionCard title="Escalations & incidents">
              <EscalationsSection booking={b} notify={notify} />
            </SectionCard>
            <SectionCard title="Progress">
              <BookingTimeline history={b.statusHistory ?? []} current={b.status} onsite={b.serviceCategory.kind === 'ONSITE'} />
            </SectionCard>
            {(b.ratings ?? []).length > 0 && (
              <SectionCard title="Customer rating">
                {(b.ratings ?? []).map((r) => (
                  <Box key={r.id}>
                    <Typography sx={{ fontWeight: 700 }}>{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)} ({r.score}/5)</Typography>
                    {r.comment && <Typography variant="body2">{r.comment}</Typography>}
                  </Box>
                ))}
              </SectionCard>
            )}
          </Stack>
        </Grid>
      </Grid>
      {node}
    </Box>
  );
}
