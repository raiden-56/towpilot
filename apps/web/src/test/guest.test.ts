import { describe, expect, it } from 'vitest';
import { handleGuestRequest } from '@/guest/mock';
import { db } from '@/guest/mock/db';

describe('guest mode mock API', () => {
  it('generates coherent sample data', () => {
    expect(db.bookings.length).toBeGreaterThan(80);
    expect(db.invoices.length).toBeGreaterThan(50);
    const live = db.bookings.filter((b) => !['COMPLETED', 'CANCELLED', 'FAILED', 'DELIVERED', 'DISPUTED'].includes(b.status));
    expect(live.length).toBeGreaterThanOrEqual(8);
  });

  it('answers the catalogue and returns empty data for unknown endpoints', async () => {
    const cfg = await handleGuestRequest('customer', 'GET', '/catalog/config', {}, undefined, false);
    expect(cfg.kind === 'json' && (cfg.data as { environment: string }).environment).toBe('guest');
    const unknown = await handleGuestRequest('admin', 'GET', '/nope/list', {}, undefined, true);
    expect(unknown).toMatchObject({ kind: 'json', data: [], meta: { total: 0 } });
  });
});
