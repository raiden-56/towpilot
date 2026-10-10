import type { PrismaClient, Prisma } from '@prisma/client';
import { PERMISSIONS, ROLE_DEFINITIONS } from '../domain/permissions.js';

/** Idempotently syncs roles and permissions from code. Safe in every environment. */
export async function syncRoles(prisma: PrismaClient) {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, create: { key, description }, update: { description } });
  }
  const perms = await prisma.permission.findMany();
  for (const [key, def] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await prisma.role.upsert({ where: { key }, create: { key, name: def.name, description: def.description }, update: { name: def.name, description: def.description } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: def.permissions.map((p) => ({ roleId: role.id, permissionId: perms.find((x) => x.key === p)!.id })) });
  }
}

export const SERVICE_CATALOGUE: Prisma.ServiceCategoryCreateInput[] = [
  { key: 'CAR_TOW', name: 'Car towing', description: 'Tow a hatchback or sedan to your garage or home.', kind: 'TOWING', allowedTruckTypes: ['FLATBED', 'WHEEL_LIFT'], requiredEquipment: [], vehicleClasses: ['HATCHBACK', 'SEDAN', 'SUV'], defaultCrew: 1, icon: 'car', sortOrder: 1 },
  { key: 'BIKE_TOW', name: 'Motorcycle towing', description: 'Two-wheelers moved on a bike carrier or flatbed.', kind: 'TOWING', allowedTruckTypes: ['BIKE_CARRIER', 'FLATBED'], requiredEquipment: [], vehicleClasses: ['TWO_WHEELER'], defaultCrew: 1, icon: 'bike', sortOrder: 2 },
  { key: 'PREMIUM_TOW', name: 'SUV & premium towing', description: 'Flatbed-only transport for SUVs, luxury and EVs.', kind: 'TOWING', allowedTruckTypes: ['FLATBED'], requiredEquipment: ['WHEEL_SKATES'], vehicleClasses: ['SUV', 'PREMIUM', 'SEDAN'], defaultCrew: 1, icon: 'premium', sortOrder: 3 },
  { key: 'FLATBED_TOW', name: 'Flatbed towing', description: 'All four wheels off the ground. Safest for damaged or AWD vehicles.', kind: 'TOWING', allowedTruckTypes: ['FLATBED'], requiredEquipment: [], vehicleClasses: ['HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'TWO_WHEELER'], defaultCrew: 1, icon: 'flatbed', sortOrder: 4 },
  { key: 'WHEEL_LIFT_TOW', name: 'Wheel-lift towing', description: 'Compact truck for tight lanes and basements.', kind: 'TOWING', allowedTruckTypes: ['WHEEL_LIFT'], requiredEquipment: [], vehicleClasses: ['HATCHBACK', 'SEDAN'], defaultCrew: 1, icon: 'wheellift', sortOrder: 5 },
  { key: 'ACCIDENT_RECOVERY', name: 'Accident recovery', description: 'Recovery of damaged or immobilised vehicles after a collision.', kind: 'TOWING', allowedTruckTypes: ['FLATBED', 'HEAVY_DUTY'], requiredEquipment: ['WINCH'], vehicleClasses: ['HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'TWO_WHEELER', 'LCV'], defaultCrew: 2, icon: 'accident', sortOrder: 6 },
  { key: 'COMMERCIAL_RECOVERY', name: 'Commercial vehicle recovery', description: 'Heavy-duty recovery for LCVs and trucks.', kind: 'TOWING', allowedTruckTypes: ['HEAVY_DUTY'], requiredEquipment: ['WINCH'], vehicleClasses: ['LCV', 'HCV'], defaultCrew: 2, icon: 'truck', sortOrder: 7 },
  { key: 'JUMP_START', name: 'Battery jump-start', description: 'On-site jump-start for a flat battery.', kind: 'ONSITE', allowedTruckTypes: ['SERVICE_VAN', 'FLATBED', 'WHEEL_LIFT'], requiredEquipment: ['JUMP_STARTER'], vehicleClasses: [], defaultCrew: 1, icon: 'battery', sortOrder: 8 },
  { key: 'FLAT_TYRE', name: 'Flat-tyre assistance', description: 'Spare-wheel change or puncture repair on site.', kind: 'ONSITE', allowedTruckTypes: ['SERVICE_VAN', 'FLATBED', 'WHEEL_LIFT'], requiredEquipment: ['TYRE_KIT'], vehicleClasses: [], defaultCrew: 1, icon: 'tyre', sortOrder: 9 },
  { key: 'FUEL_DELIVERY', name: 'Fuel delivery', description: 'Emergency fuel (charged at actuals) to get you to the nearest pump.', kind: 'ONSITE', allowedTruckTypes: ['SERVICE_VAN'], requiredEquipment: ['FUEL_CAN'], vehicleClasses: ['TWO_WHEELER', 'HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM'], defaultCrew: 1, icon: 'fuel', sortOrder: 10 },
  { key: 'LOCKOUT', name: 'Lockout assistance', description: 'Non-destructive vehicle entry when keys are locked inside.', kind: 'ONSITE', allowedTruckTypes: ['SERVICE_VAN'], requiredEquipment: ['LOCKOUT_KIT'], vehicleClasses: ['HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM'], defaultCrew: 1, icon: 'key', sortOrder: 11 },
];

export async function syncCatalogue(prisma: PrismaClient) {
  for (const c of SERVICE_CATALOGUE) {
    await prisma.serviceCategory.upsert({ where: { key: c.key }, create: c, update: {} });
  }
}
