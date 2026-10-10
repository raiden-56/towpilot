import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Collapse, Grid, IconButton, InputAdornment, List, ListItemButton, ListItemText, Stack, TextField, Tooltip, Typography } from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkIcon from '@mui/icons-material/Link';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '@/api/client';
import type { Location } from '@/api/types';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useIsOnline } from '@/hooks/useOnline';
import { relative, time } from '@/lib/format';
import { MapView } from './MapView';

export type LocationValue = Omit<Location, 'kind' | 'id'>;

/**
 * Robust location capture: GPS (requested only on demand) with accuracy and capture time, a
 * draggable pin for correction, reverse geocoding when available, address search, map-link
 * paste, manual entry when GPS is denied, and road-side details (highway, km marker, gate, floor).
 */
export function LocationPicker({ value, onChange, variant = 'pickup', autoLocate }: { value: LocationValue | null; onChange: (v: LocationValue) => void; variant?: 'pickup' | 'dropoff'; autoLocate?: boolean }) {
  const geo = useGeolocation();
  const online = useIsOnline();
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeNote, setGeocodeNote] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ lat: number; lng: number; label: string }[] | null>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(variant === 'pickup');

  const patch = (p: Partial<LocationValue>) => onChange({ ...(value ?? { lat: 0, lng: 0, source: 'MANUAL' }), ...p } as LocationValue);

  async function resolveAddress(lat: number, lng: number, base: Partial<LocationValue>) {
    onChange({ ...(value ?? {}), ...base, lat, lng } as LocationValue);
    if (!online) return setGeocodeNote('Offline — address lookup will be skipped. Add a landmark so the driver can find you.');
    setGeocoding(true);
    try {
      const r = await api.get<{ address: string | null; available: boolean }>('/locations/reverse', { lat, lng });
      if (r.address) onChange({ ...(value ?? {}), ...base, lat, lng, address: r.address } as LocationValue);
      setGeocodeNote(r.available ? null : 'Address lookup is not configured. Please type the address or a landmark below.');
    } catch {
      setGeocodeNote('Could not look up the address. Please type it below.');
    } finally {
      setGeocoding(false);
    }
  }

  async function useGps() {
    const f = await geo.locate();
    if (f) await resolveAddress(f.lat, f.lng, { source: 'GPS', accuracyM: f.accuracyM, capturedAt: f.capturedAt });
  }

  useEffect(() => {
    if (autoLocate && !value) void useGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSearch() {
    if (search.trim().length < 3) return;
    try {
      const r = await api.get<{ results: { lat: number; lng: number; label: string }[]; available: boolean }>('/locations/search', { q: search });
      setResults(r.results);
      if (!r.available) setGeocodeNote('Address search is not configured. Drop the pin on the map or paste a maps link.');
    } catch {
      setResults([]);
    }
  }

  async function parseLink() {
    setLinkError(null);
    try {
      const r = await api.post<{ point: { lat: number; lng: number } | null; note: string | null }>('/locations/parse-link', { url: link });
      if (!r.point) return setLinkError(r.note ?? 'Could not read this link');
      await resolveAddress(r.point.lat, r.point.lng, { source: 'LINK', accuracyM: null, capturedAt: new Date().toISOString() });
      setLink('');
    } catch {
      setLinkError('Could not read this link');
    }
  }

  const coords = value && value.lat ? `${value.lat.toFixed(6)}, ${value.lng.toFixed(6)}` : null;
  const poorAccuracy = value?.accuracyM != null && value.accuracyM > 100;

  return (
    <Stack spacing={2}>
      {variant === 'pickup' && (
        <Button size="large" variant="contained" startIcon={geo.loading ? <CircularProgress size={18} color="inherit" /> : <MyLocationIcon />} onClick={useGps} disabled={geo.loading}>
          {geo.loading ? 'Getting your location…' : value?.source === 'GPS' ? 'Refresh my location' : 'Use my current location'}
        </Button>
      )}
      {geo.errorText && <Alert severity="warning">{geo.errorText}</Alert>}

      <MapView
        height={260}
        markers={value && value.lat ? [{ id: 'pin', lat: value.lat, lng: value.lng, kind: variant === 'pickup' ? 'pickup' : 'dropoff' }] : []}
        accuracyCircle={value?.accuracyM && value.lat ? { lat: value.lat, lng: value.lng, radiusM: value.accuracyM } : undefined}
        draggable="pin"
        onDragEnd={(lat, lng) => resolveAddress(lat, lng, { source: 'MAP_PIN', accuracyM: null, capturedAt: new Date().toISOString() })}
        onMapClick={(lat, lng) => resolveAddress(lat, lng, { source: 'MAP_PIN', accuracyM: null, capturedAt: new Date().toISOString() })}
        ariaLabel={variant === 'pickup' ? 'Pickup location map. Tap to place or drag the pin to correct it.' : 'Destination map'}
      />
      <Typography variant="caption" color="text.secondary">
        Tap the map or drag the pin to correct the position.
      </Typography>

      {coords && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip size="small" label={coords} variant="outlined" />
          {value?.accuracyM != null && <Chip size="small" color={poorAccuracy ? 'warning' : 'success'} label={`± ${value.accuracyM} m`} />}
          {value?.capturedAt && <Chip size="small" label={`${value.source === 'GPS' ? 'GPS' : 'Set'} ${time(value.capturedAt)} (${relative(value.capturedAt)})`} variant="outlined" />}
          <Tooltip title={copied ? 'Copied' : 'Copy coordinates'}>
            <IconButton
              size="small"
              aria-label="Copy location"
              onClick={async () => {
                await navigator.clipboard?.writeText(`${coords} https://maps.google.com/?q=${value!.lat},${value!.lng}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {geocoding && <CircularProgress size={16} />}
        </Stack>
      )}
      {poorAccuracy && <Alert severity="warning">GPS accuracy is low (±{value!.accuracyM} m). Drag the pin to your exact spot and add a landmark.</Alert>}
      {geocodeNote && <Alert severity="info">{geocodeNote}</Alert>}

      <TextField
        label="Search for a place or address"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), runSearch())}
        slotProps={{ input: { endAdornment: <InputAdornment position="end"><IconButton aria-label="Search" onClick={runSearch}><SearchIcon /></IconButton></InputAdornment> } }}
      />
      {results && (
        <List dense sx={{ border: 1, borderColor: 'divider', borderRadius: 2, py: 0 }}>
          {results.length === 0 && <ListItemText sx={{ px: 2, py: 1 }} primary="No matches. Try the map pin or a maps link." />}
          {results.map((r) => (
            <ListItemButton
              key={`${r.lat},${r.lng}`}
              onClick={() => {
                onChange({ ...(value ?? {}), lat: r.lat, lng: r.lng, address: r.label, source: 'MANUAL', accuracyM: null, capturedAt: new Date().toISOString() } as LocationValue);
                setResults(null);
              }}
            >
              <ListItemText primary={r.label} />
            </ListItemButton>
          ))}
        </List>
      )}
      <TextField
        label="Or paste a Google Maps / location link"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        error={!!linkError}
        helperText={linkError ?? 'Example: https://maps.google.com/?q=12.97,77.59'}
        slotProps={{ input: { endAdornment: <InputAdornment position="end"><Button size="small" startIcon={<LinkIcon />} onClick={parseLink} disabled={!link.trim()}>Use</Button></InputAdornment> } }}
      />
      <TextField label="Address" value={value?.address ?? ''} onChange={(e) => patch({ address: e.target.value })} multiline minRows={2} required={!value?.lat} helperText={!value?.lat ? 'Required if you cannot share GPS or drop a pin' : undefined} />
      <TextField label={variant === 'pickup' ? 'Nearby landmark' : 'Garage / place name'} value={(variant === 'pickup' ? value?.landmark : value?.placeName) ?? ''} onChange={(e) => patch(variant === 'pickup' ? { landmark: e.target.value } : { placeName: e.target.value })} />

      {variant === 'pickup' && (
        <>
          <Button size="small" onClick={() => setShowDetails((s) => !s)} sx={{ alignSelf: 'flex-start' }}>
            {showDetails ? 'Hide' : 'Add'} road / building details
          </Button>
          <Collapse in={showDetails}>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 6 }}><TextField label="Highway / road name" value={value?.highway ?? ''} onChange={(e) => patch({ highway: e.target.value })} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><TextField label="Direction of travel" placeholder="e.g. towards Mysuru" value={value?.roadDirection ?? ''} onChange={(e) => patch({ roadDirection: e.target.value })} /></Grid>
              <Grid size={{ xs: 6, sm: 3 }}><TextField label="KM marker" value={value?.kmMarker ?? ''} onChange={(e) => patch({ kmMarker: e.target.value })} /></Grid>
              <Grid size={{ xs: 6, sm: 3 }}><TextField label="Gate no." value={value?.gateNumber ?? ''} onChange={(e) => patch({ gateNumber: e.target.value })} /></Grid>
              <Grid size={{ xs: 6, sm: 3 }}><TextField label="Floor" value={value?.floor ?? ''} onChange={(e) => patch({ floor: e.target.value })} /></Grid>
              <Grid size={{ xs: 6, sm: 3 }}><TextField label="Parking level" value={value?.parkingLevel ?? ''} onChange={(e) => patch({ parkingLevel: e.target.value })} /></Grid>
              <Grid size={12}><TextField label="Access instructions" placeholder="Security desk, height limit, tight turns…" value={value?.accessNotes ?? ''} onChange={(e) => patch({ accessNotes: e.target.value })} multiline minRows={2} /></Grid>
            </Grid>
          </Collapse>
        </>
      )}
      <Box />
    </Stack>
  );
}
