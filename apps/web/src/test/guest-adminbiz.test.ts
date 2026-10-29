import { describe, expect, it } from 'vitest';
import { handleGuestRequest } from '@/guest/mock';
import { db } from '@/guest/mock/db';

type Q = Record<string, string | number | boolean | undefined>;
type Json = { kind: 'json'; data: unknown; meta?: Record<string, unknown> };
const call = async (method: string, path: string, query: Q = {}, body?: unknown, page = false) => (await handleGuestRequest('finance', method, path, query, body, page)) as Json;
const data = async <T,>(method: string, path: string, query: Q = {}, body?: unknown) => (await call(method, path, query, body)).data as T;

describe('guest mode: admin commercial, finance and reports', () => {
  it('serves pricing screens', async () => {
    expect((await data<unknown[]>('GET', '/admin/pricing/categories')).length).toBe(11);
    const zones = await data<{ categories: unknown[] }[]>('GET', '/admin/pricing/zones');
    expect(zones.length).toBeGreaterThanOrEqual(4);
    expect(zones.every((z) => z.categories.length > 0)).toBe(true);
    const cards = await data<{ id: string }[]>('GET', '/admin/pricing/rate-cards');
    expect(cards.length).toBe(11);
    const sim = await data<{ total: number }>('POST', `/admin/pricing/rate-cards/${cards[0]!.id}/simulate`, {}, { towDistanceKm: 18, pickupDistanceKm: 12 });
    expect(sim.total).toBeGreaterThan(0);
    const v2 = await data<{ version: number; isActive: boolean; baseFee: number }>('POST', '/admin/pricing/rate-cards/rc_car_tow_v1/versions', {}, { name: 'Car towing — standard', serviceCategoryId: 'cat_car_tow', baseFee: 1600, includedKm: 10, perKm: 36, changeReason: 'Fuel price revision' });
    expect(v2).toMatchObject({ version: 2, isActive: true, baseFee: 160000 });
    expect((await data<unknown[]>('GET', '/admin/pricing/rate-cards/rc_car_tow_v1/history')).length).toBe(2);
    expect((await data<unknown[]>('GET', '/admin/pricing/memberships')).length).toBeGreaterThan(0);
    expect(((await call('GET', '/admin/pricing/subscriptions', {}, undefined, true)).data as unknown[]).length).toBeGreaterThan(0);
  });

  it('serves the finance ledger and its actions', async () => {
    const inv = await call('GET', '/admin/finance/invoices', { pageSize: 20 }, undefined, true);
    expect((inv.data as unknown[]).length).toBe(20);
    expect(inv.meta).toHaveProperty('sums');
    const unpaid = db.invoices.find((i) => i.paymentStatus === 'UNPAID' && i.outstanding > 0)!;
    expect((await data<{ items: unknown[] }>('GET', `/admin/finance/invoices/${unpaid.id}`)).items.length).toBeGreaterThan(0);
    await data('POST', `/admin/finance/invoices/${unpaid.id}/bank-transfer`, {}, { amount: unpaid.outstanding / 100, reference: 'UTR123456' });
    expect(unpaid.paymentStatus).toBe('PAID');

    const pending = (await call('GET', '/admin/finance/payments', { method: 'CASH', status: 'PENDING' }, undefined, true)).data as { id: string; invoiceId: string }[];
    expect(pending.length).toBeGreaterThan(0);
    await data('POST', `/admin/finance/payments/${pending[0]!.id}/cash-decision`, {}, { approve: true });
    expect(db.invoices.find((i) => i.id === pending[0]!.invoiceId)!.paymentStatus).toBe('PAID');

    const refunds = (await call('GET', '/admin/finance/refunds', { status: 'REQUESTED' }, undefined, true)).data as { id: string }[];
    expect(refunds.length).toBeGreaterThan(0);
    expect((await data<{ status: string }>('POST', `/admin/finance/refunds/${refunds[0]!.id}/decision`, {}, { approve: true, note: 'Approved goodwill' })).status).toBe('SUCCEEDED');

    expect(((await call('GET', '/admin/finance/expenses', { status: 'SUBMITTED' }, undefined, true)).data as unknown[]).length).toBeGreaterThan(0);
    expect(Object.keys((await data<{ buckets: object }>('GET', '/admin/finance/ageing')).buckets)).toHaveLength(5);
    expect((await data<{ totals: { succeeded: number } }>('GET', '/admin/finance/reconciliation')).totals.succeeded).toBeGreaterThan(0);
  });

  it('serves payroll', async () => {
    expect(((await call('GET', '/admin/finance/salaries', { pageSize: 100 }, undefined, true)).data as unknown[]).length).toBeGreaterThan(0);
    const payouts = await call('GET', '/admin/finance/payouts', {}, undefined, true);
    expect((payouts.meta!.pendingByWorker as unknown[]).length).toBeGreaterThan(0);
    const generated = await data<{ id: string }[]>('POST', '/admin/finance/payouts/generate', {}, { periodStart: new Date(Date.now() - 14 * 86_400_000).toISOString(), periodEnd: new Date().toISOString() });
    expect(generated.length).toBeGreaterThan(0);
    await data('POST', `/admin/finance/payouts/${generated[0]!.id}/approve`);
    await data('POST', `/admin/finance/payouts/${generated[0]!.id}/pay`, {}, { paymentRef: 'UTR999' });
    expect(db.payouts.find((p) => p.id === generated[0]!.id)!.status).toBe('PAID');
    expect(((await call('GET', '/admin/finance/earnings', {}, undefined, true)).data as unknown[]).length).toBeGreaterThan(0);
  });

  it('computes coherent reports', async () => {
    const ov = await data<{ kpis: { key: string; value: number | null }[] }>('GET', '/admin/reports/overview', { period: 'last_month' });
    const kpi = (k: string) => ov.kpis.find((x) => x.key === k)!.value;
    expect(kpi('activeBookings')).toBeGreaterThanOrEqual(8);
    expect(kpi('grossServiceValue')).toBeGreaterThan(0);
    const fin = await data<{ current: { operating: { recognizedRevenue: number }; invoicesIssued: number } }>('GET', '/admin/reports/financial', { period: 'this_fy' });
    expect(fin.current.invoicesIssued).toBeGreaterThan(0);
    expect(fin.current.operating.recognizedRevenue).toBeGreaterThan(0);
    expect((await data<{ series: unknown[] }>('GET', '/admin/reports/trends', { period: 'this_fy', granularity: 'month' })).series.length).toBeGreaterThanOrEqual(3);
    for (const p of ['profitability', 'zones', 'drivers']) expect((await data<unknown[]>('GET', `/admin/reports/${p}`, { period: 'this_fy' })).length).toBeGreaterThan(0);
    expect((await data<{ trucks: unknown[] }>('GET', '/admin/reports/trucks', { period: 'this_fy' })).trucks.length).toBeGreaterThan(0);
    expect((await data<{ customersServed: number }>('GET', '/admin/reports/customers', { period: 'this_fy' })).customersServed).toBeGreaterThan(0);
    expect((await data<{ hotspots: unknown[] }>('GET', '/admin/reports/demand', { period: 'this_fy' })).hotspots.length).toBeGreaterThan(0);
    expect(await data('GET', '/admin/reports/cancellations', { period: 'this_fy' })).toHaveProperty('byStage');
    expect((await handleGuestRequest('finance', 'GET', '/admin/reports/financial.csv', { period: 'this_month' }, undefined, false)).kind).toBe('file');
  });
});
