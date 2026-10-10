import { useCallback, useState } from 'react';

export interface GeoFix {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: string;
}

export type GeoError = 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED' | 'INSECURE';

export const GEO_ERROR_TEXT: Record<GeoError, string> = {
  PERMISSION_DENIED: 'Location permission was denied. You can drop a pin on the map, paste a maps link, or type the address instead.',
  POSITION_UNAVAILABLE: 'Your device could not determine a location (weak GPS signal). Move to an open area or set the pin manually.',
  TIMEOUT: 'Getting your location took too long. Try again or set the pin manually.',
  UNSUPPORTED: 'This browser does not support location. Please set the pin manually.',
  INSECURE: 'Location needs a secure (https) connection. Please set the pin manually.',
};

/** Requests a one-off, high-accuracy position only when the user asks for it. */
export function useGeolocation() {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [error, setError] = useState<GeoError | null>(null);
  const [loading, setLoading] = useState(false);

  const locate = useCallback(
    () =>
      new Promise<GeoFix | null>((resolve) => {
        if (!('geolocation' in navigator)) {
          setError('UNSUPPORTED');
          return resolve(null);
        }
        if (!window.isSecureContext) {
          setError('INSECURE');
          return resolve(null);
        }
        setLoading(true);
        setError(null);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const f = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy), capturedAt: new Date(pos.timestamp).toISOString() };
            setFix(f);
            setLoading(false);
            resolve(f);
          },
          (err) => {
            setError(err.code === 1 ? 'PERMISSION_DENIED' : err.code === 3 ? 'TIMEOUT' : 'POSITION_UNAVAILABLE');
            setLoading(false);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
        );
      }),
    [],
  );

  return { fix, error, loading, locate, errorText: error ? GEO_ERROR_TEXT[error] : null };
}
