import { useEffect, useMemo, useRef } from 'react';
import { Circle, MapContainer, Marker, Popup, TileLayer, Tooltip as LTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Box, Stack, Typography } from '@mui/material';
import { humanize, relative, time } from '@/lib/format';
import type { BoardBooking, BoardDriver, Zone } from './types';

/** Tile provider is configurable (see components/MapView.tsx); OSM tiles are for development only. */
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION ?? '&copy; OpenStreetMap contributors';

export const PRIORITY_COLORS: Record<string, string> = { CRITICAL: '#b91c1c', HIGH: '#c2410c', NORMAL: '#1d4ed8' };
export const DRIVER_COLORS: Record<string, string> = { AVAILABLE: '#15803d', ON_JOB: '#7c3aed', BUSY: '#7c3aed', ON_BREAK: '#a16207', OFF_DUTY: '#64748b' };

const iconCache = new Map<string, L.DivIcon>();
function pinIcon(color: string, text: string, opts: { selected?: boolean; faded?: boolean; round?: boolean } = {}) {
  const key = `${color}|${text}|${opts.selected}|${opts.faded}|${opts.round}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const size = opts.selected ? 36 : 28;
  const shape = opts.round ? 'border-radius:50%' : 'border-radius:50% 50% 50% 0;transform:rotate(-45deg)';
  const inner = opts.round ? '' : 'transform:rotate(45deg);';
  const icon = L.divIcon({
    className: 'tp-marker',
    html: `<div style="background:${color};color:#fff;border:${opts.selected ? 3 : 2}px ${opts.faded ? 'dashed' : 'solid'} #fff;${shape};width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35);opacity:${opts.faded ? 0.6 : 1}"><span style="${inner}font:700 11px/1 Inter,system-ui">${text}</span></div>`,
    iconSize: [size, size],
    iconAnchor: opts.round ? [size / 2, size / 2] : [size / 2, size],
    popupAnchor: [0, opts.round ? -size / 2 : -size],
  });
  iconCache.set(key, icon);
  return icon;
}

function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !points.length) return;
    done.current = true;
    if (points.length === 1) map.setView(points[0]!, 12);
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 13 });
  }, [points, map]);
  return null;
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 13), { duration: 0.6 });
  }, [target, map]);
  return null;
}

export interface LiveDriver extends BoardDriver {
  /** True when the position came from a realtime update after the board was loaded. */
  live?: boolean;
}

export function DispatchMap({
  bookings,
  drivers,
  zones,
  selectedId,
  onSelect,
  height = 460,
}: {
  bookings: BoardBooking[];
  drivers: LiveDriver[];
  zones: Zone[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  height?: number | string;
}) {
  const pins = useMemo(
    () =>
      bookings
        .map((b) => ({ b, p: b.locations.find((l) => l.kind === 'PICKUP') }))
        .filter((x): x is { b: BoardBooking; p: NonNullable<typeof x.p> } => !!x.p),
    [bookings],
  );
  const placed = drivers.filter((d) => d.lat != null && d.lng != null);
  const points = useMemo<[number, number][]>(
    () => [...pins.map((x) => [x.p.lat, x.p.lng] as [number, number]), ...placed.map((d) => [d.lat!, d.lng!] as [number, number]), ...zones.map((z) => [z.centerLat, z.centerLng] as [number, number])],
    // Fit once on first data only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pins.length > 0 || placed.length > 0 || zones.length > 0],
  );
  const selected = pins.find((x) => x.b.id === selectedId);
  const flyTarget = useMemo<[number, number] | null>(() => (selected ? [selected.p.lat, selected.p.lng] : null), [selected?.b.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = zones[0] ? { lat: zones[0].centerLat, lng: zones[0].centerLng } : { lat: 12.9716, lng: 77.5946 };

  return (
    <Box>
      <Box role="region" aria-label="Live dispatch map" sx={{ height, borderRadius: 2, overflow: 'hidden', border: 1, borderColor: 'divider', '& .leaflet-container': { height: '100%', width: '100%', fontFamily: 'inherit' }, '& .tp-marker': { background: 'transparent', border: 0 } }}>
        <MapContainer center={[start.lat, start.lng]} zoom={11} scrollWheelZoom>
          <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
          <FitOnce points={points} />
          <FlyTo target={flyTarget} />
          {zones.map((z) => (
            <Circle key={z.id} center={[z.centerLat, z.centerLng]} radius={z.radiusKm * 1000} pathOptions={{ color: '#64748b', weight: 1, dashArray: '4 6', fillOpacity: 0.04 }}>
              <LTooltip sticky>{z.name}</LTooltip>
            </Circle>
          ))}
          {placed.map((d) => {
            const status = d.status ?? 'OFF_DUTY';
            return (
              <Marker key={`d-${d.id}`} position={[d.lat!, d.lng!]} icon={pinIcon(d.locationStale ? '#64748b' : (DRIVER_COLORS[status] ?? '#64748b'), d.name.replace(/^Sample (Driver|Worker) /, '').slice(0, 2).toUpperCase(), { round: true, faded: d.locationStale })} zIndexOffset={-100}>
                <Popup>
                  <strong>{d.name}</strong>
                  <br />
                  {humanize(status)}
                  {d.truck && ` · ${d.truck.registrationNumber}`}
                  <br />
                  {d.lastLocationAt ? `Location ${relative(d.lastLocationAt)} (${time(d.lastLocationAt)})` : 'No location reported'}
                  {d.locationStale && (
                    <>
                      <br />
                      <span style={{ color: '#b91c1c', fontWeight: 600 }}>Stale location — position may be outdated</span>
                    </>
                  )}
                </Popup>
              </Marker>
            );
          })}
          {pins.map(({ b, p }) => (
            <Marker key={b.id} position={[p.lat, p.lng]} icon={pinIcon(PRIORITY_COLORS[b.priority] ?? '#1d4ed8', b.priority === 'CRITICAL' ? '!!' : b.priority === 'HIGH' ? '!' : '•', { selected: b.id === selectedId })} eventHandlers={{ click: () => onSelect(b.id) }} zIndexOffset={b.id === selectedId ? 1000 : 0}>
              <LTooltip direction="top" offset={[0, -24]}>
                {b.code} · {b.statusLabel}
              </LTooltip>
            </Marker>
          ))}
        </MapContainer>
      </Box>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        {(
          [
            ['Critical', PRIORITY_COLORS.CRITICAL, false],
            ['High priority', PRIORITY_COLORS.HIGH, false],
            ['Normal', PRIORITY_COLORS.NORMAL, false],
            ['Driver available', DRIVER_COLORS.AVAILABLE, true],
            ['On job / busy', DRIVER_COLORS.ON_JOB, true],
            ['On break', DRIVER_COLORS.ON_BREAK, true],
            ['Off duty / stale location', DRIVER_COLORS.OFF_DUTY, true],
          ] as const
        ).map(([label, color, round]) => (
          <Stack key={label} direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 12, height: 12, bgcolor: color, borderRadius: round ? '50%' : '50% 50% 50% 0', transform: round ? undefined : 'rotate(-45deg)' }} />
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
