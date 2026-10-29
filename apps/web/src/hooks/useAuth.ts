import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, tokenStore } from '@/api/client';
import type { Me, Role } from '@/api/types';
import { endGuestSession, isGuestActive, startGuestSession, type GuestRole } from '@/guest/session';
import { signedIn, signedOut, store, useAppDispatch, useAppSelector } from '@/store';

interface TokenResponse {
  accessToken: string;
  user: Me;
}

/** Restore a session from the refresh cookie on page load. */
export async function bootstrapSession() {
  const ok = await refreshSession();
  if (!ok) store.dispatch(signedOut());
}

export function homePathFor(user: Pick<Me, 'roles'> | null): string {
  if (!user) return '/login';
  const r = user.roles;
  if (r.some((x) => ['admin', 'dispatcher', 'finance'].includes(x))) return '/admin';
  if (r.includes('driver') || r.includes('worker')) return '/driver';
  return '/app';
}

export function useAuth() {
  const dispatch = useAppDispatch();
  const qc = useQueryClient();
  const { status, user } = useAppSelector((s) => s.auth);

  const finish = useCallback(
    (r: TokenResponse) => {
      tokenStore.set(r.accessToken);
      dispatch(signedIn(r.user));
      return r.user;
    },
    [dispatch],
  );

  const requestOtp = useCallback((phone: string) => api.post<{ expiresInSec: number; isNewUser: boolean; sandbox: boolean; sandboxOtp?: string }>('/auth/otp/request', { phone }), []);

  const verifyOtp = useCallback(
    async (input: { phone: string; code: string; fullName?: string; acceptTerms?: boolean; locationConsent?: boolean; marketingConsent?: boolean }) => finish(await api.post<TokenResponse>('/auth/otp/verify', input)),
    [finish],
  );

  const loginWithPassword = useCallback(async (email: string, password: string) => finish(await api.post<TokenResponse>('/auth/login', { email, password })), [finish]);

  /** Guest mode: sign in as a sample account without any network call (see src/guest). */
  const enterGuest = useCallback(
    async (role: GuestRole) => {
      startGuestSession(role);
      qc.clear();
      const { guestUser } = await import('@/guest/mock');
      return finish({ accessToken: 'guest', user: guestUser(role) });
    },
    [finish, qc],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      if (isGuestActive()) endGuestSession();
      tokenStore.set(null);
      dispatch(signedOut());
      qc.clear();
    }
  }, [dispatch, qc]);

  const hasRole = useCallback((...roles: Role[]) => !!user && roles.some((r) => user.roles.includes(r)), [user]);
  const can = useCallback((perm: string) => !!user?.permissions.includes(perm), [user]);

  return { status, user, requestOtp, verifyOtp, loginWithPassword, enterGuest, logout, hasRole, can };
}
