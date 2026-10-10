import { useEffect, useState, type ReactNode } from 'react';
import { Alert, AlertTitle, Box, Chip, Stack, Typography } from '@mui/material';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { Assessment, BookingDetail, BookingStatus } from '@/api/types';
import { humanize } from '@/lib/format';

// ─── Response shapes of /driver/* endpoints (money is integer paise) ─────────

export interface OfferItem {
  assignmentId: string;
  expiresAt: string;
  booking: BookingDetail;
}

export interface ConditionReport {
  id: string;
  stage: string;
  notes: string | null;
  damageMarks: { area: string; description: string }[];
  odometerKm: number | null;
  fuelLevel: string | null;
  itemsInVehicle?: string | null;
  attachmentIds: string[];
  supersedesId?: string | null;
  createdAt: string;
}

export interface DriverJobRow {
  id: string;
  code: string;
  status: BookingStatus;
  createdAt: string;
  completedAt: string | null;
  serviceCategory: { name: string };
  vehicle: { registrationNumber: string; make: string; model: string } | null;
  earnings: { amount: number; kind: string }[];
}

export type EarningKind = 'JOB_FIXED' | 'JOB_COMMISSION' | 'INCENTIVE' | 'DEDUCTION' | 'REIMBURSEMENT';

export interface EarningsResponse {
  period: string;
  range: { from: string; to: string };
  totals: { jobEarnings: number; incentives: number; deductions: number; reimbursements: number; pendingPayout: number };
  jobs: { completed: number; cancelled: number };
  lines: { id: string; bookingId: string | null; kind: EarningKind; amount: number; status: 'PENDING' | 'IN_PAYOUT' | 'VOID'; note: string | null; earnedAt: string; booking: { code: string } | null }[];
  payouts: { id: string; periodStart: string; periodEnd: string; earningsAmount: number; incentivesAmount: number; deductionsAmount: number; reimbursementsAmount: number; netAmount: number; status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED'; paidAt: string | null; paymentRef: string | null }[];
  salary: { id: string; frequency: string; periodStart: string; periodEnd: string; baseAmount: number; incentives: number; deductions: number; netAmount: number; status: 'ACCRUED' | 'APPROVED' | 'PAID' | 'CANCELLED'; paidAt: string | null; paymentRef: string | null; notes: string | null }[];
}

export interface PerformanceResponse {
  windowDays: number;
  inputs: {
    assignmentsOffered: number;
    accepted: number;
    completed: number;
    cancelledByWorker: number;
    arrivals: number;
    onTimeArrivals: number;
    ratingsAvg: number | null;
    ratingsCount: number;
    verifiedComplaints: number;
    safetyIncidentsReported: number;
    checklistComplete: number;
    difficultJobs: number;
  };
  score: number | null;
  sufficientData: boolean;
  components: { punctuality: number | null; completion: number | null; safety: number | null; feedback: number | null; difficulty: number };
  weights: { punctuality: number; completion: number; safety: number; feedback: number; difficulty: number };
  explanation: string;
}

export interface AttendanceRow {
  id: string;
  status: 'AVAILABLE' | 'BUSY' | 'ON_JOB' | 'ON_BREAK' | 'OFF_DUTY';
  zoneId: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface ExpenseRow {
  id: string;
  number: string;
  category: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';
  description: string;
  amount: number;
  expenseDate: string;
  fuelLitres: number | null;
  odometerKm: number | null;
  bookingId: string | null;
  rejectionReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface TicketRow {
  id: string;
  number: string;
  category: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
  subject: string;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  booking: { code: string } | null;
}

export interface TicketDetail extends Omit<TicketRow, 'booking'> {
  booking: { id: string; code: string } | null;
  messages: { id: string; body: string; createdAt: string; authorName?: string; fromCustomer: boolean }[];
}

// ─── Labels ──────────────────────────────────────────────────────────

export const SAFETY_FLAG_LABELS: Record<string, string> = {
  EV_OR_HYBRID: 'EV / hybrid — high-voltage system, flatbed only, never tow on drive wheels',
  OVERTURNED: 'Vehicle overturned — heavy recovery, check for fuel leaks',
  FLOOD_EXPOSURE: 'Flood exposure — do NOT try to start the vehicle',
  BLOCKING_TRAFFIC: 'Blocking traffic — cones and hazard lights first',
  HEIGHT_RESTRICTED: 'Height restriction (basement / parking structure)',
  NARROW_ACCESS: 'Narrow lane access',
  RESTRICTED_ACCESS: 'Restricted-access area — entry permission needed',
  CHILDREN_PRESENT: 'Children present',
  ELDERLY_PRESENT: 'Elderly people present',
  ACCESSIBILITY_NEEDS: 'Passenger with accessibility needs',
  PASSENGER_TRANSPORT: 'Passengers need transport',
  UNSAFE_LOCATION: 'Customer says the location is NOT safe',
};

export const EQUIPMENT_LABELS: Record<string, string> = {
  WINCH: 'Winch',
  DOLLIES: 'Dollies',
  GO_JACKS: 'Go-jacks',
  WHEEL_SKATES: 'Wheel skates',
  WHEEL_LIFT: 'Wheel lift',
  FLATBED_DECK: 'Flatbed deck',
  JUMP_STARTER: 'Jump starter',
  TYRE_KIT: 'Tyre kit',
  FUEL_CAN: 'Fuel can',
  LOCKOUT_KIT: 'Lockout kit',
  EV_SAFE_KIT: 'EV safety kit',
  RECOVERY_STRAPS: 'Recovery straps',
  SAFETY_CONES: 'Safety cones',
};

export const TRUCK_TYPE_LABELS: Record<string, string> = {
  FLATBED: 'Flatbed',
  WHEEL_LIFT: 'Wheel-lift',
  HEAVY_DUTY: 'Heavy-duty',
  BIKE_CARRIER: 'Bike carrier',
  SERVICE_VAN: 'Service van',
};

export const ACCESS_LABELS: Record<string, string> = {
  NONE: 'No access restriction',
  BASEMENT: 'Basement',
  NARROW_LANE: 'Narrow lane',
  PARKING_STRUCTURE: 'Multi-level parking',
  RESTRICTED_AREA: 'Restricted area (gated / permission needed)',
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  AVAILABLE: 'Available',
  BUSY: 'Busy',
  ON_JOB: 'On a job',
  ON_BREAK: 'On break',
  OFF_DUTY: 'Off duty',
};

export const TEAM_ROLE_LABELS: Record<string, string> = { TEAM_LEADER: 'Team leader', DRIVER: 'Driver', RECOVERY_WORKER: 'Recovery worker' };

export const label = (map: Record<string, string>, key: string) => map[key] ?? humanize(key);

/** Human-readable list of the problems the customer reported (only answers that matter). */
export function assessmentSummary(a: Assessment | null | undefined): string[] {
  if (!a) return [];
  const out: string[] = [`Problem: ${humanize(a.breakdownType)}`];
  const checks: [keyof Assessment, string, string, string][] = [
    // key, ok value, label when not ok, label when unsure
    ['engineStarts', 'YES', "Engine won't start", 'Engine start: unsure'],
    ['wheelsRotate', 'YES', "Wheels don't rotate (dollies / skates)", 'Wheels rotate: unsure'],
    ['steeringWorks', 'YES', 'Steering not working', 'Steering: unsure'],
    ['brakesWork', 'YES', 'Brakes not working', 'Brakes: unsure'],
    ['isStuck', 'NO', 'Stuck (ditch / mud / kerb)', 'Possibly stuck'],
    ['isOverturned', 'NO', 'Overturned', 'Possibly overturned'],
    ['isSubmerged', 'NO', 'Submerged / flood-affected', 'Possibly flood-affected'],
    ['blockingTraffic', 'NO', 'Blocking traffic', 'May be blocking traffic'],
    ['majorDamage', 'NO', 'Major damage', 'Possible major damage'],
  ];
  for (const [k, okVal, bad, unsure] of checks) {
    const v = a[k];
    if (v === okVal) continue;
    out.push(v === 'NOT_SURE' ? unsure : bad);
  }
  if (a.isEvOrHybrid) out.push('Electric / hybrid vehicle');
  return out;
}

export function peopleSummary(a: Assessment | null | undefined): string[] {
  if (!a) return [];
  const out: string[] = [];
  if (a.passengersNeedingTransport > 0) out.push(`${a.passengersNeedingTransport} passenger${a.passengersNeedingTransport > 1 ? 's' : ''} need transport`);
  if (a.hasChildren) out.push('Children present');
  if (a.hasElderly) out.push('Elderly person present');
  if (a.needsAccessibility) out.push('Accessibility assistance needed');
  return out;
}

// ─── Utilities ───────────────────────────────────────────────────────

/** Re-renders every `ms` so countdowns stay live. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function countdown(msLeft: number) {
  if (msLeft <= 0) return '0:00';
  const s = Math.floor(msLeft / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  return Math.floor((new Date(d).getTime() - Date.now()) / 86_400_000);
}

/** Best-effort quick GPS fix for evidence (never blocks the action for more than `timeoutMs`). */
export function quickPosition(timeoutMs = 5000): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator) || !window.isSecureContext) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

export const mapsDirUrl = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

/** Rupee string → number, or null when empty / invalid / more than 2 decimals. */
export function parseRupees(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Number(t);
}

// ─── Small shared UI ─────────────────────────────────────────────────

export function OfflineActionsNotice({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <Alert severity="error" icon={<WifiOffIcon />} sx={{ fontWeight: 600 }}>
      You are offline. Buttons that update the job are disabled until you reconnect — nothing is saved as done until the server confirms it.
    </Alert>
  );
}

export function SafetyFlagsAlert({ flags, extra, title = 'Safety warnings' }: { flags: string[]; extra?: string[]; title?: string }) {
  const items = [...flags.map((f) => label(SAFETY_FLAG_LABELS, f)), ...(extra ?? [])];
  if (!items.length) return null;
  return (
    <Alert severity="error" variant="filled" icon={<WarningAmberIcon fontSize="large" />} sx={{ '& .MuiAlert-message': { width: '100%' } }} role="alert">
      <AlertTitle sx={{ fontWeight: 800, fontSize: '1.05rem' }}>{title}</AlertTitle>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {items.map((t) => (
          <Typography component="li" key={t} sx={{ fontWeight: 600, fontSize: '0.98rem' }}>
            {t}
          </Typography>
        ))}
      </Box>
    </Alert>
  );
}

export function ChipList({ items, color = 'default', empty }: { items: string[]; color?: 'default' | 'primary' | 'warning' | 'error' | 'info' | 'success'; empty?: ReactNode }) {
  if (!items.length) return empty ? <>{empty}</> : null;
  return (
    <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75}>
      {items.map((i) => (
        <Chip key={i} label={i} color={color} variant={color === 'default' ? 'outlined' : 'filled'} />
      ))}
    </Stack>
  );
}

/** Label/value row with large, high-contrast value text for sunlight readability. */
export function Fact({ label: l, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ py: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {l}
      </Typography>
      <Typography component="div" sx={{ fontWeight: 600, fontSize: '1rem', wordBreak: 'break-word' }}>
        {children}
      </Typography>
    </Box>
  );
}
