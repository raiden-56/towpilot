import { type ReactNode, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  type ChipProps,
} from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { ApiError } from '@/api/client';
import type { BookingStatus, PaymentStatus } from '@/api/types';
import { inr, PAYMENT_LABELS, paymentColor, STATUS_LABELS, statusColor } from '@/lib/format';
import { useIsOnline } from '@/hooks/useOnline';
import { useConfig } from '@/hooks/useConfig';
import { isGuestActive } from '@/guest/session';
import { GuestBanner } from '@/guest/GuestBanner';

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" sx={{ mb: 2.5 }}>
      <Box sx={{ minWidth: 0 }}>
        {back}
        <Typography variant="h2" component="h1" sx={{ wordBreak: 'break-word' }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

export function SectionCard({ title, action, children, dense, sx }: { title?: ReactNode; action?: ReactNode; children: ReactNode; dense?: boolean; sx?: object }) {
  return (
    <Card sx={{ ...sx }}>
      <CardContent sx={{ p: dense ? 2 : { xs: 2, sm: 2.5 }, '&:last-child': { pb: dense ? 2 : { xs: 2, sm: 2.5 } } }}>
        {(title || action) && (
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }} spacing={1}>
            {typeof title === 'string' ? <Typography variant="h5">{title}</Typography> : title}
            {action}
          </Stack>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 6, px: 2, textAlign: 'center', color: 'text.secondary' }}>
      {icon ?? <InboxOutlinedIcon sx={{ fontSize: 44, opacity: 0.6 }} />}
      <Typography variant="h5" color="text.primary">
        {title}
      </Typography>
      {body && <Typography sx={{ maxWidth: 420 }}>{body}</Typography>}
      {action}
    </Stack>
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

export function ErrorState({ error, onRetry, title = 'Could not load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Alert severity="error" icon={<ErrorOutlineIcon />} action={onRetry && <Button color="inherit" size="small" onClick={onRetry}>Retry</Button>} sx={{ my: 2 }}>
      <AlertTitle>{title}</AlertTitle>
      {errorMessage(error)}
    </Alert>
  );
}

export function LoadingBlock({ rows = 4, height = 56 }: { rows?: number; height?: number }) {
  return (
    <Stack spacing={1.5} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={height} />
      ))}
    </Stack>
  );
}

export function StatusChip({ status, size = 'small', ...rest }: { status: BookingStatus } & Omit<ChipProps, 'color'>) {
  return <Chip size={size} color={statusColor(status)} label={STATUS_LABELS[status] ?? status} variant={statusColor(status) === 'default' ? 'outlined' : 'filled'} {...rest} />;
}

export function PaymentChip({ status, size = 'small' }: { status: PaymentStatus; size?: 'small' | 'medium' }) {
  return <Chip size={size} color={paymentColor(status)} label={PAYMENT_LABELS[status] ?? status} variant="outlined" />;
}

export function Money({ value, strong, negative }: { value: number | null | undefined; strong?: boolean; negative?: boolean }) {
  return (
    <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: strong ? 700 : undefined, color: negative ? 'error.main' : undefined, whiteSpace: 'nowrap' }}>
      {inr(value)}
    </Box>
  );
}

export function KeyValue({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.75 }}>
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 500 }} component="div">
        {value}
      </Typography>
    </Stack>
  );
}

export function KpiCard({ label, value, hint, definition, trend, onClick }: { label: string; value: ReactNode; hint?: ReactNode; definition?: string; trend?: { pct: number | null; goodWhenUp?: boolean }; onClick?: () => void }) {
  const t = trend?.pct;
  const good = t == null ? null : (t >= 0) === (trend?.goodWhenUp ?? true);
  return (
    <Card sx={{ height: '100%', cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.4 }}>
            {label}
          </Typography>
          {definition && (
            <Tooltip title={definition}>
              <InfoOutlinedIcon sx={{ fontSize: 15, color: 'text.disabled' }} aria-label={`Definition: ${definition}`} />
            </Tooltip>
          )}
        </Stack>
        <Typography variant="h3" component="div" sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
        {(hint || t != null) && (
          <Typography variant="caption" color={good == null ? 'text.secondary' : good ? 'success.main' : 'error.main'}>
            {t != null && `${t >= 0 ? '▲' : '▼'} ${Math.abs(t).toFixed(1)}% vs previous · `}
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  requireReason,
  reasonLabel = 'Reason',
  loading,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {body && <DialogContentText component="div">{body}</DialogContentText>}
        {children}
        {requireReason && <TextField autoFocus label={reasonLabel} value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} sx={{ mt: 2 }} required />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Back</Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} disabled={loading || (requireReason && reason.trim().length < 3)} onClick={() => onConfirm(reason.trim())}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Persistent label shown whenever simulated integrations are active. */
export function SandboxBanner({ compact }: { compact?: boolean }) {
  const { data } = useConfig();
  if (isGuestActive()) return <GuestBanner />;
  if (!data || (!data.payments.sandbox && !data.sms.sandbox)) return null;
  const parts = [data.payments.sandbox && 'payments', data.sms.sandbox && 'SMS', data.maps.provider === 'sandbox' && 'maps'].filter(Boolean).join(', ');
  return (
    <Alert severity="warning" icon={<ScienceOutlinedIcon />} sx={{ borderRadius: 0, py: compact ? 0 : undefined, '& .MuiAlert-message': { py: compact ? 0.75 : undefined } }}>
      Sandbox mode: {parts} are simulated. No real money moves and no real SMS is sent.
    </Alert>
  );
}

export function OfflineBanner() {
  const online = useIsOnline();
  if (online) return null;
  return (
    <Alert severity="error" icon={<WifiOffIcon />} sx={{ borderRadius: 0 }} role="status">
      You are offline. Drafts are kept on this device; nothing is submitted, assigned or paid until you reconnect.
    </Alert>
  );
}

/** Reminds users that TowPilot is not an emergency medical service. */
export function EmergencyNotice() {
  const { data } = useConfig();
  const n = data?.business.emergencyNumber ?? '112';
  return (
    <Alert severity="error" variant="outlined" sx={{ alignItems: 'center' }} action={<Button color="error" variant="contained" href={`tel:${n}`}>Call {n}</Button>}>
      Anyone injured or in danger? Call emergency services on <strong>{n}</strong> first. TowPilot is a roadside assistance service, not an emergency medical service.
    </Alert>
  );
}

export function SampleTag({ show }: { show?: boolean }) {
  if (!show) return null;
  return <Chip component="span" size="small" label="Sample" color="warning" variant="outlined" sx={{ ml: 1 }} />;
}
