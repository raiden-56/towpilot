/** Client-side mirrors of the API's main shapes. Money is integer paise. */

export type Role = 'customer' | 'driver' | 'worker' | 'dispatcher' | 'finance' | 'admin';

export interface Me {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string;
  roles: Role[];
  permissions: string[];
  photoUrl?: string | null;
  customerProfile?: {
    marketingConsent: boolean;
    locationConsent: boolean;
    notifySms: boolean;
    notifyEmail: boolean;
    notifyPush: boolean;
    preferredLanguage: string;
    consentVersion: string | null;
  } | null;
  workerProfile?: { employeeCode: string; verificationStatus: string; employmentType: string } | null;
}

export interface AppConfig {
  business: { brandName: string; supportPhone: string; supportEmail: string; emergencyNumber: string; currency: string; logoUrl: string };
  locale: { timezone: string; fyStartMonth: number };
  maps: { provider: string; geocodingAvailable: boolean; distanceSource: string };
  payments: { provider: 'RAZORPAY' | 'SANDBOX'; sandbox: boolean; keyId: string | null };
  sms: { sandbox: boolean };
  shareLinks: { defaultHours: number; maxHours: number };
  privacy: { consentVersion: string; noticeUrl: string };
  environment: string;
}

export type VehicleClass = 'TWO_WHEELER' | 'HATCHBACK' | 'SEDAN' | 'SUV' | 'PREMIUM' | 'LCV' | 'HCV';
export type FuelType = 'PETROL' | 'DIESEL' | 'CNG' | 'LPG' | 'ELECTRIC' | 'HYBRID' | 'OTHER';

export interface Vehicle {
  id: string;
  vehicleClass: VehicleClass;
  registrationNumber: string;
  make: string;
  model: string;
  fuelType: FuelType;
  color?: string | null;
  year?: number | null;
  photoUrls: string[];
  fleetAccount?: { id: string; name: string } | null;
}

export interface ServiceCategory {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: 'TOWING' | 'ONSITE';
  icon?: string | null;
  vehicleClasses: VehicleClass[];
  availableHere: boolean | null;
}

export type BookingStatus =
  | 'REQUESTED'
  | 'QUOTED'
  | 'CONFIRMED'
  | 'SEARCHING_FOR_PROVIDER'
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'INSPECTING'
  | 'RECOVERY_AUTHORIZED'
  | 'LOADING'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'REASSIGNMENT_REQUIRED'
  | 'CANCELLED'
  | 'FAILED'
  | 'CUSTOMER_UNAVAILABLE'
  | 'SAFETY_HOLD'
  | 'DISPUTED';

export type PaymentStatus = 'UNPAID' | 'PAYMENT_PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'PAYMENT_FAILED' | 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'DISPUTED';

export interface Location {
  id?: string;
  kind: 'PICKUP' | 'DROPOFF';
  lat: number;
  lng: number;
  accuracyM?: number | null;
  capturedAt?: string | null;
  source: 'GPS' | 'MAP_PIN' | 'MANUAL' | 'LINK' | 'SAVED';
  address?: string | null;
  landmark?: string | null;
  highway?: string | null;
  roadDirection?: string | null;
  kmMarker?: string | null;
  gateNumber?: string | null;
  floor?: string | null;
  parkingLevel?: string | null;
  accessNotes?: string | null;
  isSafeLocation?: boolean | null;
  destinationType?: 'GARAGE' | 'SERVICE_CENTRE' | 'HOME' | 'CUSTOM' | null;
  placeName?: string | null;
}

export interface QuoteItem {
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
  reason?: string | null;
}

export interface Quote {
  id: string;
  version: number;
  kind: 'INITIAL' | 'REVISION';
  status: 'PENDING_INTERNAL_APPROVAL' | 'PENDING_CUSTOMER_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED';
  subtotal: number;
  discountTotal: number;
  taxableValue: number;
  taxTotal: number;
  passThroughTotal: number;
  total: number;
  expiresAt: string | null;
  reason: string | null;
  createdAt: string;
  items: QuoteItem[];
  assumptions?: { notes?: string[]; pickupDistance?: string; previousTotal?: number; difference?: number };
  pricingSnapshot?: { rules: { cancellationPolicy: { description: string; acceptedFee: number; arrivedFee: number }; taxRateBps: number; includedKm: number; perKm: number; waitingFreeMinutes: number; waitingPer15Min: number } };
}

export interface StatusHistory {
  id: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  actorRole: string;
  reason: string | null;
  isOverride: boolean;
  createdAt: string;
}

export interface Attachment {
  id: string;
  kind: string;
  mimeType: string;
  url: string;
  caption?: string | null;
  createdAt: string;
}

export interface Recommendation {
  truckTypes: string[];
  equipment: string[];
  crew: number;
  priority: string;
  safetyFlags: string[];
  manualReviewReasons: string[];
  reasons: string[];
  suggestedCategoryKey: string | null;
  crewNote: string;
}

export interface Assessment {
  breakdownType: string;
  engineStarts: string;
  wheelsRotate: string;
  steeringWorks: string;
  brakesWork: string;
  isStuck: string;
  isOverturned: string;
  isSubmerged: string;
  blockingTraffic: string;
  majorDamage: string;
  isEvOrHybrid: boolean;
  accessRestriction: string;
  hasChildren: boolean;
  hasElderly: boolean;
  needsAccessibility: boolean;
  passengersNeedingTransport: number;
  notes?: string | null;
}

/** Booking as returned by GET /bookings/:id (fields vary by viewer). */
export interface BookingDetail {
  id: string;
  code: string;
  status: BookingStatus;
  statusLabel: string;
  viewer: 'customer' | 'field' | 'offered' | 'staff';
  type: 'EMERGENCY' | 'SCHEDULED';
  scheduledFor: string | null;
  priority: 'NORMAL' | 'HIGH' | 'CRITICAL';
  safetyFlags: string[];
  serviceCategory: { id: string; key: string; name: string; kind: 'TOWING' | 'ONSITE' };
  zone: { id: string; name: string; city: string } | null;
  vehicle: { id: string; vehicleClass: VehicleClass; registrationNumber: string; make: string; model: string; fuelType: FuelType; color?: string | null } | null;
  towDistanceKm: number | null;
  pickupDistanceKm: number | null;
  distanceSource: string | null;
  etaAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  version: number;
  pickup?: Location;
  dropoff?: Location | null;
  pickupArea?: { lat: number; lng: number; landmark?: string | null; approximate: true };
  dropoffArea?: { lat: number; lng: number; placeName?: string | null; approximate: true } | null;
  assessment?: Assessment | null;
  recommendation?: Recommendation | null;
  crewRequested?: number;
  crewRecommended?: number;
  requiresManualReview?: boolean;
  manualReviewReasons?: string[];
  reviewedAt?: string | null;
  instructions?: string | null;
  contactName?: string;
  contactPhone?: string;
  attachments?: Attachment[];
  quotes?: Quote[];
  approvedQuoteId?: string | null;
  pendingQuoteId?: string | null;
  driver?: { id: string; name: string; verified: boolean; photoUrl: string | null; truck: { id: string; registrationNumber: string; truckType: string; make: string; model: string } | null; etaMinutes: number | null } | null;
  team?: { userId: string; name: string; role: string; responsibility: string | null; photoUrl: string | null }[];
  driverLocation?: { lat: number; lng: number; at: string; accuracyM?: number | null } | null;
  statusHistory?: StatusHistory[];
  conditionReports?: { id: string; stage: string; notes: string | null; damageMarks: { area: string; description: string }[]; odometerKm: number | null; fuelLevel: string | null; attachmentIds: string[]; createdAt: string }[];
  custody?: { stage: string; method: string; recipientName: string | null; recipientRelation: string | null; overrideReason: string | null; createdAt: string }[];
  invoice?: { id: string; number: string; total: number; outstanding: number; paymentStatus: PaymentStatus; amountPaid: number; amountPendingCash: number } | null;
  cancellationReason?: string | null;
  cancellationFee?: number;
  failureReason?: string | null;
  pickupVerifiedAt?: string | null;
  waitingMinutes?: number;
  pickupOtp?: string | null;
  handoverOtp?: string | null;
  shareLinks?: { id: string; expiresAt: string; viewCount: number; createdAt: string }[];
  cancellable?: boolean;
  ratings?: { score: number; comment: string | null }[];
  customer?: { id?: string; name?: string; fullName?: string; phone: string | null };
  allowedNext?: BookingStatus[];
  offer?: { id: string; expiresAt: string; etaMinutes: number | null; distanceKm: number | null } | null;
  quoteTotal?: number | null;
  assignments?: { id: string; status: string; method: string; attempt: number; offeredAt: string; expiresAt: string; respondedAt: string | null; rejectionReason: string | null; etaMinutes: number | null; distanceKm: number | null; driver: { id: string; fullName: string; phone: string | null }; truck: { registrationNumber: string; truckType: string } | null }[];
  escalations?: { id: string; type: string; status: string; detail: string; createdAt: string }[];
  incidents?: { id: string; type: string; severity: string; status: string; description: string; createdAt: string }[];
}

export interface BookingSummary {
  id: string;
  code: string;
  status: BookingStatus;
  type: string;
  priority: string;
  scheduledFor: string | null;
  createdAt: string;
  completedAt: string | null;
  requiresManualReview: boolean;
  safetyFlags: string[];
  serviceCategory: { name: string; key: string; kind: string };
  vehicle: { registrationNumber: string; make: string; model: string; vehicleClass: string } | null;
  zone: { name: string } | null;
  invoice: { id: string; number: string; total: number; outstanding: number; paymentStatus: PaymentStatus } | null;
  quotes: { total: number; status: string }[];
  locations: { kind: string; address: string | null; lat: number; lng: number; placeName: string | null }[];
}

export interface Invoice {
  id: string;
  number: string;
  type: 'SERVICE' | 'CANCELLATION' | 'MEMBERSHIP';
  status: 'ISSUED' | 'VOID';
  paymentStatus: PaymentStatus;
  billingName: string;
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
  issuedAt: string;
  dueAt: string | null;
  booking?: { id?: string; code: string } | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}
