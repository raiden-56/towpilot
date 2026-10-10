/** Rate cards tab: versioned, immutable pricing with history and a price simulator. */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, Grid, MenuItem, Stack, Switch, TableCell, TableRow, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { api } from '@/api/client';
import { ConfirmDialog, EmptyState, ErrorState, LoadingBlock, Money, SectionCard } from '@/components/common';
import { dateTime, humanize, inr, VEHICLE_CLASS_LABELS } from '@/lib/format';
import type { PriceBreakdown, RateCardRow } from './types';
import { EQUIPMENT_TYPES, FormDialog, MultiSelect, num, numOpt, opts, rupees, RupeeField, SimpleTable, VEHICLE_CLASSES } from './shared';
import { useCategories, useFleetContracts, useZones } from './queries';

const money = (label: string) => z.number({ error: `${label} is required (0 if none)` }).min(0, 'Cannot be negative').refine((v) => Math.round(v * 100) === Number((v * 100).toFixed(2)), 'At most two decimals');
const rcSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(100),
  serviceCategoryId: z.string().min(1, 'Pick a service'),
  zoneId: z.string(),
  vehicleClass: z.string(),
  fleetContractId: z.string(),
  baseFee: money('Base fee'),
  includedKm: z.number({ error: 'Required' }).min(0).max(500),
  perKm: money('Per km'),
  pickupFreeKm: z.number({ error: 'Required' }).min(0).max(200),
  pickupPerKm: money('Pickup per km'),
  includedCrew: z.number({ error: 'Required' }).int().min(1).max(6),
  crewChargePerWorker: money('Crew charge'),
  waitingFreeMinutes: z.number({ error: 'Required' }).int().min(0).max(240),
  waitingPer15Min: money('Waiting charge'),
  nightSurchargePct: z.number({ error: 'Required' }).min(0).max(100),
  nightStartHour: z.number({ error: 'Required' }).int().min(0).max(23),
  nightEndHour: z.number({ error: 'Required' }).int().min(0).max(23),
  holidaySurchargePct: z.number({ error: 'Required' }).min(0).max(100),
  minimumCharge: money('Minimum charge'),
  scheduledBookingFee: money('Scheduled fee'),
  equipment: z.record(z.string(), z.number().min(0).optional()),
  taxRatePct: z.number({ error: 'Required' }).min(0).max(28),
  tollTreatment: z.enum(['PASS_THROUGH_ACTUALS', 'INCLUDED']),
  quoteValidityMin: z.number({ error: 'Required' }).int().min(5).max(1440),
  cancellationAcceptedFee: money('Fee'),
  cancellationArrivedFee: money('Fee'),
  changeReason: z.string().trim().min(3, 'Explain why (at least 3 characters)').max(500),
});
type RcValues = z.infer<typeof rcSchema>;

function defaults(rc: RateCardRow | null, categoryId = ''): RcValues {
  if (!rc)
    return { name: '', serviceCategoryId: categoryId, zoneId: '', vehicleClass: '', fleetContractId: '', baseFee: 0, includedKm: 10, perKm: 0, pickupFreeKm: 10, pickupPerKm: 0, includedCrew: 1, crewChargePerWorker: 0, waitingFreeMinutes: 15, waitingPer15Min: 0, nightSurchargePct: 0, nightStartHour: 22, nightEndHour: 6, holidaySurchargePct: 0, minimumCharge: 0, scheduledBookingFee: 0, equipment: {}, taxRatePct: 18, tollTreatment: 'PASS_THROUGH_ACTUALS', quoteValidityMin: 30, cancellationAcceptedFee: 0, cancellationArrivedFee: 0, changeReason: '' };
  return {
    name: rc.name,
    serviceCategoryId: rc.serviceCategoryId,
    zoneId: rc.zoneId ?? '',
    vehicleClass: rc.vehicleClass ?? '',
    fleetContractId: rc.fleetContractId ?? '',
    baseFee: rupees(rc.baseFee)!,
    includedKm: rc.includedKm,
    perKm: rupees(rc.perKm)!,
    pickupFreeKm: rc.pickupFreeKm,
    pickupPerKm: rupees(rc.pickupPerKm)!,
    includedCrew: rc.includedCrew,
    crewChargePerWorker: rupees(rc.crewChargePerWorker)!,
    waitingFreeMinutes: rc.waitingFreeMinutes,
    waitingPer15Min: rupees(rc.waitingPer15Min)!,
    nightSurchargePct: rc.nightSurchargeBps / 100,
    nightStartHour: rc.nightStartHour,
    nightEndHour: rc.nightEndHour,
    holidaySurchargePct: rc.holidaySurchargeBps / 100,
    minimumCharge: rupees(rc.minimumCharge)!,
    scheduledBookingFee: rupees(rc.scheduledBookingFee)!,
    equipment: Object.fromEntries(Object.entries(rc.equipmentSurcharges ?? {}).map(([k, v]) => [k, rupees(v)])),
    taxRatePct: rc.taxRateBps / 100,
    tollTreatment: rc.tollTreatment,
    quoteValidityMin: rc.quoteValidityMin,
    cancellationAcceptedFee: rupees(rc.cancellationPolicy?.acceptedFee ?? 0)!,
    cancellationArrivedFee: rupees(rc.cancellationPolicy?.arrivedFee ?? 0)!,
    changeReason: '',
  };
}

function RateCardDialog({ open, onClose, base, mode, onSaved }: { open: boolean; onClose: () => void; base: RateCardRow | null; mode: 'create' | 'version' | 'copy'; onSaved: (m: string) => void }) {
  const cats = useCategories(open);
  const zones = useZones(open);
  const contractsQ = useFleetContracts(open);
  const contracts = useMemo(() => (contractsQ.data ?? []).map((c) => ({ id: c.id, label: `${c.fleetAccount.name} — ${c.name}${c.active ? '' : ' (inactive)'}` })), [contractsQ.data]);
  const { register, handleSubmit, reset, control, formState } = useForm<RcValues>({ resolver: zodResolver(rcSchema) });
  const save = useMutation({
    mutationFn: (v: RcValues) => {
      const { equipment, zoneId, vehicleClass, fleetContractId, ...rest } = v;
      const body = {
        ...rest,
        zoneId: zoneId || null,
        vehicleClass: vehicleClass || null,
        fleetContractId: fleetContractId || null,
        equipmentSurcharges: Object.fromEntries(Object.entries(equipment).filter(([, x]) => x != null && Number.isFinite(x) && x > 0)),
      };
      return mode === 'version' && base ? api.post(`/admin/pricing/rate-cards/${base.id}/versions`, body) : api.post('/admin/pricing/rate-cards', body);
    },
    onSuccess: () => onSaved(mode === 'version' ? 'New rate card version published' : 'Rate card created'),
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    const d = defaults(base);
    if (mode === 'copy' && base) d.name = `${base.name} (copy)`;
    reset(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, base, mode, reset]);
  const e = formState.errors;
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('sm'));
  const field = (name: keyof RcValues, label: string, opt: { rupee?: boolean; helper?: string; step?: number; size?: number } = {}) => {
    const err = e[name] as { message?: string } | undefined;
    const props = { label, fullWidth: true, size: 'small' as const, ...register(name, numOpt), error: !!err, helperText: err?.message ?? opt.helper };
    return (
      <Grid size={{ xs: 6, md: opt.size ?? 3 }}>
        {opt.rupee ? <RupeeField {...props} /> : <TextField type="number" {...props} slotProps={{ htmlInput: { step: opt.step ?? 1, min: 0 } }} />}
      </Grid>
    );
  };
  const title = mode === 'version' ? `New version of “${base?.name}” (v${(base?.version ?? 0) + 1})` : mode === 'copy' ? 'New rate card (copied)' : 'New rate card';
  return (
    <FormDialog
      open={open}
      title={title}
      onClose={onClose}
      onSubmit={handleSubmit((v) => save.mutate(v))}
      submitting={save.isPending}
      error={save.error}
      maxWidth="lg"
      submitLabel={mode === 'version' ? 'Publish new version' : 'Create rate card'}
      intro={
        mode === 'version' ? (
          <Alert severity="info">
            Rate cards are immutable. Saving creates version {(base?.version ?? 0) + 1} and retires v{base?.version}. Quotes and invoices already issued keep the frozen pricing snapshot they were created with; only new quotes use the new version.
          </Alert>
        ) : (
          <Alert severity="info">All amounts are in rupees. GST is added on top of taxable charges at the tax rate below; tolls and parking are passed through at actuals when selected.</Alert>
        )
      }
    >
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Scope</Typography>
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, md: 4 }}>
          <TextField label="Name" fullWidth size="small" required {...register('name')} error={!!e.name} helperText={e.name?.message} />
        </Grid>
        <Grid size={{ xs: 12, md: 2 }}>
          <Controller control={control} name="serviceCategoryId" render={({ field: f }) => (
            <TextField select label="Service" fullWidth size="small" required {...f} value={f.value ?? ''} error={!!e.serviceCategoryId} helperText={e.serviceCategoryId?.message} disabled={mode === 'version'}>
              {(cats.data ?? []).map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
          )} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4, md: 2 }}>
          <Controller control={control} name="zoneId" render={({ field: f }) => (
            <TextField select label="Zone" fullWidth size="small" {...f} value={f.value ?? ''}>
              <MenuItem value="">All zones</MenuItem>
              {(zones.data ?? []).map((z) => <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>)}
            </TextField>
          )} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4, md: 2 }}>
          <Controller control={control} name="vehicleClass" render={({ field: f }) => (
            <TextField select label="Vehicle class" fullWidth size="small" {...f} value={f.value ?? ''}>
              <MenuItem value="">All classes</MenuItem>
              {VEHICLE_CLASSES.map((v) => <MenuItem key={v} value={v}>{VEHICLE_CLASS_LABELS[v]}</MenuItem>)}
            </TextField>
          )} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4, md: 2 }}>
          <Controller control={control} name="fleetContractId" render={({ field: f }) => (
            <TextField select label="Fleet contract" fullWidth size="small" {...f} value={f.value ?? ''} helperText="Optional">
              <MenuItem value="">Public rate</MenuItem>
              {contracts.map((c) => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}
            </TextField>
          )} />
        </Grid>
      </Grid>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Distance & base</Typography>
      <Grid container spacing={1.5}>
        {field('baseFee', 'Base fee', { rupee: true })}
        {field('minimumCharge', 'Minimum charge', { rupee: true })}
        {field('includedKm', 'Included tow km', { step: 0.5 })}
        {field('perKm', 'Per km beyond', { rupee: true })}
        {field('pickupFreeKm', 'Free pickup km', { step: 0.5, helper: 'Driver approach distance' })}
        {field('pickupPerKm', 'Pickup per km beyond', { rupee: true })}
        {field('includedCrew', 'Included crew')}
        {field('crewChargePerWorker', 'Extra crew (each)', { rupee: true })}
      </Grid>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Time-based charges</Typography>
      <Grid container spacing={1.5}>
        {field('waitingFreeMinutes', 'Free waiting (min)')}
        {field('waitingPer15Min', 'Waiting per 15 min', { rupee: true })}
        {field('scheduledBookingFee', 'Scheduled booking fee', { rupee: true })}
        {field('quoteValidityMin', 'Quote validity (min)')}
        {field('nightSurchargePct', 'Night surcharge %', { step: 0.5 })}
        {field('nightStartHour', 'Night starts (hour 0–23)')}
        {field('nightEndHour', 'Night ends (hour 0–23)')}
        {field('holidaySurchargePct', 'Holiday surcharge %', { step: 0.5 })}
      </Grid>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Equipment surcharges <Typography component="span" variant="caption" color="text.secondary">(leave blank or 0 for no surcharge)</Typography></Typography>
      <Grid container spacing={1.5}>
        {EQUIPMENT_TYPES.map((eq) => (
          <Grid key={eq} size={{ xs: 6, sm: 4, md: small ? 6 : 3 }}>
            <RupeeField label={humanize(eq)} fullWidth size="small" {...register(`equipment.${eq}` as const, numOpt)} />
          </Grid>
        ))}
      </Grid>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Tax, tolls & cancellation</Typography>
      <Grid container spacing={1.5}>
        {field('taxRatePct', 'GST rate %', { step: 0.5 })}
        <Grid size={{ xs: 6, md: 3 }}>
          <Controller control={control} name="tollTreatment" render={({ field: f }) => (
            <TextField select label="Tolls & parking" fullWidth size="small" {...f} value={f.value ?? 'PASS_THROUGH_ACTUALS'}>
              <MenuItem value="PASS_THROUGH_ACTUALS">Pass through at actuals</MenuItem>
              <MenuItem value="INCLUDED">Included in price</MenuItem>
            </TextField>
          )} />
        </Grid>
        {field('cancellationAcceptedFee', 'Cancel after accept (GST incl.)', { rupee: true })}
        {field('cancellationArrivedFee', 'Cancel after arrival (GST incl.)', { rupee: true })}
      </Grid>
      <Divider sx={{ my: 2 }} />
      <TextField label="Change reason" fullWidth required multiline minRows={2} {...register('changeReason')} error={!!e.changeReason} helperText={e.changeReason?.message ?? 'Recorded on the version and in the audit log'} />
    </FormDialog>
  );
}

// ─── Simulator ───────────────────────────────────────────────────────

export function BreakdownTable({ b }: { b: PriceBreakdown }) {
  const row = (label: string, amount: number, bold = false, muted = false) => (
    <TableRow>
      <TableCell colSpan={3} sx={{ fontWeight: bold ? 700 : undefined, color: muted ? 'text.secondary' : undefined }}>{label}</TableCell>
      <TableCell align="right" sx={{ ...num, fontWeight: bold ? 700 : undefined }}>{inr(amount)}</TableCell>
    </TableRow>
  );
  return (
    <SimpleTable
      rows={b.lines}
      rowKey={(l) => `${l.code}-${l.description}`}
      columns={[
        { key: 'd', header: 'Charge', render: (l) => (<>{l.description}{l.isEstimate && <Chip size="small" variant="outlined" label="estimate" sx={{ ml: 0.5, height: 18, fontSize: 11 }} />}{l.isPassThrough && <Chip size="small" variant="outlined" label="pass-through" sx={{ ml: 0.5, height: 18, fontSize: 11 }} />}</>) },
        { key: 'q', header: 'Qty', align: 'right', render: (l) => l.quantity },
        { key: 'u', header: 'Unit', align: 'right', render: (l) => inr(l.unitAmount) },
        { key: 'a', header: 'Amount', align: 'right', render: (l) => <Box component="span" sx={{ color: l.amount < 0 ? 'success.main' : undefined }}>{inr(l.amount)}</Box> },
      ]}
      footer={
        <>
          {row('Gross service value', b.subtotal, false, true)}
          {b.discountTotal !== 0 && row('Discounts', -Math.abs(b.discountTotal), false, true)}
          {row('Taxable value', b.taxableValue)}
          {row(`GST (${b.taxRateBps / 100}%)`, b.taxTotal, false, true)}
          {b.passThroughTotal !== 0 && row('Pass-through (tolls/parking)', b.passThroughTotal, false, true)}
          {row('Customer total', b.total, true)}
        </>
      }
    />
  );
}

function SimulatorDialog({ rc, onClose }: { rc: RateCardRow | null; onClose: () => void }) {
  const [input, setInput] = useState({ towDistanceKm: 15, pickupDistanceKm: 5, crew: 1, equipment: [] as string[], localHour: 12, isHoliday: false, scheduled: false, waitingMinutes: 0 });
  const sim = useMutation({ mutationFn: () => api.post<PriceBreakdown>(`/admin/pricing/rate-cards/${rc!.id}/simulate`, input) });
  useEffect(() => {
    if (rc) sim.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rc]);
  const n = (k: keyof typeof input, label: string, extra: object = {}) => (
    <Grid size={{ xs: 6, sm: 3 }}>
      <TextField label={label} type="number" size="small" fullWidth value={input[k] as number} onChange={(e) => setInput((s) => ({ ...s, [k]: e.target.value === '' ? 0 : Number(e.target.value) }))} slotProps={{ htmlInput: { min: 0, ...extra } }} />
    </Grid>
  );
  const theme = useTheme();
  const full = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog open={!!rc} onClose={onClose} fullWidth maxWidth="md" fullScreen={full}>
      <DialogTitle>Price simulator · {rc?.name} (v{rc?.version})</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Shows exactly what a customer would be quoted with this rate card. Nothing is saved.
        </Typography>
        <Grid container spacing={1.5}>
          {n('towDistanceKm', 'Tow distance (km)', { step: 0.5, max: 1000 })}
          {n('pickupDistanceKm', 'Pickup distance (km)', { step: 0.5, max: 200 })}
          {n('crew', 'Crew', { min: 1, max: 6 })}
          {n('waitingMinutes', 'Waiting (min)')}
          {n('localHour', 'Local hour (0–23)', { max: 23 })}
          <Grid size={{ xs: 12, sm: 5 }}>
            <MultiSelect size="small" label="Equipment used" options={opts(EQUIPMENT_TYPES)} value={input.equipment} onChange={(v) => setInput((s) => ({ ...s, equipment: v }))} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControlLabel control={<Switch checked={input.isHoliday} onChange={(e) => setInput((s) => ({ ...s, isHoliday: e.target.checked }))} />} label="Holiday" />
            <FormControlLabel control={<Switch checked={input.scheduled} onChange={(e) => setInput((s) => ({ ...s, scheduled: e.target.checked }))} />} label="Scheduled" />
          </Grid>
        </Grid>
        <Box sx={{ mt: 2 }}>
          {sim.error ? <ErrorState error={sim.error} /> : sim.data ? (
            <>
              <BreakdownTable b={sim.data} />
              {sim.data.notes.map((x) => <Typography key={x} variant="caption" color="text.secondary" display="block">{x}</Typography>)}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">Set the scenario and press Calculate.</Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={() => sim.mutate()} disabled={sim.isPending || !rc}>{sim.isPending ? 'Calculating…' : 'Calculate'}</Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── History ─────────────────────────────────────────────────────────

const DIFF_FIELDS: [keyof RateCardRow, string, 'paise' | 'bps' | 'plain'][] = [
  ['baseFee', 'Base fee', 'paise'],
  ['minimumCharge', 'Minimum', 'paise'],
  ['includedKm', 'Included km', 'plain'],
  ['perKm', 'Per km', 'paise'],
  ['pickupFreeKm', 'Free pickup km', 'plain'],
  ['pickupPerKm', 'Pickup/km', 'paise'],
  ['includedCrew', 'Crew', 'plain'],
  ['crewChargePerWorker', 'Extra crew', 'paise'],
  ['waitingFreeMinutes', 'Free wait', 'plain'],
  ['waitingPer15Min', 'Wait/15 min', 'paise'],
  ['nightSurchargeBps', 'Night %', 'bps'],
  ['holidaySurchargeBps', 'Holiday %', 'bps'],
  ['scheduledBookingFee', 'Scheduled fee', 'paise'],
  ['taxRateBps', 'GST %', 'bps'],
  ['tollTreatment', 'Tolls', 'plain'],
  ['quoteValidityMin', 'Quote validity', 'plain'],
  ['name', 'Name', 'plain'],
];
const fmtField = (v: unknown, t: 'paise' | 'bps' | 'plain') => (t === 'paise' ? inr(v as number) : t === 'bps' ? `${(v as number) / 100}%` : String(v ?? '—'));

function HistoryDialog({ rc, onClose }: { rc: RateCardRow | null; onClose: () => void }) {
  const h = useQuery({ queryKey: ['admin', 'pricing', 'rate-card-history', rc?.id], queryFn: () => api.get<RateCardRow[]>(`/admin/pricing/rate-cards/${rc!.id}/history`), enabled: !!rc });
  const theme = useTheme();
  const full = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog open={!!rc} onClose={onClose} fullWidth maxWidth="md" fullScreen={full}>
      <DialogTitle>Version history · {rc?.name}</DialogTitle>
      <DialogContent dividers>
        {h.isLoading ? <LoadingBlock rows={3} /> : h.error ? <ErrorState error={h.error} /> : (
          <Stack spacing={1.5} divider={<Divider />}>
            {(h.data ?? []).map((v, i, arr) => {
              const prev = arr[i + 1];
              const changes = prev ? DIFF_FIELDS.filter(([k]) => JSON.stringify(v[k]) !== JSON.stringify(prev[k])) : [];
              const eqChanged = prev && JSON.stringify(v.equipmentSurcharges) !== JSON.stringify(prev.equipmentSurcharges);
              const cxChanged = prev && JSON.stringify(v.cancellationPolicy) !== JSON.stringify(prev.cancellationPolicy);
              return (
                <Box key={v.id}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="subtitle2">Version {v.version}</Typography>
                    {v.isActive ? <Chip size="small" color="success" label="Active" /> : <Chip size="small" variant="outlined" label="Retired" />}
                    <Typography variant="caption" color="text.secondary">Effective {dateTime(v.effectiveFrom)}</Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>{v.changeReason ?? 'No reason recorded'}</Typography>
                  {prev ? (
                    changes.length || eqChanged || cxChanged ? (
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                        {changes.map(([k, label, t]) => <Chip key={k} size="small" variant="outlined" label={`${label}: ${fmtField(prev[k], t)} → ${fmtField(v[k], t)}`} />)}
                        {eqChanged && <Chip size="small" variant="outlined" label="Equipment surcharges changed" />}
                        {cxChanged && <Chip size="small" variant="outlined" label={`Cancellation: ${v.cancellationPolicy.description}`} />}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">No pricing fields changed vs v{prev.version}.</Typography>
                    )
                  ) : (
                    <Typography variant="caption" color="text.secondary">Base {inr(v.baseFee)} · {v.includedKm} km incl. · {inr(v.perKm)}/km · GST {v.taxRateBps / 100}%</Typography>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

// ─── Tab ─────────────────────────────────────────────────────────────

export function RateCardsTab({ canManage, toast, toastError }: { canManage: boolean; toast: (m: string) => void; toastError: (e: unknown) => void }) {
  const qc = useQueryClient();
  const cats = useCategories();
  const [showRetired, setShowRetired] = useState(false);
  const cards = useQuery({ queryKey: ['admin', 'pricing', 'rate-cards', showRetired], queryFn: () => api.get<RateCardRow[]>('/admin/pricing/rate-cards', { includeHistory: showRetired ? true : undefined }) });
  const [form, setForm] = useState<{ mode: 'create' | 'version' | 'copy'; base: RateCardRow | null } | null>(null);
  const [simulate, setSimulate] = useState<RateCardRow | null>(null);
  const [history, setHistory] = useState<RateCardRow | null>(null);
  const [deactivate, setDeactivate] = useState<RateCardRow | null>(null);
  const deact = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/admin/pricing/rate-cards/${id}/deactivate`, { reason }),
    onSuccess: () => {
      toast('Rate card deactivated');
      setDeactivate(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'pricing', 'rate-cards'] });
    },
    onError: toastError,
  });

  const grouped = useMemo(() => {
    const m = new Map<string, RateCardRow[]>();
    for (const r of cards.data ?? []) m.set(r.serviceCategoryId, [...(m.get(r.serviceCategoryId) ?? []), r]);
    const order = cats.data?.map((c) => c.id) ?? [];
    return [...m.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [cards.data, cats.data]);

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760 }}>
          The most specific active card wins (fleet contract → zone + vehicle class → zone → default). Editing publishes a new immutable version; existing quotes and invoices keep their frozen snapshot.
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <FormControlLabel control={<Switch checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />} label="Show retired versions" />
          {canManage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ mode: 'create', base: null })}>New rate card</Button>}
        </Stack>
      </Stack>
      {cards.isLoading ? <LoadingBlock /> : cards.error ? <ErrorState error={cards.error} onRetry={() => void cards.refetch()} /> : !grouped.length ? (
        <SectionCard><EmptyState title="No rate cards" body="Create a rate card so customers can be quoted for a service." /></SectionCard>
      ) : (
        <Stack spacing={2}>
          {grouped.map(([catId, rows]) => (
            <SectionCard key={catId} title={cats.data?.find((c) => c.id === catId)?.name ?? rows[0]?.serviceCategory?.name ?? 'Service'}>
              <SimpleTable
                rows={rows}
                rowKey={(r) => r.id}
                minWidth={1080}
                columns={[
                  { key: 'n', header: 'Rate card', render: (r) => (<><Typography variant="body2" sx={{ fontWeight: 600 }}>{r.name}</Typography><Typography variant="caption" color="text.secondary">v{r.version} · {r.changeReason ?? ''}</Typography></>) },
                  { key: 's', header: 'Applies to', render: (r) => [r.zone?.name ?? 'All zones', r.vehicleClass ? VEHICLE_CLASS_LABELS[r.vehicleClass] : 'All classes', r.fleetContract?.name].filter(Boolean).join(' · ') },
                  { key: 'b', header: 'Base', align: 'right', render: (r) => <Money value={r.baseFee} /> },
                  { key: 'k', header: 'Incl. km', align: 'right', render: (r) => r.includedKm },
                  { key: 'p', header: 'Per km', align: 'right', render: (r) => <Money value={r.perKm} /> },
                  { key: 'min', header: 'Minimum', align: 'right', render: (r) => <Money value={r.minimumCharge} /> },
                  { key: 'ns', header: 'Night / holiday', align: 'right', render: (r) => `${r.nightSurchargeBps / 100}% / ${r.holidaySurchargeBps / 100}%` },
                  { key: 't', header: 'GST', align: 'right', render: (r) => `${r.taxRateBps / 100}%` },
                  { key: 'st', header: 'Status', render: (r) => (r.isActive ? <Chip size="small" color="success" label="Active" /> : <Chip size="small" variant="outlined" label="Retired" />) },
                  {
                    key: 'x',
                    header: '',
                    align: 'right',
                    render: (r) => (
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Button size="small" onClick={() => setSimulate(r)}>Simulate</Button>
                        <Button size="small" onClick={() => setHistory(r)}>History</Button>
                        {canManage && r.isActive && (
                          <Fragment>
                            <Button size="small" onClick={() => setForm({ mode: 'version', base: r })}>Edit</Button>
                            <Button size="small" color="error" onClick={() => setDeactivate(r)}>Deactivate</Button>
                          </Fragment>
                        )}
                        {canManage && !r.isActive && <Button size="small" onClick={() => setForm({ mode: 'copy', base: r })}>Copy</Button>}
                      </Stack>
                    ),
                  },
                ]}
              />
            </SectionCard>
          ))}
        </Stack>
      )}
      <RateCardDialog open={!!form} mode={form?.mode ?? 'create'} base={form?.base ?? null} onClose={() => setForm(null)} onSaved={(m) => { toast(m); setForm(null); void qc.invalidateQueries({ queryKey: ['admin', 'pricing', 'rate-cards'] }); }} />
      <SimulatorDialog rc={simulate} onClose={() => setSimulate(null)} />
      <HistoryDialog rc={history} onClose={() => setHistory(null)} />
      <ConfirmDialog
        open={!!deactivate}
        title="Deactivate rate card?"
        body={`“${deactivate?.name}” will stop being used for new quotes. If no other active card matches, customers cannot be quoted for this service. Issued quotes and invoices are unaffected.`}
        confirmLabel="Deactivate"
        danger
        requireReason
        loading={deact.isPending}
        onClose={() => setDeactivate(null)}
        onConfirm={(reason) => deactivate && deact.mutate({ id: deactivate.id, reason })}
      />
    </Box>
  );
}
