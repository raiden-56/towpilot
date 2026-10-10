/** Permission catalogue. Enforced server-side on every protected endpoint. */
export const PERMISSIONS = {
  'customer:self': 'Use customer features for own account (vehicles, bookings, invoices)',
  'driver:self': 'Use field-worker features for own assignments, availability and earnings',
  'booking:read_any': 'View any booking, including exact locations',
  'booking:manage': 'Cancel, hold, or modify any booking',
  'booking:override': 'Perform authorised workflow overrides (OTP bypass, forced transitions)',
  'dispatch:manage': 'Assign and reassign drivers, manage dispatch queue',
  'employee:read': 'View employee directory and assignments',
  'employee:manage': 'Create, edit, suspend employees and set compensation',
  'employee:verify': 'Approve or reject employee verification',
  'employee:documents': 'View private employee documents',
  'fleet:read': 'View fleet registry',
  'fleet:manage': 'Create and edit trucks, equipment and maintenance',
  'customer:read': 'View customer profiles',
  'customer:manage': 'Suspend customers and manage business accounts',
  'pricing:read': 'View rate cards and service configuration',
  'pricing:manage': 'Edit rate cards, services and zones',
  'pricing:approve_override': 'Approve exceptional price overrides',
  'finance:read': 'View invoices, payments, expenses and financial reports',
  'finance:manage': 'Confirm cash, approve refunds and expenses, issue credit notes',
  'payroll:manage': 'Manage salary records and driver payouts',
  'reports:read': 'View operational analytics',
  'support:manage': 'Handle support tickets and complaints',
  'incident:manage': 'Handle incidents and escalations',
  'membership:manage': 'Manage membership plans and fleet contracts',
  'settings:manage': 'Change business settings',
  'audit:read': 'Read audit logs',
  'roles:manage': 'Grant and revoke staff roles',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLE_DEFINITIONS: Record<string, { name: string; description: string; permissions: PermissionKey[] }> = {
  customer: { name: 'Customer', description: 'Vehicle owner requesting assistance', permissions: ['customer:self'] },
  driver: { name: 'Driver', description: 'Tow-truck driver; can lead a recovery team', permissions: ['driver:self'] },
  worker: { name: 'Recovery worker', description: 'Field recovery crew member', permissions: ['driver:self'] },
  dispatcher: {
    name: 'Dispatcher',
    description: 'Operations staff running live dispatch',
    permissions: [
      'booking:read_any',
      'booking:manage',
      'booking:override',
      'dispatch:manage',
      'employee:read',
      'fleet:read',
      'customer:read',
      'pricing:read',
      'incident:manage',
      'support:manage',
      'reports:read',
    ],
  },
  finance: {
    name: 'Finance',
    description: 'Accounts staff',
    permissions: ['finance:read', 'finance:manage', 'payroll:manage', 'reports:read', 'customer:read', 'pricing:read', 'employee:read', 'fleet:read', 'booking:read_any'],
  },
  admin: { name: 'Administrator', description: 'Business owner with full access', permissions: ALL },
};

export const STAFF_ROLES = ['admin', 'dispatcher', 'finance'] as const;
export const FIELD_ROLES = ['driver', 'worker'] as const;

export function hasAny(granted: Iterable<string>, required: string[]): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return required.some((p) => set.has(p));
}

export function permissionsForRoles(roleKeys: string[]): Set<PermissionKey> {
  const out = new Set<PermissionKey>();
  for (const r of roleKeys) for (const p of ROLE_DEFINITIONS[r]?.permissions ?? []) out.add(p);
  return out;
}
