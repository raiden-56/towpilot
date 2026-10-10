import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { maskPhone } from '../lib/crypto.js';

export interface DeliveryResult {
  delivered: boolean;
  provider: string;
  sandbox: boolean;
  error?: string;
}

// ─── SMS ──────────────────────────────────────────────────────────────

export interface SmsProvider {
  name: string;
  sandbox: boolean;
  sendOtp(phone: string, code: string): Promise<DeliveryResult>;
  sendText(phone: string, text: string): Promise<DeliveryResult>;
}

/** Development adapter. Nothing is sent; the message is written to the API log only. */
const sandboxSms: SmsProvider = {
  name: 'sandbox',
  sandbox: true,
  async sendOtp(phone, code) {
    logger.warn({ phone: maskPhone(phone) }, `[SANDBOX SMS — not sent] OTP for ${phone}: ${code}`);
    return { delivered: false, provider: 'sandbox', sandbox: true };
  },
  async sendText(phone, text) {
    logger.info({ phone: maskPhone(phone) }, `[SANDBOX SMS — not sent] ${text}`);
    return { delivered: false, provider: 'sandbox', sandbox: true };
  },
};

const msg91: SmsProvider = {
  name: 'msg91',
  sandbox: false,
  async sendOtp(phone, code) {
    if (!env.MSG91_AUTH_KEY || !env.MSG91_OTP_TEMPLATE_ID) return { delivered: false, provider: 'msg91', sandbox: false, error: 'MSG91 not configured' };
    const mobile = phone.replace('+', '');
    const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(env.MSG91_OTP_TEMPLATE_ID)}&mobile=${mobile}&otp=${code}`;
    try {
      const r = await fetch(url, { method: 'POST', headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000) });
      const body = (await r.json().catch(() => ({}))) as { type?: string; message?: string };
      if (!r.ok || body.type === 'error') return { delivered: false, provider: 'msg91', sandbox: false, error: body.message ?? `HTTP ${r.status}` };
      return { delivered: true, provider: 'msg91', sandbox: false };
    } catch (e) {
      return { delivered: false, provider: 'msg91', sandbox: false, error: (e as Error).message };
    }
  },
  async sendText(phone, text) {
    // Transactional SMS in India requires DLT-registered templates. Wire a Flow template here.
    logger.warn({ phone: maskPhone(phone) }, `MSG91 transactional template not configured; SMS not sent: ${text}`);
    return { delivered: false, provider: 'msg91', sandbox: false, error: 'Transactional SMS template not configured' };
  },
};

export const sms: SmsProvider = env.SMS_PROVIDER === 'msg91' ? msg91 : sandboxSms;

// ─── Email ────────────────────────────────────────────────────────────

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

const transporter =
  env.EMAIL_PROVIDER === 'smtp' && env.SMTP_HOST
    ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT ?? 587, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined })
    : null;

export async function sendEmail(msg: EmailMessage): Promise<DeliveryResult> {
  if (!transporter) {
    logger.info({ to: msg.to, subject: msg.subject }, '[SANDBOX EMAIL — not sent]');
    return { delivered: false, provider: 'sandbox', sandbox: true };
  }
  try {
    await transporter.sendMail({ from: env.EMAIL_FROM, ...msg });
    return { delivered: true, provider: 'smtp', sandbox: false };
  } catch (e) {
    return { delivered: false, provider: 'smtp', sandbox: false, error: (e as Error).message };
  }
}

// ─── Push ─────────────────────────────────────────────────────────────

/**
 * Push boundary. Web Push requires VAPID keys and stored subscriptions; native push requires
 * FCM/APNs credentials. Until configured, push notifications are logged and in-app delivery
 * (Socket.IO + notification centre) is used instead.
 */
export async function sendPush(userId: string, title: string, body: string): Promise<DeliveryResult> {
  if (env.PUSH_PROVIDER === 'none') return { delivered: false, provider: 'none', sandbox: false, error: 'Push disabled' };
  logger.debug({ userId, title, body }, '[SANDBOX PUSH — not sent]');
  return { delivered: false, provider: 'sandbox', sandbox: true };
}
