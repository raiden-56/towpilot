import { expect, test, type Page } from '@playwright/test';
import { API, apiLoginOtp } from './helpers';

/**
 * Renders every route for each role and fails on uncaught errors, console errors (other than
 * map-tile network noise) or a visible error state. Screenshots are kept for visual review.
 */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', async (m) => {
    if (m.type() !== 'error') return;
    let t = m.text();
    if (t.includes('%s')) {
      const args = await Promise.all(m.args().slice(1).map((a) => a.jsonValue().catch(() => '?')));
      args[args.length - 1] = String(args[args.length - 1]).replace(/\s+/g, ' ').slice(-700);
      t = `${t.split('\n')[0]} [${args.map(String).join(', ')}]`;
    }
    if (/tile\.openstreetmap|Failed to load resource: net::ERR|favicon|ERR_NAME_NOT_RESOLVED/i.test(t)) return;
    errors.push(`console: ${t.split('\n')[0]!.slice(0, 200)}`);
  });
  return errors;
}

async function visit(page: Page, path: string, shot: string, errors: string[]) {
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
  await expect(page.getByText('Not implemented yet')).toHaveCount(0);
  await expect(page.getByText('Something went wrong. Please try again.')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect.soft(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/shots/${test.info().project.name}-${shot}.png`, fullPage: true });
  if (errors.length) console.log(`ERRORS ${path}: ${[...new Set(errors)].join(' | ')}`);
  expect.soft(errors, `errors on ${path}`).toEqual([]);
  errors.length = 0;
}

/** Sign in by restoring a refresh-cookie session obtained through the API (fast and avoids OTP throttling). */
async function signInAs(page: Page, kind: 'staff' | 'otp', who: string) {
  const ctx = page.context();
  const res =
    kind === 'staff'
      ? await ctx.request.post(`/api/v1/auth/login`, { data: { email: who, password: 'Sample@12345' } })
      : await (async () => {
          const r1 = await ctx.request.post(`/api/v1/auth/otp/request`, { data: { phone: who } });
          const otp = (await r1.json()).data.sandboxOtp;
          return ctx.request.post(`/api/v1/auth/otp/verify`, { data: { phone: who, code: otp } });
        })();
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe.configure({ mode: 'serial' });

test('admin routes render', async ({ page }) => {
  const errors = watchErrors(page);
  await signInAs(page, 'staff', 'admin@towpilot.local');
  const routes = ['/admin', '/admin/dispatch', '/admin/bookings', '/admin/incidents', '/admin/support', '/admin/employees', '/admin/fleet', '/admin/customers', '/admin/accounts', '/admin/pricing', '/admin/memberships', '/admin/finance', '/admin/payroll', '/admin/reports', '/admin/settings', '/admin/audit'];
  for (const r of routes) await visit(page, r, `admin${r.replace(/\//g, '_')}`, errors);
  // Detail pages reached by clicking the first row.
  for (const [list, prefix] of [['/admin/bookings', '/admin/bookings/'], ['/admin/employees', '/admin/employees/'], ['/admin/fleet', '/admin/fleet/'], ['/admin/customers', '/admin/customers/'], ['/admin/accounts', '/admin/accounts/']] as const) {
    await page.goto(list);
    await page.waitForLoadState('networkidle').catch(() => {});
    const link = page.locator(`a[href^="${prefix}"]`).first();
    if (await link.count()) {
      await visit(page, (await link.getAttribute('href'))!, `admin${prefix.replace(/\//g, '_')}detail`, errors);
    } else {
      const row = page.locator('tbody tr, .MuiCardActionArea-root').first();
      await row.click();
      await page.waitForURL(new RegExp(prefix));
      await visit(page, new URL(page.url()).pathname, `admin${prefix.replace(/\//g, '_')}detail`, errors);
    }
  }
  const inv = await page.context().request.get(`/api/v1/admin/finance/invoices?pageSize=1`, { headers: {} });
  void inv;
});

test('customer routes render', async ({ page }) => {
  const errors = watchErrors(page);
  await signInAs(page, 'otp', '9000000101');
  for (const r of ['/app', '/app/request', '/app/bookings', '/app/vehicles', '/app/billing', '/app/memberships', '/app/support', '/app/account', '/app/notifications']) await visit(page, r, `customer${r.replace(/\//g, '_')}`, errors);
  await page.goto('/app/bookings?tab=completed');
  await page.waitForLoadState('networkidle').catch(() => {});
  const b = page.locator('a[href^="/app/bookings/"]').first();
  if (await b.count()) await visit(page, (await b.getAttribute('href'))!, 'customer_booking_detail', errors);
  await page.goto('/app/billing');
  await page.waitForLoadState('networkidle').catch(() => {});
  const i = page.locator('a[href^="/app/billing/"]').first();
  if (await i.count()) await visit(page, (await i.getAttribute('href'))!, 'customer_invoice_detail', errors);
});

test('driver routes render', async ({ page }) => {
  const errors = watchErrors(page);
  await signInAs(page, 'otp', '9000000012');
  for (const r of ['/driver', '/driver/jobs', '/driver/earnings', '/driver/profile']) await visit(page, r, `driver${r.replace(/\//g, '_')}`, errors);
  const j = page.locator('a[href^="/driver/jobs/"]').first();
  await page.goto('/driver/jobs');
  await page.waitForLoadState('networkidle').catch(() => {});
  if (await j.count()) await visit(page, (await j.getAttribute('href'))!, 'driver_job_detail', errors);
});

test('role boundaries in the UI', async ({ page }) => {
  await signInAs(page, 'otp', test.info().project.name === 'mobile' ? '9000000104' : '9000000103');
  await page.goto('/admin');
  await page.waitForURL('**/app');
  await page.goto('/driver');
  await page.waitForURL('**/app');
  void API;
  void apiLoginOtp;
});
