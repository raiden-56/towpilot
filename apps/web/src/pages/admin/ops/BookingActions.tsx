import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Link,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined';
import BoltIcon from '@mui/icons-material/Bolt';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api } from '@/api/client';
import type { BookingStatus } from '@/api/types';
import { EmptyState, ErrorState, LoadingBlock, Money } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { dateTime, humanize, inr, STATUS_LABELS, time } from '@/lib/format';
import { ASSIGNMENT_COLOR, Countdown, EQUIPMENT_TYPES, FIELD_ACTIVE, HARD_BLOCK, NEEDS_PROVIDER, ReasonDialog, TRUCK_TYPES, type Notify } from './shared';
import type { Candidate, CandidatesResponse, Employee, StaffAssignment, StaffBooking } from './types';

const OPS_TRANSITION_TARGETS: BookingStatus[] = ['SAFETY_HOLD', 'FAILED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT', 'COMPLETED', 'SEARCHING_FOR_PROVIDER'];

/** The status a booking on safety hold returns to (the status it was held from). */
export function holdReturnStatus(b: StaffBooking): BookingStatus | null {
  if (b.status !== 'SAFETY_HOLD') return null;
  const h = [...(b.statusHistory ?? [])].reverse().find((x) => x.toStatus === 'SAFETY_HOLD');
  return h?.fromStatus ?? null;
}

export const reviewPending = (b: { requiresManualReview?: boolean; reviewedAt?: string | null; status: string }) => !!b.requiresManualReview && !b.reviewedAt && !['CANCELLED', 'FAILED', 'COMPLETED'].includes(b.status);

/** Shared cache update after any booking mutation that returns the booking. */
function useBookingCache(id: string) {
  const qc = useQueryClient();
  return (data?: unknown) => {
    if (data && typeof data === 'object' && 'id' in data && 'status' in data) qc.setQueryData(['booking', id], data);
    else void qc.invalidateQueries({ queryKey: ['booking', id] });
    void qc.invalidateQueries({ queryKey: ['dispatch'] });
    void qc.invalidateQueries({ queryKey: ['bookings'] });
  };
}

// ─── Provider status (honest: only "accepted" when an accepted assignment exists) ───

export function ProviderStatus({ booking }: { booking: StaffBooking }) {
  const a = booking.assignments ?? [];
  const live = a.find((x) => x.status === 'ACCEPTED');
  const offered = a.find((x) => x.status === 'OFFERED');
  const done = a.find((x) => x.status === 'COMPLETED');
  if (live)
    return (
      <Alert severity="success" variant="outlined">
        <strong>{live.driver.fullName}</strong> accepted at {time(live.respondedAt)}
        {live.truck && ` · ${live.truck.registrationNumber} (${humanize(live.truck.truckType)})`}
        {live.etaMinutes != null && ` · ETA ~${live.etaMinutes} min`}
        {booking.etaAt && ` (by ${time(booking.etaAt)})`}
      </Alert>
    );
  if (offered)
    return (
      <Alert severity="warning" variant="outlined">
        Offer sent to <strong>{offered.driver.fullName}</strong> — not yet accepted. Offer expires in <Countdown to={offered.expiresAt} expiredLabel="moments (timing out)" />.
      </Alert>
    );
  if (done)
    return (
      <Alert severity="info" variant="outlined">
        Completed by <strong>{done.driver.fullName}</strong>
        {done.truck && ` · ${done.truck.registrationNumber}`}
      </Alert>
    );
  if (NEEDS_PROVIDER.includes(booking.status))
    return (
      <Alert severity="error" variant="outlined">
        No provider assigned. {a.length ? `${a.length} previous offer${a.length > 1 ? 's' : ''} (see history).` : 'No offers made yet.'}
      </Alert>
    );
  return (
    <Alert severity="info" variant="outlined">
      No provider on this booking.
    </Alert>
  );
}

// ─── Assignment history ──────────────────────────────────────────────

export function AssignmentsTable({ assignments }: { assignments: StaffAssignment[] }) {
  if (!assignments.length) return <Typography color="text.secondary" variant="body2">No offers have been made for this booking.</Typography>;
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            <TableCell>Driver</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Offered</TableCell>
            <TableCell>Responded</TableCell>
            <TableCell>Reason / notes</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {assignments.map((a) => (
            <TableRow key={a.id}>
              <TableCell>{a.attempt}</TableCell>
              <TableCell>
                <Link component={RouterLink} to={`/admin/employees/${a.driver.id}`}>
                  {a.driver.fullName}
                </Link>
                <Typography variant="caption" color="text.secondary" display="block">
                  {humanize(a.method)}
                  {a.truck ? ` · ${a.truck.registrationNumber}` : ''}
                  {a.distanceKm != null ? ` · ${a.distanceKm} km` : ''}
                  {a.etaMinutes != null ? ` · ETA ${a.etaMinutes} min` : ''}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip size="small" variant="outlined" color={ASSIGNMENT_COLOR(a.status)} label={humanize(a.status)} />
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{dateTime(a.offeredAt)}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{a.status === 'OFFERED' ? <Countdown to={a.expiresAt} expiredLabel="timing out" /> : dateTime(a.respondedAt)}</TableCell>
              <TableCell>{a.rejectionReason ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// ─── Candidates ──────────────────────────────────────────────────────

export function CandidatesPanel({ booking, notify }: { booking: StaffBooking; notify: Notify }) {
  const { can } = useAuth();
  const onBooking = useBookingCache(booking.id);
  const pendingReview = reviewPending(booking);
  const canAssign = can('dispatch:manage') && NEEDS_PROVIDER.includes(booking.status) && !pendingReview;
  const q = useQuery({
    queryKey: ['dispatch', 'candidates', booking.id, booking.status],
    queryFn: () => api.get<CandidatesResponse>(`/dispatch/bookings/${booking.id}/candidates`),
    enabled: can('dispatch:manage'),
    refetchInterval: 30_000,
  });
  const [target, setTarget] = useState<Candidate | null>(null);
  const assign = useMutation({
    mutationFn: (v: { driverUserId: string; note?: string; force?: boolean }) => api.post<StaffBooking>(`/dispatch/bookings/${booking.id}/assign`, v),
    onSuccess: (data, v) => {
      onBooking(data);
      setTarget(null);
      notify(`Offer sent to ${q.data?.candidates.find((c) => c.driverUserId === v.driverUserId)?.name ?? 'driver'}. Waiting for them to accept.`);
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });

  if (!can('dispatch:manage')) return null;
  if (q.isLoading) return <LoadingBlock rows={3} height={64} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Could not load candidates" />;
  const list = q.data?.candidates ?? [];
  const eligibleCount = list.filter((c) => c.eligible).length;
  const warnings = target ? target.reasons : [];
  const hard = warnings.filter((r) => HARD_BLOCK.test(r));

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {eligibleCount} eligible of {list.length} drivers
          {q.data?.request && ` · needs ${q.data.request.truckTypes.map(humanize).join(' / ') || 'any truck'} · within ${q.data.request.radiusKm} km`}
        </Typography>
        <Tooltip title="Refresh candidates">
          <IconButton size="small" onClick={() => void q.refetch()} aria-label="Refresh candidates">
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {pendingReview && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Complete the manual safety review before assigning a provider.
        </Alert>
      )}
      {q.data?.request.equipment.length ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Required equipment: {q.data.request.equipment.map(humanize).join(', ')}
        </Typography>
      ) : null}
      {!list.length ? (
        <EmptyState title="No drivers registered" body="Add drivers under Employees to dispatch jobs." />
      ) : (
        <Stack spacing={1}>
          {list.map((c) => {
            const hardReasons = c.reasons.filter((r) => HARD_BLOCK.test(r));
            const blocked = hardReasons.length > 0;
            return (
              <Box key={c.driverUserId} sx={{ border: 1, borderColor: c.eligible ? 'success.main' : 'divider', borderRadius: 2, p: 1.25 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ sm: 'center' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography sx={{ fontWeight: 700 }}>{c.name}</Typography>
                      <Chip size="small" color={c.eligible ? 'success' : blocked ? 'error' : 'warning'} label={c.eligible ? 'Eligible' : blocked ? 'Blocked' : 'Warnings'} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {c.truck ? `${c.truck.registrationNumber} · ${humanize(c.truck.truckType)}` : 'No truck'} · {c.distanceKm != null ? `${c.distanceKm} km` : 'distance unknown'} · ETA {c.etaMinutes != null ? `${c.etaMinutes} min` : '—'} · {c.jobsToday} jobs today · rating {c.rating != null ? c.rating.toFixed(1) : '—'}
                      {c.score && ` · score ${c.score.total.toFixed(2)}`}
                    </Typography>
                  </Box>
                  {canAssign && (
                    <Tooltip title={blocked ? `Cannot be overridden: ${hardReasons.join('; ')}` : c.eligible ? '' : 'Assigning requires confirming the warnings with a reason'}>
                      <span>
                        <Button size="small" variant={c.eligible ? 'contained' : 'outlined'} disabled={blocked || assign.isPending} onClick={() => setTarget(c)}>
                          {c.eligible ? 'Assign' : 'Assign anyway…'}
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                </Stack>
                {c.reasons.length > 0 && (
                  <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                    {c.reasons.map((r) => (
                      <Typography component="li" variant="caption" key={r} color={HARD_BLOCK.test(r) ? 'error.main' : 'warning.main'}>
                        {HARD_BLOCK.test(r) ? 'Hard block: ' : 'Warning: '}
                        {r}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
      <ReasonDialog
        open={!!target}
        title={target?.eligible ? `Offer job to ${target?.name}?` : `Override warnings for ${target?.name}?`}
        label={target?.eligible ? 'Note for the audit trail' : 'Reason for overriding the warnings'}
        optional={!!target?.eligible}
        minLength={3}
        loading={assign.isPending}
        confirmLabel={target?.eligible ? 'Send offer' : 'Override & send offer'}
        danger={!target?.eligible}
        body={
          target?.eligible ? (
            'The driver receives an offer and must accept it before the booking shows as accepted.'
          ) : (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                This driver has dispatch warnings. Overrides are logged with your reason.
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </Box>
              {hard.length > 0 && <Alert severity="error">Hard blocks cannot be overridden.</Alert>}
            </>
          )
        }
        onClose={() => setTarget(null)}
        onConfirm={(note) => target && assign.mutate({ driverUserId: target.driverUserId, note: note || undefined, force: target.eligible ? undefined : true })}
      />
    </Box>
  );
}

// ─── Team ────────────────────────────────────────────────────────────

export function TeamManager({ booking, notify }: { booking: StaffBooking; notify: Notify }) {
  const { can } = useAuth();
  const onBooking = useBookingCache(booking.id);
  const manage = can('dispatch:manage');
  const active = FIELD_ACTIVE.includes(booking.status);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const remove = useMutation({
    mutationFn: (userId: string) => api.del<StaffBooking>(`/dispatch/bookings/${booking.id}/team/${userId}`),
    onSuccess: (d) => {
      onBooking(d);
      setRemoving(null);
      notify('Team member removed and set back to available');
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  const team = booking.team ?? [];
  return (
    <Box>
      {team.length ? (
        <List dense disablePadding>
          {team.map((t) => (
            <ListItem
              key={t.userId}
              disableGutters
              secondaryAction={
                manage && t.role !== 'TEAM_LEADER' ? (
                  <Tooltip title="Remove from team">
                    <IconButton edge="end" size="small" onClick={() => setRemoving({ userId: t.userId, name: t.name })} aria-label={`Remove ${t.name}`}>
                      <PersonRemoveOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : undefined
              }
            >
              <ListItemText
                primary={
                  <Link component={RouterLink} to={`/admin/employees/${t.userId}`}>
                    {t.name}
                  </Link>
                }
                secondary={`${humanize(t.role)}${t.responsibility ? ` · ${t.responsibility}` : ''}`}
              />
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No active field team. The team forms when a driver accepts the job.
        </Typography>
      )}
      {manage && active && (
        <Button size="small" sx={{ mt: 1 }} onClick={() => setOpen(true)}>
          Add worker…
        </Button>
      )}
      <AddWorkerDialog open={open} booking={booking} onClose={() => setOpen(false)} notify={notify} />
      <ReasonDialog
        open={!!removing}
        title={`Remove ${removing?.name ?? ''} from the team?`}
        body="They will be marked available for other jobs."
        label="Note (optional)"
        optional
        loading={remove.isPending}
        confirmLabel="Remove"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.userId)}
      />
    </Box>
  );
}

function AddWorkerDialog({ open, booking, onClose, notify }: { open: boolean; booking: StaffBooking; onClose: () => void; notify: Notify }) {
  const onBooking = useBookingCache(booking.id);
  const [worker, setWorker] = useState<Employee | null>(null);
  const [role, setRole] = useState<'RECOVERY_WORKER' | 'DRIVER'>('RECOVERY_WORKER');
  const [responsibility, setResponsibility] = useState('');
  useEffect(() => {
    if (open) {
      setWorker(null);
      setRole('RECOVERY_WORKER');
      setResponsibility('');
    }
  }, [open]);
  const workers = useQuery({
    queryKey: ['admin', 'employees', 'available-workers', role],
    queryFn: () => api.page<Employee>('/admin/employees', { role: role === 'DRIVER' ? 'driver' : 'worker', availability: 'AVAILABLE', verification: 'APPROVED', status: 'ACTIVE', pageSize: 100 }),
    enabled: open,
  });
  const add = useMutation({
    mutationFn: () => api.post<StaffBooking>(`/dispatch/bookings/${booking.id}/team`, { userId: worker!.id, role, responsibility: responsibility.trim() || undefined }),
    onSuccess: (d) => {
      onBooking(d);
      notify(`${worker?.fullName} added to the team`);
      onClose();
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  const already = new Set((booking.team ?? []).map((t) => t.userId));
  const options = (workers.data?.data ?? []).filter((w) => !already.has(w.id));
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add a worker to {booking.code}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Team role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <MenuItem value="RECOVERY_WORKER">Recovery worker</MenuItem>
            <MenuItem value="DRIVER">Additional driver</MenuItem>
          </TextField>
          <Autocomplete
            options={options}
            loading={workers.isLoading}
            value={worker}
            onChange={(_, v) => setWorker(v)}
            getOptionLabel={(o) => `${o.fullName} (${o.workerProfile?.employeeCode ?? ''})`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText={workers.isLoading ? 'Loading…' : 'No verified, available workers right now'}
            renderInput={(p) => <TextField {...p} label="Available verified worker" helperText="Only active, verified workers currently marked Available are listed." />}
          />
          <TextField label="Responsibility (optional)" value={responsibility} onChange={(e) => setResponsibility(e.target.value.slice(0, 200))} placeholder="e.g. Winch operation, traffic management" />
          {workers.error && <ErrorState error={workers.error} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Back</Button>
        <Button variant="contained" disabled={!worker || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? 'Adding…' : 'Add to team'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Manual safety review ────────────────────────────────────────────

function ReviewDialog({ open, booking, onClose, notify }: { open: boolean; booking: StaffBooking; onClose: () => void; notify: Notify }) {
  const onBooking = useBookingCache(booking.id);
  const rec = booking.recommendation;
  const [approve, setApprove] = useState(true);
  const [notes, setNotes] = useState('');
  const [crew, setCrew] = useState(String(rec?.crew ?? booking.crewRecommended ?? 1));
  const [truckTypes, setTruckTypes] = useState<string[]>(rec?.truckTypes ?? []);
  const [equipment, setEquipment] = useState<string[]>(rec?.equipment ?? []);
  useEffect(() => {
    if (open) {
      setApprove(true);
      setNotes('');
      setCrew(String(rec?.crew ?? booking.crewRecommended ?? 1));
      setTruckTypes(rec?.truckTypes ?? []);
      setEquipment(rec?.equipment ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useMutation({
    mutationFn: () => api.post<{ approved: boolean }>(`/dispatch/bookings/${booking.id}/review`, approve ? { approve, notes: notes.trim(), crew: Number(crew), truckTypes, equipment } : { approve, notes: notes.trim() }),
    onSuccess: (r) => {
      onBooking();
      notify(r.approved ? 'Safety review approved. The booking can now be dispatched.' : 'Recovery declined and booking cancelled.', r.approved ? 'success' : 'info');
      onClose();
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  const crewN = Number(crew);
  const valid = notes.trim().length >= 5 && (!approve || (Number.isInteger(crewN) && crewN >= 1 && crewN <= 8 && truckTypes.length > 0));
  return (
    <Dialog open={open} onClose={m.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Manual safety review · {booking.code}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {(booking.manualReviewReasons ?? []).length > 0 && (
            <Alert severity="warning">
              Flagged because: {(booking.manualReviewReasons ?? []).join('; ')}
            </Alert>
          )}
          <ToggleButtonGroup exclusive value={approve ? 'approve' : 'decline'} onChange={(_, v) => v && setApprove(v === 'approve')} size="small" color={approve ? 'success' : 'error'}>
            <ToggleButton value="approve">Approve recovery</ToggleButton>
            <ToggleButton value="decline">Decline (cancels booking)</ToggleButton>
          </ToggleButtonGroup>
          {approve && (
            <>
              <TextField label="Crew size" type="number" value={crew} onChange={(e) => setCrew(e.target.value)} slotProps={{ htmlInput: { min: 1, max: 8 } }} helperText={`Recommended: ${rec?.crew ?? '—'}. ${rec?.crewNote ?? ''}`} />
              <Autocomplete multiple options={[...TRUCK_TYPES]} value={truckTypes} onChange={(_, v) => setTruckTypes(v)} getOptionLabel={(o: string) => humanize(o)} renderInput={(p) => <TextField {...p} label="Allowed truck types" error={!truckTypes.length} helperText={!truckTypes.length ? 'Pick at least one' : undefined} />} />
              <Autocomplete multiple options={[...EQUIPMENT_TYPES]} value={equipment} onChange={(_, v) => setEquipment(v)} getOptionLabel={(o: string) => humanize(o)} renderInput={(p) => <TextField {...p} label="Required equipment" />} />
            </>
          )}
          <TextField label="Review notes" required multiline minRows={3} value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 1000))} helperText="At least 5 characters. Recorded in the audit log." />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={m.isPending}>
          Back
        </Button>
        <Button variant="contained" color={approve ? 'primary' : 'error'} disabled={!valid || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? 'Saving…' : approve ? 'Approve' : 'Decline & cancel'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Custody override ────────────────────────────────────────────────

function CustodyDialog({ open, booking, stages, onClose, notify }: { open: boolean; booking: StaffBooking; stages: ('PICKUP' | 'HANDOVER')[]; onClose: () => void; notify: Notify }) {
  const onBooking = useBookingCache(booking.id);
  const [stage, setStage] = useState<'PICKUP' | 'HANDOVER'>(stages[0] ?? 'PICKUP');
  const [reason, setReason] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [relation, setRelation] = useState('');
  useEffect(() => {
    if (open) {
      setStage(stages[0] ?? 'PICKUP');
      setReason('');
      setRecipientName('');
      setRelation('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useMutation({
    mutationFn: () => api.post(`/dispatch/bookings/${booking.id}/custody-override`, { stage, reason: reason.trim(), recipientName: recipientName.trim() || undefined, recipientRelation: relation.trim() || undefined }),
    onSuccess: () => {
      onBooking();
      notify(`${stage === 'PICKUP' ? 'Pickup' : 'Handover'} custody confirmed by override`);
      onClose();
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  return (
    <Dialog open={open} onClose={m.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Authorise custody override</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="warning">Use only when the customer cannot provide the pickup/handover code and identity has been verified another way. The customer is notified and the override is audited.</Alert>
          <TextField select label="Stage" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
            {stages.map((s) => (
              <MenuItem key={s} value={s}>
                {s === 'PICKUP' ? 'Pickup (vehicle collected)' : 'Handover (vehicle delivered)'}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Reason" required multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} helperText={`At least 10 characters (${reason.trim().length}/500)`} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField fullWidth label="Recipient name (optional)" value={recipientName} onChange={(e) => setRecipientName(e.target.value.slice(0, 100))} placeholder={booking.contactName ?? ''} />
            <TextField fullWidth label="Relation (optional)" value={relation} onChange={(e) => setRelation(e.target.value.slice(0, 60))} placeholder="e.g. Owner, Garage manager" />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={m.isPending}>
          Back
        </Button>
        <Button variant="contained" color="warning" disabled={reason.trim().length < 10 || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? 'Saving…' : 'Confirm override'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Cancel ──────────────────────────────────────────────────────────

function CancelDialog({ open, booking, onClose, notify }: { open: boolean; booking: StaffBooking; onClose: () => void; notify: Notify }) {
  const onBooking = useBookingCache(booking.id);
  const [reason, setReason] = useState('');
  const [waive, setWaive] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setWaive(false);
    }
  }, [open]);
  const preview = useQuery({
    queryKey: ['booking', booking.id, 'cancellation'],
    queryFn: () => api.get<{ status: string; stage: string; fee: number; policy: { description: string } }>(`/bookings/${booking.id}/cancellation`),
    enabled: open,
  });
  const m = useMutation({
    mutationFn: () => api.post<{ fee: number; booking: StaffBooking }>(`/bookings/${booking.id}/cancel`, { reason: reason.trim(), waiveFee: waive || undefined }),
    onSuccess: (r) => {
      onBooking(r.booking);
      notify(r.fee > 0 ? `Booking cancelled. Cancellation fee ${inr(r.fee)} invoiced.` : 'Booking cancelled. No fee charged.');
      onClose();
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  const fee = preview.data?.fee ?? 0;
  return (
    <Dialog open={open} onClose={m.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Cancel {booking.code}?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {preview.isLoading ? (
            <LoadingBlock rows={1} />
          ) : preview.error ? (
            <ErrorState error={preview.error} title="Could not load the cancellation policy" />
          ) : (
            <Alert severity={fee > 0 ? 'warning' : 'info'}>
              Stage: {humanize(preview.data?.stage)}. Fee under policy: <Money value={fee} strong />. {preview.data?.policy.description}
            </Alert>
          )}
          {fee > 0 && <FormControlLabel control={<Checkbox checked={waive} onChange={(e) => setWaive(e.target.checked)} />} label="Waive the cancellation fee (operations decision, audited)" />}
          <Typography variant="body2" color="text.secondary">
            Any live driver offer or accepted assignment is released and the customer is notified.
          </Typography>
          <TextField label="Reason" required multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} helperText={`At least 3 characters (${reason.trim().length}/500)`} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={m.isPending}>
          Back
        </Button>
        <Button variant="contained" color="error" disabled={reason.trim().length < 3 || m.isPending || preview.isLoading} onClick={() => m.mutate()}>
          {m.isPending ? 'Cancelling…' : waive || fee === 0 ? 'Cancel booking' : `Cancel & charge ${inr(fee)}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Action bar ──────────────────────────────────────────────────────

type DialogKey = 'review' | 'reassign' | 'hold' | 'resume' | 'fail' | 'custody' | 'cancel' | null;

export function BookingActions({ booking, notify, allowCancel }: { booking: StaffBooking; notify: Notify; allowCancel?: boolean }) {
  const { can } = useAuth();
  const onBooking = useBookingCache(booking.id);
  const [dialog, setDialog] = useState<DialogKey>(null);
  const next = booking.allowedNext ?? [];
  const assignments = booking.assignments ?? [];
  const live = assignments.find((a) => a.status === 'ACCEPTED' || a.status === 'OFFERED');
  const accepted = assignments.find((a) => a.status === 'ACCEPTED');
  const pending = reviewPending(booking);
  const resumeTo = holdReturnStatus(booking);
  const custodyStages = useMemo(() => (['PICKUP', 'HANDOVER'] as const).filter((s) => !(booking.custody ?? []).some((c) => c.stage === s)), [booking.custody]);

  const auto = useMutation({
    mutationFn: () => api.post<{ offered: boolean; reason?: string; driverUserId?: string }>(`/dispatch/bookings/${booking.id}/auto-dispatch`),
    onSuccess: (r) => {
      onBooking();
      notify(r.offered ? 'Auto-dispatch sent an offer to the best eligible driver. Waiting for acceptance.' : `No offer made: ${r.reason ?? 'no eligible provider'}. Dispatch has been alerted.`, r.offered ? 'success' : 'warning');
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  const reassign = useMutation({
    mutationFn: (reason: string) => api.post<StaffBooking>(`/dispatch/bookings/${booking.id}/reassign`, { reason }),
    onSuccess: (d) => {
      onBooking(d);
      setDialog(null);
      notify('Provider released. The booking is back in the dispatch queue.');
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  const transition = useMutation({
    mutationFn: (v: { to: BookingStatus; reason: string }) => api.post<StaffBooking>(`/dispatch/bookings/${booking.id}/transition`, v),
    onSuccess: (d, v) => {
      onBooking(d);
      setDialog(null);
      notify(`Booking moved to “${STATUS_LABELS[v.to]}”`);
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });

  const actions: React.ReactNode[] = [];
  if (can('dispatch:manage') && NEEDS_PROVIDER.includes(booking.status))
    actions.push(
      <Tooltip key="auto" title={pending ? 'Complete the safety review first' : 'Offer to the best-scoring eligible driver'}>
        <span>
          <Button variant="contained" startIcon={<BoltIcon />} disabled={pending || auto.isPending} onClick={() => auto.mutate()}>
            {auto.isPending ? 'Dispatching…' : 'Auto-dispatch'}
          </Button>
        </span>
      </Tooltip>,
    );
  if (can('dispatch:manage') && pending)
    actions.push(
      <Button key="review" variant="contained" color="warning" onClick={() => setDialog('review')}>
        Safety review…
      </Button>,
    );
  if (can('dispatch:manage') && next.includes('REASSIGNMENT_REQUIRED') && (live || booking.status === 'SAFETY_HOLD'))
    actions.push(
      <Button key="reassign" variant="outlined" onClick={() => setDialog('reassign')}>
        Reassign…
      </Button>,
    );
  if (can('booking:manage') && next.includes('SAFETY_HOLD'))
    actions.push(
      <Button key="hold" variant="outlined" color="warning" onClick={() => setDialog('hold')}>
        Safety hold…
      </Button>,
    );
  if (can('booking:manage') && resumeTo && OPS_TRANSITION_TARGETS.includes(resumeTo))
    actions.push(
      <Button key="resume" variant="outlined" color="success" onClick={() => setDialog('resume')}>
        Resume ({STATUS_LABELS[resumeTo]})…
      </Button>,
    );
  if (can('booking:override') && accepted && custodyStages.length)
    actions.push(
      <Button key="custody" variant="outlined" onClick={() => setDialog('custody')}>
        Custody override…
      </Button>,
    );
  if (can('booking:manage') && next.includes('FAILED'))
    actions.push(
      <Button key="fail" variant="outlined" color="error" onClick={() => setDialog('fail')}>
        Mark failed…
      </Button>,
    );
  if (allowCancel && can('booking:manage') && next.includes('CANCELLED'))
    actions.push(
      <Button key="cancel" variant="outlined" color="error" onClick={() => setDialog('cancel')}>
        Cancel booking…
      </Button>,
    );

  return (
    <Box>
      {actions.length ? (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {actions}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No operations actions are available for this booking in its current status{booking.status === 'COMPLETED' || booking.status === 'CANCELLED' || booking.status === 'FAILED' ? ' (closed)' : ''}.
        </Typography>
      )}
      <ReviewDialog open={dialog === 'review'} booking={booking} onClose={() => setDialog(null)} notify={notify} />
      <CustodyDialog open={dialog === 'custody'} booking={booking} stages={custodyStages} onClose={() => setDialog(null)} notify={notify} />
      <CancelDialog open={dialog === 'cancel'} booking={booking} onClose={() => setDialog(null)} notify={notify} />
      <ReasonDialog
        open={dialog === 'reassign'}
        title={`Reassign ${booking.code}?`}
        body={live ? `${live.driver.fullName}'s ${live.status === 'OFFERED' ? 'offer' : 'assignment'} will be released and the job returns to the dispatch queue (auto-dispatch retries if enabled).` : 'The job returns to the dispatch queue.'}
        label="Reason for reassignment"
        loading={reassign.isPending}
        confirmLabel="Release & reassign"
        danger
        onClose={() => setDialog(null)}
        onConfirm={(r) => reassign.mutate(r)}
      />
      <ReasonDialog
        open={dialog === 'hold'}
        title="Put the job on safety hold?"
        body="Field work pauses. The customer is told the job is paused for a safety check. Only operations staff can resume, and only to the current status."
        label="Safety concern"
        loading={transition.isPending}
        confirmLabel="Place on hold"
        danger
        onClose={() => setDialog(null)}
        onConfirm={(r) => transition.mutate({ to: 'SAFETY_HOLD', reason: r })}
      />
      <ReasonDialog
        open={dialog === 'resume'}
        title={`Resume the job${resumeTo ? ` to “${STATUS_LABELS[resumeTo]}”` : ''}?`}
        body="Confirm the safety concern has been resolved."
        label="How was the concern resolved?"
        loading={transition.isPending}
        confirmLabel="Resume"
        onClose={() => setDialog(null)}
        onConfirm={(r) => resumeTo && transition.mutate({ to: resumeTo, reason: r })}
      />
      <ReasonDialog
        open={dialog === 'fail'}
        title="Mark this booking as failed?"
        body="Use when the service could not be completed. Any live assignment is released and the customer is told we could not complete the service."
        label="Failure reason"
        loading={transition.isPending}
        confirmLabel="Mark failed"
        danger
        onClose={() => setDialog(null)}
        onConfirm={(r) => transition.mutate({ to: 'FAILED', reason: r })}
      />
    </Box>
  );
}

export function SectionDivider() {
  return <Divider sx={{ my: 2 }} />;
}
