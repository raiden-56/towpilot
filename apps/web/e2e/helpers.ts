import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1';

/** Unique test phone in a reserved-looking range so E2E users are easy to identify. */
export function testPhone() {
  return `97${String(Date.now()).slice(-8)}`;
}

export async function apiLoginStaff(request: APIRequestContext, email = 'admin@towpilot.local', password = 'Sample@12345') {
  const r = await request.post(`${API}/auth/login`, { data: { email, password } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).data.accessToken as string;
}

export async function apiLoginOtp(request: APIRequestContext, phone: string, extra: Record<string, unknown> = {}) {
  const r1 = await request.post(`${API}/auth/otp/request`, { data: { phone } });
  expect(r1.ok(), await r1.text()).toBeTruthy();
  const otp = (await r1.json()).data.sandboxOtp as string;
  const r2 = await request.post(`${API}/auth/otp/verify`, { data: { phone, code: otp, ...extra } });
  expect(r2.ok(), await r2.text()).toBeTruthy();
  return (await r2.json()).data.accessToken as string;
}

/** OTP sign-in that waits out the per-phone 30-second resend throttle. Works on a page's request context (sets the session cookie). */
export async function otpSignIn(req: APIRequestContext, phone: string, base = '/api/v1') {
  for (let i = 0; i < 4; i++) {
    const r1 = await req.post(`${base}/auth/otp/request`, { data: { phone } });
    if (r1.ok()) {
      const otp = (await r1.json()).data.sandboxOtp as string;
      const r2 = await req.post(`${base}/auth/otp/verify`, { data: { phone, code: otp } });
      expect(r2.ok(), await r2.text()).toBeTruthy();
      return (await r2.json()).data.accessToken as string;
    }
    if (!/30 seconds/.test(await r1.text())) throw new Error(`OTP request failed: ${await r1.text()}`);
    await new Promise((r) => setTimeout(r, 31_000));
  }
  throw new Error('OTP throttled');
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Customer sign-up through the real login UI (sandbox OTP is displayed on screen). */
export async function signUpCustomerViaUi(page: Page, phone: string, name: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  const otpBox = page.getByText(/development code is/i);
  await expect(otpBox, 'sandbox OTP not shown (rate limited or SMS not in sandbox?)').toBeVisible({ timeout: 15_000 });
  const otpText = await otpBox.innerText();
  const code = otpText.match(/(\d{6})/)![1]!;
  await page.getByLabel('6-digit code').fill(code);
  await page.getByLabel('Your full name').fill(name);
  await page.getByRole('checkbox', { name: /I agree to the Terms/i }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/app');
}

export async function signInStaffViaUi(page: Page, email: string, password = 'Sample@12345') {
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Staff sign-in' }).click();
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/admin');
}
