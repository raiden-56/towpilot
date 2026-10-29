/**
 * Guest mode: a frontend-only demo for static hosting (GitHub Pages) where no API server exists.
 * Enabled at build time with VITE_GUEST_MODE=true. While a guest session is active every API
 * request is answered in the browser from sample data (see ./mock), and nothing leaves the device.
 * The session (just the chosen role) lives in sessionStorage so it survives reloads.
 */
export type GuestRole = 'admin' | 'dispatcher' | 'finance' | 'customer' | 'driver';

export const GUEST_MODE_ENABLED = import.meta.env.VITE_GUEST_MODE === 'true';

const KEY = 'tp.guest';

export const GUEST_ROLES: { role: GuestRole; label: string; description: string }[] = [
  { role: 'admin', label: 'Administrator', description: 'Full operations console: dispatch, fleet, finance, reports' },
  { role: 'dispatcher', label: 'Dispatcher', description: 'Live dispatch board, bookings, incidents and support' },
  { role: 'finance', label: 'Finance', description: 'Invoices, payments, payroll and financial reports' },
  { role: 'customer', label: 'Customer', description: 'Request a tow, track the driver, pay invoices' },
  { role: 'driver', label: 'Driver', description: 'Job offers, the active job workflow and earnings' },
];

const isRole = (v: unknown): v is GuestRole => GUEST_ROLES.some((r) => r.role === v);
/** In-memory copy so guest mode still works when storage is blocked. */
let current: GuestRole | null = null;

export function guestRole(): GuestRole | null {
  if (!GUEST_MODE_ENABLED) return null;
  if (current) return current;
  try {
    const v = sessionStorage.getItem(KEY);
    current = isRole(v) ? v : null;
  } catch {
    /* storage unavailable */
  }
  return current;
}

export const isGuestActive = () => guestRole() !== null;

export function startGuestSession(role: GuestRole) {
  current = role;
  try {
    sessionStorage.setItem(KEY, role);
  } catch {
    /* storage unavailable: the session lasts until reload */
  }
}

export function endGuestSession() {
  current = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
