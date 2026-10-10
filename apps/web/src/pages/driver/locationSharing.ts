import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/api/client';
import { useIsOnline } from '@/hooks/useOnline';

export interface DriverMe {
  id: string;
  fullName: string;
  phone: string;
  photoUrl: string | null;
  roles: string[];
  workerProfile: { employeeCode: string; verificationStatus: string; verificationNote: string | null; employmentType: string; skills: string[]; partnerCompany: string | null; zones: { id: string; name: string; city: string }[] } | null;
  driverProfile: { licenceExpiry: string; licenceClass: string; canLeadTeam: boolean } | null;
  availability: { status: 'AVAILABLE' | 'BUSY' | 'ON_JOB' | 'ON_BREAK' | 'OFF_DUTY'; zoneId: string | null; lastLocationAt: string | null; locationSharing: boolean; statusSince: string } | null;
  assignedTruck: {
    id: string;
    registrationNumber: string;
    truckType: string;
    make: string;
    model: string;
    status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'OUT_OF_SERVICE' | 'RETIRED';
    odometerKm: number;
    insuranceExpiry: string | null;
    fitnessExpiry: string | null;
    permitExpiry: string | null;
    pucExpiry: string | null;
    nextInspectionDue: string | null;
    equipment: { id: string; type: string; status: 'OK' | 'DAMAGED' | 'MISSING'; notes: string | null }[];
  } | null;
}

export const useDriverMe = () => useQuery({ queryKey: ['driver', 'me'], queryFn: () => api.get<DriverMe>('/driver/me'), refetchInterval: 60_000 });

interface Point {
  lat: number;
  lng: number;
  accuracyM: number;
  speedKmh?: number;
  heading?: number;
  recordedAt: string;
}

const MIN_INTERVAL_MS = 15_000;

/**
 * Shares GPS only while the worker is on duty (not OFF_DUTY), with device permission.
 * Points recorded while offline are buffered in memory (never persisted) and flushed as one
 * batch when the connection returns. Location is never shared off duty.
 */
export function useDriverLocationSharing() {
  const me = useDriverMe();
  const online = useIsOnline();
  const [active, setActive] = useState(false);
  const [reason, setReason] = useState('Off duty');
  const buffer = useRef<Point[]>([]);
  const lastSent = useRef(0);
  const onDuty = !!me.data?.availability && me.data.availability.status !== 'OFF_DUTY';

  useEffect(() => {
    if (!onDuty) {
      setActive(false);
      setReason('Off duty');
      return;
    }
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setReason('GPS unavailable');
      return;
    }
    const flush = async () => {
      if (!buffer.current.length || !navigator.onLine) return;
      const points = buffer.current.splice(0, buffer.current.length);
      try {
        await api.post('/driver/location', { points });
        lastSent.current = Date.now();
      } catch (e) {
        // Rejected by the server (e.g. went off duty, invalid points): drop — never retry forever.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) return;
        buffer.current.unshift(...points.slice(-200)); // network/server error: keep latest; retry later
      }
    };
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setActive(true);
        setReason('Sharing');
        buffer.current.push({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy),
          speedKmh: pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : undefined,
          heading: pos.coords.heading ?? undefined,
          recordedAt: new Date(pos.timestamp).toISOString(),
        });
        if (Date.now() - lastSent.current >= MIN_INTERVAL_MS) void flush();
      },
      (err) => {
        setActive(false);
        setReason(err.code === 1 ? 'Location blocked' : 'Weak GPS');
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    const timer = setInterval(() => void flush(), MIN_INTERVAL_MS);
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(timer);
      void flush();
    };
  }, [onDuty]);

  useEffect(() => {
    if (online && buffer.current.length) void api.post('/driver/location', { points: buffer.current.splice(0) }).catch(() => {});
  }, [online]);

  return { active: active && onDuty, reason: online ? reason : 'Offline — buffering', pending: buffer.current.length };
}
