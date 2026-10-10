import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, createStaff, loginCustomer, nextPhone, resetDb } from '../helpers.js';
import { prisma } from '../../src/lib/prisma.js';
import { invalidatePrincipal } from '../../src/middleware/auth.js';

beforeAll(resetDb);

describe('phone OTP authentication', () => {
  it('registers a new customer with consent and returns tokens + refresh cookie', async () => {
    const c = await loginCustomer('Asha');
    expect(c.token).toBeTruthy();
    expect(c.user.roles).toEqual(['customer']);
    expect(c.cookie.join(';')).toMatch(/tp_rt=.*HttpOnly/i);
    const profile = await prisma.customerProfile.findUnique({ where: { userId: c.user.id } });
    expect(profile?.termsAcceptedAt).toBeTruthy();
  });

  it('requires name and terms for new accounts', async () => {
    const phone = nextPhone();
    const r1 = await api().post('/api/v1/auth/otp/request').send({ phone }).expect(200);
    expect(r1.body.data.isNewUser).toBe(true);
    const r2 = await api().post('/api/v1/auth/otp/verify').send({ phone, code: r1.body.data.sandboxOtp }).expect(400);
    expect(r2.body.error.message).toMatch(/name/i);
  });

  it('rejects wrong codes, locks after repeated attempts and codes are single use', async () => {
    const phone = nextPhone();
    const r1 = await api().post('/api/v1/auth/otp/request').send({ phone }).expect(200);
    const wrong = r1.body.data.sandboxOtp === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await api().post('/api/v1/auth/otp/verify').send({ phone, code: wrong, fullName: 'X Y', acceptTerms: true }).expect(401);
    await api().post('/api/v1/auth/otp/verify').send({ phone, code: r1.body.data.sandboxOtp, fullName: 'X Y', acceptTerms: true }).expect(401);
  });

  it('validates Indian mobile numbers', async () => {
    await api().post('/api/v1/auth/otp/request').send({ phone: '12345' }).expect(400);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes all sessions on reuse', async () => {
    const c = await loginCustomer();
    const cookie = c.cookie.find((x) => x.startsWith('tp_rt='))!.split(';')[0]!;
    const r1 = await api().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(200);
    const rotated = (r1.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith('tp_rt='))!.split(';')[0]!;
    expect(rotated).not.toBe(cookie);
    // Re-using the old token is treated as theft.
    await api().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    await api().post('/api/v1/auth/refresh').set('Cookie', rotated).expect(401);
  });

  it('staff log in with email and password; wrong password is rejected', async () => {
    const t = await createStaff('admin');
    const me = await api().get('/api/v1/auth/me').set(bearer(t)).expect(200);
    expect(me.body.data.permissions).toContain('settings:manage');
    await api().post('/api/v1/auth/login').send({ email: 'nobody@test.local', password: 'x' }).expect(401);
  });

  it('suspended accounts are blocked immediately', async () => {
    const c = await loginCustomer();
    await prisma.user.update({ where: { id: c.user.id }, data: { status: 'SUSPENDED' } });
    invalidatePrincipal(c.user.id);
    await api().get('/api/v1/me').set(bearer(c.token)).expect(403);
  });

  it('rejects missing and forged tokens', async () => {
    await api().get('/api/v1/me').expect(401);
    await api().get('/api/v1/me').set(bearer('forged.token.value')).expect(401);
  });
});

describe('privacy: right to erasure', () => {
  it('anonymises personal data but keeps invoices', async () => {
    const c = await loginCustomer('Erase Me');
    await api().post('/api/v1/me/addresses').set(bearer(c.token)).send({ label: 'Home', address: '12 MG Road', lat: 12.97, lng: 77.59 }).expect(201);
    await prisma.invoice.create({ data: { number: 'INV/ERASE/1', type: 'SERVICE', customerUserId: c.user.id, billingName: 'Erase Me', subtotal: 100, discountTotal: 0, taxableValue: 100, taxTotal: 18, passThroughTotal: 0, total: 118, outstanding: 0 } });
    const admin = await createStaff('admin');
    await api().post(`/api/v1/admin/customers/${c.user.id}/anonymize`).set(bearer(admin)).send({ reason: 'DPDP erasure request verified' }).expect(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } });
    expect(u.phone).toBeNull();
    expect(u.fullName).toBe('Erased customer');
    expect(u.status).toBe('DEACTIVATED');
    expect(await prisma.savedAddress.count({ where: { userId: u.id } })).toBe(0);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { number: 'INV/ERASE/1' } })).billingName).toBe('Erase Me');
    await api().get('/api/v1/me').set(bearer(c.token)).expect(401);
  });
});
