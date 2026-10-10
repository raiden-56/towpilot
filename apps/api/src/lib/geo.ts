export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6371; // km

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Ray-casting point-in-polygon for a GeoJSON Polygon ([lng, lat] rings). */
export function pointInPolygon(point: LatLng, polygon: { type: string; coordinates: number[][][] }): boolean {
  const ring = polygon.coordinates[0];
  if (!ring) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    const intersect = yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface ZoneShape {
  id: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  polygon: unknown;
  active: boolean;
}

/** Returns the best matching active zone (polygon match first, then nearest radius match). */
export function resolveZone<T extends ZoneShape>(point: LatLng, zones: T[]): T | null {
  const active = zones.filter((z) => z.active);
  const poly = active.find((z) => {
    const p = z.polygon as { type?: string; coordinates?: number[][][] } | null;
    return p?.type === 'Polygon' && Array.isArray(p.coordinates) && pointInPolygon(point, p as { type: string; coordinates: number[][][] });
  });
  if (poly) return poly;
  let best: T | null = null;
  let bestDist = Infinity;
  for (const z of active) {
    const d = haversineKm(point, { lat: z.centerLat, lng: z.centerLng });
    if (d <= z.radiusKm && d < bestDist) {
      best = z;
      bestDist = d;
    }
  }
  return best;
}

export const isValidLatLng = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Coarse location for viewers who should not see an exact position (≈1 km grid). */
export const coarsen = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 });
