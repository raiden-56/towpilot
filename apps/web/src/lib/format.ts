import type { BookingStatus, PaymentStatus } from '@/api/types';

export const TZ = 'Asia/Kolkata';

/** Paise → "₹1,234.50" */
export function inr(paise: number | null | undefined, opts: { decimals?: boolean } = {}) {
  if (paise == null) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: opts.decimals === false ? 0 : 2, maximumFractionDigits: opts.decimals === false ? 0 : 2 }).format(paise / 100);
}

/** Compact INR for KPI tiles: ₹1.2L, ₹3.4Cr */
export function inrCompact(paise: number | null | undefined) {
  if (paise == null) return '—';
  const r = paise / 100;
  const abs = Math.abs(r);
  const sign = r < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export const toPaise = (rupees: number) => Math.round(rupees * 100);

export function dateTime(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

export function date(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
}

export function time(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
}

export function relative(d: string | Date | null | undefined) {
  if (!d) return '—';
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');

export const STATUS_LABELS: Record<BookingStatus, string> = {
  REQUESTED: 'Request submitted',
  QUOTED: 'Quote ready',
  CONFIRMED: 'Confirmed',
  SEARCHING_FOR_PROVIDER: 'Finding provider',
  ASSIGNED: 'Driver assigned',
  ACCEPTED: 'Driver accepted',
  EN_ROUTE: 'Heading to pickup',
  ARRIVED: 'Driver arrived',
  INSPECTING: 'Inspecting vehicle',
  RECOVERY_AUTHORIZED: 'Recovery authorised',
  LOADING: 'Loading vehicle',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Handed over',
  COMPLETED: 'Completed',
  REJECTED: 'Driver declined',
  REASSIGNMENT_REQUIRED: 'Reassigning',
  CANCELLED: 'Cancelled',
  FAILED: 'Unable to complete',
  CUSTOMER_UNAVAILABLE: 'Customer unreachable',
  SAFETY_HOLD: 'Safety hold',
  DISPUTED: 'Disputed',
};

export type ChipColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';

export function statusColor(s: BookingStatus): ChipColor {
  if (['COMPLETED', 'DELIVERED'].includes(s)) return 'success';
  if (['CANCELLED', 'FAILED'].includes(s)) return 'default';
  if (['SAFETY_HOLD', 'DISPUTED', 'CUSTOMER_UNAVAILABLE', 'REASSIGNMENT_REQUIRED', 'REJECTED'].includes(s)) return 'error';
  if (['REQUESTED', 'QUOTED', 'CONFIRMED', 'SEARCHING_FOR_PROVIDER', 'ASSIGNED'].includes(s)) return 'warning';
  return 'info';
}

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Unpaid',
  PAYMENT_PENDING: 'Payment pending',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  PAYMENT_FAILED: 'Payment failed',
  REFUND_PENDING: 'Refund pending',
  PARTIALLY_REFUNDED: 'Partially refunded',
  REFUNDED: 'Refunded',
  DISPUTED: 'Disputed',
};

export function paymentColor(s: PaymentStatus): ChipColor {
  if (s === 'PAID') return 'success';
  if (['PAYMENT_FAILED', 'DISPUTED'].includes(s)) return 'error';
  if (['REFUNDED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING'].includes(s)) return 'info';
  return 'warning';
}

/** The customer-facing booking timeline (happy path). */
export const TIMELINE_STEPS: BookingStatus[] = ['REQUESTED', 'CONFIRMED', 'SEARCHING_FOR_PROVIDER', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

export const VEHICLE_CLASS_LABELS: Record<string, string> = {
  TWO_WHEELER: 'Two-wheeler',
  HATCHBACK: 'Hatchback',
  SEDAN: 'Sedan',
  SUV: 'SUV',
  PREMIUM: 'Premium / luxury',
  LCV: 'Light commercial',
  HCV: 'Heavy commercial',
};
