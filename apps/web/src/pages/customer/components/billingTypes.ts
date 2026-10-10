/** Shapes and helpers for the customer billing pages (money is integer paise unless stated). */
import { z } from 'zod';
import type { ChipColor } from '@/lib/format';
import { inr } from '@/lib/format';
import type { Invoice, PaymentStatus } from '@/api/types';

export type PaymentTxnStatus = 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REJECTED';
export type PaymentMethod = 'ONLINE' | 'CASH' | 'BANK_TRANSFER' | 'PREPAID_CREDIT';

export interface InvoiceListRow extends Invoice {
  bookingId: string | null;
  subscriptionId: string | null;
}

export interface InvoiceItemRow {
  id: string;
  code: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  taxable: boolean;
  isPassThrough: boolean;
  isAdditional: boolean;
  reason: string | null;
}

export interface InvoicePayment {
  id: string;
  method: PaymentMethod;
  provider: 'RAZORPAY' | 'SANDBOX' | 'MANUAL';
  status: PaymentTxnStatus;
  amount: number;
  providerPaymentId: string | null;
  receiptNumber: string | null;
  isSandbox: boolean;
  failureReason: string | null;
  createdAt: string;
  succeededAt: string | null;
}

export interface InvoiceRefund {
  id: string;
  amount: number;
  status: RefundStatus;
  reason: string;
  failureReason: string | null;
  isSandbox: boolean;
  createdAt: string;
  processedAt: string | null;
}

export interface InvoiceCreditNote {
  id: string;
  number: string;
  amount: number;
  taxableAmount: number;
  taxAmount: number;
  reason: string;
  createdAt: string;
}

export interface PriceChange {
  code: string;
  description: string;
  approved: number;
  final: number;
  delta: number;
  isPassThrough: boolean;
  reason?: string | null;
}

export interface PriceDifference {
  approvedTotal: number;
  finalTotal: number;
  changes: PriceChange[];
  totalDelta: number;
  chargeableIncrease: number;
}

export interface InvoiceDetailData extends Omit<Invoice, 'booking'> {
  bookingId: string | null;
  subscriptionId: string | null;
  currency: string;
  billingPhone: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  billingGstin: string | null;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  isSample?: boolean;
  items: InvoiceItemRow[];
  payments: InvoicePayment[];
  refunds: InvoiceRefund[];
  creditNotes: InvoiceCreditNote[];
  booking: { id: string; code: string; serviceCategory: { name: string } | null; vehicle: { registrationNumber: string } | null } | null;
  tickets: { id: string; number: string; status: TicketStatusLike; category: string }[];
  priceDifference: PriceDifference | null;
}

type TicketStatusLike = 'OPEN' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';

export interface PaymentHistoryRow {
  id: string;
  method: PaymentMethod;
  status: PaymentTxnStatus;
  amount: number;
  receiptNumber: string | null;
  isSandbox: boolean;
  createdAt: string;
  succeededAt: string | null;
  failureReason: string | null;
  invoice: { id: string; number: string };
}

/** POST /invoices/:id/pay response. */
export interface PaymentOrder {
  paymentId: string;
  orderId: string | null;
  amount: number;
  currency: string;
  status: PaymentTxnStatus;
  provider: 'RAZORPAY' | 'SANDBOX';
  keyId: string | null;
  sandbox: boolean;
  invoiceNumber: string;
}

/** GET /payments/:id response. */
export interface PaymentPoll {
  id: string;
  status: PaymentTxnStatus;
  amount: number;
  method: PaymentMethod;
  receiptNumber: string | null;
  failureReason: string | null;
  isSandbox: boolean;
}

export const TXN_LABELS: Record<PaymentTxnStatus, string> = {
  CREATED: 'Started',
  PENDING: 'Awaiting confirmation',
  SUCCEEDED: 'Successful',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export function txnColor(s: PaymentTxnStatus): ChipColor {
  if (s === 'SUCCEEDED') return 'success';
  if (s === 'FAILED') return 'error';
  if (s === 'CANCELLED') return 'default';
  return 'warning';
}

export const REFUND_LABELS: Record<RefundStatus, string> = {
  REQUESTED: 'Requested — under review',
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  SUCCEEDED: 'Refunded',
  FAILED: 'Failed — finance will retry',
  REJECTED: 'Rejected',
};

export function refundColor(s: RefundStatus): ChipColor {
  if (s === 'SUCCEEDED') return 'success';
  if (s === 'FAILED' || s === 'REJECTED') return 'error';
  return 'info';
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  ONLINE: 'Online',
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  PREPAID_CREDIT: 'Prepaid credit',
};

export const INVOICE_TYPE_LABELS: Record<Invoice['type'], string> = {
  SERVICE: 'Service',
  CANCELLATION: 'Cancellation fee',
  MEMBERSHIP: 'Membership',
};

export const OPEN_REFUND_STATUSES: RefundStatus[] = ['REQUESTED', 'APPROVED', 'PROCESSING'];

/** Mirrors the API's refundableAmount(): paid − refunded − refunds still in flight. */
export function refundableOf(inv: Pick<InvoiceDetailData, 'amountPaid' | 'amountRefunded' | 'refunds'>) {
  const inFlight = inv.refunds.filter((r) => OPEN_REFUND_STATUSES.includes(r.status)).reduce((a, r) => a + r.amount, 0);
  return Math.max(0, inv.amountPaid - inv.amountRefunded - inFlight);
}

/** Amount the customer can pay online right now (cash awaiting confirmation is excluded). */
export const payableOf = (inv: Pick<InvoiceDetailData, 'outstanding' | 'amountPendingCash' | 'status'>) => (inv.status === 'ISSUED' ? Math.max(0, inv.outstanding - inv.amountPendingCash) : 0);

export const isPaymentStatusSettled = (s: PaymentStatus) => s === 'PAID' || s === 'REFUNDED';

/** Paise from a validated rupee string. */
export const rupeeStringToPaise = (v: string) => Math.round(Number(v.trim()) * 100);

/**
 * Rupee amount entered as a string (avoids resolver typing issues with coercion).
 * Validates format (max 2 decimals) and the [min, max] range in paise.
 */
export function rupeeAmountSchema(opts: { minPaise: number; maxPaise: number; label?: string }) {
  return z
    .string()
    .trim()
    .min(1, `Enter ${opts.label ?? 'an amount'}`)
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Enter a valid amount in rupees, with at most 2 decimal places')
    .refine((v) => rupeeStringToPaise(v) >= opts.minPaise, `Minimum is ${inr(opts.minPaise)}`)
    .refine((v) => rupeeStringToPaise(v) <= opts.maxPaise, `Maximum is ${inr(opts.maxPaise)}`);
}

/** Paise → plain rupee string for prefilling inputs ("1234.5" → "1234.50"). */
export const paiseToRupeeString = (p: number) => (p / 100).toFixed(2);

export const fileNameFor = (number: string) => `${number.replace(/\//g, '-')}.pdf`;
