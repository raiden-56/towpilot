/**
 * Guest-mode API: answers every request of the API client in the browser from sample data.
 * Loaded lazily by src/api/client.ts only while a guest session is active.
 */
import type { Me } from '@/api/types';
import type { GuestRole } from '../session';
import { userById } from './db';
import { refreshLivePositions } from './bookingOps';
import { FileResult, match, PagedResult, type Query } from './router';
import { meFor } from './serialize';
import './handlers/core';
import './handlers/customer';
import './handlers/driver';
import './handlers/adminOps';
import './handlers/adminBiz';

/** The sample account each guest role signs in as. */
export const GUEST_USER_IDS: Record<GuestRole, string> = {
  admin: 'u_admin',
  dispatcher: 'u_dispatch',
  finance: 'u_finance',
  customer: 'u_cus_priya',
  driver: 'u_drv_ravi',
};

export function guestUser(role: GuestRole): Me {
  return meFor(userById(GUEST_USER_IDS[role])!);
}

export type GuestResponse = { kind: 'json'; data: unknown; meta?: unknown } | { kind: 'file'; response: Response };

const delay = () => new Promise((r) => setTimeout(r, 60 + Math.random() * 140));

export async function handleGuestRequest(role: GuestRole, method: string, path: string, query: Query, body: unknown, expectPage: boolean): Promise<GuestResponse> {
  await delay();
  refreshLivePositions();
  const found = match(method, path);
  if (!found) {
    if (import.meta.env.DEV) console.warn(`[guest] no mock for ${method} ${path}`);
    // Sensible empty answers so unknown screens render an empty state instead of an error.
    if (method !== 'GET') return { kind: 'json', data: {} };
    return expectPage ? { kind: 'json', data: [], meta: { page: 1, pageSize: Number(query.pageSize) || 20, total: 0, totalPages: 1 } } : { kind: 'json', data: [] };
  }
  const form = body instanceof FormData ? body : null;
  const json = form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')) : ((body ?? {}) as Record<string, unknown>);
  const out = await found.handler({ method, path, params: found.params, query, body: json, form, role, userId: GUEST_USER_IDS[role] });
  if (out instanceof FileResult) return { kind: 'file', response: new Response(new Blob([out.body], { type: out.type }), { status: 200, headers: { 'content-type': out.type } }) };
  // Deep-copy so screens never hold live references into the in-memory database.
  if (out instanceof PagedResult) return { kind: 'json', data: structuredClone(out.value.data), meta: structuredClone(out.value.meta) };
  return { kind: 'json', data: out === undefined ? null : structuredClone(out) };
}
