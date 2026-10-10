/** Services & zones tabs of the Services & pricing page. */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Box, Button, Checkbox, Chip, FormControlLabel, FormGroup, Grid, IconButton, MenuItem, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { api } from '@/api/client';
import { ErrorState, LoadingBlock, SectionCard } from '@/components/common';
import { MapView, type MapMarker } from '@/components/MapView';
import { humanize, VEHICLE_CLASS_LABELS } from '@/lib/format';
import type { ServiceCategoryRow, ZoneRow } from './types';
import { EnumChip, EQUIPMENT_TYPES, FormDialog, MultiSelect, numOpt, opts, SimpleTable, TRUCK_TYPES, VEHICLE_CLASSES } from './shared';
import { useCategories, useZones } from './queries';

// ─── Services ────────────────────────────────────────────────────────

const categorySchema = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z_]{3,40}$/, '3–40 capital letters or underscores, e.g. CAR_TOW'),
  name: z.string().trim().min(2, 'At least 2 characters').max(80),
  description: z.string().trim().max(500),
  kind: z.enum(['TOWING', 'ONSITE']),
  allowedTruckTypes: z.array(z.string()).min(1, 'Pick at least one truck type'),
  requiredEquipment: z.array(z.string()),
  vehicleClasses: z.array(z.string()),
  defaultCrew: z.number({ error: 'Required' }).int().min(1).max(6),
  icon: z.string().max(40),
  sortOrder: z.number({ error: 'Required' }).int(),
  active: z.boolean(),
});
type CategoryValues = z.infer<typeof categorySchema>;

function CategoryDialog({ open, onClose, category, onSaved }: { open: boolean; onClose: () => void; category: ServiceCategoryRow | null; onSaved: (m: string) => void }) {
  const { register, handleSubmit, reset, control, formState } = useForm<CategoryValues>({ resolver: zodResolver(categorySchema) });
  const save = useMutation({
    mutationFn: (v: CategoryValues) => {
      const body = { ...v, icon: v.icon || undefined };
      if (category) {
        const { key: _key, ...rest } = body;
        void _key;
        return api.patch(`/admin/pricing/categories/${category.id}`, rest);
      }
      return api.post('/admin/pricing/categories', body);
    },
    onSuccess: () => onSaved(category ? 'Service updated' : 'Service created'),
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    reset(
      category
        ? { key: category.key, name: category.name, description: category.description, kind: category.kind, allowedTruckTypes: category.allowedTruckTypes, requiredEquipment: category.requiredEquipment, vehicleClasses: category.vehicleClasses, defaultCrew: category.defaultCrew, icon: category.icon ?? '', sortOrder: category.sortOrder, active: category.active }
        : { key: '', name: '', description: '', kind: 'TOWING', allowedTruckTypes: [], requiredEquipment: [], vehicleClasses: [], defaultCrew: 1, icon: '', sortOrder: 0, active: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category, reset]);
  const e = formState.errors;
  return (
    <FormDialog open={open} title={category ? `Edit service: ${category.name}` : 'New service'} onClose={onClose} onSubmit={handleSubmit((v) => save.mutate(v))} submitting={save.isPending} error={save.error} maxWidth="md" submitLabel={category ? 'Save service' : 'Create service'}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField label="Key" fullWidth required disabled={!!category} {...register('key')} error={!!e.key} helperText={e.key?.message ?? (category ? 'Keys cannot change (used by memberships)' : 'Permanent identifier')} slotProps={{ htmlInput: { style: { textTransform: 'uppercase' } } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 5 }}>
          <TextField label="Name" fullWidth required {...register('name')} error={!!e.name} helperText={e.name?.message} />
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <Controller control={control} name="kind" render={({ field }) => (
            <TextField select label="Kind" fullWidth {...field}>
              <MenuItem value="TOWING">Towing</MenuItem>
              <MenuItem value="ONSITE">On-site assistance</MenuItem>
            </TextField>
          )} />
        </Grid>
        <Grid size={12}>
          <TextField label="Customer-facing description" fullWidth multiline minRows={2} {...register('description')} error={!!e.description} helperText={e.description?.message} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Controller control={control} name="allowedTruckTypes" render={({ field }) => <MultiSelect label="Allowed truck types *" options={opts(TRUCK_TYPES)} value={field.value ?? []} onChange={field.onChange} error={!!e.allowedTruckTypes} helperText={e.allowedTruckTypes?.message ?? 'Dispatch only offers jobs to these truck types'} />} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Controller control={control} name="requiredEquipment" render={({ field }) => <MultiSelect label="Required equipment" options={opts(EQUIPMENT_TYPES)} value={field.value ?? []} onChange={field.onChange} />} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Controller control={control} name="vehicleClasses" render={({ field }) => <MultiSelect label="Vehicle classes served" options={opts(VEHICLE_CLASSES, VEHICLE_CLASS_LABELS)} value={field.value ?? []} onChange={field.onChange} helperText="Empty = all classes" />} />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <TextField label="Default crew" type="number" fullWidth {...register('defaultCrew', numOpt)} error={!!e.defaultCrew} helperText={e.defaultCrew?.message} slotProps={{ htmlInput: { min: 1, max: 6 } }} />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <TextField label="Sort order" type="number" fullWidth {...register('sortOrder', numOpt)} error={!!e.sortOrder} helperText={e.sortOrder?.message} />
        </Grid>
        <Grid size={{ xs: 12, md: 2 }}>
          <TextField label="Icon key" fullWidth {...register('icon')} helperText="Optional" />
        </Grid>
        <Grid size={12}>
          <Controller control={control} name="active" render={({ field }) => <FormControlLabel control={<Switch checked={!!field.value} onChange={(ev) => field.onChange(ev.target.checked)} />} label="Active (offered to customers in enabled zones)" />} />
        </Grid>
      </Grid>
    </FormDialog>
  );
}

export function ServicesTab({ canManage, toast }: { canManage: boolean; toast: (m: string) => void }) {
  const qc = useQueryClient();
  const cats = useCategories();
  const zones = useZones();
  const [edit, setEdit] = useState<{ c: ServiceCategoryRow | null } | null>(null);
  if (cats.isLoading) return <LoadingBlock />;
  if (cats.error) return <ErrorState error={cats.error} onRetry={() => void cats.refetch()} />;
  return (
    <SectionCard title="Service catalogue" action={canManage && <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setEdit({ c: null })}>New service</Button>}>
      <SimpleTable
        rows={cats.data}
        rowKey={(c) => c.id}
        empty="No services configured."
        minWidth={980}
        columns={[
          { key: 'n', header: 'Service', render: (c) => (<><Typography variant="body2" sx={{ fontWeight: 600 }}>{c.name}</Typography><Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{c.key}</Typography></>) },
          { key: 'k', header: 'Kind', render: (c) => (c.kind === 'TOWING' ? 'Towing' : 'On-site') },
          { key: 't', header: 'Truck types', render: (c) => c.allowedTruckTypes.map(humanize).join(', ') },
          { key: 'e', header: 'Equipment', render: (c) => (c.requiredEquipment.length ? c.requiredEquipment.map(humanize).join(', ') : '—') },
          { key: 'v', header: 'Vehicle classes', render: (c) => (c.vehicleClasses.length ? c.vehicleClasses.map((v) => VEHICLE_CLASS_LABELS[v] ?? v).join(', ') : 'All') },
          { key: 'c', header: 'Crew', align: 'right', render: (c) => c.defaultCrew },
          { key: 'z', header: 'Zones', align: 'right', render: (c) => <Tooltip title={c.zones.filter((z) => z.active).map((z) => zones.data?.find((x) => x.id === z.zoneId)?.name ?? z.zoneId).join(', ') || 'Not enabled in any zone'}><span>{c.zones.filter((z) => z.active).length}</span></Tooltip> },
          { key: 's', header: 'Sort', align: 'right', render: (c) => c.sortOrder },
          { key: 'a', header: 'Status', render: (c) => <EnumChip value={c.active ? 'ACTIVE' : 'INACTIVE'} /> },
          { key: 'x', header: '', align: 'right', render: (c) => canManage && <IconButton size="small" aria-label={`Edit ${c.name}`} onClick={() => setEdit({ c })}><EditOutlinedIcon fontSize="small" /></IconButton> },
        ]}
      />
      <CategoryDialog open={!!edit} category={edit?.c ?? null} onClose={() => setEdit(null)} onSaved={(m) => { toast(m); setEdit(null); void qc.invalidateQueries({ queryKey: ['admin', 'pricing'] }); }} />
    </SectionCard>
  );
}

// ─── Zones ───────────────────────────────────────────────────────────

const zoneSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(80),
  city: z.string().trim().min(2, 'At least 2 characters').max(80),
  centerLat: z.number({ error: 'Pick a centre on the map' }).min(-90).max(90),
  centerLng: z.number({ error: 'Pick a centre on the map' }).min(-180).max(180),
  radiusKm: z.number({ error: 'Required' }).positive('Must be positive').max(300),
  polygon: z.string().refine((s) => {
    if (!s.trim()) return true;
    try {
      const p = JSON.parse(s) as { type?: string; coordinates?: unknown };
      return p.type === 'Polygon' && Array.isArray(p.coordinates) && p.coordinates.length > 0 && (p.coordinates as unknown[][]).every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === 'number')));
    } catch {
      return false;
    }
  }, 'Must be a GeoJSON Polygon: {"type":"Polygon","coordinates":[[[lng,lat],… ≥4 points, first = last]]}'),
  active: z.boolean(),
  categoryIds: z.array(z.string()),
});
type ZoneValues = z.infer<typeof zoneSchema>;

function ZoneDialog({ open, onClose, zone, categories, onSaved }: { open: boolean; onClose: () => void; zone: ZoneRow | null; categories: ServiceCategoryRow[]; onSaved: (m: string) => void }) {
  const { register, handleSubmit, reset, control, watch, setValue, formState } = useForm<ZoneValues>({ resolver: zodResolver(zoneSchema) });
  const save = useMutation({
    mutationFn: (v: ZoneValues) => {
      const body = { ...v, polygon: v.polygon.trim() ? JSON.parse(v.polygon) : null };
      return zone ? api.patch(`/admin/pricing/zones/${zone.id}`, body) : api.post('/admin/pricing/zones', body);
    },
    onSuccess: () => onSaved(zone ? 'Zone updated' : 'Zone created'),
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    reset(
      zone
        ? { name: zone.name, city: zone.city, centerLat: zone.centerLat, centerLng: zone.centerLng, radiusKm: zone.radiusKm, polygon: zone.polygon ? JSON.stringify(zone.polygon, null, 2) : '', active: zone.active, categoryIds: zone.categories.filter((c) => c.active).map((c) => c.categoryId) }
        : { name: '', city: '', centerLat: 12.9716, centerLng: 77.5946, radiusKm: 15, polygon: '', active: true, categoryIds: categories.filter((c) => c.active).map((c) => c.id) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, zone, reset]);
  const lat = watch('centerLat');
  const lng = watch('centerLng');
  const radius = watch('radiusKm');
  const e = formState.errors;
  const valid = Number.isFinite(lat) && Number.isFinite(lng);
  return (
    <FormDialog open={open} title={zone ? `Edit zone: ${zone.name}` : 'New service zone'} onClose={onClose} onSubmit={handleSubmit((v) => save.mutate(v))} submitting={save.isPending} error={save.error} maxWidth="md" submitLabel={zone ? 'Save zone' : 'Create zone'}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={2}>
            <TextField label="Zone name" fullWidth required {...register('name')} error={!!e.name} helperText={e.name?.message} />
            <TextField label="City" fullWidth required {...register('city')} error={!!e.city} helperText={e.city?.message} />
            <Stack direction="row" spacing={1.5}>
              <TextField label="Centre latitude" type="number" fullWidth {...register('centerLat', numOpt)} error={!!e.centerLat} helperText={e.centerLat?.message} slotProps={{ htmlInput: { step: 'any' } }} />
              <TextField label="Centre longitude" type="number" fullWidth {...register('centerLng', numOpt)} error={!!e.centerLng} helperText={e.centerLng?.message} slotProps={{ htmlInput: { step: 'any' } }} />
            </Stack>
            <TextField label="Service radius (km)" type="number" fullWidth {...register('radiusKm', numOpt)} error={!!e.radiusKm} helperText={e.radiusKm?.message ?? 'Bookings within this distance of the centre fall in this zone'} slotProps={{ htmlInput: { step: 0.5, min: 0.5, max: 300 } }} />
            <Controller control={control} name="active" render={({ field }) => <FormControlLabel control={<Switch checked={!!field.value} onChange={(ev) => field.onChange(ev.target.checked)} />} label="Active" />} />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
            Click the map to set the zone centre. The circle shows the service radius.
          </Typography>
          <MapView
            height={280}
            fit={false}
            zoom={10}
            center={valid ? { lat, lng } : undefined}
            markers={valid ? [{ id: 'centre', lat, lng, kind: 'truck', label: 'Z' }] : []}
            accuracyCircle={valid && radius > 0 ? { lat, lng, radiusM: radius * 1000 } : undefined}
            onMapClick={(la, ln) => {
              setValue('centerLat', Math.round(la * 1e6) / 1e6, { shouldValidate: true });
              setValue('centerLng', Math.round(ln * 1e6) / 1e6, { shouldValidate: true });
            }}
            ariaLabel="Zone centre picker"
          />
        </Grid>
        <Grid size={12}>
          <TextField label="Boundary polygon (GeoJSON, optional)" fullWidth multiline minRows={3} maxRows={8} {...register('polygon')} error={!!e.polygon} helperText={e.polygon?.message ?? 'When set, the polygon is used instead of the radius. Leave empty to use the radius only (clears any saved polygon). Coordinates are [longitude, latitude].'} slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 12 } } }} />
        </Grid>
        <Grid size={12}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Enabled services</Typography>
          <Controller
            control={control}
            name="categoryIds"
            render={({ field }) => (
              <FormGroup row>
                {categories.map((c) => (
                  <FormControlLabel
                    key={c.id}
                    sx={{ width: { xs: '100%', sm: '50%', md: '33%' }, mr: 0 }}
                    control={<Checkbox size="small" checked={field.value?.includes(c.id) ?? false} onChange={(ev) => field.onChange(ev.target.checked ? [...(field.value ?? []), c.id] : (field.value ?? []).filter((x) => x !== c.id))} />}
                    label={<Typography variant="body2" color={c.active ? undefined : 'text.disabled'}>{c.name}{c.active ? '' : ' (inactive)'}</Typography>}
                  />
                ))}
              </FormGroup>
            )}
          />
        </Grid>
      </Grid>
    </FormDialog>
  );
}

export function ZonesTab({ canManage, toast }: { canManage: boolean; toast: (m: string) => void }) {
  const qc = useQueryClient();
  const zones = useZones();
  const cats = useCategories();
  const [edit, setEdit] = useState<{ z: ZoneRow | null } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const markers: MapMarker[] = useMemo(
    () => (zones.data ?? []).map((z) => ({ id: z.id, lat: z.centerLat, lng: z.centerLng, kind: z.active ? 'truck' : 'idle', label: 'Z', popup: <Box><strong>{z.name}</strong><br />{z.city} · {z.radiusKm} km radius<br />{z.categories.filter((c) => c.active).length} services</Box>, onClick: () => setFocus(z.id) })),
    [zones.data],
  );
  const focused = zones.data?.find((z) => z.id === focus) ?? null;
  if (zones.isLoading) return <LoadingBlock />;
  if (zones.error) return <ErrorState error={zones.error} onRetry={() => void zones.refetch()} />;
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 7 }}>
        <SectionCard title="Service zones" action={canManage && <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setEdit({ z: null })}>New zone</Button>}>
          <SimpleTable
            rows={zones.data}
            rowKey={(z) => z.id}
            empty="No zones configured. Bookings outside zones cannot be served."
            onRowClick={(z) => setFocus(z.id)}
            minWidth={640}
            columns={[
              { key: 'n', header: 'Zone', render: (z) => (<><Typography variant="body2" sx={{ fontWeight: 600 }}>{z.name}</Typography><Typography variant="caption" color="text.secondary">{z.city}</Typography></>) },
              { key: 'r', header: 'Area', render: (z) => (z.polygon ? <Chip size="small" label="Polygon" variant="outlined" /> : `${z.radiusKm} km radius`) },
              { key: 's', header: 'Services', align: 'right', render: (z) => <Tooltip title={z.categories.filter((c) => c.active).map((c) => c.category.name).join(', ') || 'None'}><span>{z.categories.filter((c) => c.active).length}</span></Tooltip> },
              { key: 't', header: 'Trucks', align: 'right', render: (z) => z._count.trucks },
              { key: 'w', header: 'Workers', align: 'right', render: (z) => z._count.workers },
              { key: 'a', header: 'Status', render: (z) => <EnumChip value={z.active ? 'ACTIVE' : 'INACTIVE'} /> },
              { key: 'x', header: '', align: 'right', render: (z) => canManage && <IconButton size="small" aria-label={`Edit ${z.name}`} onClick={(ev) => { ev.stopPropagation(); setEdit({ z }); }}><EditOutlinedIcon fontSize="small" /></IconButton> },
            ]}
          />
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, lg: 5 }}>
        <SectionCard title="Map preview">
          <MapView key={focus ?? "all"} height={380} markers={markers} zoom={10} fit={!focused} center={focused ? { lat: focused.centerLat, lng: focused.centerLng } : undefined} accuracyCircle={focused ? { lat: focused.centerLat, lng: focused.centerLng, radiusM: focused.radiusKm * 1000 } : undefined} ariaLabel="Service zones map" />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            {focused ? `Showing ${focused.name}: ${focused.radiusKm} km radius${focused.polygon ? ' (polygon boundary takes precedence)' : ''}.` : 'Select a zone to see its service radius. Grey markers are inactive zones.'}
          </Typography>
        </SectionCard>
      </Grid>
      <ZoneDialog open={!!edit} zone={edit?.z ?? null} categories={cats.data ?? []} onClose={() => setEdit(null)} onSaved={(m) => { toast(m); setEdit(null); void qc.invalidateQueries({ queryKey: ['admin', 'pricing'] }); }} />
    </Grid>
  );
}
