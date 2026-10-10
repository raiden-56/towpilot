/** Shared building blocks for the admin business & finance pages. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputAdornment,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  type AlertColor,
  type TextFieldProps,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { humanize, TZ, type ChipColor } from '@/lib/format';
import { errorMessage } from '@/components/common';

// ─── Toast ───────────────────────────────────────────────────────────

export function useToast() {
  const [state, setState] = useState<{ text: string; severity: AlertColor; key: number } | null>(null);
  const toast = useCallback((text: string, severity: AlertColor = 'success') => setState({ text, severity, key: Date.now() }), []);
  const toastNode = (
    <Snackbar key={state?.key} open={!!state} autoHideDuration={state?.severity === 'error' ? 8000 : 4000} onClose={(_, reason) => reason !== 'clickaway' && setState(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Alert severity={state?.severity ?? 'success'} variant="filled" onClose={() => setState(null)} sx={{ width: '100%' }} role={state?.severity === 'error' ? 'alert' : 'status'}>
        {state?.text}
      </Alert>
    </Snackbar>
  );
  const toastError = useCallback((e: unknown) => toast(errorMessage(e), 'error'), [toast]);
  return { toast, toastError, toastNode };
}

export function BackLink({ to, label = 'Back' }: { to: string; label?: string }) {
  return (
    <Button component={RouterLink} to={to} size="small" startIcon={<ArrowBackIcon />} sx={{ ml: -1, mb: 0.5 }}>
      {label}
    </Button>
  );
}

// ─── URL-synced state ────────────────────────────────────────────────

/** A tab value kept in the `?tab=` search param so tabs are linkable and survive reloads. */
export function useTabParam<T extends string>(values: readonly T[], fallback: T, param = 'tab'): [T, (v: T) => void] {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get(param) as T | null;
  const value = raw && values.includes(raw) ? raw : fallback;
  const set = useCallback(
    (v: T) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set(param, v);
          return n;
        },
        { replace: true },
      ),
    [setSp, param],
  );
  return [value, set];
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ─── Dates & numbers ─────────────────────────────────────────────────

/** Date → "YYYY-MM-DD" in the business timezone (for <input type="date">). */
export function toDateInput(d: string | Date | null | undefined): string {
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  return parts; // en-CA yields YYYY-MM-DD
}

/** "YYYY-MM-DD" (business local date) → ISO instant at local midnight (IST, +05:30). */
export function localDateToIso(s: string): string {
  return new Date(`${s}T00:00:00+05:30`).toISOString();
}

/** Exclusive end for a local date filter: midnight after the given day. */
export function localDateEndIso(s: string): string {
  return new Date(new Date(`${s}T00:00:00+05:30`).getTime() + 86_400_000).toISOString();
}

export function todayInput() {
  return toDateInput(new Date());
}

export function addDaysInput(s: string, days: number) {
  return toDateInput(new Date(new Date(`${s}T12:00:00+05:30`).getTime() + days * 86_400_000));
}

export const rupees = (paise: number | null | undefined) => (paise == null ? undefined : Math.round(paise) / 100);

export function pctChange(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export const fmtPct = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${v.toFixed(digits)}%`);
export const fmtNum = (v: number | null | undefined, digits = 0) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 }));

/** RHF register option: '' → undefined, otherwise Number(). */
export const numOpt = { setValueAs: (v: unknown) => (v === '' || v == null ? undefined : Number(v)) };

// ─── Inputs ──────────────────────────────────────────────────────────

/** Rupee amount input (₹ prefix, 2 decimals). Values are rupees; the API converts to paise. */
export function RupeeField(props: TextFieldProps) {
  return (
    <TextField
      type="number"
      {...props}
      slotProps={{
        ...props.slotProps,
        input: { startAdornment: <InputAdornment position="start">₹</InputAdornment>, ...((props.slotProps?.input as object) ?? {}) },
        htmlInput: { step: '0.01', min: 0, inputMode: 'decimal', ...((props.slotProps?.htmlInput as object) ?? {}) },
      }}
    />
  );
}

export function MultiSelect({ label, options, value, onChange, disabled, helperText, error, size = 'medium' }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; helperText?: ReactNode; error?: boolean; size?: 'small' | 'medium' }) {
  const id = `ms-${label.replace(/\W/g, '')}`;
  return (
    <FormControl fullWidth disabled={disabled} error={error} size={size}>
      <InputLabel id={id}>{label}</InputLabel>
      <Select
        labelId={id}
        multiple
        value={value}
        label={label}
        onChange={(e) => onChange(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
        renderValue={(sel) => (
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.5}>
            {sel.map((v) => (
              <Chip key={v} size="small" label={options.find((o) => o.value === v)?.label ?? v} />
            ))}
          </Stack>
        )}
        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 360 } } } }}
      >
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value} dense>
            <Checkbox size="small" checked={value.includes(o.value)} />
            <ListItemText primary={o.label} />
          </MenuItem>
        ))}
      </Select>
      {helperText && (
        <Typography variant="caption" color={error ? 'error' : 'text.secondary'} sx={{ mt: 0.5, mx: 1.75 }}>
          {helperText}
        </Typography>
      )}
    </FormControl>
  );
}

/** Responsive filter row. */
export function FilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }} sx={{ mb: 2 }} useFlexGap flexWrap="wrap">
      {children}
      {actions && (
        <>
          <Box sx={{ flex: 1, display: { xs: 'none', md: 'block' } }} />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {actions}
          </Stack>
        </>
      )}
    </Stack>
  );
}

// ─── Display ─────────────────────────────────────────────────────────

export function InfoTip({ title }: { title: ReactNode }) {
  return (
    <Tooltip title={title} enterTouchDelay={0}>
      <InfoOutlinedIcon sx={{ fontSize: 15, color: 'text.disabled', verticalAlign: 'middle', ml: 0.5, cursor: 'help' }} aria-label={typeof title === 'string' ? `Definition: ${title}` : 'Definition'} tabIndex={0} />
    </Tooltip>
  );
}

const TONES: Record<string, ChipColor> = {
  // generic lifecycle
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  DEACTIVATED: 'default',
  PENDING: 'warning',
  INACTIVE: 'default',
  // payments
  CREATED: 'default',
  SUCCEEDED: 'success',
  FAILED: 'error',
  CANCELLED: 'default',
  // refunds
  REQUESTED: 'warning',
  APPROVED: 'info',
  PROCESSING: 'info',
  REJECTED: 'default',
  // expenses / salaries / payouts
  SUBMITTED: 'warning',
  PAID: 'success',
  ACCRUED: 'warning',
  DRAFT: 'warning',
  // invoices
  ISSUED: 'info',
  VOID: 'default',
  // subscriptions
  PENDING_PAYMENT: 'warning',
  EXPIRED: 'default',
  // tickets
  OPEN: 'warning',
  IN_PROGRESS: 'info',
  AWAITING_CUSTOMER: 'info',
  RESOLVED: 'success',
  CLOSED: 'default',
  // webhooks
  RECEIVED: 'info',
  PROCESSED: 'success',
  IGNORED: 'default',
};

export function EnumChip({ value, label, color }: { value: string; label?: string; color?: ChipColor }) {
  const c = color ?? TONES[value] ?? 'default';
  return <Chip size="small" color={c} variant={c === 'default' ? 'outlined' : 'filled'} label={label ?? humanize(value)} sx={{ fontWeight: 600 }} />;
}

export function SandboxChip({ show }: { show?: boolean }) {
  if (!show) return null;
  return <Chip size="small" label="Sandbox" color="warning" variant="outlined" sx={{ ml: 0.5, height: 20, fontSize: 11 }} />;
}

export const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 } as const;
export const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;

export interface SimpleColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  nowrap?: boolean;
}

/**
 * Compact table for use inside cards. Wide tables scroll horizontally inside their container
 * (never the page). Optional footer row for totals.
 */
export function SimpleTable<T>({ columns, rows, rowKey, empty = 'Nothing to show', onRowClick, footer, size = 'small', minWidth, maxHeight }: { columns: SimpleColumn<T>[]; rows: T[] | undefined; rowKey: (r: T) => string; empty?: ReactNode; onRowClick?: (r: T) => void; footer?: ReactNode; size?: 'small' | 'medium'; minWidth?: number; maxHeight?: number }) {
  if (!rows?.length)
    return (
      <Typography color="text.secondary" variant="body2" sx={{ py: 2 }}>
        {empty}
      </Typography>
    );
  return (
    <TableContainer sx={{ overflowX: 'auto', maxHeight, mx: { xs: -2, sm: 0 }, width: { xs: 'calc(100% + 32px)', sm: '100%' } }}>
      <Table size={size} stickyHeader={!!maxHeight} sx={{ minWidth }}>
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell key={c.key} align={c.align} sx={{ width: c.width, whiteSpace: 'nowrap' }}>
                {c.header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={rowKey(r)} hover={!!onRowClick} onClick={onRowClick ? () => onRowClick(r) : undefined} sx={{ cursor: onRowClick ? 'pointer' : undefined }}>
              {columns.map((c) => (
                <TableCell key={c.key} align={c.align} sx={{ ...(c.align === 'right' ? num : {}), whiteSpace: c.nowrap ? 'nowrap' : undefined }}>
                  {c.render(r)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {footer}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** Dialog shell for forms: submit via <form>, server error area, disabled while submitting. */
export function FormDialog({ open, title, onClose, onSubmit, submitting, submitLabel = 'Save', children, error, maxWidth = 'sm', danger, submitDisabled, intro }: { open: boolean; title: ReactNode; onClose: () => void; onSubmit: () => void; submitting?: boolean; submitLabel?: string; children: ReactNode; error?: unknown; maxWidth?: 'xs' | 'sm' | 'md' | 'lg'; danger?: boolean; submitDisabled?: boolean; intro?: ReactNode }) {
  const theme = useTheme();
  const full = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth={maxWidth} fullScreen={full}>
      <Box
        component="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent dividers>
          {intro && <Box sx={{ mb: 2 }}>{intro}</Box>}
          {children}
          {error != null && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errorMessage(error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" color={danger ? 'error' : 'primary'} disabled={submitting || submitDisabled}>
            {submitting ? 'Saving…' : submitLabel}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** Pick a reason/reference with a single text input (dangerous/financial actions). */
export function PromptDialog({ open, title, body, label, confirmLabel = 'Confirm', minLength = 3, maxLength = 500, danger, loading, onConfirm, onClose, error, multiline = true }: { open: boolean; title: string; body?: ReactNode; label: string; confirmLabel?: string; minLength?: number; maxLength?: number; danger?: boolean; loading?: boolean; onConfirm: (value: string) => void; onClose: () => void; error?: unknown; multiline?: boolean }) {
  const [v, setV] = useState('');
  useEffect(() => {
    if (open) setV('');
  }, [open]);
  const ok = v.trim().length >= minLength && v.trim().length <= maxLength;
  return (
    <FormDialog open={open} title={title} onClose={onClose} onSubmit={() => ok && onConfirm(v.trim())} submitting={loading} submitLabel={confirmLabel} danger={danger} submitDisabled={!ok} error={error} maxWidth="xs">
      {body && (
        <Typography variant="body2" color="text.secondary" component="div" sx={{ mb: 2 }}>
          {body}
        </Typography>
      )}
      <TextField autoFocus fullWidth label={label} value={v} onChange={(e) => setV(e.target.value)} multiline={multiline} minRows={multiline ? 2 : undefined} required helperText={`At least ${minLength} characters`} slotProps={{ htmlInput: { maxLength } }} />
    </FormDialog>
  );
}

// ─── Enumerations ────────────────────────────────────────────────────

export const TRUCK_TYPES = ['FLATBED', 'WHEEL_LIFT', 'HEAVY_DUTY', 'BIKE_CARRIER', 'SERVICE_VAN'] as const;
export const EQUIPMENT_TYPES = ['WINCH', 'DOLLIES', 'GO_JACKS', 'WHEEL_SKATES', 'WHEEL_LIFT', 'FLATBED_DECK', 'JUMP_STARTER', 'TYRE_KIT', 'FUEL_CAN', 'LOCKOUT_KIT', 'EV_SAFE_KIT', 'RECOVERY_STRAPS', 'SAFETY_CONES'] as const;
export const VEHICLE_CLASSES = ['TWO_WHEELER', 'HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'LCV', 'HCV'] as const;
export const EXPENSE_CATEGORIES = ['FUEL', 'MAINTENANCE', 'REPAIR', 'EQUIPMENT', 'RENTAL', 'MARKETING', 'INSURANCE', 'TOLLS_PARKING', 'OFFICE', 'SOFTWARE', 'OTHER'] as const;

export const opts = (values: readonly string[], labels?: Record<string, string>) => values.map((v) => ({ value: v, label: labels?.[v] ?? humanize(v) }));

/** Number of whole days an invoice is past due (0 if not yet due). */
export function daysPastDue(dueAt: string | null | undefined, issuedAt?: string) {
  const d = dueAt ?? issuedAt;
  if (!d) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));
}
