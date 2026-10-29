import { describe, expect, it, vi } from 'vitest';
import { handleGuestRequest } from '@/guest/mock';

// Only the driver handlers are under test here.
vi.mock('@/guest/mock/handlers/customer', () => ({}));
vi.mock('@/guest/mock/handlers/adminOps', () => ({}));
vi.mock('@/guest/mock/handlers/adminBiz', () => ({}));

type Json = { kind: 'json'; data: unknown; meta?: unknown };
const call = async <T,>(method: string, path: string, body?: unknown, query: Record<string, string | number> = {}, page = false) => {
  const r = (await handleGuestRequest('driver', method, path, query, body, page)) as Json;
  return r.data as T;
};

describe('guest mode: driver portal', () => {
  it('runs the full towing job workflow and then offers a new job', async () => {
    const me = await call<{ fullName: string; assignedTruck: { registrationNumber: string } }>('GET', '/driver/me');
    expect(me.fullName).toBe('Ravi Kumar');
    expect(me.assignedTruck.registrationNumber).toBe('KA01TP1001');

    const active = await call<{ id: string; status: string; viewer: string }>('GET', '/driver/jobs/active');
    expect(active).toMatchObject({ id: 'bk_live_priya', status: 'EN_ROUTE', viewer: 'field' });
    const id = active.id;
    const step = (to: string) => call<{ status: string }>('POST', `/driver/jobs/${id}/transition`, { to });

    expect((await step('ARRIVED')).status).toBe('ARRIVED');
    await expect(step('INSPECTING')).rejects.toThrow(/pickup code/);
    await call('POST', `/driver/jobs/${id}/verify-pickup`, { code: '1234' });
    expect((await step('INSPECTING')).status).toBe('INSPECTING');
    await call('POST', `/driver/jobs/${id}/equipment-check`, {});

    const form = () => {
      const f = new FormData();
      f.append('files', new File(['x'], 'photo.jpg', { type: 'image/jpeg' }));
      return f;
    };
    const fPick = form();
    fPick.append('kind', 'PICKUP_EVIDENCE');
    const [photo] = await call<{ id: string }[]>('POST', `/driver/jobs/${id}/attachments`, fPick);
    await expect(step('RECOVERY_AUTHORIZED')).rejects.toThrow(/condition report/);
    await call('POST', `/driver/jobs/${id}/condition-reports`, { stage: 'PICKUP', attachmentIds: [photo!.id], damageMarks: [] });
    expect((await step('RECOVERY_AUTHORIZED')).status).toBe('RECOVERY_AUTHORIZED');
    expect((await step('LOADING')).status).toBe('LOADING');
    expect((await step('IN_TRANSIT')).status).toBe('IN_TRANSIT');

    const fDel = form();
    fDel.append('kind', 'DELIVERY_EVIDENCE');
    const [photo2] = await call<{ id: string }[]>('POST', `/driver/jobs/${id}/attachments`, fDel);
    await call('POST', `/driver/jobs/${id}/condition-reports`, { stage: 'DELIVERY', attachmentIds: [photo2!.id] });
    await call('POST', `/driver/jobs/${id}/handover`, { code: '5678', recipientName: 'Service advisor' });
    expect((await step('DELIVERED')).status).toBe('DELIVERED');

    const closed = await call<{ invoiceNumber: string; total: number }>('POST', `/driver/jobs/${id}/close`, { tolls: 0, parking: 0, expenses: [] });
    expect(closed.invoiceNumber).toMatch(/^INV\//);
    expect(await call('GET', '/driver/jobs/active')).toBeNull();

    // Free again: a waiting job is offered and can be accepted.
    const offers = await call<{ assignmentId: string; booking: { id: string; viewer: string } }[]>('GET', '/driver/offers');
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0]!.booking.viewer).toBe('offered');
    const accepted = await call<{ status: string; viewer: string }>('POST', `/driver/offers/${offers[0]!.assignmentId}/accept`);
    expect(accepted).toMatchObject({ status: 'ACCEPTED', viewer: 'field' });
  });

  it('serves earnings, performance, jobs, attendance and expenses', async () => {
    const e = await call<{ lines: unknown[]; payouts: unknown[]; totals: { pendingPayout: number } }>('GET', '/driver/earnings', undefined, { period: 'this_fy' });
    expect(e.lines.length).toBeGreaterThan(0);
    expect(e.payouts.length).toBeGreaterThan(0);
    const p = await call<{ score: number | null; inputs: { completed: number } }>('GET', '/driver/performance');
    expect(p.inputs.completed).toBeGreaterThan(0);
    expect(p.score).not.toBeNull();
    const jobs = (await handleGuestRequest('driver', 'GET', '/driver/jobs', { page: 1, pageSize: 20 }, undefined, true)) as Json;
    expect((jobs.meta as { total: number }).total).toBeGreaterThan(5);
    const att = (await handleGuestRequest('driver', 'GET', '/driver/attendance', { page: 1, pageSize: 10 }, undefined, true)) as Json;
    expect((att.data as unknown[]).length).toBeGreaterThan(0);
    const exp = await call<unknown[]>('GET', '/driver/expenses');
    expect(exp.length).toBeGreaterThan(0);
  });
});
