/**
 * Rule-based fleet maintenance reminders. These are NOT predictive models: they apply the
 * configured service intervals and document expiry dates, plus a simple linear projection
 * from recent utilisation when enough data exists. Results are labelled accordingly.
 */
export interface TruckMaintenanceInput {
  odometerKm: number;
  lastServiceAt: Date | null;
  lastServiceOdometerKm: number | null;
  serviceIntervalKm: number;
  serviceIntervalDays: number;
  insuranceExpiry: Date | null;
  fitnessExpiry: Date | null;
  permitExpiry: Date | null;
  pucExpiry: Date | null;
  nextInspectionDue: Date | null;
  /** Average km/day over recent history, if known. */
  avgKmPerDay?: number | null;
}

export interface Reminder {
  kind: 'SERVICE_KM' | 'SERVICE_DAYS' | 'DOCUMENT' | 'INSPECTION';
  severity: 'OVERDUE' | 'DUE_SOON';
  message: string;
  dueAt?: string;
  basis: 'RULE_BASED' | 'RULE_BASED_PROJECTION';
}

const DAY = 86_400_000;

export function maintenanceReminders(t: TruckMaintenanceInput, now = new Date(), soonDays = 30): Reminder[] {
  const out: Reminder[] = [];

  const kmSince = t.odometerKm - (t.lastServiceOdometerKm ?? 0);
  if (kmSince >= t.serviceIntervalKm) out.push({ kind: 'SERVICE_KM', severity: 'OVERDUE', message: `Service overdue: ${kmSince} km since last service (interval ${t.serviceIntervalKm} km)`, basis: 'RULE_BASED' });
  else if (kmSince >= t.serviceIntervalKm * 0.9) out.push({ kind: 'SERVICE_KM', severity: 'DUE_SOON', message: `Service due in ${t.serviceIntervalKm - kmSince} km`, basis: 'RULE_BASED' });
  else if (t.avgKmPerDay && t.avgKmPerDay > 0) {
    const daysLeft = (t.serviceIntervalKm - kmSince) / t.avgKmPerDay;
    if (daysLeft <= soonDays) {
      const due = new Date(now.getTime() + daysLeft * DAY);
      out.push({ kind: 'SERVICE_KM', severity: 'DUE_SOON', message: `At ~${Math.round(t.avgKmPerDay)} km/day, service interval reached in about ${Math.ceil(daysLeft)} days`, dueAt: due.toISOString(), basis: 'RULE_BASED_PROJECTION' });
    }
  }

  if (t.lastServiceAt) {
    const due = new Date(t.lastServiceAt.getTime() + t.serviceIntervalDays * DAY);
    const days = (due.getTime() - now.getTime()) / DAY;
    if (days < 0) out.push({ kind: 'SERVICE_DAYS', severity: 'OVERDUE', message: `Time-based service overdue by ${Math.ceil(-days)} days`, dueAt: due.toISOString(), basis: 'RULE_BASED' });
    else if (days <= soonDays) out.push({ kind: 'SERVICE_DAYS', severity: 'DUE_SOON', message: `Time-based service due in ${Math.ceil(days)} days`, dueAt: due.toISOString(), basis: 'RULE_BASED' });
  } else {
    out.push({ kind: 'SERVICE_DAYS', severity: 'DUE_SOON', message: 'No service history recorded', basis: 'RULE_BASED' });
  }

  const docs: [string, Date | null][] = [
    ['Insurance', t.insuranceExpiry],
    ['Fitness certificate', t.fitnessExpiry],
    ['Permit', t.permitExpiry],
    ['PUC certificate', t.pucExpiry],
  ];
  for (const [label, d] of docs) {
    if (!d) continue;
    const days = (d.getTime() - now.getTime()) / DAY;
    if (days < 0) out.push({ kind: 'DOCUMENT', severity: 'OVERDUE', message: `${label} expired`, dueAt: d.toISOString(), basis: 'RULE_BASED' });
    else if (days <= soonDays) out.push({ kind: 'DOCUMENT', severity: 'DUE_SOON', message: `${label} expires in ${Math.ceil(days)} days`, dueAt: d.toISOString(), basis: 'RULE_BASED' });
  }

  if (t.nextInspectionDue) {
    const days = (t.nextInspectionDue.getTime() - now.getTime()) / DAY;
    if (days < 0) out.push({ kind: 'INSPECTION', severity: 'OVERDUE', message: 'Inspection overdue', dueAt: t.nextInspectionDue.toISOString(), basis: 'RULE_BASED' });
    else if (days <= 7) out.push({ kind: 'INSPECTION', severity: 'DUE_SOON', message: `Inspection due in ${Math.ceil(days)} days`, dueAt: t.nextInspectionDue.toISOString(), basis: 'RULE_BASED' });
  }
  return out;
}
