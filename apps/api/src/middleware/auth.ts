import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { ActorRole, UserStatus } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { permissionsForRoles, type PermissionKey } from '../domain/permissions.js';

export interface Principal {
  userId: string;
  fullName: string;
  status: UserStatus;
  roles: string[];
  permissions: Set<PermissionKey>;
}

interface AccessClaims {
  sub: string;
  typ: 'access';
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId, typ: 'access' } satisfies AccessClaims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'towpilot',
    audience: 'towpilot-app',
  });
}

export function verifyAccessToken(token: string): string {
  const claims = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'towpilot', audience: 'towpilot-app' }) as AccessClaims;
  if (claims.typ !== 'access') throw new Error('wrong token type');
  return claims.sub;
}

// Principals are cached briefly; role/status changes call invalidatePrincipal() so revocation
// takes effect immediately on this instance and within PRINCIPAL_TTL_MS on others.
const PRINCIPAL_TTL_MS = 15_000;
const cache = new Map<string, { p: Principal; at: number }>();

export function invalidatePrincipal(userId: string) {
  cache.delete(userId);
}

export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < PRINCIPAL_TTL_MS) return hit.p;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, status: true, deletedAt: true, roles: { select: { role: { select: { key: true } } } } },
  });
  if (!user || user.deletedAt) return null;
  const roles = user.roles.map((r) => r.role.key);
  const p: Principal = { userId: user.id, fullName: user.fullName, status: user.status, roles, permissions: permissionsForRoles(roles) };
  cache.set(userId, { p, at: Date.now() });
  return p;
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return null;
}

/** Attaches req.auth when a valid token is present; never rejects. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (token) {
    try {
      const p = await loadPrincipal(verifyAccessToken(token));
      if (p && p.status === 'ACTIVE') req.auth = p;
    } catch {
      /* ignore invalid token for optional auth */
    }
  }
  next();
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) throw unauthorized();
  let userId: string;
  try {
    userId = verifyAccessToken(token);
  } catch {
    throw unauthorized('Session expired. Please sign in again.');
  }
  const p = await loadPrincipal(userId);
  if (!p) throw unauthorized('Account not found');
  if (p.status === 'SUSPENDED') throw forbidden('Your account is suspended. Contact support.');
  if (p.status === 'DEACTIVATED') throw unauthorized('This account has been deactivated');
  req.auth = p;
  next();
}

/** Requires at least one of the listed permissions. */
export const requirePermission =
  (...perms: PermissionKey[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw unauthorized();
    if (!perms.some((p) => req.auth!.permissions.has(p))) throw forbidden();
    next();
  };

export const can = (req: Request, perm: PermissionKey) => !!req.auth?.permissions.has(perm);

export function principal(req: Request): Principal {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Map a principal to the state-machine actor role for a given booking context. */
export function actorRoleFor(p: Principal, opts: { isCustomer?: boolean; isFieldTeam?: boolean }): ActorRole {
  if (opts.isFieldTeam) return p.roles.includes('driver') ? 'DRIVER' : 'WORKER';
  if (opts.isCustomer) return 'CUSTOMER';
  if (p.roles.includes('admin')) return 'ADMIN';
  if (p.permissions.has('booking:manage')) return 'DISPATCHER';
  throw forbidden();
}
