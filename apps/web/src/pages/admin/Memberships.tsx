import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Card, CardActions, CardContent, Chip, Divider, FormControlLabel, Grid, LinearProgress, MenuItem, Stack, Switch, Tab, TablePagination, Tabs, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { api } from '@/api/client';
import { EmptyState, ErrorState, LoadingBlock, Money, PageHeader, PaymentChip, SectionCard } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { date } from '@/lib/format';
import type { PlanRow, SubscriptionRow } from './biz/types';
import { EnumChip, FilterBar, FormDialog, MultiSelect, numOpt, rupees, RupeeField, SimpleTable, useTabParam, useToast } from './biz/shared';
import { useCategories } from './biz/queries';

const schema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,30}$/, '3–30 capital letters, digits or underscores'),
  name: z.string().trim().min(2, 'At least 2 characters').max(80),
  description: z.string().max(1000),
  price: z.number({ error: 'Enter a price' }).min(0),
  durationMonths: z.number().refine((v) => [1, 3, 6, 12].includes(v), 'Use 1, 3, 6 or 12 months'),
  includedServices: z.number({ error: 'Required' }).int().min(0).max(50),
  includedKmPerService: z.number({ error: 'Required' }).min(0).max(200),
  discountPct: z.number({ error: 'Required' }).min(0).max(50, 'Maximum 50%'),
  coveredCategoryKeys: z.array(z.string()).min(1, 'Pick at least one covered service'),
  exclusions: z.string().trim().min(3, 'List exclusions (at least 3 characters)').max(2000),
  renewalTerms: z.string().trim().min(3, 'State the renewal terms').max(1000),
  forFleet: z.boolean(),
  active: z.boolean(),
});
type Values = z.infer<typeof schema>;

function PlanDialog({ open, plan, onClose, onSaved }: { open: boolean; plan: PlanRow | null; onClose: () => void; onSaved: (m: string) => void }) {
  const cats = useCategories(open);
  const { register, handleSubmit, reset, control, formState } = useForm<Values>({ resolver: zodResolver(schema) });
  const save = useMutation({
    mutationFn: (v: Values) => {
      if (plan) {
        const { code: _c, ...rest } = v;
        void _c;
        return api.patch(`/admin/pricing/memberships/${plan.id}`, rest);
      }
      return api.post('/admin/pricing/memberships', v);
    },
    onSuccess: () => onSaved(plan ? 'Plan updated' : 'Plan created'),
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    reset(
      plan
        ? { code: plan.code, name: plan.name, description: plan.description, price: rupees(plan.price)!, durationMonths: plan.durationMonths, includedServices: plan.includedServices, includedKmPerService: plan.includedKmPerService, discountPct: plan.discountBps / 100, coveredCategoryKeys: plan.coveredCategoryKeys, exclusions: plan.exclusions, renewalTerms: plan.renewalTerms, forFleet: plan.forFleet, active: plan.active }
        : { code: '', name: '', description: '', price: 0, durationMonths: 12, includedServices: 1, includedKmPerService: 0, discountPct: 0, coveredCategoryKeys: [], exclusions: '', renewalTerms: 'Does not auto-renew. Renew any time before expiry.', forFleet: false, active: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan]);
  const e = formState.errors;
  return (
    <FormDialog
      open={open}
      title={plan ? `Edit plan: ${plan.name}` : 'New membership plan'}
      onClose={onClose}
      onSubmit={handleSubmit((v) => save.mutate(v))}
      submitting={save.isPending}
      error={save.error}
      maxWidth="md"
      submitLabel={plan ? 'Save plan' : 'Create plan'}
      intro={plan && plan._count.subscriptions > 0 ? <Alert severity="info">{plan._count.subscriptions} existing subscriber(s) keep the plan terms they bought (snapshot). Changes apply to new subscriptions only.</Alert> : undefined}
    >
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField label="Plan code" fullWidth required disabled={!!plan} {...register('code')} error={!!e.code} helperText={e.code?.message ?? (plan ? 'Codes cannot change' : 'Permanent, e.g. ROADSAFE_ANNUAL')} slotProps={{ htmlInput: { style: { textTransform: 'uppercase' } } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 8 }}>
          <TextField label="Plan name" fullWidth required {...register('name')} error={!!e.name} helperText={e.name?.message} />
        </Grid>
        <Grid size={12}>
          <TextField label="Description" fullWidth multiline minRows={2} {...register('description')} error={!!e.description} helperText={e.description?.message} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <RupeeField label="Price (incl. GST)" fullWidth required {...register('price', numOpt)} error={!!e.price} helperText={e.price?.message} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Controller control={control} name="durationMonths" render={({ field }) => (
            <TextField select label="Duration" fullWidth value={field.value ?? 12} onChange={(ev) => field.onChange(Number(ev.target.value))} error={!!e.durationMonths} helperText={e.durationMonths?.message}>
              {[1, 3, 6, 12].map((m) => <MenuItem key={m} value={m}>{m === 12 ? '12 months (annual)' : `${m} month${m > 1 ? 's' : ''}`}</MenuItem>)}
            </TextField>
          )} />
        </Grid>
        <Grid size={{ xs: 6, sm: 2 }}>
          <TextField label="Included services" type="number" fullWidth {...register('includedServices', numOpt)} error={!!e.includedServices} helperText={e.includedServices?.message} slotProps={{ htmlInput: { min: 0, max: 50 } }} />
        </Grid>
        <Grid size={{ xs: 6, sm: 2 }}>
          <TextField label="Free km / service" type="number" fullWidth {...register('includedKmPerService', numOpt)} error={!!e.includedKmPerService} helperText={e.includedKmPerService?.message} slotProps={{ htmlInput: { min: 0, max: 200, step: 0.5 } }} />
        </Grid>
        <Grid size={{ xs: 6, sm: 2 }}>
          <TextField label="Discount %" type="number" fullWidth {...register('discountPct', numOpt)} error={!!e.discountPct} helperText={e.discountPct?.message ?? 'Beyond included'} slotProps={{ htmlInput: { min: 0, max: 50, step: 0.5 } }} />
        </Grid>
        <Grid size={12}>
          <Controller control={control} name="coveredCategoryKeys" render={({ field }) => (
            <MultiSelect label="Covered services *" options={(cats.data ?? []).map((c) => ({ value: c.key, label: c.name }))} value={field.value ?? []} onChange={field.onChange} error={!!e.coveredCategoryKeys} helperText={e.coveredCategoryKeys?.message} />
          )} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField label="Exclusions" fullWidth required multiline minRows={3} {...register('exclusions')} error={!!e.exclusions} helperText={e.exclusions?.message ?? 'Shown to customers before purchase'} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField label="Renewal terms" fullWidth required multiline minRows={3} {...register('renewalTerms')} error={!!e.renewalTerms} helperText={e.renewalTerms?.message} />
        </Grid>
        <Grid size={12}>
          <Controller control={control} name="forFleet" render={({ field }) => <FormControlLabel control={<Switch checked={!!field.value} onChange={(ev) => field.onChange(ev.target.checked)} />} label="Fleet / business plan" />} />
          <Controller control={control} name="active" render={({ field }) => <FormControlLabel control={<Switch checked={!!field.value} onChange={(ev) => field.onChange(ev.target.checked)} />} label="Available for purchase" />} />
        </Grid>
      </Grid>
    </FormDialog>
  );
}

const TABS = ['plans', 'subscriptions'] as const;

export default function Memberships() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can('membership:manage');
  const { toast, toastNode } = useToast();
  const [tab, setTab] = useTabParam(TABS, 'plans');
  const [edit, setEdit] = useState<{ plan: PlanRow | null } | null>(null);
  const [subStatus, setSubStatus] = useState('');
  const [subPage, setSubPage] = useState(1);
  const [subPageSize, setSubPageSize] = useState(20);
  const plans = useQuery({ queryKey: ['admin', 'pricing', 'memberships'], queryFn: () => api.get<PlanRow[]>('/admin/pricing/memberships') });
  const subs = useQuery({
    queryKey: ['admin', 'pricing', 'subscriptions', { subStatus, subPage, subPageSize }],
    queryFn: () => api.page<SubscriptionRow>('/admin/pricing/subscriptions', { status: subStatus || undefined, page: subPage, pageSize: subPageSize }),
    enabled: tab === 'subscriptions',
    placeholderData: keepPreviousData,
  });
  const cats = useCategories();
  const catName = (k: string) => cats.data?.find((c) => c.key === k)?.name ?? k;


  return (
    <Box>
      <PageHeader
        title="Memberships"
        subtitle="Prepaid roadside plans and their subscribers"
        actions={canManage && tab === 'plans' && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEdit({ plan: null })}>New plan</Button>}
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="plans" label="Plans" />
        <Tab value="subscriptions" label="Subscriptions" />
      </Tabs>

      {tab === 'plans' &&
        (plans.isLoading ? <LoadingBlock /> : plans.error ? <ErrorState error={plans.error} onRetry={() => void plans.refetch()} /> : !plans.data?.length ? (
          <SectionCard><EmptyState title="No membership plans" body="Create a plan customers can buy for prepaid roadside cover." /></SectionCard>
        ) : (
          <Grid container spacing={2}>
            {plans.data.map((p) => (
              <Grid key={p.id} size={{ xs: 12, md: 6, xl: 4 }}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', opacity: p.active ? 1 : 0.75 }}>
                  <CardContent sx={{ flex: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                      <Box>
                        <Typography variant="h5">{p.name}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{p.code}</Typography>
                      </Box>
                      <Stack direction="row" spacing={0.5}>
                        {p.forFleet && <Chip size="small" label="Fleet" color="info" variant="outlined" />}
                        <EnumChip value={p.active ? 'ACTIVE' : 'INACTIVE'} label={p.active ? 'On sale' : 'Not on sale'} />
                      </Stack>
                    </Stack>
                    <Typography variant="h3" sx={{ mt: 1.5, fontVariantNumeric: 'tabular-nums' }}>
                      <Money value={p.price} />
                      <Typography component="span" color="text.secondary" variant="body2"> / {p.durationMonths === 12 ? 'year' : `${p.durationMonths} mo`}</Typography>
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{p.description}</Typography>
                    <Divider sx={{ my: 1.5 }} />
                    <Stack spacing={0.5}>
                      <Typography variant="body2"><strong>{p.includedServices}</strong> included service{p.includedServices === 1 ? '' : 's'}{p.includedKmPerService ? `, ${p.includedKmPerService} free km each` : ''}</Typography>
                      <Typography variant="body2"><strong>{p.discountBps / 100}%</strong> off beyond included services</Typography>
                      <Typography variant="body2"><strong>{p._count.subscriptions}</strong> subscription{p._count.subscriptions === 1 ? '' : 's'}</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                      {p.coveredCategoryKeys.map((k) => <Chip key={k} size="small" variant="outlined" label={catName(k)} />)}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}><strong>Exclusions:</strong> {p.exclusions}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block"><strong>Renewal:</strong> {p.renewalTerms}</Typography>
                  </CardContent>
                  {canManage && (
                    <CardActions sx={{ px: 2, pb: 2 }}>
                      <Button size="small" variant="outlined" onClick={() => setEdit({ plan: p })}>Edit plan</Button>
                    </CardActions>
                  )}
                </Card>
              </Grid>
            ))}
          </Grid>
        ))}

      {tab === 'subscriptions' && (
        <SectionCard>
          <FilterBar>
            <TextField select size="small" label="Status" value={subStatus} onChange={(e) => { setSubStatus(e.target.value); setSubPage(1); }} sx={{ minWidth: 180 }}>
              <MenuItem value="">All statuses</MenuItem>
              <MenuItem value="PENDING_PAYMENT">Pending payment</MenuItem>
              <MenuItem value="ACTIVE">Active</MenuItem>
              <MenuItem value="EXPIRED">Expired</MenuItem>
              <MenuItem value="CANCELLED">Cancelled</MenuItem>
            </TextField>
          </FilterBar>
          {subs.isLoading ? <LoadingBlock /> : subs.error ? <ErrorState error={subs.error} onRetry={() => void subs.refetch()} /> : (
            <>
              <SimpleTable
                rows={subs.data?.data}
                rowKey={(s) => s.id}
                empty={subStatus ? 'No subscriptions with this status.' : 'No subscriptions yet.'}
                minWidth={900}
                columns={[
                  { key: 'who', header: 'Subscriber', render: (s) => (<><Typography variant="body2" sx={{ fontWeight: 600 }}>{s.fleetAccount?.name ?? s.user?.fullName ?? '—'}</Typography><Typography variant="caption" color="text.secondary">{s.fleetAccount ? 'Business account' : s.user?.phone}</Typography></>) },
                  { key: 'p', header: 'Plan', render: (s) => s.membership.name },
                  { key: 'st', header: 'Status', render: (s) => <EnumChip value={s.status} /> },
                  { key: 'per', header: 'Period', render: (s) => (s.startsAt ? `${date(s.startsAt)} – ${date(s.endsAt)}` : 'Starts on payment'), nowrap: true },
                  {
                    key: 'use',
                    header: 'Usage',
                    render: (s) => {
                      const inc = s.planSnapshot?.includedServices ?? null;
                      return (
                        <Box sx={{ minWidth: 110 }}>
                          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.servicesUsed}{inc != null ? ` of ${inc}` : ''} used</Typography>
                          {inc ? <LinearProgress variant="determinate" value={Math.min(100, (s.servicesUsed / inc) * 100)} sx={{ height: 4, borderRadius: 2 }} /> : null}
                        </Box>
                      );
                    },
                  },
                  { key: 'inv', header: 'Invoice', render: (s) => (s.invoice ? (<Stack spacing={0.5} alignItems="flex-start"><Typography variant="caption">{s.invoice.number}</Typography><PaymentChip status={s.invoice.paymentStatus} /></Stack>) : '—') },
                  { key: 'c', header: 'Created', render: (s) => date(s.createdAt), nowrap: true },
                ]}
              />
              <TablePagination component="div" count={subs.data?.meta.total ?? 0} page={subPage - 1} rowsPerPage={subPageSize} onPageChange={(_, p) => setSubPage(p + 1)} onRowsPerPageChange={(e) => { setSubPageSize(Number(e.target.value)); setSubPage(1); }} rowsPerPageOptions={[10, 20, 50, 100]} />
            </>
          )}
        </SectionCard>
      )}
      <PlanDialog open={!!edit} plan={edit?.plan ?? null} onClose={() => setEdit(null)} onSaved={(m) => { toast(m); setEdit(null); void qc.invalidateQueries({ queryKey: ['admin', 'pricing', 'memberships'] }); }} />
      {toastNode}
    </Box>
  );
}
