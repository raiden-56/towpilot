import { describe, expect, it } from 'vitest';
import type { BookingDetail, BookingSummary, Invoice } from '@/api/types';
import { match, PagedResult } from '@/guest/mock/router';
import '@/guest/mock/handlers/core';
import '@/guest/mock/handlers/customer';
import { db } from '@/guest/mock/db';

type Json<T> = { kind: 'json'; data: T; meta?: Record<string, unknown> };
/** Calls the customer handlers directly (independent of the other portals' handlers). */
async function call<T>(method: string, path: string, body?: unknown, query: Record<string, string | number> = {}): Promise<Json<T>> {
  const m = match(method, path);
  if (!m) throw new Error(`no handler for ${method} ${path}`);
  const out = await m.handler({ method, path, params: m.params, query, body: (body ?? {}) as Record<string, unknown>, form: null, role: 'customer', userId: 'u_cus_priya' });
  return out instanceof PagedResult ? { kind: 'json', data: out.value.data as T, meta: out.value.meta } : { kind: 'json', data: out as T };
}

describe('guest mode: customer API', () => {
  it('lists own bookings and shows the live booking with a driver', async () => {
    const list = await call<BookingSummary[]>('GET', '/bookings', undefined, { group: 'active' });
    expect(list.data.length).toBeGreaterThan(0);
    expect(list.data.every((b) => db.bookings.find((x) => x.id === b.id)?.customerUserId === 'u_cus_priya')).toBe(true);
    const live = await call<BookingDetail>('GET', '/bookings/bk_live_priya');
    expect(live.data.viewer).toBe('customer');
    expect(live.data.driver?.name).toBe('Ravi Kumar');
    expect(live.data.driverLocation).not.toBeNull();
  });

  it('creates a booking, quotes it and confirms it', async () => {
    const body = {
      serviceCategoryId: 'cat_jump_start',
      vehicleId: 'veh_ka05hj8899',
      type: 'EMERGENCY',
      pickup: { lat: 12.9719, lng: 77.6412, source: 'GPS', address: 'Indiranagar' },
      assessment: { breakdownType: 'BATTERY', engineStarts: 'NO', wheelsRotate: 'YES', steeringWorks: 'YES', brakesWork: 'YES', isStuck: 'NO', isOverturned: 'NO', isSubmerged: 'NO', blockingTraffic: 'NO', majorDamage: 'NO', isEvOrHybrid: false, accessRestriction: 'NONE', hasChildren: false, hasElderly: false, needsAccessibility: false, passengersNeedingTransport: 0 },
      contactName: 'Priya Sharma',
      contactPhone: '+919000000101',
      useMembership: true,
    };
    const created = await call<BookingDetail>('POST', '/bookings', body);
    expect(created.data.status).toBe('QUOTED');
    const quoteId = created.data.pendingQuoteId!;
    expect(created.data.quotes?.find((q) => q.id === quoteId)?.total).toBeGreaterThan(0);
    const confirmed = await call<BookingDetail>('POST', `/bookings/${created.data.id}/confirm`, { quoteId });
    expect(confirmed.data.status).toBe('SEARCHING_FOR_PROVIDER');
  });

  it('pays an invoice through the sandbox checkout', async () => {
    const invoices = await call<Invoice[]>('GET', '/invoices', undefined, {});
    const unpaid = invoices.data.find((i) => i.outstanding > 0 && i.status === 'ISSUED')!;
    expect(unpaid).toBeTruthy();
    const order = await call<{ paymentId: string; sandbox: boolean; status: string }>('POST', `/invoices/${unpaid.id}/pay`, {});
    expect(order.data).toMatchObject({ sandbox: true, status: 'CREATED' });
    await call('POST', `/payments/${order.data.paymentId}/sandbox-complete`, { outcome: 'success' });
    const poll = await call<{ status: string; receiptNumber: string }>('GET', `/payments/${order.data.paymentId}`);
    expect(poll.data.status).toBe('SUCCEEDED');
    const inv = await call<Invoice>('GET', `/invoices/${unpaid.id}`);
    expect(inv.data.paymentStatus).toBe('PAID');
  });

  it('serves notifications with an unread count and support tickets', async () => {
    const n = await call<unknown[]>('GET', '/me/notifications', undefined, { pageSize: 15 });
    expect(n.meta?.unread).toBeGreaterThan(0);
    const t = await call<{ id: string }[]>('GET', '/support/tickets', undefined, {});
    expect(t.data.length).toBeGreaterThan(0);
    const detail = await call<{ messages: { internal: boolean }[] }>('GET', `/support/tickets/${t.data[0]!.id}`);
    expect(detail.data.messages.every((m) => !m.internal)).toBe(true);
  });

  it('resolves the public tracking link', async () => {
    const r = await call<{ code: string; driver: { firstName: string } }>('GET', '/public/track/guest-demo-track');
    expect(r.data.driver.firstName).toBe('Ravi');
  });
});
