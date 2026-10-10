import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Grid, TextField } from '@mui/material';
import { ApiError } from '@/api/client';
import { FormDialog, numOpt, rupees, RupeeField } from './shared';
import type { FleetAccountRow } from './types';

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

const schema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(120),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || GSTIN_RE.test(v), 'Invalid GSTIN (format: 22AAAAA0000A1Z5)'),
  billingEmail: z.string().trim().email('Enter a valid email'),
  billingPhone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^(\+?91)?[6-9]\d{9}$/.test(v.replace(/[\s-]/g, '')), 'Enter a 10-digit Indian mobile number'),
  billingAddress: z.string().trim().max(500),
  creditLimit: z.number({ error: 'Enter a credit limit (0 for none)' }).min(0).max(100_000_000),
  paymentTermsDays: z.number({ error: 'Enter payment terms' }).int('Whole days only').min(0).max(120),
});
export type AccountFormValues = z.infer<typeof schema>;

/** Create / edit dialog for a business (fleet) account. Credit limit is entered in rupees. */
export function AccountFormDialog({ open, onClose, initial, onSubmit, submitting, error }: { open: boolean; onClose: () => void; initial?: Partial<FleetAccountRow> | null; onSubmit: (body: Record<string, unknown>) => void; submitting?: boolean; error?: unknown }) {
  const { register, handleSubmit, reset, setError, formState } = useForm<AccountFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', gstin: '', billingEmail: '', billingPhone: '', billingAddress: '', creditLimit: 0, paymentTermsDays: 30 },
  });
  useEffect(() => {
    if (open)
      reset({
        name: initial?.name ?? '',
        gstin: initial?.gstin ?? '',
        billingEmail: initial?.billingEmail ?? '',
        billingPhone: initial?.billingPhone ?? '',
        billingAddress: initial?.billingAddress ?? '',
        creditLimit: rupees(initial?.creditLimit) ?? 0,
        paymentTermsDays: initial?.paymentTermsDays ?? 30,
      });
  }, [open, initial, reset]);
  useEffect(() => {
    if (error instanceof ApiError) for (const [k, m] of Object.entries(error.fieldErrors)) setError(k as keyof AccountFormValues, { message: m });
  }, [error, setError]);
  const e = formState.errors;
  return (
    <FormDialog
      open={open}
      title={initial?.id ? 'Edit business account' : 'New business account'}
      onClose={onClose}
      submitting={submitting}
      submitLabel={initial?.id ? 'Save changes' : 'Create account'}
      error={error}
      onSubmit={handleSubmit((v) =>
        onSubmit({
          name: v.name,
          ...(v.gstin ? { gstin: v.gstin.toUpperCase() } : initial?.id && initial.gstin ? { gstin: null } : {}),
          billingEmail: v.billingEmail,
          ...(v.billingPhone ? { billingPhone: v.billingPhone } : {}),
          ...(v.billingAddress ? { billingAddress: v.billingAddress } : {}),
          creditLimit: v.creditLimit,
          paymentTermsDays: v.paymentTermsDays,
        }),
      )}
    >
      <Grid container spacing={2}>
        <Grid size={12}>
          <TextField label="Legal / trading name" fullWidth required {...register('name')} error={!!e.name} helperText={e.name?.message} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="GSTIN" fullWidth {...register('gstin')} error={!!e.gstin} helperText={e.gstin?.message ?? 'Optional; printed on corporate invoices'} slotProps={{ htmlInput: { maxLength: 15, style: { textTransform: 'uppercase' } } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Billing email" type="email" fullWidth required {...register('billingEmail')} error={!!e.billingEmail} helperText={e.billingEmail?.message} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Billing phone" fullWidth {...register('billingPhone')} error={!!e.billingPhone} helperText={e.billingPhone?.message ?? 'Optional'} slotProps={{ htmlInput: { inputMode: 'tel' } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Payment terms (days)" type="number" fullWidth required {...register('paymentTermsDays', numOpt)} error={!!e.paymentTermsDays} helperText={e.paymentTermsDays?.message ?? 'Invoice due date = issue date + terms'} slotProps={{ htmlInput: { min: 0, max: 120 } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <RupeeField label="Credit limit" fullWidth required {...register('creditLimit', numOpt)} error={!!e.creditLimit} helperText={e.creditLimit?.message ?? 'Maximum unpaid balance allowed'} />
        </Grid>
        <Grid size={12}>
          <TextField label="Billing address" fullWidth multiline minRows={2} {...register('billingAddress')} error={!!e.billingAddress} helperText={e.billingAddress?.message} />
        </Grid>
      </Grid>
    </FormDialog>
  );
}
