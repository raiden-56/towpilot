import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Link,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
  type ChipProps,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { api } from '@/api/client';
import { errorMessage } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { humanize } from '@/lib/format';
import type { ChipColor } from '@/lib/format';
import type { Reminder, Zone } from './types';

// ─── Feedback ────────────────────────────────────────────────────────

type Severity = 'success' | 'error' | 'info' | 'warning';
export type Notify = (msg: string, severity?: Severity) => void;

/** Page-level snackbar. Render `node` once; pass `notify` to children. */
export function useNotice() {
  const [state, setState] = useState<{ msg: string; severity: Severity; key: number } | null>(null);
  const notify = useCallback<Notify>((msg, severity = 'success') => setState({ msg, severity, key: Date.now() }), []);
  const fail = useCallback((e: unknown) => setState({ msg: errorMessage(e), severity: 'error', key: Date.now() }), []);
  const node = (
    <Snackbar key={state?.key} open={!!state} autoHideDuration={state?.severity === 'error' ? 8000 : 4500} onClose={(_, r) => r !== 'clickaway' && setState(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Alert severity={state?.severity ?? 'info'} variant="filled" onClose={() => setState(null)} sx={{ width: '100%' }}>
        {state?.msg}
      </Alert>
    </Snackbar>
  );
  return { notify, fail, node };
}

// ─── Reason dialog (configurable minimum length, resets on open) ─────

export function ReasonDialog({
  open,
  title,
  body,
  label = 'Reason',
  minLength = 3,
  maxLength = 500,
  confirmLabel = 'Confirm',
  danger,
  loading,
  optional,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  label?: string;
  minLength?: number;
  maxLength?: number;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  optional?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const len = reason.trim().length;
  const valid = optional ? len === 0 || len >= minLength : len >= minLength;
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {body && <DialogContentText component="div" sx={{ mb: 1 }}>{body}</DialogContentText>}
        {children}
        <TextField
          autoFocus
          fullWidth
          label={label}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, maxLength))}
          multiline
          minRows={2}
          sx={{ mt: 2 }}
          required={!optional}
          helperText={`${optional ? 'Optional. ' : ''}${minLength > 1 ? `At least ${minLength} characters. ` : ''}${len}/${maxLength}`}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Back
        </Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} disabled={loading || !valid} onClick={() => onConfirm(reason.trim())}>
          {loading ? 'Working…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Chips & small display helpers ───────────────────────────────────

export function PriorityChip({ priority, hideNormal }: { priority: string; hideNormal?: boolean }) {
  if (priority === 'NORMAL' && hideNormal) return null;
  const color: ChipColor = priority === 'CRITICAL' ? 'error' : priority === 'HIGH' ? 'warning' : priority === 'MEDIUM' ? 'info' : 'default';
  return <Chip size="small" color={color} variant={priority === 'CRITICAL' ? 'filled' : 'outlined'} label={humanize(priority)} />;
}

export function FlagChips({ flags, max = 3 }: { flags: string[]; max?: number }) {
  if (!flags.length) return null;
  const shown = flags.slice(0, max);
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {shown.map((f) => (
        <Chip key={f} size="small" variant="outlined" color="warning" label={humanize(f)} sx={{ height: 22 }} />
      ))}
      {flags.length > max && (
        <Tooltip title={flags.slice(max).map(humanize).join(', ')}>
          <Chip size="small" variant="outlined" label={`+${flags.length - max}`} sx={{ height: 22 }} />
        </Tooltip>
      )}
    </Stack>
  );
}

export function EnumChip({ value, color = 'default', variant = 'outlined', ...rest }: { value: string | null | undefined; color?: ChipColor; variant?: 'outlined' | 'filled' } & Omit<ChipProps, 'color' | 'label' | 'variant'>) {
  if (!value) return <>—</>;
  return <Chip size="small" color={color} variant={variant} label={humanize(value)} {...rest} />;
}

export const ESCALATION_COLOR = (s: string): ChipColor => (s === 'OPEN' ? 'error' : s === 'ACKNOWLEDGED' ? 'warning' : 'success');
export const VERIFICATION_COLOR = (s?: string | null): ChipColor => (s === 'APPROVED' ? 'success' : s === 'REJECTED' || s === 'SUSPENDED' ? 'error' : 'warning');
export const ACCOUNT_COLOR = (s?: string | null): ChipColor => (s === 'ACTIVE' ? 'success' : s === 'PENDING' ? 'warning' : 'error');
export const AVAILABILITY_COLOR = (s?: string | null): ChipColor => (s === 'AVAILABLE' ? 'success' : s === 'ON_JOB' || s === 'BUSY' ? 'info' : s === 'ON_BREAK' ? 'warning' : 'default');
export const TRUCK_STATUS_COLOR = (s?: string | null): ChipColor => (s === 'AVAILABLE' ? 'success' : s === 'IN_USE' ? 'info' : s === 'MAINTENANCE' ? 'warning' : s === 'OUT_OF_SERVICE' ? 'error' : 'default');
export const ASSIGNMENT_COLOR = (s: string): ChipColor => (s === 'ACCEPTED' || s === 'COMPLETED' ? 'success' : s === 'OFFERED' ? 'warning' : s === 'REJECTED' || s === 'TIMED_OUT' ? 'error' : 'default');
export const TICKET_STATUS_COLOR = (s: string): ChipColor => (s === 'OPEN' ? 'error' : s === 'IN_PROGRESS' ? 'info' : s === 'AWAITING_CUSTOMER' ? 'warning' : 'success');

/** Live mm:ss countdown to a timestamp. */
export function Countdown({ to, expiredLabel = 'expired' }: { to: string; expiredLabel?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <>{expiredLabel}</>;
  const s = Math.floor(ms / 1000);
  return (
    <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </Box>
  );
}

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Button component={RouterLink} to={to} size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 1, ml: -1 }}>
      {label}
    </Button>
  );
}

export function BookingLink({ id, code }: { id: string | null | undefined; code: string | null | undefined }) {
  if (!id) return <>{code ?? '—'}</>;
  return (
    <Link component={RouterLink} to={`/admin/bookings/${id}`} onClick={(e) => e.stopPropagation()} sx={{ fontWeight: 600 }}>
      {code ?? 'View booking'}
    </Link>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" component="span">
      {children}
    </Typography>
  );
}

export function Hint({ children, severity = 'info' }: { children: ReactNode; severity?: Severity }) {
  return (
    <Alert severity={severity} variant="outlined" sx={{ py: 0.25 }}>
      {children}
    </Alert>
  );
}

/** Select with an "All" option, used in filter bars. */
export function FilterSelect({ label, value, onChange, options, allLabel = 'All', minWidth = 150 }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string | null; minWidth?: number }) {
  return (
    <TextField select size="small" fullWidth={false} label={label} value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth, flex: { xs: '1 1 140px', md: '0 0 auto' } }}>
      {allLabel !== null && <MenuItem value="">{allLabel}</MenuItem>}
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

export const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: humanize(v) }));

/** Debounced value for search inputs. */
export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Service zones: the admin list (incl. inactive) when permitted, else the public active list. */
export function useZones() {
  const { can } = useAuth();
  const admin = can('pricing:read');
  return useQuery({
    queryKey: ['admin', 'zones', admin ? 'all' : 'active'],
    queryFn: () => api.get<Zone[]>(admin ? '/admin/pricing/zones' : '/catalog/zones'),
    staleTime: 5 * 60_000,
  });
}

export function useServiceCategories() {
  return useQuery({
    queryKey: ['catalog', 'services', 'all'],
    queryFn: async () => (await api.get<{ services: { id: string; key: string; name: string; kind: string }[] }>('/catalog/services')).services,
    staleTime: 5 * 60_000,
  });
}

// ─── Enumerations ────────────────────────────────────────────────────

export const TRUCK_TYPES = ['FLATBED', 'WHEEL_LIFT', 'HEAVY_DUTY', 'BIKE_CARRIER', 'SERVICE_VAN'] as const;
export const TRUCK_STATUSES = ['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'RETIRED'] as const;
export const VEHICLE_CLASSES = ['TWO_WHEELER', 'HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'LCV', 'HCV'] as const;
export const EQUIPMENT_TYPES = ['WINCH', 'DOLLIES', 'GO_JACKS', 'WHEEL_SKATES', 'WHEEL_LIFT', 'FLATBED_DECK', 'JUMP_STARTER', 'TYRE_KIT', 'FUEL_CAN', 'LOCKOUT_KIT', 'EV_SAFE_KIT', 'RECOVERY_STRAPS', 'SAFETY_CONES'] as const;
export const EMPLOYEE_ROLES = ['driver', 'worker', 'dispatcher', 'finance', 'admin'] as const;
export const OFFICE_ROLES = ['dispatcher', 'finance', 'admin'];
export const VERIFICATION_STATUSES = ['PENDING', 'DOCUMENTS_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export const AVAILABILITY_STATUSES = ['AVAILABLE', 'BUSY', 'ON_JOB', 'ON_BREAK', 'OFF_DUTY'] as const;
export const EMPLOYMENT_TYPES = ['SALARIED', 'COMMISSION', 'JOB_BASED', 'PARTNER'] as const;
export const PAY_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'ANNUAL'] as const;
export const DOCUMENT_TYPES = ['ID_PROOF', 'DRIVING_LICENCE', 'PHOTO', 'ADDRESS_PROOF', 'TRAINING_CERTIFICATE', 'OTHER'] as const;
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
export const TICKET_CATEGORIES = ['GENERAL', 'COMPLAINT', 'BILLING_DISPUTE', 'REFUND_REQUEST', 'PRIVACY_REQUEST', 'PERFORMANCE_CHALLENGE', 'SAFETY'] as const;
export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const ROLE_LABELS: Record<string, string> = { driver: 'Driver', worker: 'Recovery worker', dispatcher: 'Dispatcher', finance: 'Finance', admin: 'Administrator' };

/** Booking statuses that need a provider (mirrors the API). */
export const NEEDS_PROVIDER = ['CONFIRMED', 'SEARCHING_FOR_PROVIDER', 'REJECTED', 'REASSIGNMENT_REQUIRED'];
export const FIELD_ACTIVE = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT', 'CUSTOMER_UNAVAILABLE', 'SAFETY_HOLD'];

/**
 * Reasons the API treats as hard blocks (never overridable). Mirrors the server rule in
 * dispatch/service.ts → manualAssign; the server remains the authority.
 */
export const HARD_BLOCK = /Driver is (off duty|on break|busy)|not verified|not active|expired|holds an assignment|No truck|not suitable|capacity|Missing working equipment|maintenance|out of service|retired|heavy-vehicle/i;

/** Date input value (yyyy-mm-dd) in local time. */
export function toDateInput(d: string | Date | null | undefined) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

export function minutesLabel(v: number | null | undefined) {
  if (v == null) return '—';
  if (v < 60) return `${Math.round(v)} min`;
  return `${Math.floor(v / 60)} h ${Math.round(v % 60)} min`;
}

export function durationBetween(a: string, b: string | null) {
  const ms = (b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime();
  return minutesLabel(ms / 60000);
}

// ─── Fleet reminders ─────────────────────────────────────────────────

export const REMINDER_BASIS_LABEL = 'Rule-based reminders (service intervals & document expiry), not predictive AI';

export function ReminderBadges({ reminders }: { reminders: Reminder[] }) {
  const overdue = reminders.filter((r) => r.severity === 'OVERDUE');
  const soon = reminders.filter((r) => r.severity === 'DUE_SOON');
  if (!reminders.length) return <Chip size="small" variant="outlined" color="success" label="Up to date" />;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {overdue.length > 0 && (
        <Tooltip title={overdue.map((r) => r.message).join(' · ')}>
          <Chip size="small" color="error" label={`${overdue.length} overdue`} />
        </Tooltip>
      )}
      {soon.length > 0 && (
        <Tooltip title={soon.map((r) => r.message).join(' · ')}>
          <Chip size="small" color="warning" variant="outlined" label={`${soon.length} due soon`} />
        </Tooltip>
      )}
    </Stack>
  );
}

