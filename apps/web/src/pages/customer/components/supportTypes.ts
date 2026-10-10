import type { ChipColor } from '@/lib/format';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
export type TicketCategory = 'GENERAL' | 'COMPLAINT' | 'BILLING_DISPUTE' | 'REFUND_REQUEST' | 'PRIVACY_REQUEST' | 'PERFORMANCE_CHALLENGE' | 'SAFETY';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface TicketSummary {
  id: string;
  number: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  subject: string;
  bookingId: string | null;
  invoiceId: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  booking: { code: string } | null;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  internal: boolean;
  createdAt: string;
  authorName?: string | null;
  fromCustomer: boolean;
}

export interface TicketDetailData extends Omit<TicketSummary, 'booking'> {
  booking: { id: string; code: string } | null;
  invoice: { id: string; number: string } | null;
  messages: TicketMessage[];
}

/** Categories a customer can raise (privacy and performance challenges have their own flows). */
export const CUSTOMER_CATEGORIES = ['GENERAL', 'COMPLAINT', 'BILLING_DISPUTE', 'REFUND_REQUEST', 'SAFETY'] as const;
export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  GENERAL: 'General question',
  COMPLAINT: 'Complaint',
  BILLING_DISPUTE: 'Billing dispute',
  REFUND_REQUEST: 'Refund request',
  PRIVACY_REQUEST: 'Privacy request',
  PERFORMANCE_CHALLENGE: 'Performance review',
  SAFETY: 'Safety concern',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  AWAITING_CUSTOMER: 'Awaiting your reply',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export function ticketStatusColor(s: TicketStatus): ChipColor {
  if (s === 'AWAITING_CUSTOMER') return 'warning';
  if (s === 'RESOLVED') return 'success';
  if (s === 'CLOSED') return 'default';
  if (s === 'IN_PROGRESS') return 'info';
  return 'primary';
}

export const PRIORITY_LABELS: Record<TicketPriority, string> = { LOW: 'Low priority', MEDIUM: 'Normal priority', HIGH: 'High priority', CRITICAL: 'Urgent' };

export function priorityColor(p: TicketPriority): ChipColor {
  if (p === 'CRITICAL') return 'error';
  if (p === 'HIGH') return 'warning';
  return 'default';
}
