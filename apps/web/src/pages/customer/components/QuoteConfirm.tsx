import { useEffect, useState } from 'react';
import { Alert, AlertTitle, Box, Button, Chip, CircularProgress, Collapse, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api, ApiError } from '@/api/client';
import type { BookingDetail, Quote } from '@/api/types';
import { QuoteBreakdown } from '@/components/QuoteBreakdown';
import { errorMessage, SectionCard } from '@/components/common';
import { useIsOnline } from '@/hooks/useOnline';
import { dateTime, inr } from '@/lib/format';
import { flagLabel } from './bookingParts';

function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Recommendation, safety flags and manual-review notice for a booking. */
export function RecommendationNotes({ booking }: { booking: BookingDetail }) {
  const rec = booking.recommendation;
  const review = booking.manualReviewReasons ?? [];
  return (
    <Stack spacing={1.5}>
      {booking.safetyFlags.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            Safety notes for the crew
          </Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {booking.safetyFlags.map((f) => (
              <Chip key={f} size="small" color="warning" variant="outlined" label={flagLabel(f)} />
            ))}
          </Stack>
        </Box>
      )}
      {booking.requiresManualReview && review.length > 0 && (
        <Alert severity="info">
          <AlertTitle>A coordinator will check this request</AlertTitle>
          Before a provider is dispatched, our team reviews: {review.join('; ')}. They may call you to confirm details.
        </Alert>
      )}
      {rec && rec.reasons.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            Why we recommend this setup
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5, mt: 0.5 }}>
            {rec.reasons.map((r) => (
              <Typography component="li" variant="body2" key={r} sx={{ mb: 0.25 }}>
                {r}
              </Typography>
            ))}
          </Box>
        </Box>
      )}
      {rec && (
        <Typography variant="caption" color="text.secondary">
          Recommended crew: {rec.crew}
          {booking.crewRequested && booking.crewRequested !== rec.crew ? ` (you asked for ${booking.crewRequested})` : ''}. {rec.crewNote}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * Shows the pending initial quote of a QUOTED booking and lets the customer confirm it.
 * Handles quote expiry (requote), promo/membership changes and offline mode.
 */
export function QuoteConfirmPanel({ booking, onUpdated, onConfirmed }: { booking: BookingDetail; onUpdated: (b: BookingDetail) => void; onConfirmed: (b: BookingDetail) => void }) {
  const online = useIsOnline();
  const now = useNow();
  const [busy, setBusy] = useState<'confirm' | 'requote' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [promo, setPromo] = useState('');
  const [useMembership, setUseMembership] = useState(true);

  const quote: Quote | undefined = booking.quotes?.find((q) => q.id === booking.pendingQuoteId) ?? undefined;
  const expired = !!quote?.expiresAt && new Date(quote.expiresAt).getTime() <= now;
  const minsLeft = quote?.expiresAt ? Math.max(0, Math.round((new Date(quote.expiresAt).getTime() - now) / 60000)) : null;

  async function requote(body: { promoCode?: string | null; useMembership?: boolean } = {}, msg = 'We refreshed your quote. Please review the price before confirming.') {
    setBusy('requote');
    setError(null);
    try {
      const b = await api.post<BookingDetail>(`/bookings/${booking.id}/requote`, body);
      onUpdated(b);
      setNotice(msg);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!quote) return;
    setBusy('confirm');
    setError(null);
    setNotice(null);
    try {
      const b = await api.post<BookingDetail>(`/bookings/${booking.id}/confirm`, { quoteId: quote.id });
      onConfirmed(b);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && (e.details as { code?: string } | undefined)?.code === 'QUOTE_EXPIRED') {
        setBusy(null);
        await requote({}, 'Your quote had expired, so we fetched an updated price. Please review it and confirm again.');
        return;
      }
      if (e instanceof ApiError && e.status === 409) {
        // Quote superseded or booking already moved on — reload the latest state.
        try {
          const fresh = await api.get<BookingDetail>(`/bookings/${booking.id}`);
          if (fresh.status !== 'QUOTED') return onConfirmed(fresh);
          onUpdated(fresh);
        } catch {
          /* fall through to message */
        }
      }
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack spacing={2}>
      <SectionCard title="Your quote" action={quote && <Chip size="small" label={`v${quote.version}`} variant="outlined" />}>
        {quote ? (
          <>
            <QuoteBreakdown quote={quote} />
            {minsLeft != null && !expired && (
              <Typography variant="body2" color={minsLeft <= 3 ? 'warning.main' : 'text.secondary'} sx={{ mt: 1, fontWeight: 600 }}>
                Price held for {minsLeft <= 0 ? 'less than a minute' : `${minsLeft} more minute${minsLeft === 1 ? '' : 's'}`} (until {dateTime(quote.expiresAt)})
              </Typography>
            )}
          </>
        ) : (
          <Alert severity="warning">This quote is no longer available. Get a fresh quote to continue.</Alert>
        )}
        {expired && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            This quote expired at {dateTime(quote?.expiresAt)}. Prices can change with time of day and demand — get a fresh quote to continue.
          </Alert>
        )}
      </SectionCard>

      <SectionCard>
        <RecommendationNotes booking={booking} />
        <Button size="small" sx={{ mt: 1.5, ml: -1 }} onClick={() => setShowOptions((s) => !s)} aria-expanded={showOptions}>
          {showOptions ? 'Hide' : 'Apply a'} promo code or membership option
        </Button>
        <Collapse in={showOptions}>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <TextField label="Promo code" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} slotProps={{ htmlInput: { maxLength: 30, autoCapitalize: 'characters' } }} helperText="Leave empty to remove a previously applied code." />
            <FormControlLabel control={<Switch checked={useMembership} onChange={(e) => setUseMembership(e.target.checked)} />} label="Use my membership benefits if this service is covered" />
            <Button variant="outlined" startIcon={busy === 'requote' ? <CircularProgress size={16} /> : <RefreshIcon />} disabled={!!busy || !online} onClick={() => requote({ promoCode: promo.trim() || null, useMembership }, 'Quote updated with your promo and membership choices.')}>
              Update quote
            </Button>
          </Stack>
        </Collapse>
      </SectionCard>

      {notice && (
        <Alert severity="info" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {!online && <Alert severity="warning">You are offline. Your booking is not confirmed yet — reconnect to confirm. Nothing has been dispatched.</Alert>}

      {quote && !expired ? (
        <Button size="large" variant="contained" startIcon={busy === 'confirm' ? <CircularProgress size={18} color="inherit" /> : <CheckCircleOutlineIcon />} disabled={!!busy || !online} onClick={confirm} sx={{ minHeight: 56 }}>
          {busy === 'confirm' ? 'Confirming…' : `Confirm booking · ${inr(quote.total)}`}
        </Button>
      ) : (
        <Button size="large" variant="contained" startIcon={busy === 'requote' ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon />} disabled={!!busy || !online} onClick={() => requote()} sx={{ minHeight: 56 }}>
          Get a fresh quote
        </Button>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
        You pay after the job is done. Any extra chargeable work needs your approval first.
      </Typography>
    </Stack>
  );
}
