import { prisma } from '../lib/prisma.js';
import { getSettings } from '../lib/settings.js';
import { logger } from '../lib/logger.js';
import { every } from './queue.js';
import { escalationSweep, quoteExpirySweep, scheduledDispatchSweep } from '../modules/dispatch/service.js';
import { maintenanceReminders } from '../domain/maintenance.js';
import { notifyMany, notify } from '../modules/notifications/service.js';
import { financialSummary } from '../modules/admin/reports.js';
import { localParts, resolvePeriod } from '../lib/time.js';
import { formatInr } from '../lib/money.js';

/** Recurring tasks. Each runs on exactly one instance at a time (advisory lock in `every`). */
export function registerSchedules() {
  every('escalation-sweep', 30_000, escalationSweep);
  every('scheduled-dispatch', 60_000, scheduledDispatchSweep);
  every('quote-expiry', 60_000, quoteExpirySweep);
  every('subscription-expiry', 15 * 60_000, subscriptionExpiry);
  every('retention-purge', 6 * 3600_000, retentionPurge);
  every('compliance-reminders', 24 * 3600_000, complianceReminders);
  every('weekly-report', 3600_000, weeklyReport);
}

/** Every Monday morning (business timezone), email/in-app a summary of last week to administrators. */
async function weeklyReport() {
  const s = await getSettings();
  const p = localParts(new Date(), s.locale.timezone);
  if (p.weekday !== 1 || p.hour < 8) return;
  const range = resolvePeriod('last_week', { tz: s.locale.timezone, fyStartMonth: s.locale.fyStartMonth });
  const key = `weekly-report:${range.from.toISOString().slice(0, 10)}`;
  const done = await prisma.backgroundJob.findUnique({ where: { dedupeKey: key } });
  if (done) return;
  await prisma.backgroundJob.create({ data: { type: 'report.weekly.marker', payload: {}, status: 'DONE', dedupeKey: key, completedAt: new Date() } });
  const f = await financialSummary(range, { excludeSample: false });
  const body = [
    `Completed bookings: ${f.completedBookings}`,
    `Recognized revenue: ${formatInr(f.operating.recognizedRevenue)}`,
    `Operating profit: ${formatInr(f.operating.operatingProfit)}${f.operating.profitMarginPct != null ? ` (${f.operating.profitMarginPct}%)` : ''}`,
    `Cash in: ${formatInr(f.cashFlow.cashIn)} · Cash out: ${formatInr(f.cashFlow.cashOut)}`,
    `Receivables: ${formatInr(f.receivables.amount)}`,
  ].join('\n');
  const admins = await prisma.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { key: { in: ['admin', 'finance'] } } } } }, select: { id: true } });
  await notifyMany(prisma, admins.map((a) => a.id), { type: 'report.weekly', title: 'Weekly business summary', body, channels: ['EMAIL'] });
}

async function subscriptionExpiry() {
  const expired = await prisma.membershipSubscription.findMany({ where: { status: 'ACTIVE', endsAt: { lt: new Date() } }, select: { id: true, userId: true, planSnapshot: true } });
  for (const s of expired) {
    await prisma.membershipSubscription.update({ where: { id: s.id }, data: { status: 'EXPIRED' } });
    if (s.userId) await notify(prisma, s.userId, { type: 'membership.expired', title: `${(s.planSnapshot as { name: string }).name} has expired`, body: 'Renew any time from Memberships. Memberships never auto-renew without your payment.', data: { subscriptionId: s.id } });
  }
}

/** Data minimisation: location history and spent OTP challenges are not kept longer than needed. */
async function retentionPurge() {
  const s = await getSettings();
  const now = Date.now();
  const tracking = await prisma.trackingEvent.deleteMany({ where: { recordedAt: { lt: new Date(now - s.retention.trackingDays * 86_400_000) } } });
  const otps = await prisma.otpChallenge.deleteMany({ where: { createdAt: { lt: new Date(now - s.retention.otpDays * 86_400_000) } } });
  const notes = await prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(now - s.retention.notificationDays * 86_400_000) } } });
  const sessions = await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now - 7 * 86_400_000) } }, { revokedAt: { lt: new Date(now - 30 * 86_400_000) } }] } });
  const jobs = await prisma.backgroundJob.deleteMany({ where: { status: 'DONE', completedAt: { lt: new Date(now - 7 * 86_400_000) } } });
  logger.info({ tracking: tracking.count, otps: otps.count, notifications: notes.count, sessions: sessions.count, jobs: jobs.count }, 'retention purge complete');
}

async function complianceReminders() {
  const trucks = await prisma.towTruck.findMany({ where: { status: { not: 'RETIRED' } } });
  const lines: string[] = [];
  for (const t of trucks) for (const r of maintenanceReminders(t)) if (r.severity === 'OVERDUE' || r.kind === 'DOCUMENT') lines.push(`${t.registrationNumber}: ${r.message}`);
  const soon = new Date(Date.now() + 30 * 86_400_000);
  const licences = await prisma.driverProfile.findMany({ where: { licenceExpiry: { lt: soon } }, include: { user: { select: { fullName: true } } } });
  for (const l of licences) lines.push(`${l.user.fullName}: driving licence ${l.licenceExpiry < new Date() ? 'expired' : 'expires'} ${l.licenceExpiry.toDateString()}`);
  if (!lines.length) return;
  const admins = await prisma.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { key: { in: ['admin'] } } } } }, select: { id: true } });
  await notifyMany(prisma, admins.map((a) => a.id), { type: 'compliance', title: `${lines.length} fleet/licence compliance item(s)`, body: lines.slice(0, 10).join('\n') + (lines.length > 10 ? `\n…and ${lines.length - 10} more` : ''), data: {} });
}
