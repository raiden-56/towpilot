import type { AvailabilityStatus, EquipmentType, TruckStatus, TruckType, UserStatus, VehicleClass, VerificationStatus } from '@prisma/client';
import { haversineKm, type LatLng } from '../lib/geo.js';

export const VEHICLE_CLASS_ORDER: VehicleClass[] = ['TWO_WHEELER', 'HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'LCV', 'HCV'];

export interface TruckCandidate {
  id: string;
  registrationNumber: string;
  status: TruckStatus;
  truckType: TruckType;
  maxVehicleClass: VehicleClass;
  zoneId: string | null;
  equipment: { type: EquipmentType; status: string }[];
  insuranceExpiry: Date | null;
  fitnessExpiry: Date | null;
  permitExpiry: Date | null;
  pucExpiry: Date | null;
}

export interface DriverCandidate {
  userId: string;
  name: string;
  userStatus: UserStatus;
  verificationStatus: VerificationStatus;
  availability: AvailabilityStatus;
  availabilityZoneId: string | null;
  zoneIds: string[];
  lastLocation: LatLng | null;
  lastLocationAt: Date | null;
  licenceExpiry: Date | null;
  heavyVehicleCert: boolean;
  hasLiveAssignment: boolean;
  previouslyDeclined: boolean;
  jobsToday: number;
  rating: number | null;
  truck: TruckCandidate | null;
}

export interface DispatchRequest {
  zoneId: string | null;
  pickup: LatLng;
  truckTypes: TruckType[];
  equipment: EquipmentType[];
  vehicleClass: VehicleClass;
  now: Date;
  staleMinutes: number;
  radiusKm: number;
  avgSpeedKmh: number;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  distanceKm: number | null;
  etaMinutes: number | null;
}

const expired = (d: Date | null, now: Date) => !!d && d.getTime() < now.getTime();

export function truckIssues(truck: TruckCandidate, req: Pick<DispatchRequest, 'truckTypes' | 'equipment' | 'vehicleClass' | 'now'>): string[] {
  const r: string[] = [];
  if (truck.status !== 'AVAILABLE' && truck.status !== 'IN_USE') r.push(`Truck ${truck.registrationNumber} is ${truck.status.toLowerCase().replace('_', ' ')}`);
  if (truck.status === 'IN_USE') r.push(`Truck ${truck.registrationNumber} is already on a job`);
  if (req.truckTypes.length && !req.truckTypes.includes(truck.truckType)) r.push(`Truck type ${truck.truckType} not suitable (needs ${req.truckTypes.join(' or ')})`);
  if (VEHICLE_CLASS_ORDER.indexOf(truck.maxVehicleClass) < VEHICLE_CLASS_ORDER.indexOf(req.vehicleClass)) r.push(`Truck capacity (${truck.maxVehicleClass}) below vehicle class ${req.vehicleClass}`);
  const ok = new Set(truck.equipment.filter((e) => e.status === 'OK').map((e) => e.type));
  const missing = req.equipment.filter((e) => !ok.has(e));
  if (missing.length) r.push(`Missing working equipment: ${missing.join(', ')}`);
  for (const [label, d] of [
    ['insurance', truck.insuranceExpiry],
    ['fitness certificate', truck.fitnessExpiry],
    ['permit', truck.permitExpiry],
    ['PUC certificate', truck.pucExpiry],
  ] as const) {
    if (expired(d, req.now)) r.push(`Truck ${label} expired`);
  }
  return r;
}

export function evaluateDriver(d: DriverCandidate, req: DispatchRequest): EligibilityResult {
  const reasons: string[] = [];
  if (d.userStatus !== 'ACTIVE') reasons.push('Account not active');
  if (d.verificationStatus !== 'APPROVED') reasons.push('Driver not verified');
  if (d.availability !== 'AVAILABLE') reasons.push(`Driver is ${d.availability.toLowerCase().replace('_', ' ')}`);
  if (d.hasLiveAssignment) reasons.push('Driver already holds an assignment');
  if (d.previouslyDeclined) reasons.push('Driver already declined or timed out on this booking');
  if (req.zoneId && !d.zoneIds.includes(req.zoneId)) reasons.push('Not authorised for this service zone');
  if (expired(d.licenceExpiry, req.now)) reasons.push('Driving licence expired');
  if ((req.vehicleClass === 'HCV' || req.vehicleClass === 'LCV') && !d.heavyVehicleCert) reasons.push('No heavy-vehicle certification');
  if (!d.truck) reasons.push('No truck assigned');
  else reasons.push(...truckIssues(d.truck, req).filter((x) => !x.includes('already on a job')));

  let distanceKm: number | null = null;
  let etaMinutes: number | null = null;
  if (!d.lastLocation || !d.lastLocationAt) reasons.push('No recent location');
  else {
    const ageMin = (req.now.getTime() - d.lastLocationAt.getTime()) / 60000;
    if (ageMin > req.staleMinutes) reasons.push(`Location is ${Math.round(ageMin)} min old`);
    distanceKm = Math.round(haversineKm(d.lastLocation, req.pickup) * 10) / 10;
    etaMinutes = Math.max(5, Math.round((distanceKm / req.avgSpeedKmh) * 60));
    if (distanceKm > req.radiusKm) reasons.push(`Outside search radius (${distanceKm} km)`);
  }
  return { eligible: reasons.length === 0, reasons, distanceKm, etaMinutes };
}

export interface ScoreWeights {
  eta: number;
  workload: number;
  rating: number;
}

/** Higher is better. Speed is one factor among several — workload and rating keep dispatch fair. */
export function scoreCandidate(etaMinutes: number, jobsToday: number, rating: number | null, w: ScoreWeights, maxEta = 90) {
  const etaScore = 1 - Math.min(etaMinutes, maxEta) / maxEta;
  const workloadScore = 1 - Math.min(jobsToday, 8) / 8;
  const ratingScore = rating == null ? 0.75 : (rating - 1) / 4;
  const total = w.eta * etaScore + w.workload * workloadScore + w.rating * ratingScore;
  return { total: Math.round(total * 1000) / 1000, etaScore, workloadScore, ratingScore };
}

export function rankCandidates(drivers: DriverCandidate[], req: DispatchRequest, w: ScoreWeights) {
  return drivers
    .map((d) => {
      const e = evaluateDriver(d, req);
      const score = e.eligible && e.etaMinutes != null ? scoreCandidate(e.etaMinutes, d.jobsToday, d.rating, w) : null;
      return { driver: d, ...e, score };
    })
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return (b.score?.total ?? 0) - (a.score?.total ?? 0);
    });
}
