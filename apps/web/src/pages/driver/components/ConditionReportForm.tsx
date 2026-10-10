import { useMemo, useState } from 'react';
import { Alert, Box, Button, Divider, IconButton, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { BookingDetail } from '@/api/types';
import { errorMessage } from '@/components/common';
import { useIsOnline } from '@/hooks/useOnline';
import { dateTime } from '@/lib/format';
import { AttachmentGrid, EvidenceUploader } from './EvidenceUploader';
import type { ConditionReport } from './driverShared';

const AREAS = ['Front bumper', 'Rear bumper', 'Bonnet', 'Roof', 'Boot / tailgate', 'Left side', 'Right side', 'Windscreen', 'Rear glass', 'Wheels / tyres', 'Lights', 'Mirrors', 'Interior', 'Underbody', 'Other'];
const FUEL = ['Empty', '1/4', '1/2', '3/4', 'Full'];

/**
 * Pickup / delivery condition report: evidence photos (at least one), damage marks, fuel level,
 * odometer, items left in the vehicle and notes. A correction supersedes an earlier report.
 */
export function ConditionReportForm({ booking, stage, supersedes, onDone, onCancel }: { booking: BookingDetail; stage: 'PICKUP' | 'DELIVERY'; supersedes?: ConditionReport | null; onDone?: () => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const kind = stage === 'PICKUP' ? 'PICKUP_EVIDENCE' : 'DELIVERY_EVIDENCE';
  const reports = (booking.conditionReports ?? []) as ConditionReport[];
  const used = useMemo(() => new Set(reports.flatMap((r) => r.attachmentIds)), [reports]);
  const photos = (booking.attachments ?? []).filter((a) => a.kind === kind);
  const [selected, setSelected] = useState<string[]>(() => (supersedes ? supersedes.attachmentIds : photos.filter((p) => !used.has(p.id)).map((p) => p.id)));
  const [marks, setMarks] = useState<{ area: string; description: string }[]>(() => supersedes?.damageMarks ?? []);
  const [fuel, setFuel] = useState<string>(supersedes?.fuelLevel ?? '');
  const [odometer, setOdometer] = useState(supersedes?.odometerKm != null ? String(supersedes.odometerKm) : '');
  const [items, setItems] = useState(supersedes?.itemsInVehicle ?? '');
  const [notes, setNotes] = useState(supersedes?.notes ?? '');
  const ev = booking.vehicle?.fuelType === 'ELECTRIC';

  const odoValid = odometer === '' || /^\d{1,7}$/.test(odometer.trim());
  const marksValid = marks.every((m) => m.area && m.description.trim().length >= 2);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/driver/jobs/${booking.id}/condition-reports`, {
        stage,
        notes: notes.trim() || undefined,
        damageMarks: marks.map((m) => ({ area: m.area, description: m.description.trim() })),
        odometerKm: odometer.trim() ? Number(odometer.trim()) : undefined,
        fuelLevel: fuel || undefined,
        itemsInVehicle: items.trim() || undefined,
        attachmentIds: selected,
        supersedesId: supersedes?.id,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['booking', booking.id] });
      onDone?.();
    },
  });

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Stack spacing={2}>
      {supersedes && <Alert severity="info">Correcting the {stage.toLowerCase()} report from {dateTime(supersedes.createdAt)}. The original stays on record.</Alert>}
      <Box>
        <Typography variant="h6" gutterBottom>
          1. Photos {stage === 'PICKUP' ? 'before moving the vehicle' : 'at the destination'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          All four sides, close-ups of any damage{stage === 'PICKUP' ? ', the odometer and fuel gauge' : ''}. Tap a photo to include or exclude it.
        </Typography>
        <EvidenceUploader bookingId={booking.id} kind={kind} label="Take photos" onUploaded={(rows) => setSelected((s) => [...s, ...rows.map((r) => r.id)])} />
        <Box sx={{ mt: 1.5 }}>
          <AttachmentGrid attachments={photos} selected={selected} onToggle={toggle} empty="No photos yet." />
        </Box>
        <Typography variant="body2" sx={{ mt: 1, fontWeight: 600 }} color={selected.length ? 'success.main' : 'error.main'}>
          {selected.length} photo{selected.length === 1 ? '' : 's'} selected{selected.length ? '' : ' — at least one is required'}
        </Typography>
      </Box>

      <Divider />
      <Box>
        <Typography variant="h6" gutterBottom>
          2. Damage
        </Typography>
        <Stack spacing={1.5}>
          {marks.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No damage marked. Add each existing dent, scratch or broken part so it is on record.
            </Typography>
          )}
          {marks.map((m, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
              <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
                <TextField select label="Where" value={m.area} onChange={(e) => setMarks((ms) => ms.map((x, j) => (j === i ? { ...x, area: e.target.value } : x)))}>
                  {AREAS.map((a) => (
                    <MenuItem key={a} value={a}>
                      {a}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField label="What (dent, scratch, cracked…)" value={m.description} onChange={(e) => setMarks((ms) => ms.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} slotProps={{ htmlInput: { maxLength: 300 } }} />
              </Stack>
              <IconButton aria-label="Remove damage mark" onClick={() => setMarks((ms) => ms.filter((_, j) => j !== i))} sx={{ width: 48, height: 48 }}>
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}
          <Button size="large" variant="outlined" startIcon={<AddIcon />} disabled={marks.length >= 30} onClick={() => setMarks((ms) => [...ms, { area: AREAS[0]!, description: '' }])}>
            Add damage mark
          </Button>
        </Stack>
      </Box>

      <Divider />
      <Box>
        <Typography variant="h6" gutterBottom>
          3. {ev ? 'Battery charge' : 'Fuel level'}
        </Typography>
        <ToggleButtonGroup exclusive fullWidth value={fuel} onChange={(_, v: string | null) => setFuel(v ?? '')} aria-label={ev ? 'Battery charge' : 'Fuel level'}>
          {FUEL.map((f) => (
            <ToggleButton key={f} value={f} sx={{ minHeight: 52, fontWeight: 700, fontSize: '1rem' }}>
              {f}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      <TextField
        label="Odometer (km)"
        value={odometer}
        onChange={(e) => setOdometer(e.target.value.replace(/[^\d]/g, ''))}
        error={!odoValid}
        helperText={!odoValid ? 'Whole kilometres only' : 'Optional'}
        slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*', maxLength: 7 } }}
      />
      <TextField label="Items left in the vehicle" placeholder="e.g. laptop bag on rear seat, spare wheel present" value={items} onChange={(e) => setItems(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
      <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 2000 } }} />

      {save.error && <Alert severity="error">{errorMessage(save.error)}</Alert>}
      <Stack direction="row" spacing={1}>
        {onCancel && (
          <Button size="large" onClick={onCancel} sx={{ flex: 1 }}>
            Cancel
          </Button>
        )}
        <Button size="large" variant="contained" sx={{ flex: 2 }} disabled={!online || save.isPending || !selected.length || !odoValid || !marksValid} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : supersedes ? 'Save correction' : `Save ${stage === 'PICKUP' ? 'pickup' : 'delivery'} report`}
        </Button>
      </Stack>
    </Stack>
  );
}

/** Compact read-only summary of a recorded condition report. */
export function ConditionReportSummary({ report, booking }: { report: ConditionReport; booking: BookingDetail }) {
  const photos = (booking.attachments ?? []).filter((a) => report.attachmentIds.includes(a.id));
  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        <strong>{report.damageMarks.length ? `${report.damageMarks.length} damage mark${report.damageMarks.length > 1 ? 's' : ''}` : 'No damage marked'}</strong>
        {report.fuelLevel && ` · Fuel/charge ${report.fuelLevel}`}
        {report.odometerKm != null && ` · ${report.odometerKm.toLocaleString('en-IN')} km`}
        {` · ${report.attachmentIds.length} photo${report.attachmentIds.length === 1 ? '' : 's'}`}
      </Typography>
      {report.damageMarks.map((m, i) => (
        <Typography key={i} variant="body2" color="text.secondary">
          • {m.area}: {m.description}
        </Typography>
      ))}
      {report.itemsInVehicle && (
        <Typography variant="body2" color="text.secondary">
          Items: {report.itemsInVehicle}
        </Typography>
      )}
      {report.notes && (
        <Typography variant="body2" color="text.secondary">
          Notes: {report.notes}
        </Typography>
      )}
      {photos.length > 0 && <AttachmentGrid attachments={photos} />}
    </Stack>
  );
}
