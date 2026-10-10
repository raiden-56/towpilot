import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Chip, Divider, Grid, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { EmptyState, ErrorState, KpiCard, LoadingBlock, Money, PageHeader, SectionCard } from '@/components/common';
import { date, dateTime, inr } from '@/lib/format';
import type { EarningKind, EarningsResponse } from './components/driverShared';

const PERIODS = [
  ['today', 'Today'],
  ['this_week', 'This week'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['this_fy', 'This FY'],
] as const;
type Period = (typeof PERIODS)[number][0];

const KIND_LABELS: Record<EarningKind, string> = { JOB_FIXED: 'Job payment', JOB_COMMISSION: 'Job commission', INCENTIVE: 'Incentive', DEDUCTION: 'Deduction', REIMBURSEMENT: 'Reimbursement' };
const PAYOUT_COLORS = { DRAFT: 'default', APPROVED: 'info', PAID: 'success', CANCELLED: 'default' } as const;
const SALARY_TEXT = { ACCRUED: 'Owed — not yet paid', APPROVED: 'Approved — payment pending', PAID: 'Paid', CANCELLED: 'Cancelled' } as const;
const SALARY_COLORS = { ACCRUED: 'warning', APPROVED: 'info', PAID: 'success', CANCELLED: 'default' } as const;

/** Range end is exclusive on the server; show the last included day. */
const rangeText = (r: { from: string; to: string }) => `${date(r.from)} – ${date(new Date(new Date(r.to).getTime() - 1))}`;

export default function DriverEarnings() {
  const [period, setPeriod] = useState<Period>('this_month');
  const q = useQuery({ queryKey: ['driver', 'earnings', period], queryFn: () => api.get<EarningsResponse>('/driver/earnings', { period }), placeholderData: keepPreviousData });
  const d = q.data;

  return (
    <>
      <PageHeader title="Earnings" subtitle={d ? rangeText(d.range) : 'Your own earnings, payouts and salary records'} />
      <ToggleButtonGroup
        exclusive
        value={period}
        onChange={(_, v: Period | null) => v && setPeriod(v)}
        aria-label="Period"
        sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1, '& .MuiToggleButtonGroup-grouped': { border: 2, borderColor: 'divider', borderRadius: '10px !important', m: 0, flex: '1 1 auto' } }}
      >
        {PERIODS.map(([v, l]) => (
          <ToggleButton key={v} value={v} sx={{ minHeight: 48, fontWeight: 700, px: 1.5 }}>
            {l}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <LoadingBlock rows={4} height={88} />
      ) : (
        <Stack spacing={2} sx={{ opacity: q.isFetching && q.isPlaceholderData ? 0.6 : 1 }}>
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12 }}>
              <KpiCard label="Job earnings" value={inr(d.totals.jobEarnings)} hint={`${d.jobs.completed} completed · ${d.jobs.cancelled} cancelled / released`} definition="Per-job pay and commission earned in this period, before incentives and deductions." />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <KpiCard label="Incentives" value={inr(d.totals.incentives)} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <KpiCard label="Deductions" value={d.totals.deductions ? `−${inr(Math.abs(d.totals.deductions))}` : inr(0)} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <KpiCard label="Reimbursements" value={inr(d.totals.reimbursements)} definition="Approved expense claims paid back to you." />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <KpiCard label="Pending payout" value={inr(d.totals.pendingPayout)} definition="All earnings not yet included in a payout (any period)." />
            </Grid>
          </Grid>

          <SectionCard title="Earning lines">
            {d.lines.length === 0 ? (
              <EmptyState title="No earnings in this period" body="Earnings are added when a job you worked on is closed." />
            ) : (
              <Stack divider={<Divider />}>
                {d.lines.map((l) => (
                  <Stack key={l.id} direction="row" justifyContent="space-between" spacing={1} sx={{ py: 1 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700 }}>
                        {KIND_LABELS[l.kind] ?? l.kind}
                        {l.booking && l.bookingId && (
                          <>
                            {' · '}
                            <Box component={RouterLink} to={`/driver/jobs/${l.bookingId}`} sx={{ color: 'primary.main' }}>
                              {l.booking.code}
                            </Box>
                          </>
                        )}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {dateTime(l.earnedAt)}
                        {l.note && l.note !== l.booking?.code ? ` · ${l.note}` : ''}
                      </Typography>
                    </Box>
                    <Stack alignItems="flex-end" sx={{ flexShrink: 0 }}>
                      <Typography sx={{ fontWeight: 800 }} color={l.amount < 0 ? 'error.main' : undefined}>
                        <Money value={l.amount} />
                      </Typography>
                      <Chip size="small" label={l.status === 'PENDING' ? 'Pending payout' : 'In payout'} color={l.status === 'PENDING' ? 'warning' : 'success'} variant="outlined" />
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            )}
          </SectionCard>

          <SectionCard title="Payouts">
            {d.payouts.length === 0 ? (
              <Typography color="text.secondary">No payouts yet.</Typography>
            ) : (
              <Stack divider={<Divider />}>
                {d.payouts.map((p) => (
                  <Box key={p.id} sx={{ py: 1 }}>
                    <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                      <Typography sx={{ fontWeight: 700 }}>
                        {date(p.periodStart)} – {date(p.periodEnd)}
                      </Typography>
                      <Typography sx={{ fontWeight: 900, fontSize: '1.1rem' }}>
                        <Money value={p.netAmount} />
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                      <Chip size="small" label={p.status.toLowerCase()} color={PAYOUT_COLORS[p.status]} />
                      <Typography variant="body2" color="text.secondary">
                        Jobs {inr(p.earningsAmount)} + incentives {inr(p.incentivesAmount)} + reimbursements {inr(p.reimbursementsAmount)} − deductions {inr(p.deductionsAmount)}
                      </Typography>
                    </Stack>
                    {p.paidAt && (
                      <Typography variant="body2" color="text.secondary">
                        Paid {dateTime(p.paidAt)}
                        {p.paymentRef ? ` · Ref ${p.paymentRef}` : ''}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            )}
          </SectionCard>

          <SectionCard title="Salary">
            {d.salary.length === 0 ? (
              <Typography color="text.secondary">No salary records. Salary applies only to salaried staff.</Typography>
            ) : (
              <Stack divider={<Divider />}>
                {d.salary.map((s) => (
                  <Box key={s.id} sx={{ py: 1 }}>
                    <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                      <Typography sx={{ fontWeight: 700 }}>
                        {date(s.periodStart)} – {date(s.periodEnd)}
                      </Typography>
                      <Typography sx={{ fontWeight: 900, fontSize: '1.1rem' }}>
                        <Money value={s.netAmount} />
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                      <Chip size="small" label={SALARY_TEXT[s.status]} color={SALARY_COLORS[s.status]} />
                      <Typography variant="body2" color="text.secondary">
                        Base {inr(s.baseAmount)} + incentives {inr(s.incentives)} − deductions {inr(s.deductions)}
                      </Typography>
                    </Stack>
                    {s.paidAt && (
                      <Typography variant="body2" color="text.secondary">
                        Paid {dateTime(s.paidAt)}
                        {s.paymentRef ? ` · Ref ${s.paymentRef}` : ''}
                      </Typography>
                    )}
                    {s.notes && (
                      <Typography variant="body2" color="text.secondary">
                        {s.notes}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            )}
          </SectionCard>
          <Alert severity="info">Spotted a mistake? Raise a ticket from your Profile page and finance will review it.</Alert>
        </Stack>
      )}
    </>
  );
}
