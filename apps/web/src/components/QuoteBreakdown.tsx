import { Alert, Box, Chip, Divider, Stack, Typography } from '@mui/material';
import type { Quote } from '@/api/types';
import { dateTime, inr } from '@/lib/format';

/**
 * Itemised quote: clearly separates estimated vs fixed charges, discounts, GST and
 * pass-through actuals (tolls/parking), and shows expiry and disclosed conditions.
 */
export function QuoteBreakdown({ quote, compareTo, showConditions = true }: { quote: Quote; compareTo?: Quote | null; showConditions?: boolean }) {
  const service = quote.items.filter((i) => i.taxable && i.amount > 0);
  const discounts = quote.items.filter((i) => i.amount < 0);
  const pass = quote.items.filter((i) => i.isPassThrough);
  const anyEstimate = quote.items.some((i) => i.isEstimate);
  const rules = quote.pricingSnapshot?.rules;
  const prev = compareTo ? new Map(compareTo.items.map((i) => [i.code, i.amount])) : null;

  const row = (label: React.ReactNode, amount: number, opts: { muted?: boolean; bold?: boolean; tag?: React.ReactNode; sub?: React.ReactNode } = {}) => (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.6 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" component="div" sx={{ fontWeight: opts.bold ? 700 : 500, color: opts.muted ? 'text.secondary' : undefined }}>
          {label} {opts.tag}
        </Typography>
        {opts.sub && (
          <Typography variant="caption" color="text.secondary">
            {opts.sub}
          </Typography>
        )}
      </Box>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: opts.bold ? 700 : 500, whiteSpace: 'nowrap', color: amount < 0 ? 'success.main' : undefined }}>
        {inr(amount)}
      </Typography>
    </Stack>
  );

  return (
    <Box>
      {service.map((i) => {
        const delta = prev ? i.amount - (prev.get(i.code) ?? 0) : 0;
        return (
          <Box key={i.id ?? i.code}>
            {row(i.description, i.amount, {
              tag: (
                <>
                  {i.isEstimate && <Chip size="small" label="estimate" variant="outlined" sx={{ height: 18, fontSize: 11 }} />}
                  {i.isAdditional && <Chip size="small" color="warning" label="additional" sx={{ height: 18, fontSize: 11, ml: 0.5 }} />}
                  {prev && delta !== 0 && <Chip size="small" color={delta > 0 ? 'error' : 'success'} label={`${delta > 0 ? '+' : ''}${inr(delta)}`} sx={{ height: 18, fontSize: 11, ml: 0.5 }} />}
                </>
              ),
              sub: [i.quantity !== 1 && `${i.quantity} × ${inr(i.unitAmount)}`, i.reason && `Reason: ${i.reason}`].filter(Boolean).join(' · ') || undefined,
            })}
          </Box>
        );
      })}
      {discounts.map((i) => (
        <Box key={i.id ?? i.code}>{row(i.description, i.amount)}</Box>
      ))}
      <Divider sx={{ my: 1 }} />
      {row('Taxable value', quote.taxableValue, { muted: true })}
      {row(`GST${rules ? ` (${rules.taxRateBps / 100}%)` : ''}`, quote.taxTotal, { muted: true })}
      {pass.map((i) => (
        <Box key={i.id ?? i.code}>{row(i.description, i.amount, { muted: true, sub: 'Pass-through at actuals with receipts' })}</Box>
      ))}
      <Divider sx={{ my: 1 }} />
      {row(anyEstimate ? 'Estimated total' : 'Total', quote.total, { bold: true })}
      {compareTo && compareTo.total !== quote.total && (
        <Typography variant="caption" color={quote.total > compareTo.total ? 'error.main' : 'success.main'}>
          {quote.total > compareTo.total ? 'Increase' : 'Decrease'} of {inr(Math.abs(quote.total - compareTo.total))} vs previously approved {inr(compareTo.total)}
        </Typography>
      )}
      {showConditions && (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          {anyEstimate && <Alert severity="info">Items marked “estimate” depend on actual distance. You will be asked to approve any additional chargeable work before it is done.</Alert>}
          {quote.expiresAt && quote.status === 'PENDING_CUSTOMER_APPROVAL' && (
            <Typography variant="caption" color="text.secondary">
              Quote valid until {dateTime(quote.expiresAt)}.
            </Typography>
          )}
          {rules && (
            <Typography variant="caption" color="text.secondary">
              Includes {rules.includedKm} km towing; then {inr(rules.perKm)}/km. Waiting beyond {rules.waitingFreeMinutes} min: {inr(rules.waitingPer15Min)} per 15 min. Cancellation: {rules.cancellationPolicy.description}.
            </Typography>
          )}
          {quote.assumptions?.notes?.map((n) => (
            <Typography key={n} variant="caption" color="text.secondary">
              {n}
            </Typography>
          ))}
        </Stack>
      )}
    </Box>
  );
}
