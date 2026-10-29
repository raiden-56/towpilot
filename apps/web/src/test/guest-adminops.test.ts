import { describe, expect, it } from 'vitest';
import { handleGuestRequest } from '@/guest/mock';
import type { GuestRole } from '@/guest/session';
import type { CandidatesResponse, DispatchBoard, EmployeeDetail, TruckDetailData } from '@/pages/admin/ops/types';
import type { FleetAccountDetail } from '@/pages/admin/biz/types';

async function call<T>(role: GuestRole, method: string, path: string, opts: { query?: Record<string, string | number>; body?: unknown; page?: boolean } = {}) {
  const r = await handleGuestRequest(role, method, path, opts.query ?? {}, opts.body, !!opts.page);
  if (r.kind !== 'json') throw new Error('expected json');
  return (r.meta ? { data: r.data, meta: r.meta } : r.data) as T;
}

describe('guest mode: admin operations', () => {
  it('serves a live dispatch board', async () => {
    const board = await call<DispatchBoard>('dispatcher', 'GET', '/dispatch/board');
    expect(board.bookings.length).toBeGreaterThanOrEqual(8);
    expect(board.drivers.some((d) => d.status === 'ON_JOB' && d.lat != null)).toBe(true);
    expect(board.escalations.length).toBeGreaterThan(0);
    expect(board.incidents.length).toBeGreaterThan(0);
  });

  it('ranks candidates and assigns with a warning override', async () => {
    const cands = await call<CandidatesResponse>('admin', 'GET', '/dispatch/bookings/bk_live_kavya/candidates');
    const anil = cands.candidates.find((c) => c.driverUserId === 'u_drv_anil')!;
    expect(anil.reasons.join(' ')).toMatch(/declined/);
    await expect(call('admin', 'POST', '/dispatch/bookings/bk_live_kavya/assign', { body: { driverUserId: 'u_drv_anil' } })).rejects.toThrow(/warnings/);
    const b = await call<{ status: string }>('admin', 'POST', '/dispatch/bookings/bk_live_kavya/assign', { body: { driverUserId: 'u_drv_anil', force: true, note: 'Customer moved scooter to ground level' } });
    expect(b.status).toBe('ASSIGNED');
  });

  it('lists and resolves escalations, incidents and history', async () => {
    const esc = await call<{ data: { id: string; status: string }[] }>('admin', 'GET', '/dispatch/escalations', { query: { status: 'OPEN' }, page: true });
    expect(esc.data.length).toBeGreaterThan(0);
    const e = await call<{ status: string }>('admin', 'POST', `/dispatch/escalations/${esc.data[0]!.id}/resolve`, { body: { resolution: 'Handled' } });
    expect(e.status).toBe('RESOLVED');
    const inc = await call<{ data: unknown[] }>('admin', 'GET', '/dispatch/incidents', { page: true });
    expect(inc.data.length).toBeGreaterThan(0);
    const hist = await call<{ data: unknown[] }>('admin', 'GET', '/dispatch/assignments/history', { page: true });
    expect(hist.data.length).toBeGreaterThan(2);
  });

  it('serves employees, fleet, customers and accounts', async () => {
    const emps = await call<{ data: { id: string }[]; meta: { total: number } }>('admin', 'GET', '/admin/employees', { query: { pageSize: 100 }, page: true });
    expect(emps.meta.total).toBeGreaterThan(10);
    const ravi = await call<EmployeeDetail>('admin', 'GET', '/admin/employees/u_drv_ravi');
    expect(ravi.assignments.length).toBeGreaterThan(3);
    expect(ravi.performance.score).not.toBeNull();
    expect(ravi.documents?.length).toBeGreaterThan(0);
    const trucks = await call<{ data: { id: string }[] }>('admin', 'GET', '/admin/fleet/trucks', { page: true });
    const truck = await call<TruckDetailData>('admin', 'GET', `/admin/fleet/trucks/${trucks.data[0]!.id}`);
    expect(truck.maintenance.length).toBeGreaterThan(0);
    const cust = await call<{ data: { id: string }[] }>('finance', 'GET', '/admin/customers', { page: true });
    expect(cust.data.length).toBeGreaterThan(0);
    const detail = await call<{ invoices: unknown[] | null }>('finance', 'GET', '/admin/customers/u_cus_priya');
    expect(detail.invoices?.length).toBeGreaterThan(0);
    const acct = await call<FleetAccountDetail>('admin', 'GET', '/admin/fleet-accounts/fa_sahyadri');
    expect(acct.members.length).toBe(1);
    expect(acct.invoices.length).toBeGreaterThan(0);
  });

  it('serves settings, roles, audit log and support tickets', async () => {
    const s = await call<{ values: Record<string, Record<string, unknown>> }>('admin', 'GET', '/admin/system/settings');
    expect(s.values.dispatch!.offerTimeoutSec).toBe(90);
    await call('admin', 'PUT', '/admin/system/settings/dispatch', { body: { offerTimeoutSec: 120 } });
    const audit = await call<{ data: { action: string }[] }>('admin', 'GET', '/admin/system/audit-logs', { page: true });
    expect(audit.data[0]!.action).toBe('settings.dispatch');
    const tickets = await call<{ data: { id: string }[] }>('dispatcher', 'GET', '/admin/system/tickets', { page: true });
    expect(tickets.data.length).toBeGreaterThan(3);
    await expect(call('dispatcher', 'GET', '/admin/system/audit-logs', { page: true })).rejects.toThrow(/permission/);
  });
});
