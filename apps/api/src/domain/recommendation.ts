import type { BookingPriority, EquipmentType, TriState, TruckType, VehicleClass } from '@prisma/client';

export interface AssessmentInput {
  breakdownType: string;
  engineStarts: TriState;
  wheelsRotate: TriState;
  steeringWorks: TriState;
  brakesWork: TriState;
  isStuck: TriState;
  isOverturned: TriState;
  isSubmerged: TriState;
  blockingTraffic: TriState;
  majorDamage: TriState;
  isEvOrHybrid: boolean;
  accessRestriction: string;
  hasChildren: boolean;
  hasElderly: boolean;
  needsAccessibility: boolean;
  passengersNeedingTransport: number;
}

export interface CategoryInput {
  key: string;
  kind: 'TOWING' | 'ONSITE';
  allowedTruckTypes: TruckType[];
  requiredEquipment: EquipmentType[];
  defaultCrew: number;
}

export interface Recommendation {
  truckTypes: TruckType[];
  equipment: EquipmentType[];
  crew: number;
  priority: BookingPriority;
  safetyFlags: string[];
  manualReviewReasons: string[];
  reasons: string[];
  suggestedCategoryKey: string | null;
  crewNote: string;
}

const yesOrUnsure = (v: TriState) => v === 'YES' || v === 'NOT_SURE';

export function recommendRecovery(category: CategoryInput, vehicleClass: VehicleClass, a: AssessmentInput, crewRequested: number): Recommendation {
  const reasons: string[] = [];
  const safety: string[] = [];
  const review: string[] = [];
  const equipment = new Set<EquipmentType>(category.requiredEquipment);
  let crew = Math.max(1, category.defaultCrew);
  let priority: BookingPriority = 'NORMAL';
  let preferred: TruckType[] | null = null;
  let suggestedCategoryKey: string | null = null;

  const prefer = (types: TruckType[], why: string) => {
    preferred = preferred ? preferred.filter((t) => types.includes(t)) : types;
    if (preferred.length === 0) preferred = types;
    reasons.push(why);
  };

  // Vehicle size
  if (vehicleClass === 'TWO_WHEELER') prefer(['BIKE_CARRIER', 'FLATBED'], 'Two-wheelers are carried on a bike carrier or flatbed.');
  if (vehicleClass === 'LCV' || vehicleClass === 'HCV') prefer(['HEAVY_DUTY'], 'Commercial vehicles need a heavy-duty recovery truck.');
  if (vehicleClass === 'PREMIUM') prefer(['FLATBED'], 'Premium vehicles are moved on a flatbed to avoid drivetrain damage.');

  if (a.isEvOrHybrid) {
    if (category.kind === 'TOWING') prefer(['FLATBED', 'HEAVY_DUTY'], 'Electric/hybrid vehicles must not be towed with drive wheels on the ground — flatbed required.');
    equipment.add('EV_SAFE_KIT');
    safety.push('EV_OR_HYBRID');
  }

  // Mechanical condition
  if (category.kind === 'TOWING') {
    if (a.wheelsRotate === 'NO') {
      prefer(['FLATBED', 'HEAVY_DUTY'], 'Wheels do not rotate — vehicle must be lifted onto a flatbed.');
      equipment.add('WHEEL_SKATES');
      equipment.add('WINCH');
    } else if (a.wheelsRotate === 'NOT_SURE') {
      equipment.add('WHEEL_SKATES');
      reasons.push('Wheel rotation unknown — wheel skates carried as a precaution.');
    }
    if (a.steeringWorks === 'NO') prefer(['FLATBED', 'HEAVY_DUTY'], 'Steering is locked or damaged — flatbed recommended.');
    if (a.brakesWork === 'NO') {
      equipment.add('WINCH');
      reasons.push('Brakes may not hold — winch-controlled loading required.');
    }
  }

  if (a.isStuck === 'YES') {
    equipment.add('WINCH');
    equipment.add('RECOVERY_STRAPS');
    crew = Math.max(crew, 2);
    reasons.push('Vehicle is stuck — winch, straps and a second crew member recommended.');
  }

  if (a.isOverturned === 'NOT_SURE') {
    safety.push('CONDITION_UNCONFIRMED');
    reasons.push('Overturn status unknown — driver must confirm on arrival before any recovery work.');
  }
  if (a.isOverturned === 'YES') {
    review.push('Vehicle reported overturned');
    equipment.add('WINCH');
    equipment.add('RECOVERY_STRAPS');
    crew = Math.max(crew, 3);
    priority = 'CRITICAL';
    safety.push('OVERTURNED');
    if (category.kind === 'TOWING') prefer(['HEAVY_DUTY', 'FLATBED'], 'Overturned vehicles need an uprighting-capable recovery truck.');
  }

  if (a.isSubmerged === 'NOT_SURE' && a.breakdownType !== 'FLOOD') {
    safety.push('CONDITION_UNCONFIRMED');
    reasons.push('Water exposure unknown — do not crank the engine until the driver has inspected it.');
  }
  if (a.isSubmerged === 'YES' || a.breakdownType === 'FLOOD') {
    review.push('Possible flood exposure or submerged vehicle — do not attempt to start; site assessment required');
    safety.push('FLOOD_EXPOSURE');
    if (a.isEvOrHybrid) {
      review.push('Flood-exposed EV/hybrid — high-voltage battery hazard');
      priority = 'CRITICAL';
    }
    if (category.kind === 'TOWING') prefer(['FLATBED', 'HEAVY_DUTY'], 'Flood-exposed vehicles are moved on a flatbed without cranking the engine.');
  }

  if (a.blockingTraffic === 'YES') {
    equipment.add('SAFETY_CONES');
    if (priority === 'NORMAL') priority = 'HIGH';
    safety.push('BLOCKING_TRAFFIC');
    reasons.push('Vehicle is blocking traffic — priority raised and cones required.');
  }

  if (a.majorDamage === 'YES') {
    if (category.kind === 'TOWING') prefer(['FLATBED', 'HEAVY_DUTY'], 'Significant damage — flatbed avoids further damage during transport.');
    if (a.breakdownType === 'COLLISION') review.push('Collision with significant damage — confirm scene safety and any police formalities');
    if (a.isEvOrHybrid && a.breakdownType === 'COLLISION') {
      review.push('Damaged EV battery risk after collision');
      priority = 'CRITICAL';
    }
  }

  // Access
  switch (a.accessRestriction) {
    case 'BASEMENT':
    case 'PARKING_STRUCTURE':
      equipment.add('GO_JACKS');
      safety.push('HEIGHT_RESTRICTED');
      if (category.kind === 'TOWING') {
        prefer(['WHEEL_LIFT', 'BIKE_CARRIER', 'FLATBED'], 'Height-restricted access — low-clearance truck and go-jacks to move the vehicle out.');
        review.push('Basement/parking-structure recovery — confirm clearance height before dispatch');
      }
      break;
    case 'NARROW_LANE':
      safety.push('NARROW_ACCESS');
      if (category.kind === 'TOWING') prefer(['WHEEL_LIFT', 'BIKE_CARRIER', 'FLATBED'], 'Narrow lane — a compact wheel-lift truck may be needed.');
      equipment.add('GO_JACKS');
      break;
    case 'RESTRICTED_AREA':
      review.push('Restricted-access area — confirm entry permission');
      safety.push('RESTRICTED_ACCESS');
      break;
  }

  // People
  if (a.hasChildren) safety.push('CHILDREN_PRESENT');
  if (a.hasElderly) safety.push('ELDERLY_PRESENT');
  if (a.needsAccessibility) safety.push('ACCESSIBILITY_NEEDS');
  if (a.passengersNeedingTransport > 2) {
    safety.push('PASSENGER_TRANSPORT');
    reasons.push(`${a.passengersNeedingTransport} passengers need transport — tow cab seats at most 2; arrange alternate transport.`);
  }
  if ((a.hasChildren || a.hasElderly || a.needsAccessibility) && priority === 'NORMAL' && a.blockingTraffic !== 'NO') priority = 'HIGH';

  // Service fit
  if (category.kind === 'ONSITE') {
    const needsTow = a.majorDamage === 'YES' || a.wheelsRotate === 'NO' || a.isOverturned === 'YES' || a.isSubmerged === 'YES' || a.breakdownType === 'COLLISION';
    if (needsTow) {
      suggestedCategoryKey = vehicleClass === 'TWO_WHEELER' ? 'BIKE_TOW' : vehicleClass === 'LCV' || vehicleClass === 'HCV' ? 'COMMERCIAL_RECOVERY' : 'FLATBED_TOW';
      review.push('Reported condition suggests towing rather than on-site assistance');
    }
    if (category.key === 'JUMP_START' && a.breakdownType !== 'BATTERY' && a.engineStarts !== 'NO') reasons.push('Jump-start requested but breakdown is not reported as a battery issue.');
  }

  let truckTypes: TruckType[] = preferred ?? category.allowedTruckTypes;
  const fits = truckTypes.filter((t) => category.allowedTruckTypes.includes(t));
  if (fits.length === 0 && category.kind === 'TOWING') {
    review.push(`Selected service does not normally use ${truckTypes.join('/')} trucks required for this condition`);
  } else if (fits.length > 0) truckTypes = fits;
  if (category.kind === 'ONSITE') truckTypes = category.allowedTruckTypes;

  if (crewRequested > crew) reasons.push(`Customer requested ${crewRequested} workers; final staffing is confirmed by the dispatcher after assessment.`);

  return {
    truckTypes,
    equipment: [...equipment],
    crew,
    priority,
    safetyFlags: [...new Set(safety)],
    manualReviewReasons: [...new Set(review)],
    reasons,
    suggestedCategoryKey,
    crewNote: 'Recommended crew is based on the reported condition. Final staffing depends on the on-site recovery assessment.',
  };
}
