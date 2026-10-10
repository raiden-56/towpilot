import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import type { FuelType, Vehicle, VehicleClass } from '@/api/types';
import { errorMessage } from '@/components/common';
import { VEHICLE_CLASS_LABELS } from '@/lib/format';
import { FUEL_LABELS, normaliseReg, REG_PATTERN } from './shared';

const MAX_YEAR = new Date().getFullYear() + 1;
const REG_MESSAGE = 'Enter a valid Indian registration number, e.g. KA01AB1234';

const VEHICLE_CLASSES = Object.keys(VEHICLE_CLASS_LABELS) as VehicleClass[];
const FUEL_TYPES: FuelType[] = ['PETROL', 'DIESEL', 'CNG', 'LPG', 'ELECTRIC', 'HYBRID', 'OTHER'];

const schema = z.object({
  registrationNumber: z
    .string()
    .trim()
    .min(1, 'Enter the registration number')
    .refine((v) => REG_PATTERN.test(normaliseReg(v)), REG_MESSAGE),
  vehicleClass: z.string().min(1, 'Choose the vehicle type'),
  fuelType: z.string().min(1, 'Choose the fuel type'),
  make: z.string().trim().min(1, 'Enter the make, e.g. Maruti Suzuki').max(60, 'Keep it under 60 characters'),
  model: z.string().trim().min(1, 'Enter the model, e.g. Swift').max(60, 'Keep it under 60 characters'),
  color: z.string().trim().max(30, 'Keep it under 30 characters'),
  year: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d{4}$/.test(v) && Number(v) >= 1950 && Number(v) <= MAX_YEAR), `Enter a year between 1950 and ${MAX_YEAR}`),
});

type FormValues = z.infer<typeof schema>;
type FieldName = keyof FormValues;
const FIELD_NAMES: FieldName[] = ['registrationNumber', 'vehicleClass', 'fuelType', 'make', 'model', 'color', 'year'];

function defaults(v?: Vehicle | null): FormValues {
  return {
    registrationNumber: v?.registrationNumber ?? '',
    vehicleClass: v?.vehicleClass ?? '',
    fuelType: v?.fuelType ?? '',
    make: v?.make ?? '',
    model: v?.model ?? '',
    color: v?.color ?? '',
    year: v?.year ? String(v.year) : '',
  };
}

/**
 * Add / edit vehicle dialog. POSTs /vehicles (or PATCHes /vehicles/:id when `vehicle` is given),
 * invalidates ['vehicles'] and hands the saved vehicle back via onSaved.
 */
export function VehicleFormDialog({ open, onClose, vehicle, onSaved }: { open: boolean; onClose: () => void; vehicle?: Vehicle | null; onSaved: (v: Vehicle) => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const qc = useQueryClient();
  const editing = !!vehicle;
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults(vehicle) });

  useEffect(() => {
    if (open) {
      reset(defaults(vehicle));
      setFormError(null);
    }
  }, [open, vehicle, reset]);

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    const body: Record<string, unknown> = {
      registrationNumber: normaliseReg(values.registrationNumber),
      vehicleClass: values.vehicleClass,
      fuelType: values.fuelType,
      make: values.make.trim(),
      model: values.model.trim(),
    };
    const color = values.color.trim();
    // When editing, an empty colour clears it; when adding, omit it.
    if (color || (editing && vehicle?.color)) body.color = color;
    if (values.year) body.year = Number(values.year);
    else if (editing && vehicle?.year) {
      setError('year', { message: `The year can be changed but not removed (currently ${vehicle.year}).` });
      return;
    }
    try {
      const saved = editing ? await api.patch<Vehicle>(`/vehicles/${vehicle!.id}`, body) : await api.post<Vehicle>('/vehicles', body);
      await qc.invalidateQueries({ queryKey: ['vehicles'] });
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError) {
        const fe = e.fieldErrors;
        let mapped = false;
        for (const [path, msg] of Object.entries(fe)) {
          const key = path.split('.')[0] as FieldName;
          if (FIELD_NAMES.includes(key)) {
            setError(key, { message: msg });
            mapped = true;
          }
        }
        if (mapped) return;
        if (e.status === 409 && /already added/i.test(e.message)) {
          setError('registrationNumber', { message: e.message });
          return;
        }
      }
      setFormError(errorMessage(e));
    }
  };

  const close = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Dialog open={open} onClose={close} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby="vehicle-form-title">
      <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'contents' }}>
        <DialogTitle id="vehicle-form-title">{editing ? 'Edit vehicle' : 'Add a vehicle'}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            We use these details to send the right truck and equipment. The registration number helps the driver identify your vehicle.
          </Typography>
          {formError && (
            <Alert severity="error" sx={{ mb: 2 }} role="alert">
              {formError}
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid size={12}>
              <TextField
                label="Registration number"
                required
                fullWidth
                autoFocus={!editing}
                placeholder="KA01AB1234"
                {...register('registrationNumber')}
                error={!!errors.registrationNumber}
                helperText={errors.registrationNumber?.message ?? 'As on the number plate. Spaces and dashes are fine. BH-series supported.'}
                slotProps={{ htmlInput: { autoCapitalize: 'characters', autoComplete: 'off', spellCheck: false, style: { textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 } } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="vehicleClass"
                control={control}
                render={({ field }) => (
                  <TextField select label="Vehicle type" required fullWidth {...field} error={!!errors.vehicleClass} helperText={errors.vehicleClass?.message}>
                    {VEHICLE_CLASSES.map((c) => (
                      <MenuItem key={c} value={c}>
                        {VEHICLE_CLASS_LABELS[c]}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="fuelType"
                control={control}
                render={({ field }) => (
                  <TextField
                    select
                    label="Fuel type"
                    required
                    fullWidth
                    {...field}
                    error={!!errors.fuelType}
                    helperText={errors.fuelType?.message ?? (field.value === 'ELECTRIC' || field.value === 'HYBRID' ? 'EV/hybrid vehicles get flatbed towing and trained crews.' : undefined)}
                  >
                    {FUEL_TYPES.map((f) => (
                      <MenuItem key={f} value={f}>
                        {FUEL_LABELS[f]}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Make" required fullWidth placeholder="e.g. Maruti Suzuki" {...register('make')} error={!!errors.make} helperText={errors.make?.message} slotProps={{ htmlInput: { maxLength: 60 } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Model" required fullWidth placeholder="e.g. Swift" {...register('model')} error={!!errors.model} helperText={errors.model?.message} slotProps={{ htmlInput: { maxLength: 60 } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Colour (optional)" fullWidth placeholder="e.g. White" {...register('color')} error={!!errors.color} helperText={errors.color?.message} slotProps={{ htmlInput: { maxLength: 30 } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Year (optional)"
                fullWidth
                placeholder={String(MAX_YEAR - 1)}
                {...register('year')}
                error={!!errors.year}
                helperText={errors.year?.message}
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 4, pattern: '[0-9]*' } }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={close} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" size="large" disabled={isSubmitting} startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : undefined}>
            {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Add vehicle'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
