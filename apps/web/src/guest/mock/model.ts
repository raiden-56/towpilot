/**
 * Guest-mode in-memory records. Shapes mirror the API's Prisma models (apps/api/prisma/schema.prisma)
 * so handlers can follow the real route code; one-to-one relations and booking children are embedded.
 * Dates are ISO strings, money is integer paise.
 */
import type { Assessment, BookingStatus, FuelType, PaymentStatus, Recommendation, Role, VehicleClass } from '@/api/types';
import type { PriceBreakdown, QuoteInput, RateCardRules } from './pricing';

export type AvailabilityStatus = 'AVAILABLE' | 'BUSY' | 'ON_JOB' | 'ON_BREAK' | 'OFF_DUTY';
export type TruckType = 'FLATBED' | 'WHEEL_LIFT' | 'HEAVY_DUTY' | 'BIKE_CARRIER' | 'SERVICE_VAN';
export type ActorRole = 'CUSTOMER' | 'DRIVER' | 'WORKER' | 'DISPATCHER' | 'ADMIN' | 'SYSTEM';

export interface GZone {
  id: string;
  name: string;
  city: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  polygon: null;
  active: boolean;
  /** ServiceZoneCategory rows: category keys enabled in this zone. */
  categoryKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GCategory {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: 'TOWING' | 'ONSITE';
  allowedTruckTypes: TruckType[];
  requiredEquipment: string[];
  vehicleClasses: VehicleClass[];
  defaultCrew: number;
  icon: string;
  sortOrder: number;
  active: boolean;
}

export interface GWorkerProfile {
  id: string;
  employeeCode: string;
  partnerCompany: string | null;
  employmentType: 'SALARIED' | 'COMMISSION' | 'JOB_BASED' | 'PARTNER';
  payFrequency: 'WEEKLY' | 'MONTHLY' | 'ANNUAL' | null;
  baseSalary: number | null;
  commissionBps: number | null;
  perJobAmount: number | null;
  verificationStatus: 'PENDING' | 'DOCUMENTS_REQUESTED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  verificationNote: string | null;
  verifiedById: string | null;
  verifiedAt: string | null;
  skills: string[];
  trainingNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  payoutMethod: 'BANK' | 'UPI' | 'CASH' | null;
  payoutDetailsMasked: string | null;
  joinedAt: string;
  zoneIds: string[];
}

export interface GUser {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  roles: Role[];
  photoUrl: string | null;
  isSample: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  customerProfile: {
    preferredLanguage: string;
    termsAcceptedAt: string | null;
    privacyConsentAt: string | null;
    consentVersion: string | null;
    marketingConsent: boolean;
    locationConsent: boolean;
    notifySms: boolean;
    notifyEmail: boolean;
    notifyPush: boolean;
  } | null;
  workerProfile: GWorkerProfile | null;
  driverProfile: { licenceNumberMask: string; licenceClass: string; licenceExpiry: string; canLeadTeam: boolean; heavyVehicleCert: boolean } | null;
  availability: {
    status: AvailabilityStatus;
    zoneId: string | null;
    lastLat: number | null;
    lastLng: number | null;
    lastAccuracyM: number | null;
    lastLocationAt: string | null;
    locationSharing: boolean;
    statusSince: string;
  } | null;
}

export interface GAvailabilityLog {
  id: string;
  userId: string;
  status: AvailabilityStatus;
  zoneId: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface GSavedAddress {
  id: string;
  userId: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  landmark: string | null;
  createdAt: string;
}

export interface GEmergencyContact {
  id: string;
  userId: string;
  name: string;
  phone: string;
  relationship: string | null;
  createdAt: string;
}

export interface GVehicle {
  id: string;
  ownerUserId: string;
  fleetAccountId: string | null;
  vehicleClass: VehicleClass;
  registrationNumber: string;
  make: string;
  model: string;
  fuelType: FuelType;
  color: string | null;
  year: number | null;
  photoUrls: string[];
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface GEquipment {
  id: string;
  truckId: string;
  type: string;
  status: 'OK' | 'DAMAGED' | 'MISSING';
  notes: string | null;
  updatedAt: string;
}

export interface GTruck {
  id: string;
  registrationNumber: string;
  truckType: TruckType;
  make: string;
  model: string;
  maxLoadKg: number;
  maxVehicleClass: VehicleClass;
  status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'OUT_OF_SERVICE' | 'RETIRED';
  zoneId: string | null;
  assignedDriverUserId: string | null;
  odometerKm: number;
  lastServiceAt: string | null;
  lastServiceOdometerKm: number | null;
  serviceIntervalKm: number;
  serviceIntervalDays: number;
  insuranceExpiry: string | null;
  fitnessExpiry: string | null;
  permitExpiry: string | null;
  pucExpiry: string | null;
  nextInspectionDue: string | null;
  notes: string | null;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  equipment: GEquipment[];
}

export interface GMaintenance {
  id: string;
  truckId: string;
  type: 'SERVICE' | 'REPAIR' | 'INSPECTION' | 'BREAKDOWN';
  description: string;
  odometerKm: number | null;
  cost: number;
  performedAt: string;
  nextDueAt: string | null;
  expenseId: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface GLocation {
  id: string;
  kind: 'PICKUP' | 'DROPOFF';
  lat: number;
  lng: number;
  accuracyM: number | null;
  capturedAt: string | null;
  source: 'GPS' | 'MAP_PIN' | 'MANUAL' | 'LINK' | 'SAVED';
  address: string | null;
  landmark: string | null;
  highway: string | null;
  roadDirection: string | null;
  kmMarker: string | null;
  gateNumber: string | null;
  floor: string | null;
  parkingLevel: string | null;
  accessNotes: string | null;
  isSafeLocation: boolean | null;
  destinationType: 'GARAGE' | 'SERVICE_CENTRE' | 'HOME' | 'CUSTOM' | null;
  placeName: string | null;
  createdAt: string;
}

export interface GQuoteItem {
  id: string;
  code: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  taxable: boolean;
  isPassThrough: boolean;
  isEstimate: boolean;
  isAdditional: boolean;
  reason: string | null;
  sortOrder: number;
}

export interface GQuote {
  id: string;
  bookingId: string;
  version: number;
  kind: 'INITIAL' | 'REVISION';
  status: 'PENDING_INTERNAL_APPROVAL' | 'PENDING_CUSTOMER_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED';
  rateCardId: string;
  rateCardVersion: number;
  pricingSnapshot: { rules: RateCardRules; input: QuoteInput; breakdown: PriceBreakdown };
  assumptions: { notes?: string[]; pickupDistance?: string; previousTotal?: number; difference?: number };
  subtotal: number;
  discountTotal: number;
  taxableValue: number;
  taxTotal: number;
  passThroughTotal: number;
  total: number;
  currency: 'INR';
  expiresAt: string | null;
  reason: string | null;
  requestedById: string | null;
  internalApprovedById: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  createdAt: string;
  items: GQuoteItem[];
}

export interface GAssignment {
  id: string;
  bookingId: string;
  driverUserId: string;
  truckId: string | null;
  status: 'OFFERED' | 'ACCEPTED' | 'REJECTED' | 'TIMED_OUT' | 'CANCELLED' | 'RELEASED' | 'COMPLETED';
  method: 'AUTO' | 'MANUAL';
  attempt: number;
  offeredAt: string;
  expiresAt: string;
  respondedAt: string | null;
  rejectionReason: string | null;
  assignedById: string | null;
  etaMinutes: number | null;
  distanceKm: number | null;
  score: number | null;
}

export interface GTeamMember {
  id: string;
  userId: string;
  role: 'TEAM_LEADER' | 'DRIVER' | 'RECOVERY_WORKER';
  responsibility: string | null;
  addedById: string | null;
  active: boolean;
  createdAt: string;
}

export interface GStatusHistory {
  id: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  actorUserId: string | null;
  actorRole: ActorRole;
  reason: string | null;
  isOverride: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface GAttachment {
  id: string;
  uploadedById: string;
  kind: string;
  mimeType: string;
  url: string;
  caption: string | null;
  createdAt: string;
}

export interface GConditionReport {
  id: string;
  stage: 'PICKUP' | 'DELIVERY';
  reportedById: string;
  notes: string | null;
  damageMarks: { area: string; description: string }[];
  odometerKm: number | null;
  fuelLevel: string | null;
  itemsInVehicle: string | null;
  attachmentIds: string[];
  createdAt: string;
}

export interface GCustody {
  stage: 'PICKUP' | 'HANDOVER';
  method: 'OTP' | 'AUTHORIZED_OVERRIDE';
  recipientName: string | null;
  recipientRelation: string | null;
  confirmedById: string;
  overrideReason: string | null;
  createdAt: string;
}

export interface GShareLink {
  id: string;
  token: string;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  createdAt: string;
}

export interface GBooking {
  id: string;
  code: string;
  customerUserId: string;
  vehicleId: string | null;
  fleetAccountId: string | null;
  serviceCategoryId: string;
  zoneId: string | null;
  status: BookingStatus;
  type: 'EMERGENCY' | 'SCHEDULED';
  scheduledFor: string | null;
  priority: 'NORMAL' | 'HIGH' | 'CRITICAL';
  safetyFlags: string[];
  requiresManualReview: boolean;
  manualReviewReasons: string[];
  reviewedById: string | null;
  reviewedAt: string | null;
  recommendation: Recommendation;
  crewRequested: number;
  crewRecommended: number;
  contactName: string;
  contactPhone: string;
  instructions: string | null;
  promoCode: string | null;
  membershipSubscriptionId: string | null;
  pickupOtp: string;
  handoverOtp: string;
  pickupVerifiedAt: string | null;
  pickupDistanceKm: number | null;
  towDistanceKm: number | null;
  distanceSource: string | null;
  etaAt: string | null;
  arrivedAt: string | null;
  waitingMinutes: number;
  dispatchAttempts: number;
  cancellationReason: string | null;
  cancellationFee: number;
  cancelledById: string | null;
  failureReason: string | null;
  holdReturnStatus: BookingStatus | null;
  completedAt: string | null;
  version: number;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  // Embedded children
  locations: GLocation[];
  assessment: Assessment | null;
  attachments: GAttachment[];
  quotes: GQuote[];
  assignments: GAssignment[];
  teamMembers: GTeamMember[];
  statusHistory: GStatusHistory[];
  conditionReports: GConditionReport[];
  custody: GCustody[];
  shareLinks: GShareLink[];
}

export interface GRating {
  id: string;
  bookingId: string;
  raterUserId: string;
  rateeUserId: string;
  score: number;
  comment: string | null;
  tags: string[];
  createdAt: string;
}

export interface GEscalation {
  id: string;
  bookingId: string;
  type: 'DRIVER_REJECTED' | 'DRIVER_NO_RESPONSE' | 'MISSED_ETA' | 'VEHICLE_UNAVAILABLE' | 'LOCATION_STALE' | 'CUSTOMER_CANNOT_CONTACT' | 'NO_PROVIDER' | 'SAFETY' | 'MANUAL_REVIEW';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  detail: string;
  resolution: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface GIncident {
  id: string;
  bookingId: string | null;
  reportedById: string;
  type: 'UNSAFE_LOCATION' | 'ACCIDENT' | 'EQUIPMENT_DAMAGE' | 'DISPUTE' | 'CUSTOMER_UNAVAILABLE' | 'INJURY' | 'OTHER';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  lat: number | null;
  lng: number | null;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  acknowledgedById: string | null;
  acknowledgedAt: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface GInvoiceItem {
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
  sortOrder: number;
}

export interface GInvoice {
  id: string;
  number: string;
  type: 'SERVICE' | 'CANCELLATION' | 'MEMBERSHIP';
  status: 'ISSUED' | 'VOID';
  paymentStatus: PaymentStatus;
  bookingId: string | null;
  subscriptionId: string | null;
  customerUserId: string;
  fleetAccountId: string | null;
  approvedQuoteId: string | null;
  billingName: string;
  billingPhone: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  billingGstin: string | null;
  currency: 'INR';
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
  createdAt: string;
  updatedAt: string;
  items: GInvoiceItem[];
}

export interface GPayment {
  id: string;
  invoiceId: string;
  method: 'ONLINE' | 'CASH' | 'BANK_TRANSFER' | 'PREPAID_CREDIT';
  provider: 'RAZORPAY' | 'SANDBOX' | 'MANUAL';
  status: 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  amount: number;
  currency: 'INR';
  providerOrderId: string | null;
  providerPaymentId: string | null;
  gatewayFee: number;
  gatewayTax: number;
  receiptNumber: string | null;
  collectedById: string | null;
  confirmedById: string | null;
  initiatedById: string | null;
  failureReason: string | null;
  isSandbox: boolean;
  notes: string | null;
  createdAt: string;
  succeededAt: string | null;
  updatedAt: string;
}

export interface GRefund {
  id: string;
  invoiceId: string;
  paymentId: string | null;
  amount: number;
  status: 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REJECTED';
  reason: string;
  providerRefundId: string | null;
  requestedById: string;
  approvedById: string | null;
  failureReason: string | null;
  isSandbox: boolean;
  createdAt: string;
  processedAt: string | null;
  updatedAt: string;
}

export interface GCreditNote {
  id: string;
  number: string;
  invoiceId: string;
  taxableAmount: number;
  taxAmount: number;
  amount: number;
  reason: string;
  issuedById: string;
  createdAt: string;
}

export interface GExpense {
  id: string;
  number: string;
  category: 'FUEL' | 'MAINTENANCE' | 'REPAIR' | 'EQUIPMENT' | 'RENTAL' | 'MARKETING' | 'INSURANCE' | 'TOLLS_PARKING' | 'OFFICE' | 'SOFTWARE' | 'OTHER';
  source: 'DIRECT' | 'VENDOR_BILL' | 'EMPLOYEE_CLAIM';
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';
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
  hasAttachment: boolean;
  submittedById: string;
  approvedById: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GSalary {
  id: string;
  userId: string;
  frequency: 'WEEKLY' | 'MONTHLY' | 'ANNUAL';
  periodStart: string;
  periodEnd: string;
  baseAmount: number;
  incentives: number;
  deductions: number;
  netAmount: number;
  status: 'ACCRUED' | 'APPROVED' | 'PAID' | 'CANCELLED';
  approvedById: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  notes: string | null;
  createdById: string;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GEarning {
  id: string;
  userId: string;
  bookingId: string | null;
  kind: 'JOB_FIXED' | 'JOB_COMMISSION' | 'INCENTIVE' | 'DEDUCTION' | 'REIMBURSEMENT';
  amount: number;
  status: 'PENDING' | 'IN_PAYOUT' | 'VOID';
  payoutId: string | null;
  expenseId: string | null;
  note: string | null;
  earnedAt: string;
  createdById: string | null;
}

export interface GPayout {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  earningsAmount: number;
  incentivesAmount: number;
  deductionsAmount: number;
  reimbursementsAmount: number;
  netAmount: number;
  status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
  approvedById: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface GMembership {
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
  createdAt: string;
  updatedAt: string;
}

export interface GSubscription {
  id: string;
  membershipId: string;
  userId: string | null;
  fleetAccountId: string | null;
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  startsAt: string | null;
  endsAt: string | null;
  servicesUsed: number;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GPromo {
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

export interface GFleetAccount {
  id: string;
  name: string;
  gstin: string | null;
  billingEmail: string;
  billingPhone: string | null;
  billingAddress: string | null;
  creditLimit: number;
  paymentTermsDays: number;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  members: { userId: string; isManager: boolean; createdAt: string }[];
  contracts: { id: string; name: string; startsAt: string; endsAt: string; active: boolean; discountBps: number; slaResponseMinutes: number | null; monthlyServiceLimit: number | null; notes: string | null; createdAt: string; updatedAt: string }[];
}

export interface GNotification {
  id: string;
  userId: string;
  channel: 'IN_APP' | 'SMS' | 'EMAIL' | 'PUSH';
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface GTicket {
  id: string;
  number: string;
  userId: string;
  category: 'GENERAL' | 'COMPLAINT' | 'BILLING_DISPUTE' | 'REFUND_REQUEST' | 'PRIVACY_REQUEST' | 'PERFORMANCE_CHALLENGE' | 'SAFETY';
  status: 'OPEN' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  subject: string;
  bookingId: string | null;
  invoiceId: string | null;
  subjectUserId: string | null;
  assignedToId: string | null;
  resolution: string | null;
  verified: boolean | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: { id: string; authorId: string; body: string; internal: boolean; createdAt: string }[];
}

export interface GDocument {
  id: string;
  userId: string;
  type: 'ID_PROOF' | 'DRIVING_LICENCE' | 'PHOTO' | 'ADDRESS_PROOF' | 'TRAINING_CERTIFICATE' | 'OTHER';
  numberMasked: string | null;
  mimeType: string;
  expiresAt: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedById: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
