/** Admin business & finance response shapes (money = integer paise). */
import type { PaymentStatus, VehicleClass } from '@/api/types';

export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface CustomerRow {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: UserStatus;
  createdAt: string;
  isSample: boolean;
  _count: { bookings: number; vehicles: number };
  fleetMemberships: { fleetAccount: { id: string; name: string } }[];
}

export interface VehicleRow {
  id: string;
  ownerUserId: string;
  fleetAccountId: string | null;
  vehicleClass: VehicleClass;
  registrationNumber: string;
  make: string;
  model: string;
  fuelType: string;
  color: string | null;
  year: number | null;
  isSample?: boolean;
}

export interface InvoiceRow {
  id: string;
  number: string;
  type: 'SERVICE' | 'CANCELLATION' | 'MEMBERSHIP';
  status: 'ISSUED' | 'VOID';
  paymentStatus: PaymentStatus;
  bookingId: string | null;
  customerUserId: string | null;
  fleetAccountId: string | null;
  billingName: string;
  billingPhone: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  billingGstin: string | null;
  subtotal: number;
  discountTotal: number;
  taxableValue: number;
  taxTotal: number;
  passThroughTotal: number;
  total: number;
  amountPaid: number;
  amountPendingCash: number;
  amountCredited: number;
  amountRefunded: number;
  amountWrittenOff: number;
  outstanding: number;
  approvedQuoteTotal: number | null;
  disputed: boolean;
  notes: string | null;
  issuedAt: string;
  dueAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  isSample: boolean;
  booking?: { id?: string; code: string } | null;
}

export type PaymentMethod = 'ONLINE' | 'CASH' | 'BANK_TRANSFER' | 'PREPAID_CREDIT';
export type PaymentTxnStatus = 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface PaymentRow {
  id: string;
  invoiceId: string;
  method: PaymentMethod;
  provider: string;
  status: PaymentTxnStatus;
  amount: number;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  gatewayFee: number;
  gatewayTax: number;
  receiptNumber: string | null;
  collectedById: string | null;
  confirmedById: string | null;
  failureReason: string | null;
  isSandbox: boolean;
  notes: string | null;
  createdAt: string;
  succeededAt: string | null;
  invoice?: { number: string; billingName: string };
  collectedBy?: string | null;
}

export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REJECTED';

export interface RefundRow {
  id: string;
  invoiceId: string;
  paymentId: string | null;
  amount: number;
  status: RefundStatus;
  reason: string;
  providerRefundId: string | null;
  failureReason: string | null;
  isSandbox: boolean;
  createdAt: string;
  processedAt: string | null;
  invoice?: { number: string; billingName: string };
  payment?: { method: PaymentMethod; isSandbox: boolean } | null;
}

export interface CreditNoteRow {
  id: string;
  number: string;
  taxableAmount: number;
  taxAmount: number;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface AdjustmentRow {
  id: string;
  type: 'WRITE_OFF' | 'ROUNDING' | 'CORRECTION';
  amount: number;
  reason: string;
  createdAt: string;
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

export interface InvoiceDetail extends InvoiceRow {
  items: InvoiceItemRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
  creditNotes: CreditNoteRow[];
  adjustments: AdjustmentRow[];
  booking: { id: string; code: string } | null;
  tickets: { id: string; number: string; category: string; status: string; subject: string; createdAt: string }[];
  fleetAccount: { name: string } | null;
}

export type ExpenseCategory = 'FUEL' | 'MAINTENANCE' | 'REPAIR' | 'EQUIPMENT' | 'RENTAL' | 'MARKETING' | 'INSURANCE' | 'TOLLS_PARKING' | 'OFFICE' | 'SOFTWARE' | 'OTHER';
export type ExpenseStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';

export interface ExpenseRow {
  id: string;
  number: string;
  category: ExpenseCategory;
  source: 'DIRECT' | 'VENDOR_BILL' | string;
  status: ExpenseStatus;
  description: string;
  vendorName: string | null;
  vendorBillRef: string | null;
  amount: number;
  taxAmount: number;
  expenseDate: string;
  fuelLitres: number | null;
  odometerKm: number | null;
  truckId: string | null;
  bookingId: string | null;
  zoneId: string | null;
  claimantUserId: string | null;
  reimbursable: boolean;
  rejectionReason: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  isSample: boolean;
  truck: { registrationNumber: string } | null;
  booking: { code: string } | null;
  claimant: string | null;
  attachmentUrl: string | null;
}

export type SalaryStatus = 'ACCRUED' | 'APPROVED' | 'PAID' | 'CANCELLED';
export interface SalaryRow {
  id: string;
  userId: string;
  frequency: 'WEEKLY' | 'MONTHLY' | 'ANNUAL';
  periodStart: string;
  periodEnd: string;
  baseAmount: number;
  incentives: number;
  deductions: number;
  netAmount: number;
  status: SalaryStatus;
  paidAt: string | null;
  paymentRef: string | null;
  notes: string | null;
  isSample: boolean;
  user: { fullName: string; workerProfile: { employeeCode: string } | null };
}

export type PayoutStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
export interface PayoutRow {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  earningsAmount: number;
  incentivesAmount: number;
  deductionsAmount: number;
  reimbursementsAmount: number;
  netAmount: number;
  status: PayoutStatus;
  paidAt: string | null;
  paymentRef: string | null;
  createdAt: string;
  user: { fullName: string; workerProfile: { employeeCode: string; payoutMethod: string | null; payoutDetailsMasked: string | null } | null };
}
export interface PendingByWorker {
  userId: string;
  name?: string;
  amount: number;
  lines: number;
}

export interface ServiceCategoryRow {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: 'TOWING' | 'ONSITE';
  allowedTruckTypes: string[];
  requiredEquipment: string[];
  vehicleClasses: VehicleClass[];
  defaultCrew: number;
  icon: string | null;
  sortOrder: number;
  active: boolean;
  zones: { zoneId: string; categoryId: string; active: boolean }[];
}

export interface ZoneRow {
  id: string;
  name: string;
  city: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  polygon: { type: 'Polygon'; coordinates: [number, number][][] } | null;
  active: boolean;
  categories: { zoneId: string; categoryId: string; active: boolean; category: { id: string; name: string } }[];
  _count: { trucks: number; workers: number };
}

export interface RateCardRow {
  id: string;
  lineageId: string;
  version: number;
  isActive: boolean;
  name: string;
  serviceCategoryId: string;
  zoneId: string | null;
  vehicleClass: VehicleClass | null;
  fleetContractId: string | null;
  baseFee: number;
  includedKm: number;
  perKm: number;
  pickupFreeKm: number;
  pickupPerKm: number;
  includedCrew: number;
  crewChargePerWorker: number;
  waitingFreeMinutes: number;
  waitingPer15Min: number;
  nightSurchargeBps: number;
  nightStartHour: number;
  nightEndHour: number;
  holidaySurchargeBps: number;
  minimumCharge: number;
  scheduledBookingFee: number;
  equipmentSurcharges: Record<string, number>;
  taxRateBps: number;
  tollTreatment: 'PASS_THROUGH_ACTUALS' | 'INCLUDED';
  quoteValidityMin: number;
  cancellationPolicy: { acceptedFee: number; arrivedFee: number; description: string };
  effectiveFrom: string;
  changeReason: string | null;
  createdAt: string;
  serviceCategory?: { name: string };
  zone?: { name: string } | null;
  fleetContract?: { name: string } | null;
}

export interface PriceLine {
  code: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  taxable: boolean;
  isPassThrough: boolean;
  isEstimate: boolean;
  isAdditional: boolean;
  reason?: string;
}
export interface PriceBreakdown {
  lines: PriceLine[];
  subtotal: number;
  discountTotal: number;
  taxableValue: number;
  taxRateBps: number;
  taxTotal: number;
  passThroughTotal: number;
  total: number;
  chargeableKm: number;
  notes: string[];
}

export interface PromoRow {
  id: string;
  code: string;
  description: string;
  discountBps: number;
  maxDiscount: number;
  validFrom: string;
  validTo: string;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  createdAt: string;
}

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string;
  price: number;
  durationMonths: number;
  includedServices: number;
  includedKmPerService: number;
  discountBps: number;
  coveredCategoryKeys: string[];
  exclusions: string;
  renewalTerms: string;
  forFleet: boolean;
  active: boolean;
  _count: { subscriptions: number };
}

export interface SubscriptionRow {
  id: string;
  membershipId: string;
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  startsAt: string | null;
  endsAt: string | null;
  servicesUsed: number;
  planSnapshot: { includedServices?: number; name?: string; price?: number } | null;
  cancelledAt: string | null;
  createdAt: string;
  membership: { name: string };
  user: { fullName: string; phone: string | null } | null;
  fleetAccount: { name: string } | null;
  invoice: { number: string; paymentStatus: PaymentStatus } | null;
}

export interface FleetContract {
  id: string;
  fleetAccountId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  discountBps: number;
  slaResponseMinutes: number | null;
  monthlyServiceLimit: number | null;
  notes: string | null;
  rateCards?: RateCardRow[];
}

export interface FleetAccountRow {
  id: string;
  name: string;
  gstin: string | null;
  billingEmail: string;
  billingPhone: string | null;
  billingAddress: string | null;
  creditLimit: number;
  paymentTermsDays: number;
  status: 'ACTIVE' | 'SUSPENDED';
  isSample: boolean;
  createdAt: string;
  _count: { members: number; vehicles: number; bookings: number };
  contracts: FleetContract[];
  outstanding: number;
}

export type AgeingKey = 'current' | '1-30' | '31-60' | '61-90' | '90+';
export const AGEING_KEYS: AgeingKey[] = ['current', '1-30', '31-60', '61-90', '90+'];
export const AGEING_LABELS: Record<AgeingKey, string> = { current: 'Not yet due', '1-30': '1–30 days', '31-60': '31–60 days', '61-90': '61–90 days', '90+': '90+ days' };

export interface FleetAccountDetail extends Omit<FleetAccountRow, '_count' | 'outstanding'> {
  members: { fleetAccountId: string; userId: string; isManager: boolean; createdAt: string; user: { id: string; fullName: string; phone: string | null } }[];
  vehicles: VehicleRow[];
  subscriptions: SubscriptionRow[];
  invoices: InvoiceRow[];
  ageing: Record<AgeingKey, number>;
  usageThisMonth: number;
}

export interface EmployeeLite {
  id: string;
  fullName: string;
  phone: string | null;
  roles: string[];
  workerProfile: { employeeCode: string } | null;
}

export interface AuditRow {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}
