import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { tokenStore, refreshSession } from '@/api/client';
import { setSocketConnected, useAppDispatch, useAppSelector } from '@/store';

export interface RealtimeEvent<T = Record<string, unknown>> {
  id: string;
  ts: string;
  type: string;
  bookingId?: string;
  data: T;
}

type Listener = (e: RealtimeEvent) => void;

let socket: Socket | null = null;
const listeners = new Set<Listener>();
const rooms = new Set<string>();
const seen = new Set<string>();

function dispatchEvent(e: RealtimeEvent) {
  // Deduplicate (reconnect replays, multiple rooms).
  if (seen.has(e.id)) return;
  seen.add(e.id);
  if (seen.size > 500) seen.delete(seen.values().next().value as string);
  listeners.forEach((l) => l(e));
}

/** Subscribe to realtime events anywhere in the tree. */
export function useRealtimeEvent(handler: Listener) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
}

/** Join a booking room; the server re-checks authorisation on every join. Re-joined after reconnects. */
export function joinBookingRoom(bookingId: string) {
  rooms.add(bookingId);
  socket?.emit('booking:join', bookingId);
}
export function leaveBookingRoom(bookingId: string) {
  rooms.delete(bookingId);
  socket?.emit('booking:leave', bookingId);
}

/**
 * Maintains one authenticated socket per signed-in session. Events are treated as hints: the
 * relevant TanStack Query caches are invalidated so data is always re-read from the API
 * (the database is the source of truth).
 */
export function useRealtimeConnection() {
  const qc = useQueryClient();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.auth.status);
  const userId = useAppSelector((s) => s.auth.user?.id);

  useEffect(() => {
    if (status !== 'authenticated' || !userId) return;
    const s = io({ path: '/socket.io', auth: (cb) => cb({ token: tokenStore.get() }), transports: ['websocket', 'polling'], reconnectionDelayMax: 10_000 });
    socket = s;
    s.on('connect', () => {
      dispatch(setSocketConnected(true));
      // Re-join rooms and reconcile state after reconnects.
      rooms.forEach((id) => s.emit('booking:join', id));
      qc.invalidateQueries();
    });
    s.on('disconnect', () => dispatch(setSocketConnected(false)));
    s.on('connect_error', async (err) => {
      dispatch(setSocketConnected(false));
      if (err.message === 'unauthorized') await refreshSession();
    });
    s.on('event', (e: RealtimeEvent) => {
      dispatchEvent(e);
      if (e.bookingId) {
        qc.invalidateQueries({ queryKey: ['booking', e.bookingId] });
        qc.invalidateQueries({ queryKey: ['bookings'] });
      }
      if (e.type === 'notification') qc.invalidateQueries({ queryKey: ['notifications'] });
      if (e.type.startsWith('job.')) {
        qc.invalidateQueries({ queryKey: ['driver'] });
      }
      if (e.type.startsWith('invoice') || e.type === 'payment.status') qc.invalidateQueries({ queryKey: ['invoices'] });
      if (['escalation.created', 'escalation.updated', 'incident.created', 'dispatch.offered', 'driver.availability', 'booking.completed'].includes(e.type)) qc.invalidateQueries({ queryKey: ['dispatch'] });
    });
    return () => {
      s.disconnect();
      socket = null;
      dispatch(setSocketConnected(false));
    };
  }, [status, userId, qc, dispatch]);
}
