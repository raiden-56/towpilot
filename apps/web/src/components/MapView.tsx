import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Box } from '@mui/material';

/**
 * Map rendering uses Leaflet with a configurable tile provider:
 *   VITE_MAP_TILE_URL / VITE_MAP_ATTRIBUTION (e.g. Mapbox or Google-licensed tiles in production).
 * The default OpenStreetMap tiles are for development only (OSM tile usage policy).
 */
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION ?? '&copy; OpenStreetMap contributors';

export type MarkerKind = 'pickup' | 'dropoff' | 'driver' | 'truck' | 'booking' | 'alert' | 'idle';

const COLORS: Record<MarkerKind, string> = {
  pickup: '#dc2626',
  dropoff: '#15803d',
  driver: '#f59e0b',
  truck: '#2563eb',
  booking: '#b45309',
  alert: '#dc2626',
  idle: '#64748b',
};

const GLYPH: Record<MarkerKind, string> = { pickup: 'P', dropoff: 'D', driver: '🛻', truck: 'T', booking: '!', alert: '!', idle: '·' };

export function markerIcon(kind: MarkerKind, label?: string) {
  const c = COLORS[kind];
  const text = label ?? GLYPH[kind];
  return L.divIcon({
    className: 'tp-marker',
    html: `<div style="background:${c};color:#fff;border:2px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);width:30px;height:30px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35)"><span style="transform:rotate(45deg);font:700 12px/1 Inter,system-ui">${text}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: MarkerKind;
  label?: string;
  popup?: React.ReactNode;
  onClick?: () => void;
}

function FitBounds({ points, padding = 48 }: { points: [number, number][]; padding?: number }) {
  const map = useMap();
  const key = JSON.stringify(points);
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0]!, Math.max(map.getZoom(), 14));
    else map.fitBounds(L.latLngBounds(points), { padding: [padding, padding], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function ClickHandler({ onClick }: { onClick?: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick?.(e.latlng.lat, e.latlng.lng) });
  return null;
}

export function MapView({
  markers = [],
  height = 320,
  center,
  zoom = 13,
  route,
  accuracyCircle,
  draggable,
  onDragEnd,
  onMapClick,
  fit = true,
  ariaLabel = 'Map',
}: {
  markers?: MapMarker[];
  height?: number | string;
  center?: { lat: number; lng: number };
  zoom?: number;
  route?: [number, number][];
  accuracyCircle?: { lat: number; lng: number; radiusM: number };
  /** Marker id that can be dragged to correct a position. */
  draggable?: string;
  onDragEnd?: (lat: number, lng: number) => void;
  onMapClick?: (lat: number, lng: number) => void;
  fit?: boolean;
  ariaLabel?: string;
}) {
  const start = center ?? (markers[0] ? { lat: markers[0].lat, lng: markers[0].lng } : { lat: 12.9716, lng: 77.5946 });
  const points = useMemo(() => markers.map((m) => [m.lat, m.lng] as [number, number]), [markers]);
  return (
    <Box role="region" aria-label={ariaLabel} sx={{ height, borderRadius: 2, overflow: 'hidden', border: 1, borderColor: 'divider', '& .leaflet-container': { height: '100%', width: '100%', fontFamily: 'inherit' }, '& .tp-marker': { background: 'transparent', border: 0 } }}>
      <MapContainer center={[start.lat, start.lng]} zoom={zoom} scrollWheelZoom={false}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        {fit && <FitBounds points={points} />}
        <ClickHandler onClick={onMapClick} />
        {accuracyCircle && accuracyCircle.radiusM > 0 && <Circle center={[accuracyCircle.lat, accuracyCircle.lng]} radius={accuracyCircle.radiusM} pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.08 }} />}
        {route && route.length > 1 && <Polyline positions={route} pathOptions={{ color: '#f59e0b', weight: 4, dashArray: '6 8' }} />}
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={markerIcon(m.kind, m.label)}
            draggable={draggable === m.id}
            eventHandlers={{
              click: () => m.onClick?.(),
              dragend: (e) => {
                const p = (e.target as L.Marker).getLatLng();
                onDragEnd?.(p.lat, p.lng);
              },
            }}
          >
            {m.popup && <Popup>{m.popup}</Popup>}
          </Marker>
        ))}
      </MapContainer>
    </Box>
  );
}
