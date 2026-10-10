/** Shapes of the admin operations endpoints (dispatch, employees, fleet, support). Money is integer paise. */
import type { BookingDetail, BookingStatus, PaymentStatus, StatusHistory } from '@/api/types';

export type Priority = 'NORMAL' | 'HIGH' | 'CRITICAL';
export type AvailabilityStatus = 'AVAILABLE' | 'BUSY' | 'ON_JOB' | 'ON_BREAK' | 'OFF_DUTY';
export type TruckStatus = 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'OUT_OF_SERVICE' | 'RETIRED';
export type TruckType = 'FLATBED' | 'WHEEL_LIFT' | 'HEAVY_DUTY' | 'BIKE_CARRIER' | 'SERVICE_VAN';
export type AssignmentStatus = 'OFFERED' | 'ACCEPTED' | 'REJECTED' | 'TIMED_OUT' | 'CANCELLED' | 'RELEASED' | 'COMPLETED';
export type EscalationStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface Zone {
  id: string;
  name: string;
  city: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  active?: boolean;
}

export interface BoardBooking {
  id: string;
  code: string;
  status: BookingStatus;
  statusLabel: string;
  type: 'EMERGENCY' | 'SCHEDULED';
  priority: Priority;
  scheduledFor: string | null;
  safetyFlags: string[];
  requiresManualReview: boolean;
  reviewedAt: string | null;
  manualReviewReasons: string[];
  etaAt: string | null;
  createdAt: string;
  updatedAt: string;
  dispatchAttempts: number;
  zoneId: string | null;
  serviceCategory: { name: string; kind: 'TOWING' | 'ONSITE' };
  vehicle: { registrationNumber: string; vehicleClass: string } | null;
  locations: { kind: 'PICKUP' | 'DROPOFF'; lat: number; lng: number; address: string | null; placeName: string | null }[];
  assignments: { id: string; status: AssignmentStatus; driverUserId: string; offeredAt: string; expiresAt: string; rejectionReason: string | null; method: 'AUTO' | 'MANUAL'; driver: { fullName: string } }[];
}

export interface BoardDriver {
  id: string;
  name: string;
  roles: string[];
  verification?: string;
  zones?: { id: string; name: string }[];
  status?: AvailabilityStatus;
  lat?: number | null;
  lng?: number | null;
  lastLocationAt?: string | null;
  locationStale: boolean;
  truck: { id: string; registrationNumber: string; truckType: TruckType; status: TruckStatus } | null;
}

export interface Escalation {
  id: string;
  bookingId: string;
  type: string;
  status: EscalationStatus;
  detail: string;
  resolution?: string | null;
  resolvedAt: string | null;
  createdAt: string;
  booking?: { code: string; status?: BookingStatus };
}

export interface Incident {
  id: string;
  bookingId: string | null;
  reportedById: string;
  type: string;
  severity: Priority | 'LOW' | 'MEDIUM';
  description: string;
  status: EscalationStatus;
  acknowledgedAt: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  booking?: { code: string } | null;
}

export interface DispatchBoard {
  serverTime: string;
  bookings: BoardBooking[];
  drivers: BoardDriver[];
  trucks: { id: string; registrationNumber: string; truckType: TruckType; status: TruckStatus; zoneId: string | null; assignedDriverUserId: string | null }[];
  zones: Zone[];
  escalations: Escalation[];
  incidents: Incident[];
}

export interface Candidate {
  driverUserId: string;
  name: string;
  eligible: boolean;
  reasons: string[];
  distanceKm: number | null;
  etaMinutes: number | null;
  score: { total: number; etaScore: number; workloadScore: number; ratingScore: number } | null;
  truck: { id: string; registrationNumber: string; truckType: TruckType } | null;
  jobsToday: number;
  rating: number | null;
}

export interface CandidatesResponse {
  request: { zoneId: string | null; truckTypes: string[]; equipment: string[]; vehicleClass: string; radiusKm: number; staleMinutes: number };
  candidates: Candidate[];
}

export interface StaffAssignment {
  id: string;
  status: AssignmentStatus;
  method: 'AUTO' | 'MANUAL';
  attempt: number;
  offeredAt: string;
  expiresAt: string;
  respondedAt: string | null;
  rejectionReason: string | null;
  etaMinutes: number | null;
  distanceKm: number | null;
  score?: number | null;
  driver: { id: string; fullName: string; phone: string | null };
  truck: { id?: string; registrationNumber: string; truckType: string } | null;
}

/** GET /bookings/:id as seen by operations staff. */
export interface StaffBooking extends Omit<BookingDetail, 'assignments' | 'escalations' | 'incidents' | 'statusHistory' | 'customer' | 'ratings'> {
  assignments?: StaffAssignment[];
  escalations?: Escalation[];
  incidents?: Incident[];
  statusHistory?: (StatusHistory & { actorUserId: string | null; metadata?: Record<string, unknown> | null })[];
  customer?: { id: string; fullName: string; phone: string | null };
  ratings?: { id: string; score: number; comment: string | null; tags?: string[]; createdAt: string }[];
}

export interface WorkerProfile {
  id: string;
  employeeCode: string;
  partnerCompany: string | null;
  employmentType: 'SALARIED' | 'COMMISSION' | 'JOB_BASED' | 'PARTNER';
  payFrequency: 'WEEKLY' | 'MONTHLY' | 'ANNUAL' | null;
  baseSalary?: number | null;
  commissionBps?: number | null;
  perJobAmount?: number | null;
  verificationStatus: 'PENDING' | 'DOCUMENTS_REQUESTED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  verificationNote: string | null;
  verifiedAt: string | null;
  skills: string[];
  trainingNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  payoutMethod: 'BANK' | 'UPI' | 'CASH' | null;
  payoutDetailsMasked?: string | null;
  joinedAt: string;
  isSample?: boolean;
  zones: { id: string; name: string }[];
}

export interface Employee {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  isSample?: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  roles: string[];
  photoUrl: string | null;
  workerProfile: WorkerProfile | null;
  driverProfile: { licenceNumberMask: string; licenceClass: string; licenceExpiry: string; canLeadTeam: boolean; heavyVehicleCert: boolean } | null;
  availability: { status: AvailabilityStatus; zoneId: string | null; lastLat: number | null; lastLng: number | null; lastLocationAt: string | null; locationSharing: boolean; statusSince: string } | null;
  assignedTruck: { id: string; registrationNumber: string; truckType: TruckType; status: TruckStatus } | null;
}

export interface EmployeeDocument {
  id: string;
  type: string;
  numberMasked: string | null;
  mimeType: string;
  expiresAt: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface Performance {
  windowDays: number;
  score: number | null;
  sufficientData: boolean;
  components: Record<string, number>;
  weights: Record<string, number>;
  inputs: Record<string, number | null>;
  explanation: string;
}

export interface EmployeeDetail extends Employee {
  assignments: (Omit<StaffAssignment, 'driver' | 'truck'> & { bookingId: string; booking: { code: string; status: BookingStatus } })[];
  incidents: Incident[];
  documents: EmployeeDocument[] | null;
  attendance: { id: string; status: AvailabilityStatus; zoneId: string | null; startedAt: string; endedAt: string | null }[];
  performance: Performance;
}

export interface Reminder {
  kind: 'SERVICE_KM' | 'SERVICE_DAYS' | 'DOCUMENT' | 'INSPECTION';
  severity: 'OVERDUE' | 'DUE_SOON';
  message: string;
  dueAt?: string;
  basis: 'RULE_BASED' | 'RULE_BASED_PROJECTION';
}

export interface Equipment {
  id: string;
  type: string;
  status: 'OK' | 'DAMAGED' | 'MISSING';
  notes: string | null;
  updatedAt: string;
}

export interface Truck {
  id: string;
  registrationNumber: string;
  truckType: TruckType;
  make: string;
  model: string;
  maxLoadKg: number;
  maxVehicleClass: string;
  status: TruckStatus;
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
  isSample?: boolean;
  zone: { id?: string; name: string; city?: string } | null;
  assignedDriver: { id: string; fullName: string; phone?: string | null } | null;
  equipment: Equipment[];
  reminders: Reminder[];
}

export interface MaintenanceRecord {
  id: string;
  type: 'SERVICE' | 'REPAIR' | 'INSPECTION' | 'BREAKDOWN';
  description: string;
  odometerKm: number | null;
  cost: number;
  performedAt: string;
  nextDueAt: string | null;
  expenseId: string | null;
  createdAt: string;
}

export interface TruckExpense {
  id: string;
  number: string;
  category: string;
  status: string;
  description: string;
  vendorName: string | null;
  amount: number;
  taxAmount: number;
  expenseDate: string;
  fuelLitres: number | null;
  odometerKm: number | null;
}

export interface TruckDetailData extends Truck {
  maintenance: MaintenanceRecord[];
  expenses: TruckExpense[];
  remindersBasis: string;
  utilisation: { completedJobsLast30Days: number };
  costs: { fuel: number; fuelLitres: number; maintenanceAndRepairs: number };
  breakdowns: number;
}

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
export type TicketCategory = 'GENERAL' | 'COMPLAINT' | 'BILLING_DISPUTE' | 'REFUND_REQUEST' | 'PRIVACY_REQUEST' | 'PERFORMANCE_CHALLENGE' | 'SAFETY';

export interface TicketSummary {
  id: string;
  number: string;
  userId: string;
  category: TicketCategory;
  status: TicketStatus;
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
  user?: { fullName: string; phone: string | null };
  booking?: { id?: string; code: string } | null;
  invoice?: { id?: string; number: string } | null;
}

export interface TicketDetail extends TicketSummary {
  messages: { id: string; authorId: string; body: string; internal: boolean; createdAt: string; authorName?: string | null; fromCustomer: boolean }[];
}

export interface KpiItem {
  key: string;
  label: string;
  value: number | null;
  unit: 'count' | 'minutes' | 'percent' | 'paise' | 'rating';
  definition: string;
}

export interface TrendPoint {
  bucket: string;
  revenue: number;
  costs: number;
  profit: number;
  bookings: number;
}

export type { PaymentStatus };
