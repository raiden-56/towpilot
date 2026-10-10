import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardContent, Chip, Divider, Grid, LinearProgress, Link, List, ListItem, ListItemIcon, ListItemText, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/CheckCircleOutline';
import BlockIcon from '@mui/icons-material/DoNotDisturbAltOutlined';
import AutorenewIcon from '@mui/icons-material/AutorenewOutlined';
import WorkspacePremiumOutlinedIcon from '@mui/icons-material/WorkspacePremiumOutlined';
import { api, ApiError } from '@/api/client';
import { ConfirmDialog, EmptyState, ErrorState, errorMessage, LoadingBlock, Money, PageHeader, PaymentChip, SectionCard } from '@/components/common';
import type { PaymentStatus } from '@/api/types';
import { useIsOnline } from '@/hooks/useOnline';
import { date, type ChipColor, humanize, inr } from '@/lib/format';
import { useToast } from './components/shared';

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  price: number;
  durationMonths: number;
  includedServices: number;
  includedKmPerService: number;
  discountBps: number;
  coveredCategoryKeys: string[];
  exclusions: string;
  renewalTerms: string;
}

type SubStatus = 'PENDING_PAYMENT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

interface Subscription {
  id: string;
  membershipId: string;
  status: SubStatus;
  startsAt: string | null;
  endsAt: string | null;
  servicesUsed: number;
  cancelledAt: string | null;
  createdAt: string;
  planSnapshot: Partial<Omit<Plan, 'id' | 'code' | 'description'>> | null;
  membership: Plan | null;
  invoice: { id: string; number: string; total: number; outstanding: number; paymentStatus: PaymentStatus } | null;
  usages: { id: string; bookingId: string; benefitAmount: number; createdAt: string; booking: { code: string } | null }[];
}

const SUB_LABELS: Record<SubStatus, string> = { PENDING_PAYMENT: 'Awaiting payment', ACTIVE: 'Active', EXPIRED: 'Expired', CANCELLED: 'Cancelled' };
const subColor = (s: SubStatus): ChipColor => (s === 'ACTIVE' ? 'success' : s === 'PENDING_PAYMENT' ? 'warning' : 'default');

const termText = (months: number) => (months === 1 ? 'month' : months === 12 ? 'year' : `${months} months`);

const isCurrent = (s: Subscription) => s.status === 'PENDING_PAYMENT' || (s.status === 'ACTIVE' && (!s.endsAt || new Date(s.endsAt) > new Date()));

function Feature({ ok = true, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <ListItem disableGutters sx={{ py: 0.25, alignItems: 'flex-start' }}>
      <ListItemIcon sx={{ minWidth: 30, mt: 0.25 }}>{ok ? <CheckIcon fontSize="small" color="success" /> : <BlockIcon fontSize="small" color="disabled" />}</ListItemIcon>
      <ListItemText primary={children} slotProps={{ primary: { variant: 'body2' } }} />
    </ListItem>
  );
}

function PlanCard({ plan, current, blockedReason, onSubscribe }: { plan: Plan; current: boolean; blockedReason: string | null; onSubscribe: () => void }) {
  const online = useIsOnline();
  const term = termText(plan.durationMonths);
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderColor: current ? 'primary.main' : undefined, borderWidth: current ? 2 : 1 }}>
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5, p: { xs: 2, sm: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Typography variant="h4" component="h3">
            {plan.name}
          </Typography>
          {current && <Chip size="small" color="primary" label="Your plan" />}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {plan.description}
        </Typography>
        <Box>
          <Typography component="span" variant="h2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {inr(plan.price, { decimals: plan.price % 100 !== 0 })}
          </Typography>
          <Typography component="span" color="text.secondary">
            {' '}
            / {term}
          </Typography>
          <Typography variant="caption" display="block" color="text.secondary">
            Valid for {plan.durationMonths} month{plan.durationMonths === 1 ? '' : 's'} from payment confirmation · Price includes GST
          </Typography>
        </Box>
        <List dense disablePadding>
          <Feature>
            {plan.includedServices} covered service{plan.includedServices === 1 ? '' : 's'} per {term}
          </Feature>
          {plan.includedKmPerService > 0 && <Feature>{plan.includedKmPerService} free km of towing per covered service</Feature>}
          {plan.discountBps > 0 && <Feature>{(plan.discountBps / 100).toLocaleString('en-IN')}% off eligible services</Feature>}
        </List>
        {plan.coveredCategoryKeys.length > 0 && (
          <Box>
            <Typography variant="overline" color="text.secondary">
              Covered services
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              {plan.coveredCategoryKeys.map((k) => (
                <Chip key={k} size="small" variant="outlined" label={humanize(k)} />
              ))}
            </Stack>
          </Box>
        )}
        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <BlockIcon fontSize="small" color="error" sx={{ mt: 0.25 }} />
            <Box>
              <Typography variant="subtitle2">Exclusions</Typography>
              <Typography variant="body2" color="text.secondary">
                {plan.exclusions}
              </Typography>
            </Box>
          </Stack>
          <Divider sx={{ my: 1.25 }} />
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <AutorenewIcon fontSize="small" color="info" sx={{ mt: 0.25 }} />
            <Box>
              <Typography variant="subtitle2">Renewal terms</Typography>
              <Typography variant="body2" color="text.secondary">
                {plan.renewalTerms}
              </Typography>
            </Box>
          </Stack>
        </Box>
        <Box sx={{ mt: 'auto', pt: 1 }}>
          <Button fullWidth size="large" variant="contained" disabled={!!blockedReason || !online} onClick={onSubscribe}>
            {current ? 'Current plan' : `Get ${plan.name}`}
          </Button>
          {(blockedReason || !online) && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75, textAlign: 'center' }}>
              {!online ? 'You are offline. Reconnect to subscribe.' : blockedReason}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

function SubscriptionCard({ sub, onCancel }: { sub: Subscription; onCancel: () => void }) {
  const snap = sub.planSnapshot ?? {};
  const name = snap.name ?? sub.membership?.name ?? 'Membership';
  const included = snap.includedServices ?? sub.membership?.includedServices ?? 0;
  const used = sub.servicesUsed;
  const cancelledActive = sub.status === 'ACTIVE' && !!sub.cancelledAt;
  const canCancel = sub.status === 'PENDING_PAYMENT' || (sub.status === 'ACTIVE' && !sub.cancelledAt);

  return (
    <SectionCard>
      <Stack spacing={1.75}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={1} alignItems="center">
            <WorkspacePremiumOutlinedIcon color="primary" />
            <Typography variant="h5" component="h3">
              {name}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            <Chip size="small" color={subColor(sub.status)} variant={sub.status === 'ACTIVE' ? 'filled' : 'outlined'} label={SUB_LABELS[sub.status]} />
            {cancelledActive && <Chip size="small" variant="outlined" label="Cancelled — will not renew" />}
          </Stack>
        </Stack>

        {sub.status === 'PENDING_PAYMENT' ? (
          <Alert
            severity="warning"
            action={
              sub.invoice ? (
                <Button color="inherit" size="small" component={RouterLink} to={`/app/billing/${sub.invoice.id}`}>
                  Pay now
                </Button>
              ) : undefined
            }
          >
            Your membership activates only after the payment is confirmed.
          </Alert>
        ) : (
          <Typography variant="body2">
            Valid {date(sub.startsAt)} – {date(sub.endsAt)}
          </Typography>
        )}
        {cancelledActive && (
          <Typography variant="body2" color="text.secondary">
            You cancelled on {date(sub.cancelledAt)}. Benefits stay available until {date(sub.endsAt)}; it will not renew.
          </Typography>
        )}

        {sub.status !== 'PENDING_PAYMENT' && included > 0 && (
          <Box>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">
                Covered services used
              </Typography>
              <Typography variant="body2" fontWeight={700}>
                {used} / {included}
              </Typography>
            </Stack>
            <LinearProgress variant="determinate" value={Math.min(100, (used / included) * 100)} sx={{ mt: 0.75, height: 8, borderRadius: 4 }} aria-label={`${used} of ${included} covered services used`} />
          </Box>
        )}

        {sub.usages.length > 0 && (
          <Box>
            <Typography variant="overline" color="text.secondary">
              Benefits used
            </Typography>
            <Stack divider={<Divider flexItem />}>
              {sub.usages.map((u) => (
                <Stack key={u.id} direction="row" justifyContent="space-between" spacing={1} sx={{ py: 0.75 }}>
                  <Link component={RouterLink} to={`/app/bookings/${u.bookingId}`} variant="body2">
                    {u.booking?.code ?? 'Booking'}
                  </Link>
                  <Typography variant="body2">
                    Saved <Money value={u.benefitAmount} strong />
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        )}

        {sub.invoice && (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" color="text.secondary">
              Invoice
            </Typography>
            <Link component={RouterLink} to={`/app/billing/${sub.invoice.id}`} variant="body2" fontWeight={600}>
              {sub.invoice.number}
            </Link>
            <PaymentChip status={sub.invoice.paymentStatus} />
          </Stack>
        )}

        {canCancel && (
          <Box>
            <Button color="error" size="small" onClick={onCancel}>
              {sub.status === 'PENDING_PAYMENT' ? 'Cancel this request' : 'Cancel membership'}
            </Button>
          </Box>
        )}
      </Stack>
    </SectionCard>
  );
}

export default function Memberships() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast, toastNode } = useToast();
  const [subscribeTo, setSubscribeTo] = useState<Plan | null>(null);
  const [cancelSub, setCancelSub] = useState<Subscription | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  const plans = useQuery({ queryKey: ['memberships', 'plans'], queryFn: () => api.get<Plan[]>('/memberships/plans') });
  const mine = useQuery({ queryKey: ['memberships', 'mine'], queryFn: () => api.get<Subscription[]>('/memberships/mine') });

  const subs = mine.data ?? [];
  const current = subs.filter(isCurrent);
  const past = subs.filter((s) => !isCurrent(s));
  const blocking = current[0] ?? null;
  const blockedReason = blocking ? (blocking.status === 'ACTIVE' ? 'You already have an active membership.' : 'You have a membership awaiting payment.') : null;

  const subscribe = useMutation({
    mutationFn: (plan: Plan) => api.post<{ subscription: { id: string }; invoice: { id: string; number: string } }>('/memberships/subscribe', { membershipId: plan.id }),
    onSuccess: (r) => {
      setSubscribeTo(null);
      void qc.invalidateQueries({ queryKey: ['memberships'] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      navigate(`/app/billing/${r.invoice.id}`, { state: { fromMembership: true } });
    },
    onError: (e) => {
      setSubscribeTo(null);
      if (e instanceof ApiError && e.status === 409) {
        setConflictMsg(`${e.message}. See your membership above${/payment/i.test(e.message) ? ' to complete the payment or cancel it' : ''}.`);
        void qc.invalidateQueries({ queryKey: ['memberships', 'mine'] });
      } else toast(errorMessage(e), 'error');
    },
  });

  const cancel = useMutation({
    mutationFn: (s: Subscription) => api.post<{ cancelled: boolean }>(`/memberships/${s.id}/cancel`),
    onSuccess: (_r, s) => {
      setCancelSub(null);
      toast(s.status === 'PENDING_PAYMENT' ? 'Request cancelled and its invoice voided.' : 'Membership cancelled. It stays valid until its end date and will not renew.');
      void qc.invalidateQueries({ queryKey: ['memberships'] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => {
      setCancelSub(null);
      toast(errorMessage(e), 'error');
      void qc.invalidateQueries({ queryKey: ['memberships', 'mine'] });
    },
  });

  return (
    <Box>
      <PageHeader title="Memberships" subtitle="Prepaid roadside cover with included services, free kilometres and discounts." />

      <Stack spacing={3}>
        {conflictMsg && (
          <Alert severity="warning" onClose={() => setConflictMsg(null)}>
            {conflictMsg}
          </Alert>
        )}

        <Box component="section" aria-labelledby="my-membership-heading">
          <Typography id="my-membership-heading" variant="h4" component="h2" sx={{ mb: 1.5 }}>
            My membership
          </Typography>
          {mine.isPending ? (
            <LoadingBlock rows={1} height={140} />
          ) : mine.isError ? (
            <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />
          ) : current.length === 0 ? (
            <SectionCard>
              <EmptyState icon={<WorkspacePremiumOutlinedIcon sx={{ fontSize: 44, opacity: 0.6 }} />} title="No active membership" body="Choose a plan below. Your membership starts as soon as the payment is confirmed." />
            </SectionCard>
          ) : (
            <Stack spacing={2}>
              {current.map((s) => (
                <SubscriptionCard key={s.id} sub={s} onCancel={() => setCancelSub(s)} />
              ))}
            </Stack>
          )}
        </Box>

        <Box component="section" aria-labelledby="plans-heading">
          <Typography id="plans-heading" variant="h4" component="h2" sx={{ mb: 1.5 }}>
            Plans
          </Typography>
          {plans.isPending ? (
            <Grid container spacing={2}>
              {[0, 1].map((i) => (
                <Grid key={i} size={{ xs: 12, md: 6 }}>
                  <LoadingBlock rows={1} height={420} />
                </Grid>
              ))}
            </Grid>
          ) : plans.isError ? (
            <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
          ) : !plans.data.length ? (
            <EmptyState title="No plans available" body="There are no membership plans available right now. Please check back later." />
          ) : (
            <Grid container spacing={2}>
              {plans.data.map((p) => (
                <Grid key={p.id} size={{ xs: 12, md: 6 }}>
                  <PlanCard plan={p} current={!!blocking && blocking.membershipId === p.id} blockedReason={mine.isPending ? 'Checking your memberships…' : mine.isError ? 'Could not check your current membership.' : blockedReason} onSubscribe={() => setSubscribeTo(p)} />
                </Grid>
              ))}
            </Grid>
          )}
        </Box>

        {past.length > 0 && (
          <Box component="section" aria-labelledby="past-heading">
            <Typography id="past-heading" variant="h4" component="h2" sx={{ mb: 1.5 }}>
              Past memberships
            </Typography>
            <Stack spacing={2}>
              {past.map((s) => (
                <SubscriptionCard key={s.id} sub={s} onCancel={() => setCancelSub(s)} />
              ))}
            </Stack>
          </Box>
        )}
      </Stack>

      <ConfirmDialog
        open={!!subscribeTo}
        title={subscribeTo ? `Get ${subscribeTo.name}?` : 'Subscribe'}
        confirmLabel={subscribe.isPending ? 'Creating invoice…' : 'Continue to payment'}
        loading={subscribe.isPending}
        onClose={() => !subscribe.isPending && setSubscribeTo(null)}
        onConfirm={() => subscribeTo && subscribe.mutate(subscribeTo)}
        body={
          subscribeTo && (
            <Stack spacing={1.5}>
              <Typography>
                {inr(subscribeTo.price)} for {subscribeTo.durationMonths} month{subscribeTo.durationMonths === 1 ? '' : 's'}.
              </Typography>
              <Alert severity="info">We create an invoice; your membership activates only after the payment is confirmed.</Alert>
              <Typography variant="body2">
                <strong>Renewal:</strong> {subscribeTo.renewalTerms}
              </Typography>
            </Stack>
          )
        }
      />

      <ConfirmDialog
        open={!!cancelSub}
        danger
        title={cancelSub?.status === 'PENDING_PAYMENT' ? 'Cancel membership request?' : 'Cancel membership?'}
        confirmLabel={cancel.isPending ? 'Cancelling…' : 'Yes, cancel'}
        loading={cancel.isPending}
        onClose={() => !cancel.isPending && setCancelSub(null)}
        onConfirm={() => cancelSub && cancel.mutate(cancelSub)}
        body={
          cancelSub?.status === 'PENDING_PAYMENT'
            ? 'Your membership has not started yet. Cancelling voids its unpaid invoice, so nothing will be due.'
            : `Your membership stays valid until ${date(cancelSub?.endsAt)} and you keep its benefits until then. It will not renew. This does not trigger a refund.`
        }
      />
      {toastNode}
    </Box>
  );
}
