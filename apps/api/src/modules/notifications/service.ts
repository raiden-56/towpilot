import type { NotificationChannel } from '@prisma/client';
import { prisma, type Db } from '../../lib/prisma.js';
import { enqueue, registerJob } from '../../jobs/queue.js';
import { emitToUser } from '../../realtime/socket.js';
import { sendEmail, sendPush, sms } from '../../integrations/messaging.js';

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Channels besides IN_APP. Respects user preferences. */
  channels?: Exclude<NotificationChannel, 'IN_APP'>[];
}

/**
 * Creates an in-app notification (delivered immediately over the socket) and queues
 * SMS/email/push deliveries as background jobs so a provider outage never blocks a request.
 * Call after the business transaction commits (or pass the tx — jobs are durable).
 */
export async function notify(db: Db, userId: string, n: NotifyInput) {
  const inApp = await db.notification.create({
    data: { userId, channel: 'IN_APP', type: n.type, title: n.title, body: n.body, data: (n.data ?? {}) as object, status: 'SENT', sentAt: new Date() },
  });
  emitToUser(userId, 'notification', { id: inApp.id, type: n.type, title: n.title, body: n.body, data: n.data ?? {}, createdAt: inApp.createdAt });

  if (n.channels?.length) {
    const prefs = await db.customerProfile.findUnique({ where: { userId }, select: { notifySms: true, notifyEmail: true, notifyPush: true } });
    for (const ch of n.channels) {
      if (prefs && ((ch === 'SMS' && !prefs.notifySms) || (ch === 'EMAIL' && !prefs.notifyEmail) || (ch === 'PUSH' && !prefs.notifyPush))) continue;
      const row = await db.notification.create({ data: { userId, channel: ch, type: n.type, title: n.title, body: n.body, data: (n.data ?? {}) as object } });
      await enqueue(db, 'notify.deliver', { notificationId: row.id });
    }
  }
  return inApp;
}

export async function notifyMany(db: Db, userIds: string[], n: NotifyInput) {
  for (const id of [...new Set(userIds)]) await notify(db, id, n);
}

/** Notify all active ops staff (dispatchers + admins). */
export async function notifyOps(db: Db, n: NotifyInput) {
  const staff = await db.user.findMany({
    where: { status: 'ACTIVE', roles: { some: { role: { key: { in: ['dispatcher', 'admin'] } } } } },
    select: { id: true },
  });
  await notifyMany(db, staff.map((s) => s.id), n);
}

registerJob<{ notificationId: string }>('notify.deliver', async ({ notificationId }) => {
  const n = await prisma.notification.findUnique({ where: { id: notificationId }, include: { user: { select: { phone: true, email: true } } } });
  if (!n || n.status !== 'PENDING') return;
  let result: { delivered: boolean; sandbox: boolean; error?: string } = { delivered: false, sandbox: false, error: 'No destination' };
  if (n.channel === 'SMS' && n.user.phone) result = await sms.sendText(n.user.phone, `${n.title}: ${n.body}`);
  else if (n.channel === 'EMAIL' && n.user.email) result = await sendEmail({ to: n.user.email, subject: n.title, text: n.body });
  else if (n.channel === 'PUSH') result = await sendPush(n.userId, n.title, n.body);

  if (result.delivered) await prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', sentAt: new Date() } });
  else if (result.sandbox) await prisma.notification.update({ where: { id: n.id }, data: { status: 'SKIPPED', error: 'Sandbox provider — not sent' } });
  else if (result.error === 'No destination') await prisma.notification.update({ where: { id: n.id }, data: { status: 'SKIPPED', error: result.error } });
  else {
    await prisma.notification.update({ where: { id: n.id }, data: { error: result.error ?? 'delivery failed' } });
    throw new Error(result.error ?? 'delivery failed'); // retried by the queue
  }
});
