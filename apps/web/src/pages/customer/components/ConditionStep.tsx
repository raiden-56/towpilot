import { Alert, Box, Checkbox, Chip, Divider, FormControlLabel, FormGroup, Grid, IconButton, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import AddAPhotoOutlinedIcon from '@mui/icons-material/AddAPhotoOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { ACCESS_LABELS, BREAKDOWN_LABELS, TRI_QUESTIONS } from './bookingParts';
import { FilePickButton, IMAGE_ACCEPT, VIDEO_ACCEPT } from './shared';

export type Tri = 'YES' | 'NO' | 'NOT_SURE';

export interface AssessmentState {
  breakdownType: string;
  engineStarts: Tri;
  wheelsRotate: Tri;
  steeringWorks: Tri;
  brakesWork: Tri;
  isStuck: Tri;
  isOverturned: Tri;
  isSubmerged: Tri;
  blockingTraffic: Tri;
  majorDamage: Tri;
  isEvOrHybrid: boolean;
  accessRestriction: string;
  hasChildren: boolean;
  hasElderly: boolean;
  needsAccessibility: boolean;
  passengersNeedingTransport: number;
  notes: string;
}

export const defaultAssessment = (): AssessmentState => ({
  breakdownType: '',
  engineStarts: 'NOT_SURE',
  wheelsRotate: 'NOT_SURE',
  steeringWorks: 'NOT_SURE',
  brakesWork: 'NOT_SURE',
  isStuck: 'NOT_SURE',
  isOverturned: 'NOT_SURE',
  isSubmerged: 'NOT_SURE',
  blockingTraffic: 'NOT_SURE',
  majorDamage: 'NOT_SURE',
  isEvOrHybrid: false,
  accessRestriction: 'NONE',
  hasChildren: false,
  hasElderly: false,
  needsAccessibility: false,
  passengersNeedingTransport: 0,
  notes: '',
});

export interface PendingFile {
  id: string;
  file: File;
  url: string;
  kind: 'DAMAGE_PHOTO' | 'DAMAGE_VIDEO';
}

function TriToggle({ label, value, onChange, hint }: { label: string; value: Tri; onChange: (v: Tri) => void; hint?: string }) {
  const id = `tri-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.75, sm: 2 }} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between" sx={{ py: 1 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography id={id} variant="body2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </Box>
      <ToggleButtonGroup exclusive size="small" value={value} onChange={(_, v: Tri | null) => v && onChange(v)} aria-labelledby={id} sx={{ flexShrink: 0, '& .MuiToggleButton-root': { flex: { xs: 1, sm: 'unset' }, px: 1.75, minHeight: 40 } }}>
        <ToggleButton value="YES">Yes</ToggleButton>
        <ToggleButton value="NO">No</ToggleButton>
        <ToggleButton value="NOT_SURE">Not sure</ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}

export function ConditionStep({
  value,
  onChange,
  errors,
  towing,
  crewRequested,
  onCrewChange,
  files,
  onAddFiles,
  onRemoveFile,
  fileError,
}: {
  value: AssessmentState;
  onChange: (patch: Partial<AssessmentState>) => void;
  errors: Record<string, string>;
  towing: boolean;
  crewRequested: number;
  onCrewChange: (n: number) => void;
  files: PendingFile[];
  onAddFiles: (files: File[], kind: PendingFile['kind']) => void;
  onRemoveFile: (id: string) => void;
  fileError: string | null;
}) {
  return (
    <Stack spacing={2.5}>
      <TextField select label="What happened?" value={value.breakdownType} onChange={(e) => onChange({ breakdownType: e.target.value })} error={!!errors.breakdownType} helperText={errors.breakdownType} required>
        {Object.entries(BREAKDOWN_LABELS).map(([k, l]) => (
          <MenuItem key={k} value={k}>
            {l}
          </MenuItem>
        ))}
      </TextField>

      <Box>
        <Typography variant="h6" component="h3">
          Vehicle condition
        </Typography>
        <Alert severity="info" sx={{ mt: 1 }}>
          Only answer what you can see from a safe place — do not get under, inside or around the vehicle near traffic to check. “Not sure” is always fine; our crew will inspect on arrival.
        </Alert>
        <Box sx={{ mt: 1 }}>
          {TRI_QUESTIONS.map((q, i) => (
            <Box key={q.key}>
              {i > 0 && <Divider />}
              <TriToggle
                label={q.label}
                value={value[q.key]}
                onChange={(v) => onChange({ [q.key]: v } as Partial<AssessmentState>)}
                hint={q.key === 'isOverturned' || q.key === 'isSubmerged' ? 'If you answer “Not sure”, the driver checks this on arrival before any recovery work. “Yes” means our coordinator reviews the request before dispatch.' : undefined}
              />
            </Box>
          ))}
        </Box>
      </Box>

      <FormGroup>
        <FormControlLabel control={<Checkbox checked={value.isEvOrHybrid} onChange={(e) => onChange({ isEvOrHybrid: e.target.checked })} />} label="This is an electric or hybrid vehicle" />
        {value.isEvOrHybrid && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            EVs and hybrids have high-voltage systems. Do not touch damaged battery areas, cables or anything that smells of burning. Stay away and wait for the crew.
          </Alert>
        )}
      </FormGroup>

      <TextField select label="Access at the pickup point" value={value.accessRestriction} onChange={(e) => onChange({ accessRestriction: e.target.value })} helperText="Basements and tight lanes need a smaller truck or extra equipment.">
        {Object.entries(ACCESS_LABELS).map(([k, l]) => (
          <MenuItem key={k} value={k}>
            {l}
          </MenuItem>
        ))}
      </TextField>

      <Box>
        <Typography variant="h6" component="h3" sx={{ mb: 0.5 }}>
          People with the vehicle
        </Typography>
        <FormGroup>
          <FormControlLabel control={<Checkbox checked={value.hasChildren} onChange={(e) => onChange({ hasChildren: e.target.checked })} />} label="Children are with me" />
          <FormControlLabel control={<Checkbox checked={value.hasElderly} onChange={(e) => onChange({ hasElderly: e.target.checked })} />} label="An elderly person is with me" />
          <FormControlLabel control={<Checkbox checked={value.needsAccessibility} onChange={(e) => onChange({ needsAccessibility: e.target.checked })} />} label="Someone needs accessibility support" />
        </FormGroup>
        <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Passengers needing a ride"
              value={value.passengersNeedingTransport}
              onChange={(e) => onChange({ passengersNeedingTransport: Number(e.target.value) })}
              helperText={towing ? 'A tow truck cab seats at most 2 passengers.' : 'People who need transport from the location.'}
              error={!!errors.passengersNeedingTransport}
            >
              {Array.from({ length: 11 }, (_, n) => (
                <MenuItem key={n} value={n}>
                  {n === 10 ? '10 or more' : n}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select label="Crew members requested" value={crewRequested} onChange={(e) => onCrewChange(Number(e.target.value))} helperText="Final staffing depends on the on-site assessment.">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>
      </Box>

      <Box>
        <Typography variant="h6" component="h3">
          Photos or videos (optional)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Only if it is safe to take them. They help the crew bring the right equipment and record the vehicle's condition. They are uploaded after you get your quote.
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <FilePickButton accept={IMAGE_ACCEPT} multiple onFiles={(f) => onAddFiles(f, 'DAMAGE_PHOTO')} variant="outlined" startIcon={<AddAPhotoOutlinedIcon />}>
            Add photos
          </FilePickButton>
          <FilePickButton accept={VIDEO_ACCEPT} multiple onFiles={(f) => onAddFiles(f, 'DAMAGE_VIDEO')} variant="outlined" startIcon={<VideocamOutlinedIcon />}>
            Add video
          </FilePickButton>
        </Stack>
        {fileError && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {fileError}
          </Alert>
        )}
        {files.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            {files.map((f) => (
              <Box key={f.id} sx={{ position: 'relative', width: 88, height: 88, borderRadius: 2, overflow: 'hidden', border: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
                {f.kind === 'DAMAGE_PHOTO' ? (
                  <Box component="img" src={f.url} alt={`Selected photo ${f.file.name}`} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', p: 0.5 }}>
                    <VideocamOutlinedIcon aria-hidden />
                    <Typography variant="caption" noWrap sx={{ maxWidth: '100%' }}>
                      {f.file.name}
                    </Typography>
                  </Stack>
                )}
                <IconButton size="small" aria-label={`Remove ${f.file.name}`} onClick={() => onRemoveFile(f.id)} sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(0,0,0,0.55)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' } }}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Stack>
        )}
        {files.length > 0 && <Chip size="small" sx={{ mt: 1 }} label={`${files.length} file${files.length === 1 ? '' : 's'} ready to upload`} />}
      </Box>

      <TextField
        label="Anything else the crew should know?"
        value={value.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
        multiline
        minRows={2}
        error={!!errors.notes}
        helperText={errors.notes ?? `${value.notes.length}/1000`}
        slotProps={{ htmlInput: { maxLength: 1000 } }}
      />
    </Stack>
  );
}
