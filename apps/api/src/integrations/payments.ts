import { env } from '../config/env.js';
import { hmacSha256, randomToken, safeEqual } from '../lib/crypto.js';

/**
 * Payment gateway boundary.
 *  - RazorpayGateway talks to the real Razorpay REST API (requires credentials).
 *  - SandboxGateway simulates a gateway for development. It never moves money; every record it
 *    creates is flagged isSandbox=true and labelled in the UI. Sandbox payments are confirmed
 *    ONLY through signed webhook events that pass through the same verification and idempotent
 *    processing pipeline as real Razorpay webhooks.
 */

export interface NormalizedWebhook {
  eventId: string;
  eventType: string;
  kind: 'payment.captured' | 'payment.failed' | 'refund.processed' | 'refund.failed' | 'other';
  orderId?: string;
  paymentId?: string;
  refundId?: string;
  amount?: number;
  fee?: number;
  tax?: number;
  failureReason?: string;
}

export interface PaymentGateway {
  provider: 'RAZORPAY' | 'SANDBOX';
  isSandbox: boolean;
  publicKeyId: string | null;
  createOrder(input: { amount: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<{ orderId: string }>;
  verifyCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }): boolean;
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(body: unknown, headers: Record<string, string | string[] | undefined>): NormalizedWebhook;
  createRefund(input: { paymentId: string; amount: number; idempotencyKey: string; notes: Record<string, string> }): Promise<{ refundId: string; status: 'processed' | 'pending' | 'failed'; error?: string }>;
}

const header = (h: Record<string, string | string[] | undefined>, name: string) => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

interface RazorpayLikeEvent {
  event: string;
  payload?: {
    payment?: { entity?: { id: string; order_id?: string; amount?: number; fee?: number; tax?: number; error_description?: string } };
    refund?: { entity?: { id: string; payment_id?: string; amount?: number } };
  };
}

function normalizeRazorpayLike(body: unknown, eventIdHeader: string | undefined): NormalizedWebhook {
  const b = (body && typeof body === 'object' ? body : {}) as Partial<RazorpayLikeEvent>;
  const p = b.payload?.payment?.entity;
  const r = b.payload?.refund?.entity;
  const eventType = typeof b.event === 'string' ? b.event.slice(0, 100) : 'unknown';
  const kind = (['payment.captured', 'payment.failed', 'refund.processed', 'refund.failed'] as const).find((k) => k === eventType) ?? 'other';
  return {
    eventId: (eventIdHeader ?? `${eventType}:${p?.id ?? ''}:${r?.id ?? ''}`).slice(0, 200),
    eventType,
    kind,
    orderId: p?.order_id,
    paymentId: p?.id ?? r?.payment_id,
    refundId: r?.id,
    amount: r?.amount ?? p?.amount,
    fee: p?.fee,
    tax: p?.tax,
    failureReason: p?.error_description,
  };
}

class RazorpayGateway implements PaymentGateway {
  provider = 'RAZORPAY' as const;
  isSandbox = false;
  publicKeyId = env.RAZORPAY_KEY_ID ?? null;
  private auth = 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');

  private async call<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    const r = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: 'POST',
      headers: { authorization: this.auth, 'content-type': 'application/json', ...(idempotencyKey ? { 'x-razorpay-idempotency-key': idempotencyKey } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await r.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!r.ok) throw new Error(json.error?.description ?? `Razorpay HTTP ${r.status}`);
    return json;
  }

  async createOrder(i: { amount: number; currency: string; receipt: string; notes: Record<string, string> }) {
    const o = await this.call<{ id: string }>('/orders', { amount: i.amount, currency: i.currency, receipt: i.receipt.slice(0, 40), notes: i.notes });
    return { orderId: o.id };
  }

  verifyCheckoutSignature(i: { orderId: string; paymentId: string; signature: string }) {
    if (!env.RAZORPAY_KEY_SECRET) return false;
    return safeEqual(hmacSha256(env.RAZORPAY_KEY_SECRET, `${i.orderId}|${i.paymentId}`), i.signature);
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const sig = header(headers, 'x-razorpay-signature');
    if (!sig || !env.RAZORPAY_WEBHOOK_SECRET) return false;
    return safeEqual(hmacSha256(env.RAZORPAY_WEBHOOK_SECRET, rawBody), sig);
  }

  parseWebhook(body: unknown, headers: Record<string, string | string[] | undefined>) {
    return normalizeRazorpayLike(body, header(headers, 'x-razorpay-event-id'));
  }

  async createRefund(i: { paymentId: string; amount: number; idempotencyKey: string; notes: Record<string, string> }) {
    try {
      const r = await this.call<{ id: string; status: string }>(`/payments/${i.paymentId}/refund`, { amount: i.amount, notes: i.notes, speed: 'normal' }, i.idempotencyKey);
      return { refundId: r.id, status: r.status === 'processed' ? ('processed' as const) : r.status === 'failed' ? ('failed' as const) : ('pending' as const) };
    } catch (e) {
      return { refundId: '', status: 'failed' as const, error: (e as Error).message };
    }
  }
}

class SandboxGateway implements PaymentGateway {
  provider = 'SANDBOX' as const;
  isSandbox = true;
  publicKeyId = 'sandbox';

  async createOrder() {
    return { orderId: `sbx_order_${randomToken(9)}` };
  }
  verifyCheckoutSignature(i: { orderId: string; paymentId: string; signature: string }) {
    return safeEqual(hmacSha256(env.SANDBOX_WEBHOOK_SECRET, `${i.orderId}|${i.paymentId}`), i.signature);
  }
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const sig = header(headers, 'x-sandbox-signature');
    return !!sig && safeEqual(hmacSha256(env.SANDBOX_WEBHOOK_SECRET, rawBody), sig);
  }
  parseWebhook(body: unknown, headers: Record<string, string | string[] | undefined>) {
    return normalizeRazorpayLike(body, header(headers, 'x-sandbox-event-id'));
  }
  async createRefund() {
    // Sandbox refunds settle asynchronously through a signed sandbox webhook (see payments service).
    return { refundId: `sbx_rfnd_${randomToken(9)}`, status: 'pending' as const };
  }

  /** Build a signed webhook exactly like the gateway would send it. */
  signEvent(event: RazorpayLikeEvent) {
    const raw = Buffer.from(JSON.stringify(event));
    return { raw, headers: { 'x-sandbox-signature': hmacSha256(env.SANDBOX_WEBHOOK_SECRET, raw), 'x-sandbox-event-id': `sbx_evt_${randomToken(12)}` } };
  }
}

export const sandboxGateway = new SandboxGateway();
export const razorpayGateway = env.PAYMENT_PROVIDER === 'razorpay' ? new RazorpayGateway() : null;
export const gateway: PaymentGateway = razorpayGateway ?? sandboxGateway;

/** Sandbox fee model used only for simulated payments (2% + 18% GST on fee), mirroring typical gateway pricing. */
export function sandboxFee(amount: number) {
  const fee = Math.round(amount * 0.02);
  return { fee: fee + Math.round(fee * 0.18), tax: Math.round(fee * 0.18) };
}
