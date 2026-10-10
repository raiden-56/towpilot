import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  InputAdornment,
  Link,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import RuleOutlinedIcon from '@mui/icons-material/RuleOutlined';
import { api } from '@/api/client';
import { ConfirmDialog, EmptyState, ErrorState, KeyValue, KpiCard, LoadingBlock, Money, PageHeader, SampleTag, SectionCard } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { date, humanize, inr, inrCompact, relative, VEHICLE_CLASS_LABELS } from '@/lib/format';
import { TruckFormDialog } from './ops/TruckFormDialog';
import { BackLink, REMINDER_BASIS_LABEL, toDateInput, TRUCK_STATUS_COLOR, useNotice, type Notify } from './ops/shared';
import type { Equipment, TruckDetailData } from './ops/types';

const SETTABLE = ['AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'RETIRED'] as const;

function EquipmentRow({ truckId, e, notify, canManage }: { truckId: string; e: Equipment; notify: Notify; canManage: boolean }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(e.notes ?? '');
  useEffect(() => setNotes(e.notes ?? ''), [e.notes]);
  const m = useMutation({
    mutationFn: (v: { status: string; notes?: string }) => api.patch(`/admin/fleet/trucks/${truckId}/equipment/${e.type}`, v),
    onSuccess: (_, v) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
      notify(`${humanize(e.type)} marked ${humanize(v.status).toLowerCase()}`);
    },
    onError: (err) => notify((err as Error).message, 'error'),
  });
  return (
    <TableRow>
      <TableCell>{humanize(e.type)}</TableCell>
      <TableCell>
        {canManage ? (
          <TextField select size="small" value={e.status} disabled={m.isPending} onChange={(ev) => m.mutate({ status: ev.target.value, notes: notes.trim() || undefined })} sx={{ minWidth: 130 }} slotProps={{ htmlInput: { 'aria-label': `${humanize(e.type)} condition` } }}>
            <MenuItem value="OK">OK</MenuItem>
            <MenuItem value="DAMAGED">Damaged</MenuItem>
            <MenuItem value="MISSING">Missing</MenuItem>
          </TextField>
        ) : (
          <Chip size="small" color={e.status === 'OK' ? 'success' : 'error'} variant="outlined" label={humanize(e.status)} />
        )}
      </TableCell>
      <TableCell>
        {canManage ? (
          <TextField
            size="small"
            placeholder="Notes"
            value={notes}
            onChange={(ev) => setNotes(ev.target.value.slice(0, 300))}
            onBlur={() => notes.trim() !== (e.notes ?? '') && m.mutate({ status: e.status, notes: notes.trim() || undefined })}
            fullWidth
            slotProps={{ htmlInput: { 'aria-label': `${humanize(e.type)} notes` } }}
          />
        ) : (
          e.notes ?? '—'
        )}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{relative(e.updatedAt)}</TableCell>
    </TableRow>
  );
}

function MaintenanceDialog({ open, truck, onClose, notify }: { open: boolean; truck: TruckDetailData; onClose: () => void; notify: Notify }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ type: 'SERVICE', description: '', odometerKm: '', cost: '', performedAt: toDateInput(new Date()), nextDueAt: '', vendorName: '', setStatus: '' });
  useEffect(() => {
    if (open) setV({ type: 'SERVICE', description: '', odometerKm: String(truck.odometerKm), cost: '', performedAt: toDateInput(new Date()), nextDueAt: '', vendorName: '', setStatus: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: keyof typeof v) => (ev: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: ev.target.value }));
  const costOk = v.cost === '' || /^\d+(\.\d{1,2})?$/.test(v.cost);
  const odoOk = v.odometerKm === '' || /^\d+$/.test(v.odometerKm);
  const valid = v.description.trim().length >= 3 && !!v.performedAt && costOk && odoOk;
  const m = useMutation({
    mutationFn: () =>
      api.post(`/admin/fleet/trucks/${truck.id}/maintenance`, {
        type: v.type,
        description: v.description.trim(),
        odometerKm: v.odometerKm ? Number(v.odometerKm) : undefined,
        cost: v.cost ? Number(v.cost) : 0, // rupees; the API converts to paise
        performedAt: new Date(`${v.performedAt}T00:00:00`).toISOString(),
        nextDueAt: v.nextDueAt ? new Date(`${v.nextDueAt}T00:00:00`).toISOString() : undefined,
        vendorName: v.vendorName.trim() || undefined,
        setStatus: v.setStatus || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
      notify(`Maintenance recorded${Number(v.cost) > 0 ? ` and ${inr(Math.round(Number(v.cost) * 100))} booked as an approved expense` : ''}`);
      onClose();
    },
    onError: (err) => notify((err as Error).message, 'error'),
  });
  return (
    <Dialog open={open} onClose={m.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add maintenance record · {truck.registrationNumber}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select fullWidth size="small" label="Type" value={v.type} onChange={set('type')}>
              {['SERVICE', 'REPAIR', 'INSPECTION', 'BREAKDOWN'].map((t) => (
                <MenuItem key={t} value={t}>
                  {humanize(t)}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth size="small" type="date" label="Performed on" value={v.performedAt} onChange={set('performedAt')} required slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={12}>
            <TextField fullWidth size="small" label="Description" multiline minRows={2} value={v.description} onChange={set('description')} required helperText="At least 3 characters" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth size="small" label="Odometer (km)" value={v.odometerKm} onChange={set('odometerKm')} error={!odoOk} inputMode="numeric" helperText={v.type === 'SERVICE' ? 'Resets the service-interval counter' : undefined} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth size="small" label="Cost" value={v.cost} onChange={set('cost')} error={!costOk} inputMode="decimal" slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> } }} helperText="In rupees. A cost above zero is booked as an approved expense." />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth size="small" label="Vendor (optional)" value={v.vendorName} onChange={set('vendorName')} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth size="small" type="date" label="Next due (optional)" value={v.nextDueAt} onChange={set('nextDueAt')} slotProps={{ inputLabel: { shrink: true } }} helperText={v.type === 'INSPECTION' ? 'Sets the next inspection date' : undefined} />
          </Grid>
          <Grid size={12}>
            <TextField select fullWidth size="small" label="Set truck status" value={v.setStatus} onChange={set('setStatus')} disabled={truck.status === 'IN_USE'} helperText={truck.status === 'IN_USE' ? 'Truck is on a job; status unchanged' : undefined}>
              <MenuItem value="">Leave unchanged ({humanize(truck.status).toLowerCase()})</MenuItem>
              <MenuItem value="AVAILABLE">Available</MenuItem>
              <MenuItem value="MAINTENANCE">Maintenance</MenuItem>
              <MenuItem value="OUT_OF_SERVICE">Out of service</MenuItem>
            </TextField>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={m.isPending}>
          Cancel
        </Button>
        <Button variant="contained" disabled={!valid || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? 'Saving…' : 'Save record'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function TruckDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { notify, node } = useNotice();
  const [editing, setEditing] = useState(false);
  const [addingMaint, setAddingMaint] = useState(false);
  const [statusTarget, setStatusTarget] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin', 'fleet', 'truck', id], queryFn: () => api.get<TruckDetailData>(`/admin/fleet/trucks/${id}`) });
  const statusM = useMutation({
    mutationFn: (status: string) => api.patch(`/admin/fleet/trucks/${id}`, { status }),
    onSuccess: (_, s) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
      setStatusTarget(null);
      notify(`Truck status set to ${humanize(s).toLowerCase()}`);
    },
    onError: (err) => notify((err as Error).message, 'error'),
  });
  const t = q.data;
  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.error || !t)
    return (
      <Box>
        <BackLink to="/admin/fleet" label="Fleet" />
        <ErrorState error={q.error ?? new Error('Truck not found')} onRetry={() => void q.refetch()} />
      </Box>
    );
  const manage = can('fleet:manage');
  const inUse = t.status === 'IN_USE';
  const kmSince = t.odometerKm - (t.lastServiceOdometerKm ?? 0);
  const docs: [string, string | null][] = [
    ['Insurance', t.insuranceExpiry],
    ['Fitness certificate', t.fitnessExpiry],
    ['Permit', t.permitExpiry],
    ['PUC certificate', t.pucExpiry],
    ['Next inspection', t.nextInspectionDue],
  ];

  return (
    <Box>
      <BackLink to="/admin/fleet" label="Fleet" />
      <PageHeader
        title={
          <Stack direction="row" spacing={1} alignItems="center" component="span" flexWrap="wrap" useFlexGap>
            <span>{t.registrationNumber}</span>
            <Chip color={TRUCK_STATUS_COLOR(t.status)} label={humanize(t.status)} />
            <SampleTag show={t.isSample} />
          </Stack>
        }
        subtitle={`${humanize(t.truckType)} · ${t.make} ${t.model} · ${t.zone?.name ?? 'no home zone'}`}
        actions={
          manage && (
            <>
              <TextField select size="small" label="Change status" value="" disabled={inUse} onChange={(e) => setStatusTarget(e.target.value)} sx={{ minWidth: 180 }} helperText={inUse ? 'Locked while on a job' : undefined}>
                {SETTABLE.filter((s) => s !== t.status).map((s) => (
                  <MenuItem key={s} value={s}>
                    {humanize(s)}
                  </MenuItem>
                ))}
              </TextField>
              <Button variant="outlined" startIcon={<BuildOutlinedIcon />} onClick={() => setAddingMaint(true)}>
                Add maintenance
              </Button>
              <Button variant="contained" startIcon={<EditOutlinedIcon />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          )
        }
      />
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <KpiCard label="Jobs (30 days)" value={t.utilisation.completedJobsLast30Days} definition="Completed assignments using this truck in the last 30 days." />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <KpiCard label="Fuel cost" value={<span title={inr(t.costs.fuel)}>{inrCompact(t.costs.fuel)}</span>} hint={`${t.costs.fuelLitres.toLocaleString('en-IN')} litres`} definition="All approved or paid fuel expenses recorded against this truck." />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <KpiCard label="Repairs & maintenance" value={<span title={inr(t.costs.maintenanceAndRepairs)}>{inrCompact(t.costs.maintenanceAndRepairs)}</span>} definition="All approved or paid maintenance and repair expenses for this truck." />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <KpiCard label="Breakdowns" value={t.breakdowns} definition="Breakdown records among the latest 50 maintenance entries." />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Stack spacing={2}>
            <SectionCard
              title={
                <Box>
                  <Typography variant="h5">Reminders</Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <RuleOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary">
                      {REMINDER_BASIS_LABEL}
                    </Typography>
                  </Stack>
                </Box>
              }
            >
              {!t.reminders.length ? (
                <Typography color="text.secondary">Nothing due in the next 30 days.</Typography>
              ) : (
                <Stack spacing={1}>
                  {t.reminders.map((r, i) => (
                    <Alert key={i} severity={r.severity === 'OVERDUE' ? 'error' : 'warning'} variant="outlined">
                      {r.message}
                      {r.dueAt && ` · ${date(r.dueAt)}`}
                      <Typography variant="caption" color="text.secondary" display="block">
                        Basis: {r.basis === 'RULE_BASED_PROJECTION' ? 'linear projection from recorded odometer readings' : 'configured interval / expiry date'}
                      </Typography>
                    </Alert>
                  ))}
                </Stack>
              )}
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                {t.remindersBasis}
              </Typography>
            </SectionCard>

            <SectionCard title={`Equipment (${t.equipment.length})`}>
              {!t.equipment.length ? (
                <EmptyState title="No equipment recorded" body={manage ? 'Use Edit to add the equipment carried on this truck.' : undefined} />
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Item</TableCell>
                        <TableCell>Condition</TableCell>
                        <TableCell>Notes</TableCell>
                        <TableCell>Updated</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {t.equipment.map((e) => (
                        <EquipmentRow key={e.id} truckId={t.id} e={e} notify={notify} canManage={manage} />
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
              <Typography variant="caption" color="text.secondary">
                Damaged or missing equipment that a job requires blocks this truck from that job.
              </Typography>
            </SectionCard>

            <SectionCard
              title={`Maintenance history (${t.maintenance.length})`}
              action={
                manage && (
                  <Button size="small" onClick={() => setAddingMaint(true)}>
                    Add record
                  </Button>
                )
              }
            >
              {!t.maintenance.length ? (
                <EmptyState title="No maintenance recorded" />
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell align="right">Odometer</TableCell>
                        <TableCell align="right">Cost</TableCell>
                        <TableCell>Next due</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {t.maintenance.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{date(m.performedAt)}</TableCell>
                          <TableCell>
                            <Chip size="small" variant="outlined" color={m.type === 'BREAKDOWN' ? 'error' : m.type === 'REPAIR' ? 'warning' : 'default'} label={humanize(m.type)} />
                          </TableCell>
                          <TableCell>{m.description}</TableCell>
                          <TableCell align="right">{m.odometerKm != null ? `${m.odometerKm.toLocaleString('en-IN')} km` : '—'}</TableCell>
                          <TableCell align="right">
                            <Money value={m.cost} />
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{date(m.nextDueAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </SectionCard>

            <SectionCard title={`Expenses (${t.expenses.length})`}>
              {!t.expenses.length ? (
                <EmptyState title="No expenses recorded against this truck" />
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Number</TableCell>
                        <TableCell>Category</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {t.expenses.map((x) => (
                        <TableRow key={x.id}>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{date(x.expenseDate)}</TableCell>
                          <TableCell>{x.number}</TableCell>
                          <TableCell>
                            {humanize(x.category)}
                            {x.fuelLitres ? ` · ${x.fuelLitres} L` : ''}
                          </TableCell>
                          <TableCell>
                            {x.description}
                            {x.vendorName && (
                              <Typography variant="caption" color="text.secondary" display="block">
                                {x.vendorName}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Chip size="small" variant="outlined" label={humanize(x.status)} color={x.status === 'PAID' ? 'success' : x.status === 'REJECTED' ? 'error' : 'default'} />
                          </TableCell>
                          <TableCell align="right">
                            <Money value={x.amount + (x.taxAmount ?? 0)} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </SectionCard>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={2}>
            <SectionCard title="Details">
              <KeyValue label="Type" value={humanize(t.truckType)} />
              <KeyValue label="Make / model" value={`${t.make} ${t.model}`} />
              <KeyValue label="Max load" value={`${t.maxLoadKg.toLocaleString('en-IN')} kg`} />
              <KeyValue label="Largest vehicle class" value={VEHICLE_CLASS_LABELS[t.maxVehicleClass] ?? t.maxVehicleClass} />
              <KeyValue label="Home zone" value={t.zone?.name ?? '—'} />
              <KeyValue
                label="Assigned driver"
                value={
                  t.assignedDriver ? (
                    <Link component={RouterLink} to={`/admin/employees/${t.assignedDriver.id}`}>
                      {t.assignedDriver.fullName}
                    </Link>
                  ) : (
                    'Unassigned (assign from the employee page)'
                  )
                }
              />
              {t.notes && <KeyValue label="Notes" value={t.notes} />}
            </SectionCard>
            <SectionCard title="Servicing">
              <KeyValue label="Odometer" value={`${t.odometerKm.toLocaleString('en-IN')} km`} />
              <KeyValue label="Last service" value={t.lastServiceAt ? `${date(t.lastServiceAt)}${t.lastServiceOdometerKm != null ? ` at ${t.lastServiceOdometerKm.toLocaleString('en-IN')} km` : ''}` : 'No record'} />
              <KeyValue label="Since last service" value={`${kmSince.toLocaleString('en-IN')} km of ${t.serviceIntervalKm.toLocaleString('en-IN')} km`} />
              <KeyValue label="Time interval" value={`every ${t.serviceIntervalDays} days`} />
            </SectionCard>
            <SectionCard title="Documents & inspection">
              {docs.map(([label, d]) => {
                const expired = d && new Date(d) < new Date();
                const soon = d && !expired && new Date(d).getTime() - Date.now() < 30 * 86_400_000;
                return (
                  <KeyValue
                    key={label}
                    label={label}
                    value={
                      d ? (
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                          <span>{date(d)}</span>
                          {expired && <Chip size="small" color="error" label="Expired" />}
                          {soon && <Chip size="small" color="warning" variant="outlined" label="< 30 days" />}
                        </Stack>
                      ) : (
                        'Not recorded'
                      )
                    }
                  />
                );
              })}
            </SectionCard>
          </Stack>
        </Grid>
      </Grid>

      <TruckFormDialog open={editing} onClose={() => setEditing(false)} truck={t} notify={notify} />
      <MaintenanceDialog open={addingMaint} truck={t} onClose={() => setAddingMaint(false)} notify={notify} />
      <ConfirmDialog
        key={statusTarget ?? 'none'}
        open={!!statusTarget}
        title={`Set ${t.registrationNumber} to ${humanize(statusTarget).toLowerCase()}?`}
        body={statusTarget === 'AVAILABLE' ? 'The truck becomes eligible for dispatch (subject to documents and equipment).' : statusTarget === 'RETIRED' ? 'Retired trucks are hidden from the fleet list and never dispatched.' : 'The truck will be excluded from dispatch until set back to available.'}
        confirmLabel="Change status"
        danger={statusTarget !== 'AVAILABLE'}
        loading={statusM.isPending}
        onClose={() => setStatusTarget(null)}
        onConfirm={() => statusTarget && statusM.mutate(statusTarget)}
      />
      {node}
    </Box>
  );
}
