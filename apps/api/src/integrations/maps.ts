import { env } from '../config/env.js';
import { haversineKm, type LatLng } from '../lib/geo.js';
import { getSettings } from '../lib/settings.js';
import { logger } from '../lib/logger.js';

/**
 * Maps boundary: geocoding, reverse geocoding and road distance/ETA.
 *  - sandbox: no geocoding; distances are straight-line × configurable road factor (labelled "estimate")
 *  - osm:     Nominatim + public OSRM (respect usage policies; suitable for development/pilots)
 *  - google:  Google Geocoding API + Distance Matrix API
 */
export interface RouteEstimate {
  distanceKm: number;
  durationMin: number;
  source: 'google' | 'osrm' | 'estimate';
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
}

const cache = new Map<string, { v: unknown; at: number }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await fn();
  cache.set(key, { v, at: Date.now() });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return v;
}

async function estimateRoute(a: LatLng, b: LatLng): Promise<RouteEstimate> {
  const s = await getSettings();
  const d = haversineKm(a, b) * s.pricing.roadDistanceFactor;
  return { distanceKm: Math.round(d * 10) / 10, durationMin: Math.max(1, Math.round((d / s.dispatch.avgSpeedKmh) * 60)), source: 'estimate' };
}

const osmHeaders = () => ({ 'user-agent': `TowPilot/0.1 (${env.OSM_CONTACT_EMAIL ?? 'contact not configured'})` });

export async function routeEstimate(a: LatLng, b: LatLng): Promise<RouteEstimate> {
  const key = `route:${a.lat.toFixed(4)},${a.lng.toFixed(4)}:${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
  return cached(key, 10 * 60_000, async () => {
    try {
      if (env.MAPS_PROVIDER === 'google' && env.GOOGLE_MAPS_API_KEY) {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${a.lat},${a.lng}&destinations=${b.lat},${b.lng}&key=${env.GOOGLE_MAPS_API_KEY}`;
        const r = (await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json()) as {
          rows?: { elements?: { status: string; distance?: { value: number }; duration?: { value: number } }[] }[];
        };
        const el = r.rows?.[0]?.elements?.[0];
        if (el?.status === 'OK' && el.distance && el.duration)
          return { distanceKm: Math.round(el.distance.value / 100) / 10, durationMin: Math.round(el.duration.value / 60), source: 'google' };
      } else if (env.MAPS_PROVIDER === 'osm') {
        const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
        const r = (await (await fetch(url, { headers: osmHeaders(), signal: AbortSignal.timeout(8000) })).json()) as { routes?: { distance: number; duration: number }[] };
        const route = r.routes?.[0];
        if (route) return { distanceKm: Math.round(route.distance / 100) / 10, durationMin: Math.round(route.duration / 60), source: 'osrm' };
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'routing provider failed; falling back to estimate');
    }
    return estimateRoute(a, b);
  });
}

export async function reverseGeocode(p: LatLng): Promise<string | null> {
  const key = `rev:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  return cached(key, 60 * 60_000, async () => {
    try {
      if (env.MAPS_PROVIDER === 'google' && env.GOOGLE_MAPS_API_KEY) {
        const r = (await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${p.lat},${p.lng}&key=${env.GOOGLE_MAPS_API_KEY}`, { signal: AbortSignal.timeout(8000) })).json()) as {
          results?: { formatted_address: string }[];
        };
        return r.results?.[0]?.formatted_address ?? null;
      }
      if (env.MAPS_PROVIDER === 'osm') {
        const r = (await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lng}`, { headers: osmHeaders(), signal: AbortSignal.timeout(8000) })).json()) as {
          display_name?: string;
        };
        return r.display_name ?? null;
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'reverse geocoding failed');
    }
    return null;
  });
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  return cached(`geo:${q.toLowerCase()}`, 60 * 60_000, async () => {
    try {
      if (env.MAPS_PROVIDER === 'google' && env.GOOGLE_MAPS_API_KEY) {
        const r = (await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=in&key=${env.GOOGLE_MAPS_API_KEY}`, { signal: AbortSignal.timeout(8000) })).json()) as {
          results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[];
        };
        return (r.results ?? []).slice(0, 5).map((x) => ({ lat: x.geometry.location.lat, lng: x.geometry.location.lng, label: x.formatted_address }));
      }
      if (env.MAPS_PROVIDER === 'osm') {
        const r = (await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&limit=5&q=${encodeURIComponent(q)}`, { headers: osmHeaders(), signal: AbortSignal.timeout(8000) })).json()) as {
          lat: string;
          lon: string;
          display_name: string;
        }[];
        return r.map((x) => ({ lat: Number(x.lat), lng: Number(x.lon), label: x.display_name }));
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'geocoding failed');
    }
    return [];
  });
}

/** Extract coordinates from a pasted Google Maps / OSM / geo: link. */
export function parseLocationLink(input: string): LatLng | null {
  const s = decodeURIComponent(input.trim());
  const patterns = [
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/, // google .../@12.97,77.59,15z
    /[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, // ?q=12.97,77.59
    /^geo:(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /mlat=(-?\d{1,2}\.\d+)&mlon=(-?\d{1,3}\.\d+)/, // openstreetmap
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, // google data param
    /^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/, // raw "lat,lng"
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

export const mapsProviderInfo = () => ({
  provider: env.MAPS_PROVIDER,
  geocodingAvailable: env.MAPS_PROVIDER !== 'sandbox' && (env.MAPS_PROVIDER !== 'google' || !!env.GOOGLE_MAPS_API_KEY),
  distanceSource: env.MAPS_PROVIDER === 'sandbox' ? 'estimate' : env.MAPS_PROVIDER,
});
