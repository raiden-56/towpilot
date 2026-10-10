import { expect, test, type Page } from '@playwright/test';
import { API, apiLoginStaff, auth, otpSignIn, signUpCustomerViaUi, testPhone } from './helpers';

/**
 * End-to-end journey through the real UI against the real API (sandbox integrations):
 *   customer signs up → requests a tow with GPS location → approves the quote →
 *   auto-dispatch offers the job → driver accepts in the driver app and works the checklist
 *   (API for the evidence-heavy middle steps) → customer pays the invoice via the sandbox
 *   checkout → booking appears in history and the admin financial report includes it.
 */
test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => !isMobile, 'Customer and driver apps are mobile-first; run once on the mobile project');

const MG_ROAD = { lat: 12.9756, lng: 77.6066 };

async function accessToken(page: Page) {
  const r = await page.request.post('/api/v1/auth/refresh');
  expect(r.ok()).toBeTruthy();
  return (await r.json()).data.accessToken as string;
}

test('customer → dispatch → driver → payment → reports', async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  const admin = await apiLoginStaff(request);

  // Put every sample driver off duty, then make one driver available near the customer.
  const drivers = (await (await request.get(`${API}/admin/employees?role=driver&pageSize=50`, { headers: auth(admin) })).json()).data as { id: string; phone: string; fullName: string; availability: { status: string } | null; assignedTruck: { truckType: string } | null }[];
  const driver = drivers.find((d) => d.phone === '+919000000013')!; // Sample Driver Suresh, flatbed
  expect(driver).toBeTruthy();
  for (const d of drivers.filter((x) => x.availability?.status === 'AVAILABLE' && x.id !== driver.id)) {
    const t = await otpSignIn(request, d.phone.replace('+91', ''), API);
    await request.put(`${API}/driver/availability`, { headers: auth(t), data: { status: 'OFF_DUTY' } });
  }

  // ── Customer: sign up through the UI ──
  const phone = testPhone();
  await signUpCustomerViaUi(page, phone, 'E2E Journey Customer');
  const custToken = await accessToken(page);
  const vr = await request.post(`${API}/vehicles`, { headers: auth(custToken), data: { vehicleClass: 'SEDAN', registrationNumber: `KA05EZ${String(Date.now()).slice(-4)}`, make: 'Hyundai', model: 'Verna', fuelType: 'PETROL' } });
  expect(vr.ok(), await vr.text()).toBeTruthy();
  const v = (await vr.json()).data;

  // ── Driver: go available with a fresh location in the driver app ──
  const driverCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: MG_ROAD.lat + 0.01, longitude: MG_ROAD.lng + 0.01 }, permissions: ['geolocation'], timezoneId: 'Asia/Kolkata' });
  const dPage = await driverCtx.newPage();
  await otpSignIn(dPage.request, '9000000013');
  await dPage.goto('/driver');
  const availableBtn = dPage.getByRole('button', { name: 'Available', exact: true });
  if ((await availableBtn.getAttribute('aria-pressed')) !== 'true') await availableBtn.click();
  await expect(availableBtn).toHaveAttribute('aria-pressed', 'true');
  // The driver app shares GPS while on duty; post one point explicitly too (headless GPS can be slow).
  const drvToken = await accessToken(dPage);
  await request.post(`${API}/driver/location`, { headers: auth(drvToken), data: { lat: MG_ROAD.lat + 0.01, lng: MG_ROAD.lng + 0.01, accuracyM: 10, recordedAt: new Date().toISOString() } });

  // ── Customer: request a tow through the wizard ──
  await page.goto(`/app/request?service=CAR_TOW&vehicleId=${v.id}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  // Pickup: GPS fix from the browser (granted), mark the place safe.
  await expect(page.getByText(/± \d+ m/)).toBeVisible();
  await page.getByRole('button', { name: "Yes, it's safe" }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  // Destination via a pasted maps link.
  await page.getByLabel('Or paste a Google Maps / location link').fill('https://maps.google.com/?q=12.9352,77.6245');
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.getByText('12.935200, 77.624500')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  // Condition: choose what happened; leave the rest as "Not sure".
  await page.getByLabel('What happened?').click();
  await page.getByRole('option', { name: /engine/i }).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  // Contact
  const contactName = page.getByLabel('Contact name');
  if (!(await contactName.inputValue())) await contactName.fill('E2E Journey Customer');
  const contactPhone = page.getByLabel('Mobile number');
  if (!(await contactPhone.inputValue())) await contactPhone.fill(phone);
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Get my quote' }).click();
  // Quote with itemised breakdown, then confirm.
  await expect(page.getByText('Your quote')).toBeVisible();
  await expect(page.getByText(/Estimated total|Total/).first()).toBeVisible();
  await page.getByRole('button', { name: /Confirm booking/ }).click();
  await page.waitForURL(/\/app\/bookings\/[a-z0-9]+/);
  const bookingId = page.url().split('/').pop()!;

  // ── Dispatch happens in the background worker; the driver gets the offer ──
  await dPage.goto('/driver');
  await expect(dPage.getByRole('button', { name: 'Accept job' })).toBeVisible({ timeout: 45_000 });
  await expect(dPage.getByText(/Exact location and customer contact are shown after you accept/i)).toBeVisible();
  await dPage.getByRole('button', { name: 'Accept job' }).click();
  await dPage.waitForURL(`**/driver/jobs/${bookingId}`);

  // Customer sees the assigned driver (realtime + polling).
  await expect(page.getByText('Sample Driver Suresh')).toBeVisible({ timeout: 30_000 });

  // ── Driver works the job in the driver app ──
  await dPage.getByRole('button', { name: 'Start driving' }).click();
  await dPage.getByRole('button', { name: "I've arrived at pickup" }).click();
  // Customer reads the pickup code from their booking page and tells the driver.
  const booking = (await (await request.get(`${API}/bookings/${bookingId}`, { headers: auth(custToken) })).json()).data;
  expect(booking.pickupOtp).toMatch(/^\d{4}$/);
  // Evidence-heavy middle steps via the same endpoints the app calls.
  const dj = (path: string, data: object) => request.post(`${API}/driver/jobs/${bookingId}/${path}`, { headers: auth(drvToken), data });
  expect((await dj('verify-pickup', { code: booking.pickupOtp })).ok()).toBeTruthy();
  expect((await dj('transition', { to: 'INSPECTING' })).ok()).toBeTruthy();
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb004300' + '08'.repeat(64) + 'ffd9', 'hex');
  const up1 = await request.post(`${API}/driver/jobs/${bookingId}/attachments`, { headers: auth(drvToken), multipart: { kind: 'PICKUP_EVIDENCE', files: { name: 'pickup.jpg', mimeType: 'image/jpeg', buffer: jpeg } } });
  expect(up1.ok(), await up1.text()).toBeTruthy();
  expect((await dj('condition-reports', { stage: 'PICKUP', attachmentIds: [(await up1.json()).data[0].id], damageMarks: [] })).ok()).toBeTruthy();
  for (const to of ['RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT']) expect((await dj('transition', { to })).ok()).toBeTruthy();
  const up2 = await request.post(`${API}/driver/jobs/${bookingId}/attachments`, { headers: auth(drvToken), multipart: { kind: 'DELIVERY_EVIDENCE', files: { name: 'drop.jpg', mimeType: 'image/jpeg', buffer: jpeg } } });
  expect((await dj('condition-reports', { stage: 'DELIVERY', attachmentIds: [(await up2.json()).data[0].id] })).ok()).toBeTruthy();
  expect((await dj('handover', { code: booking.handoverOtp, recipientName: 'Garage Supervisor' })).ok()).toBeTruthy();
  expect((await dj('transition', { to: 'DELIVERED' })).ok()).toBeTruthy();
  const closed = await dj('close', { tolls: 0, parking: 0 });
  expect(closed.ok(), await closed.text()).toBeTruthy();
  const invoiceId = (await closed.json()).data.invoiceId as string;

  // ── Customer pays through the sandbox checkout (confirmed only via signed webhook) ──
  await page.goto(`/app/billing/${invoiceId}`);
  await page.getByRole('button', { name: /^Pay ₹/ }).first().click();
  await page.getByRole('button', { name: 'Continue to pay' }).click();
  await expect(page.getByText('Sandbox — not real money').first()).toBeVisible();
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(page.getByText('Payment successful')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();

  // ── History and reports ──
  await page.goto('/app/bookings?tab=completed');
  await expect(page.getByText(booking.code)).toBeVisible();
  const inv = (await (await request.get(`${API}/admin/finance/invoices/${invoiceId}`, { headers: auth(admin) })).json()).data;
  expect(inv.paymentStatus).toBe('PAID');
  const fin = (await (await request.get(`${API}/admin/reports/financial?period=today&compare=false`, { headers: auth(admin) })).json()).data.current;
  expect(fin.operating.recognizedRevenue).toBeGreaterThanOrEqual(inv.taxableValue);
  expect(fin.cashFlow.onlineReceived).toBeGreaterThanOrEqual(inv.total);

  // Leave the sample driver off duty again.
  await request.put(`${API}/driver/availability`, { headers: auth(drvToken), data: { status: 'OFF_DUTY' } });
  await driverCtx.close();
});
