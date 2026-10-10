import { useEffect } from 'react';
import { Controller, useForm, type Control, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, TextField, Typography, useMediaQuery, useTheme, type TextFieldProps } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { errorMessage } from '@/components/common';
import { humanize, VEHICLE_CLASS_LABELS } from '@/lib/format';
import { EQUIPMENT_TYPES, toDateInput, TRUCK_TYPES, useZones, VEHICLE_CLASSES, type Notify } from './shared';
import type { Truck } from './types';

const int = (label: string, opts: { required?: boolean; min?: number; max?: number } = {}) =>
  z
    .string()
    .trim()
    .refine((v) => (opts.required ? v !== '' : true), `${label} is required`)
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= (opts.min ?? 0) && Number(v) <= (opts.max ?? 10_000_000)), `${label}: whole number${opts.min ? ` ≥ ${opts.min}` : ''}${opts.max ? ` ≤ ${opts.max}` : ''}`);

const schema = z.object({
  registrationNumber: z
    .string()
    .trim()
    .refine((v) => /^[A-Za-z0-9]{6,13}$/.test(v.replace(/[\s-]/g, '')), 'Enter a valid registration number, e.g. KA01AB1234'),
  truckType: z.enum(TRUCK_TYPES),
  make: z.string().trim().min(1, 'Required').max(60),
  model: z.string().trim().min(1, 'Required').max(60),
  maxLoadKg: int('Max load', { required: true, min: 1, max: 60000 }),
  maxVehicleClass: z.enum(VEHICLE_CLASSES),
  zoneId: z.string(),
  odometerKm: int('Odometer'),
  serviceIntervalKm: int('Service interval (km)', { min: 1 }),
  serviceIntervalDays: int('Service interval (days)', { min: 1, max: 3650 }),
  lastServiceAt: z.string(),
  lastServiceOdometerKm: int('Odometer at last service'),
  insuranceExpiry: z.string(),
  fitnessExpiry: z.string(),
  permitExpiry: z.string(),
  pucExpiry: z.string(),
  nextInspectionDue: z.string(),
  notes: z.string().max(1000),
  equipment: z.array(z.enum(EQUIPMENT_TYPES)),
});
type Values = z.infer<typeof schema>;

const empty: Values = {
  registrationNumber: '',
  truckType: 'FLATBED',
  make: '',
  model: '',
  maxLoadKg: '',
  maxVehicleClass: 'SUV',
  zoneId: '',
  odometerKm: '',
  serviceIntervalKm: '10000',
  serviceIntervalDays: '180',
  lastServiceAt: '',
  lastServiceOdometerKm: '',
  insuranceExpiry: '',
  fitnessExpiry: '',
  permitExpiry: '',
  pucExpiry: '',
  nextInspectionDue: '',
  notes: '',
  equipment: [],
};

const DATE_FIELDS = ['lastServiceAt', 'insuranceExpiry', 'fitnessExpiry', 'permitExpiry', 'pucExpiry', 'nextInspectionDue'] as const;
const INT_FIELDS = ['maxLoadKg', 'odometerKm', 'serviceIntervalKm', 'serviceIntervalDays', 'lastServiceOdometerKm'] as const;

function fromTruck(t: Truck): Values {
  return {
    registrationNumber: t.registrationNumber,
    truckType: t.truckType,
    make: t.make,
    model: t.model,
    maxLoadKg: String(t.maxLoadKg),
    maxVehicleClass: t.maxVehicleClass as Values['maxVehicleClass'],
    zoneId: t.zoneId ?? '',
    odometerKm: String(t.odometerKm ?? ''),
    serviceIntervalKm: String(t.serviceIntervalKm ?? ''),
    serviceIntervalDays: String(t.serviceIntervalDays ?? ''),
    lastServiceAt: toDateInput(t.lastServiceAt),
    lastServiceOdometerKm: t.lastServiceOdometerKm != null ? String(t.lastServiceOdometerKm) : '',
    insuranceExpiry: toDateInput(t.insuranceExpiry),
    fitnessExpiry: toDateInput(t.fitnessExpiry),
    permitExpiry: toDateInput(t.permitExpiry),
    pucExpiry: toDateInput(t.pucExpiry),
    nextInspectionDue: toDateInput(t.nextInspectionDue),
    notes: t.notes ?? '',
    equipment: t.equipment.map((e) => e.type).filter((x): x is Values['equipment'][number] => (EQUIPMENT_TYPES as readonly string[]).includes(x)),
  };
}

function toPayload(v: Values, edit: boolean) {
  const body: Record<string, unknown> = {
    registrationNumber: v.registrationNumber,
    truckType: v.truckType,
    make: v.make.trim(),
    model: v.model.trim(),
    maxVehicleClass: v.maxVehicleClass,
    zoneId: v.zoneId || (edit ? null : undefined),
    equipment: v.equipment,
  };
  if (v.notes.trim() || edit) body.notes = v.notes.trim();
  for (const k of INT_FIELDS) {
    if (v[k] !== '') body[k] = Number(v[k]);
    else if (edit && k === 'lastServiceOdometerKm') body[k] = null;
  }
  for (const k of DATE_FIELDS) {
    if (v[k]) body[k] = new Date(`${v[k]}T00:00:00`).toISOString();
    else if (edit) body[k] = null;
  }
  return body;
}

function TF({ control, name, label, ...props }: { control: Control<Values>; name: FieldPath<Values>; label: string } & Omit<TextFieldProps, 'name'>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => <TextField {...field} value={(field.value as string | undefined) ?? ''} label={label} size="small" fullWidth {...props} error={!!fieldState.error} helperText={fieldState.error?.message ?? props.helperText} />}
    />
  );
}

const dateProps = { type: 'date', slotProps: { inputLabel: { shrink: true } } } as const;

export function TruckFormDialog({ open, onClose, truck, notify, onSaved }: { open: boolean; onClose: () => void; truck?: Truck | null; notify: Notify; onSaved?: (t: { id: string }) => void }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const qc = useQueryClient();
  const zones = useZones();
  const { control, handleSubmit, reset, setError, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: empty });
  useEffect(() => {
    if (open) reset(truck ? fromTruck(truck) : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, truck?.id]);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (truck ? api.patch<{ id: string }>(`/admin/fleet/trucks/${truck.id}`, body) : api.post<{ id: string }>('/admin/fleet/trucks', body)),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
      notify(truck ? 'Truck updated' : 'Truck added to the fleet');
      onSaved?.(t);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) for (const [k, m] of Object.entries(err.fieldErrors)) if (k in empty) setError(k as keyof Values, { message: m });
    },
  });

  return (
    <Dialog open={open} onClose={save.isPending ? undefined : onClose} fullWidth maxWidth="md" fullScreen={phone}>
      <DialogTitle>{truck ? `Edit ${truck.registrationNumber}` : 'Add tow truck'}</DialogTitle>
      <DialogContent dividers>
        <form id="truck-form" noValidate onSubmit={handleSubmit((v) => save.mutate(toPayload(v, !!truck)))}>
          {save.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {errorMessage(save.error)}
            </Alert>
          )}
          <Typography variant="overline" color="text.secondary">
            Vehicle
          </Typography>
          <Grid container spacing={2} sx={{ mt: 0.25, mb: 2 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TF control={control} name="registrationNumber" label="Registration number" required placeholder="KA01AB1234" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TF control={control} name="truckType" label="Truck type" select required>
                {TRUCK_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {humanize(t)}
                  </MenuItem>
                ))}
              </TF>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TF control={control} name="zoneId" label="Home zone" select>
                <MenuItem value="">No zone</MenuItem>
                {(zones.data ?? []).map((z) => (
                  <MenuItem key={z.id} value={z.id}>
                    {z.name}
                  </MenuItem>
                ))}
              </TF>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TF control={control} name="make" label="Make" required />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TF control={control} name="model" label="Model" required />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TF control={control} name="maxLoadKg" label="Max load (kg)" required inputMode="numeric" />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TF control={control} name="maxVehicleClass" label="Largest vehicle class" select required>
                {VEHICLE_CLASSES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {VEHICLE_CLASS_LABELS[c]}
                  </MenuItem>
                ))}
              </TF>
            </Grid>
          </Grid>

          <Typography variant="overline" color="text.secondary">
            Servicing
          </Typography>
          <Grid container spacing={2} sx={{ mt: 0.25, mb: 2 }}>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TF control={control} name="odometerKm" label="Odometer (km)" inputMode="numeric" />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TF control={control} name="serviceIntervalKm" label="Service every (km)" inputMode="numeric" />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TF control={control} name="serviceIntervalDays" label="Service every (days)" inputMode="numeric" />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TF control={control} name="lastServiceAt" label="Last service date" {...dateProps} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TF control={control} name="lastServiceOdometerKm" label="Odometer at last service" inputMode="numeric" />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TF control={control} name="nextInspectionDue" label="Next inspection due" {...dateProps} />
            </Grid>
          </Grid>

          <Typography variant="overline" color="text.secondary">
            Documents (expired documents block dispatch)
          </Typography>
          <Grid container spacing={2} sx={{ mt: 0.25, mb: 2 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TF control={control} name="insuranceExpiry" label="Insurance expiry" {...dateProps} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TF control={control} name="fitnessExpiry" label="Fitness expiry" {...dateProps} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TF control={control} name="permitExpiry" label="Permit expiry" {...dateProps} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TF control={control} name="pucExpiry" label="PUC expiry" {...dateProps} />
            </Grid>
          </Grid>

          <Typography variant="overline" color="text.secondary">
            Equipment & notes
          </Typography>
          <Box sx={{ mt: 1 }}>
            <Controller
              control={control}
              name="equipment"
              render={({ field }) => (
                <Autocomplete
                  multiple
                  size="small"
                  options={[...EQUIPMENT_TYPES]}
                  value={field.value}
                  onChange={(_, v) => field.onChange(v)}
                  getOptionLabel={(o: string) => humanize(o)}
                  renderInput={(p) => <TextField {...p} label="Equipment on board" helperText={truck ? 'Removing an item deletes it from the truck; condition (OK / damaged / missing) is set on the truck page.' : 'New items start in OK condition.'} />}
                />
              )}
            />
          </Box>
          <Box sx={{ mt: 2 }}>
            <TF control={control} name="notes" label="Notes" multiline minRows={2} />
          </Box>
          {Object.keys(formState.errors).length > 0 && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Fix the highlighted fields.
            </Alert>
          )}
        </form>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" form="truck-form" variant="contained" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : truck ? 'Save changes' : 'Add truck'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
