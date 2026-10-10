import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { loadPrincipal, verifyAccessToken, type Principal } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { sha256 } from '../lib/crypto.js';

/**
 * Socket.IO is a notification channel only — the database stays authoritative. Clients use
 * events to invalidate/refetch state, dedupe by event id, and reconcile periodically.
 *
 * Rooms:
 *   user:<id>      — personal events (offers, notifications)
 *   ops            — dispatchers/admins
 *   booking:<id>   — full booking events for authorised participants (checked on join)
 *   share:<id>     — limited events for time-limited share links
 */
let io: Server | null = null;

export interface RealtimeEvent<T = unknown> {
  id: string;
  ts: string;
  type: string;
  bookingId?: string;
  data: T;
}

const envelope = <T>(type: string, data: T, bookingId?: string): RealtimeEvent<T> => ({ id: randomUUID(), ts: new Date().toISOString(), type, bookingId, data });

/** Authorise a principal for a booking room. Re-checked on every join. */
export async function canAccessBooking(p: Principal, bookingId: string): Promise<boolean> {
  if (p.permissions.has('booking:read_any')) return true;
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      customerUserId: true,
      assignments: { where: { status: { in: ['OFFERED', 'ACCEPTED'] } }, select: { driverUserId: true, status: true } },
      teamMembers: { where: { active: true }, select: { userId: true } },
    },
  });
  if (!b) return false;
  if (b.customerUserId === p.userId) return true;
  if (b.assignments.some((a) => a.driverUserId === p.userId && a.status === 'ACCEPTED')) return true;
  return b.teamMembers.some((t) => t.userId === p.userId);
}

export function initRealtime(server: HttpServer) {
  io = new Server(server, {
    path: '/socket.io',
    cors: { origin: env.corsOrigins, credentials: true },
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000 },
  });

  // Multi-instance deployments: fan events out across API replicas through Redis pub/sub.
  if (env.REDIS_URL) {
    const pub = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: null });
    const sub = pub.duplicate();
    pub.on('error', (e) => logger.warn({ err: e.message }, 'redis pub error'));
    sub.on('error', (e) => logger.warn({ err: e.message }, 'redis sub error'));
    io.adapter(createAdapter(pub, sub));
    logger.info('Realtime: Redis adapter enabled');
  }

  io.use(async (socket, next) => {
    try {
      const { token, shareToken } = socket.handshake.auth as { token?: string; shareToken?: string };
      if (shareToken) {
        const link = await prisma.bookingShareLink.findUnique({ where: { tokenHash: sha256(shareToken) } });
        if (!link || link.revokedAt || link.expiresAt < new Date()) return next(new Error('share link expired'));
        socket.data.shareBookingId = link.bookingId;
        socket.data.shareExpiresAt = link.expiresAt.getTime();
        return next();
      }
      if (!token) return next(new Error('unauthorized'));
      const p = await loadPrincipal(verifyAccessToken(token));
      if (!p || p.status !== 'ACTIVE') return next(new Error('unauthorized'));
      socket.data.principal = p;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const p = socket.data.principal as Principal | undefined;
    if (socket.data.shareBookingId) {
      socket.join(`share:${socket.data.shareBookingId}`);
      const ttl = (socket.data.shareExpiresAt as number) - Date.now();
      setTimeout(() => socket.disconnect(true), Math.max(0, ttl)).unref();
      return;
    }
    if (!p) return socket.disconnect(true);
    socket.join(`user:${p.userId}`);
    if (p.permissions.has('dispatch:manage') || p.permissions.has('booking:read_any')) socket.join('ops');

    socket.on('booking:join', async (bookingId: unknown, ack?: (r: { ok: boolean; error?: string }) => void) => {
      if (typeof bookingId !== 'string') return ack?.({ ok: false, error: 'invalid' });
      // Reload principal to honour revocations since the socket connected.
      const fresh = await loadPrincipal(p.userId);
      if (!fresh || fresh.status !== 'ACTIVE' || !(await canAccessBooking(fresh, bookingId))) return ack?.({ ok: false, error: 'forbidden' });
      await socket.join(`booking:${bookingId}`);
      ack?.({ ok: true });
    });
    socket.on('booking:leave', (bookingId: unknown) => {
      if (typeof bookingId === 'string') socket.leave(`booking:${bookingId}`);
    });
  });

  logger.info('Realtime gateway ready');
  return io;
}

export function emitToUser(userId: string, type: string, data: unknown, bookingId?: string) {
  io?.to(`user:${userId}`).emit('event', envelope(type, data, bookingId));
}

export function emitToOps(type: string, data: unknown, bookingId?: string) {
  io?.to('ops').emit('event', envelope(type, data, bookingId));
}

/**
 * Emit to everyone authorised on a booking. `shareData` (if provided) is the reduced payload sent
 * to share-link viewers; when omitted, share viewers only receive a refetch hint.
 */
export function emitToBooking(bookingId: string, type: string, data: unknown, shareData?: unknown) {
  if (!io) return;
  const ev = envelope(type, data, bookingId);
  io.to(`booking:${bookingId}`).to('ops').emit('event', ev);
  io.to(`share:${bookingId}`).emit('event', { ...ev, data: shareData ?? {} });
}

/** Remove a user's sockets from a booking room (e.g. driver reassigned away). */
export function revokeBookingRoom(userId: string, bookingId: string) {
  io?.in(`user:${userId}`).socketsLeave(`booking:${bookingId}`);
}

export function closeRealtime() {
  return new Promise<void>((resolve) => (io ? io.close(() => resolve()) : resolve()));
}
