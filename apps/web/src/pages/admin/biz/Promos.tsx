import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Grid, Switch, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { api } from '@/api/client';
import { ConfirmDialog, ErrorState, LoadingBlock, Money, SectionCard } from '@/components/common';
import { date } from '@/lib/format';
import type { PromoRow } from './types';
import { addDaysInput, EnumChip, FormDialog, localDateToIso, numOpt, RupeeField, SimpleTable, todayInput } from './shared';

const schema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, '4–20 letters or digits, no spaces'),
    description: z.string().trim().min(3, 'Describe the offer').max(200),
    discountPct: z.number({ error: 'Required' }).min(1, 'At least 1%').max(100),
    maxDiscount: z.number({ error: 'Required' }).min(0),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
    validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
    maxUses: z.number().int().positive().optional(),
  })
  .refine((v) => v.validTo > v.validFrom, { path: ['validTo'], message: 'Must be after the start date' });
type Values = z.infer<typeof schema>;

function PromoDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit, reset, formState } = useForm<Values>({ resolver: zodResolver(schema) });
  const save = useMutation({ mutationFn: (v: Values) => api.post('/admin/pricing/promo-codes', { ...v, validFrom: localDateToIso(v.validFrom), validTo: localDateToIso(addDaysInput(v.validTo, 1)) }), onSuccess: onSaved });
  useEffect(() => {
    if (open) {
      save.reset();
      reset({ code: '', description: '', discountPct: 10, maxDiscount: 300, validFrom: todayInput(), validTo: addDaysInput(todayInput(), 30), maxUses: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const e = formState.errors;
  return (
    <FormDialog open={open} title="New promo code" onClose={onClose} onSubmit={handleSubmit((v) => save.mutate(v))} submitting={save.isPending} error={save.error} submitLabel="Create promo code">
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 5 }}>
          <TextField label="Code" fullWidth required {...register('code')} error={!!e.code} helperText={e.code?.message} slotProps={{ htmlInput: { style: { textTransform: 'uppercase' } } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 7 }}>
          <TextField label="Description" fullWidth required {...register('description')} error={!!e.description} helperText={e.description?.message ?? 'Shown to customers'} />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <TextField label="Discount %" type="number" fullWidth required {...register('discountPct', numOpt)} error={!!e.discountPct} helperText={e.discountPct?.message ?? 'On service charges'} slotProps={{ htmlInput: { min: 1, max: 100 } }} />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <RupeeField label="Maximum discount" fullWidth required {...register('maxDiscount', numOpt)} error={!!e.maxDiscount} helperText={e.maxDiscount?.message ?? 'Cap per booking'} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField label="Maximum uses" type="number" fullWidth {...register('maxUses', numOpt)} error={!!e.maxUses} helperText={e.maxUses?.message ?? 'Blank = unlimited'} slotProps={{ htmlInput: { min: 1 } }} />
        </Grid>
        <Grid size={{ xs: 6 }}>
          <TextField label="Valid from" type="date" fullWidth required {...register('validFrom')} error={!!e.validFrom} helperText={e.validFrom?.message} slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
        <Grid size={{ xs: 6 }}>
          <TextField label="Valid until (inclusive)" type="date" fullWidth required {...register('validTo')} error={!!e.validTo} helperText={e.validTo?.message} slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
      </Grid>
    </FormDialog>
  );
}

export function PromosTab({ canManage, toast, toastError }: { canManage: boolean; toast: (m: string) => void; toastError: (e: unknown) => void }) {
  const qc = useQueryClient();
  const promos = useQuery({ queryKey: ['admin', 'pricing', 'promo-codes'], queryFn: () => api.get<PromoRow[]>('/admin/pricing/promo-codes') });
  const [open, setOpen] = useState(false);
  const [toggle, setToggle] = useState<PromoRow | null>(null);
  const set = useMutation({
    mutationFn: (p: PromoRow) => api.patch(`/admin/pricing/promo-codes/${p.id}`, { active: !p.active }),
    onSuccess: (_d, p) => {
      toast(p.active ? `${p.code} deactivated` : `${p.code} activated`);
      setToggle(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'pricing', 'promo-codes'] });
    },
    onError: toastError,
  });
  if (promos.isLoading) return <LoadingBlock />;
  if (promos.error) return <ErrorState error={promos.error} onRetry={() => void promos.refetch()} />;
  const now = Date.now();
  return (
    <SectionCard title="Promo codes" action={canManage && <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setOpen(true)}>New promo code</Button>}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Promo discounts reduce the taxable value; GST is charged on the discounted amount.</Typography>
      <SimpleTable
        rows={promos.data}
        rowKey={(p) => p.id}
        empty="No promo codes."
        minWidth={820}
        columns={[
          { key: 'c', header: 'Code', render: (p) => (<><Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>{p.code}</Typography><Typography variant="caption" color="text.secondary">{p.description}</Typography></>) },
          { key: 'd', header: 'Discount', align: 'right', render: (p) => `${p.discountBps / 100}%` },
          { key: 'm', header: 'Max discount', align: 'right', render: (p) => <Money value={p.maxDiscount} /> },
          { key: 'v', header: 'Validity', render: (p) => `${date(p.validFrom)} – ${date(new Date(new Date(p.validTo).getTime() - 1))}`, nowrap: true },
          { key: 'u', header: 'Used', align: 'right', render: (p) => `${p.usedCount}${p.maxUses ? ` / ${p.maxUses}` : ''}` },
          { key: 's', header: 'Status', render: (p) => (!p.active ? <EnumChip value="INACTIVE" /> : new Date(p.validTo).getTime() < now ? <EnumChip value="EXPIRED" /> : new Date(p.validFrom).getTime() > now ? <EnumChip value="SCHEDULED" color="info" /> : <EnumChip value="ACTIVE" />) },
          { key: 'a', header: 'Active', align: 'right', render: (p) => (canManage ? <Switch size="small" checked={p.active} onChange={() => setToggle(p)} slotProps={{ input: { 'aria-label': `Toggle ${p.code}` } }} /> : p.active ? 'Yes' : 'No') },
        ]}
      />
      <PromoDialog open={open} onClose={() => setOpen(false)} onSaved={() => { toast('Promo code created'); setOpen(false); void qc.invalidateQueries({ queryKey: ['admin', 'pricing', 'promo-codes'] }); }} />
      <ConfirmDialog
        open={!!toggle}
        title={toggle?.active ? `Deactivate ${toggle.code}?` : `Activate ${toggle?.code}?`}
        body={toggle?.active ? 'Customers will no longer be able to apply this code. Quotes that already used it are unaffected.' : 'Customers will be able to apply this code within its validity period.'}
        confirmLabel={toggle?.active ? 'Deactivate' : 'Activate'}
        danger={toggle?.active}
        loading={set.isPending}
        onClose={() => setToggle(null)}
        onConfirm={() => toggle && set.mutate(toggle)}
      />
    </SectionCard>
  );
}
