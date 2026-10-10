import type { PaymentStatus } from '@prisma/client';

export interface InvoiceLedger {
  total: number;
  /** Confirmed successful payments (online verified + confirmed cash). */
  paid: number;
  /** Cash recorded by a field worker but not yet confirmed by finance. */
  pendingCash: number;
  /** Credit notes issued against the invoice (reduce the amount owed). */
  credited: number;
  /** Refunds that have actually succeeded. */
  refunded: number;
  /** Refunds requested/approved/processing but not yet succeeded. */
  refundPending: number;
  writtenOff: number;
  hasPendingOnlineAttempt: boolean;
  lastAttemptFailed: boolean;
  disputed: boolean;
}

/** Amount the customer still owes. Never negative. */
export function outstandingAmount(l: Pick<InvoiceLedger, 'total' | 'paid' | 'credited' | 'refunded' | 'writtenOff'>): number {
  // A refund returns money previously paid, so it re-opens that amount unless it was matched by a credit note.
  const netPaid = l.paid - l.refunded;
  return Math.max(0, l.total - l.credited - l.writtenOff - netPaid);
}

/**
 * Derives the invoice payment status from its ledger. The order of checks matters:
 * disputes and refunds take precedence over settlement state.
 */
export function derivePaymentStatus(l: InvoiceLedger): PaymentStatus {
  if (l.disputed) return 'DISPUTED';
  if (l.refundPending > 0) return 'REFUND_PENDING';
  if (l.refunded > 0) return l.refunded >= l.paid ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  const owed = outstandingAmount(l);
  if (owed === 0 && (l.paid > 0 || l.credited > 0 || l.writtenOff > 0 || l.total === 0)) return 'PAID';
  if (l.hasPendingOnlineAttempt) return 'PAYMENT_PENDING';
  if (l.paid > 0) return 'PARTIALLY_PAID';
  if (l.lastAttemptFailed) return 'PAYMENT_FAILED';
  return 'UNPAID';
}

/** Max that can still be refunded on an invoice (prevents double refunds). */
export function refundableAmount(l: Pick<InvoiceLedger, 'paid' | 'refunded' | 'refundPending'>): number {
  return Math.max(0, l.paid - l.refunded - l.refundPending);
}
