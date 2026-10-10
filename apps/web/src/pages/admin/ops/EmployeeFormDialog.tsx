import { useEffect } from 'react';
import { Controller, useForm, type Control, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  Grid,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
  type TextFieldProps,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { errorMessage } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { humanize } from '@/lib/format';
import { EMPLOYEE_ROLES, EMPLOYMENT_TYPES, OFFICE_ROLES, PAY_FREQUENCIES, ROLE_LABELS, toDateInput, useZones, type Notify } from './shared';
import type { Employee } from './types';

const PHONE_RE = /^(\+?91)?[6-9]\d{9}$/;
const cleanPhone = (v: string) => v.replace(/[\s-]/g, '');
const money = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0), `${label}: enter rupees with up to 2 decimals`);

const base = z.object({
  fullName: z.string().trim().min(2, 'Enter the full name').max(100),
  phone: z
    .string()
    .trim()
    .refine((v) => PHONE_RE.test(cleanPhone(v)), 'Enter a 10-digit Indian mobile number'),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email'),
  password: z.string(),
  roles: z.array(z.enum(EMPLOYEE_ROLES)),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  payFrequency: z.enum(['', ...PAY_FREQUENCIES]),
  baseSalary: money('Base salary'),
  commissionPct: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 100), 'Commission must be 0–100%'),
  perJobAmount: money('Per-job amount'),
  partnerCompany: z.string().trim().max(100),
  zoneIds: z.array(z.string()),
  skills: z.string().max(800),
  emergencyContactName: z.string().trim().max(100),
  emergencyContactPhone: z
    .string()
    .trim()
    .refine((v) => v === '' || PHONE_RE.test(cleanPhone(v)), 'Enter a 10-digit Indian mobile number'),
  payoutMethod: z.enum(['', 'BANK', 'UPI', 'CASH']),
  payoutDetails: z.string().trim().max(60),
  licenceNumber: z.string().trim().max(20),
  licenceClass: z.string().trim().max(40),
  licenceExpiry: z.string(),
  heavyVehicleCert: z.boolean(),
  canLeadTeam: z.boolean(),
});
type Values = z.infer<typeof base>;

function schemaFor(mode: 'create' | 'edit', hasDriverProfile: boolean) {
  return base.superRefine((v, ctx) => {
    const isDriver = mode === 'create' ? v.roles.includes('driver') : hasDriverProfile;
    if (mode === 'create') {
      if (!v.roles.length) ctx.addIssue({ code: 'custom', path: ['roles'], message: 'Pick at least one role' });
      if (v.roles.some((r) => OFFICE_ROLES.includes(r))) {
        if (!v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Office staff sign in with email' });
        if (v.password.length < 10) ctx.addIssue({ code: 'custom', path: ['password'], message: 'At least 10 characters' });
      }
      if (isDriver) {
        if (v.licenceNumber.length < 6) ctx.addIssue({ code: 'custom', path: ['licenceNumber'], message: 'Licence number is required for drivers (6–20 characters)' });
        if (!v.licenceClass) ctx.addIssue({ code: 'custom', path: ['licenceClass'], message: 'Licence class is required (e.g. LMV, HMV)' });
        if (!v.licenceExpiry) ctx.addIssue({ code: 'custom', path: ['licenceExpiry'], message: 'Licence expiry is required' });
      }
    } else if (v.licenceNumber && v.licenceNumber.length < 6) ctx.addIssue({ code: 'custom', path: ['licenceNumber'], message: '6–20 characters' });
    if (v.employmentType === 'SALARIED' && mode === 'create' && !v.baseSalary) ctx.addIssue({ code: 'custom', path: ['baseSalary'], message: 'Salaried employees need a base salary' });
    if (v.employmentType === 'COMMISSION' && mode === 'create' && !v.commissionPct) ctx.addIssue({ code: 'custom', path: ['commissionPct'], message: 'Enter the commission rate' });
    if (v.employmentType === 'JOB_BASED' && mode === 'create' && !v.perJobAmount) ctx.addIssue({ code: 'custom', path: ['perJobAmount'], message: 'Enter the per-job amount' });
    if (v.employmentType === 'PARTNER' && !v.partnerCompany) ctx.addIssue({ code: 'custom', path: ['partnerCompany'], message: 'Enter the partner company' });
  });
}

const empty: Values = {
  fullName: '',
  phone: '',
  email: '',
  password: '',
  roles: ['driver'],
  employmentType: 'SALARIED',
  payFrequency: 'MONTHLY',
  baseSalary: '',
  commissionPct: '',
  perJobAmount: '',
  partnerCompany: '',
  zoneIds: [],
  skills: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  payoutMethod: '',
  payoutDetails: '',
  licenceNumber: '',
  licenceClass: '',
  licenceExpiry: '',
  heavyVehicleCert: false,
  canLeadTeam: false,
};

function fromEmployee(e: Employee): Values {
  const w = e.workerProfile;
  return {
    ...empty,
    fullName: e.fullName,
    phone: e.phone ?? '',
    email: e.email ?? '',
    roles: e.roles.filter((r): r is Values['roles'][number] => (EMPLOYEE_ROLES as readonly string[]).includes(r)),
    employmentType: w?.employmentType ?? 'SALARIED',
    payFrequency: w?.payFrequency ?? '',
    baseSalary: w?.baseSalary != null ? String(w.baseSalary / 100) : '',
    commissionPct: w?.commissionBps != null ? String(w.commissionBps / 100) : '',
    perJobAmount: w?.perJobAmount != null ? String(w.perJobAmount / 100) : '',
    partnerCompany: w?.partnerCompany ?? '',
    zoneIds: w?.zones.map((z) => z.id) ?? [],
    skills: w?.skills.join(', ') ?? '',
    emergencyContactName: w?.emergencyContactName ?? '',
    emergencyContactPhone: w?.emergencyContactPhone ?? '',
    payoutMethod: w?.payoutMethod ?? '',
    licenceClass: e.driverProfile?.licenceClass ?? '',
    licenceExpiry: toDateInput(e.driverProfile?.licenceExpiry),
    heavyVehicleCert: e.driverProfile?.heavyVehicleCert ?? false,
    canLeadTeam: e.driverProfile?.canLeadTeam ?? false,
  };
}

function toPayload(v: Values, mode: 'create' | 'edit', showComp: boolean, hasDriver: boolean) {
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  const num = (s: string) => (s.trim() ? Number(s) : undefined);
  const isDriver = mode === 'create' ? v.roles.includes('driver') : hasDriver;
  const body: Record<string, unknown> = {
    fullName: v.fullName.trim(),
    phone: cleanPhone(v.phone),
    email: opt(v.email)?.toLowerCase(),
    employmentType: v.employmentType,
    payFrequency: v.payFrequency || undefined,
    partnerCompany: opt(v.partnerCompany),
    zoneIds: v.zoneIds,
    skills: v.skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20),
    emergencyContactName: opt(v.emergencyContactName),
    emergencyContactPhone: v.emergencyContactPhone ? cleanPhone(v.emergencyContactPhone) : undefined,
    payoutMethod: v.payoutMethod || undefined,
    payoutDetails: opt(v.payoutDetails),
  };
  if (showComp) {
    // Rupees: the API converts to paise.
    body.baseSalary = num(v.baseSalary);
    body.commissionPct = num(v.commissionPct);
    body.perJobAmount = num(v.perJobAmount);
  }
  if (isDriver) {
    body.licenceNumber = opt(v.licenceNumber);
    body.licenceClass = opt(v.licenceClass);
    body.licenceExpiry = v.licenceExpiry ? new Date(`${v.licenceExpiry}T00:00:00`).toISOString() : undefined;
    body.heavyVehicleCert = v.heavyVehicleCert;
    if (mode === 'edit') body.canLeadTeam = v.canLeadTeam;
  }
  if (mode === 'create') {
    body.roles = v.roles;
    if (v.password) body.password = v.password;
  }
  return body;
}

function TF({ control, name, label, ...props }: { control: Control<Values>; name: FieldPath<Values>; label: string } & Omit<TextFieldProps, 'name'>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          {...field}
          value={(field.value as string | undefined) ?? ''}
          label={label}
          size="small"
          fullWidth
          {...props}
          error={!!fieldState.error}
          helperText={fieldState.error?.message ?? props.helperText}
        />
      )}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mt: 2.5 }}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      <Grid container spacing={2} sx={{ mt: 0.25 }}>
        {children}
      </Grid>
    </Box>
  );
}

/** Create or edit an employee. Money fields are entered in rupees; commission as a percentage. */
export function EmployeeFormDialog({ open, onClose, employee, notify, onSaved }: { open: boolean; onClose: () => void; employee?: Employee | null; notify: Notify; onSaved?: (e: Employee) => void }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const { can, hasRole } = useAuth();
  const qc = useQueryClient();
  const zones = useZones();
  const mode = employee ? 'edit' : 'create';
  const hasDriver = !!employee?.driverProfile;
  const showComp = mode === 'create' || employee?.workerProfile?.baseSalary !== undefined;
  const form = useForm<Values>({ resolver: zodResolver(schemaFor(mode, hasDriver)), defaultValues: empty });
  const { control, handleSubmit, reset, watch, setError, formState } = form;

  useEffect(() => {
    if (open) reset(employee ? fromEmployee(employee) : empty);
    // Reset only when opening, so background refetches don't wipe edits in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (employee ? api.patch<Employee>(`/admin/employees/${employee.id}`, body) : api.post<Employee>('/admin/employees', body)),
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
      notify(employee ? 'Employee updated' : `${e.fullName} added${e.workerProfile?.verificationStatus === 'PENDING' ? ' — upload and approve documents to verify them' : ''}`);
      onSaved?.(e);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) for (const [k, m] of Object.entries(err.fieldErrors)) if (k in empty) setError(k as keyof Values, { message: m });
    },
  });

  const roles = watch('roles');
  const employment = watch('employmentType');
  const isDriver = mode === 'create' ? roles.includes('driver') : hasDriver;
  const office = mode === 'create' && roles.some((r) => OFFICE_ROLES.includes(r));

  return (
    <Dialog open={open} onClose={save.isPending ? undefined : onClose} fullWidth maxWidth="md" fullScreen={phone}>
      <DialogTitle>{employee ? `Edit ${employee.fullName}` : 'Add employee'}</DialogTitle>
      <DialogContent dividers>
        <form id="employee-form" noValidate onSubmit={handleSubmit((v) => save.mutate(toPayload(v, mode, showComp, hasDriver)))}>
          {save.error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {errorMessage(save.error)}
            </Alert>
          )}
          <Section title="Identity">
            <Grid size={{ xs: 12, sm: 6 }}>
              <TF control={control} name="fullName" label="Full name" required />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TF control={control} name="phone" label="Mobile number" required placeholder="98765 43210" helperText="10-digit mobile; +91 is added automatically" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TF control={control} name="email" label={office ? 'Email (sign-in)' : 'Email (optional)'} type="email" required={office} />
            </Grid>
            {mode === 'create' && office && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <TF control={control} name="password" label="Initial password" type="password" required helperText="At least 10 characters. Share it securely; ask them to change it." autoComplete="new-password" />
              </Grid>
            )}
          </Section>

          {mode === 'create' && (
            <Section title="Roles">
              <Grid size={12}>
                <Controller
                  control={control}
                  name="roles"
                  render={({ field, fieldState }) => (
                    <>
                      <FormGroup row>
                        {EMPLOYEE_ROLES.map((r) => {
                          const disabled = r === 'admin' && !hasRole('admin');
                          return (
                            <FormControlLabel
                              key={r}
                              disabled={disabled}
                              control={<Checkbox checked={field.value.includes(r)} onChange={(e) => field.onChange(e.target.checked ? [...field.value, r] : field.value.filter((x) => x !== r))} />}
                              label={ROLE_LABELS[r]}
                            />
                          );
                        })}
                      </FormGroup>
                      <FormHelperText error={!!fieldState.error}>{fieldState.error?.message ?? 'Field roles (driver, recovery worker) start as pending verification. Office roles are verified on creation.'}</FormHelperText>
                    </>
                  )}
                />
              </Grid>
            </Section>
          )}

          <Section title="Employment & compensation rules">
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TF control={control} name="employmentType" label="Employment type" select>
                {EMPLOYMENT_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {humanize(t)}
                  </MenuItem>
                ))}
              </TF>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TF control={control} name="payFrequency" label="Pay frequency" select>
                <MenuItem value="">Not set</MenuItem>
                {PAY_FREQUENCIES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {humanize(t)}
                  </MenuItem>
                ))}
              </TF>
            </Grid>
            {employment === 'PARTNER' && (
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <TF control={control} name="partnerCompany" label="Partner company" required />
              </Grid>
            )}
            {showComp ? (
              <>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TF control={control} name="baseSalary" label="Base salary" inputMode="decimal" slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> } }} helperText="Per pay period, in rupees" />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TF control={control} name="commissionPct" label="Commission" inputMode="decimal" slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }} helperText="Share of job revenue" />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TF control={control} name="perJobAmount" label="Per-job amount" inputMode="decimal" slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> } }} helperText="Fixed amount per completed job" />
                </Grid>
                <Grid size={12}>
                  <Typography variant="caption" color="text.secondary">
                    These are the pay rules used to compute obligations. Actual salary records and payouts are created and paid in Payroll.
                  </Typography>
                </Grid>
              </>
            ) : (
              <Grid size={12}>
                <Alert severity="info">Compensation is visible only to staff with employee-management or payroll permission.</Alert>
              </Grid>
            )}
          </Section>

          <Section title="Zones & skills">
            <Grid size={{ xs: 12, md: 6 }}>
              <Controller
                control={control}
                name="zoneIds"
                render={({ field }) => (
                  <Autocomplete
                    multiple
                    size="small"
                    options={(zones.data ?? []).map((z) => z.id)}
                    getOptionLabel={(id) => zones.data?.find((z) => z.id === id)?.name ?? id}
                    value={field.value}
                    onChange={(_, v) => field.onChange(v)}
                    loading={zones.isLoading}
                    renderInput={(p) => <TextField {...p} label="Authorised service zones" helperText="Dispatch only offers jobs in these zones" />}
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TF control={control} name="skills" label="Skills" helperText="Comma-separated, e.g. flatbed, winching, EV handling" />
            </Grid>
          </Section>

          <Section title="Emergency contact & payout">
            <Grid size={{ xs: 12, sm: 6 }}>
              <TF control={control} name="emergencyContactName" label="Emergency contact name" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TF control={control} name="emergencyContactPhone" label="Emergency contact phone" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TF control={control} name="payoutMethod" label="Payout method" select>
                <MenuItem value="">Not set</MenuItem>
                <MenuItem value="BANK">Bank transfer</MenuItem>
                <MenuItem value="UPI">UPI</MenuItem>
                <MenuItem value="CASH">Cash</MenuItem>
              </TF>
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TF
                control={control}
                name="payoutDetails"
                label="Account / UPI ID"
                helperText={employee?.workerProfile?.payoutDetailsMasked ? `On file: ${employee.workerProfile.payoutDetailsMasked}. Leave blank to keep it.` : 'Stored masked; only the last characters are kept visible.'}
              />
            </Grid>
          </Section>

          {isDriver && (
            <Section title="Driving licence">
              <Grid size={{ xs: 12, sm: 4 }}>
                <TF control={control} name="licenceNumber" label="Licence number" required={mode === 'create'} helperText={employee?.driverProfile ? `On file: ${employee.driverProfile.licenceNumberMask}. Leave blank to keep it.` : 'Stored masked'} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TF control={control} name="licenceClass" label="Licence class" required={mode === 'create'} placeholder="LMV, MGV, HMV" />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TF control={control} name="licenceExpiry" label="Licence expiry" type="date" required={mode === 'create'} slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={12}>
                <Controller control={control} name="heavyVehicleCert" render={({ field }) => <FormControlLabel control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Heavy-vehicle certification (required for LCV/HCV recoveries)" />} />
                {mode === 'edit' && <Controller control={control} name="canLeadTeam" render={({ field }) => <FormControlLabel control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Can lead a recovery team" />} />}
              </Grid>
            </Section>
          )}
          {!can('employee:manage') && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              You need employee-management permission to save changes.
            </Alert>
          )}
          {Object.keys(formState.errors).length > 0 && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Fix the highlighted fields.
            </Alert>
          )}
        </form>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" form="employee-form" variant="contained" disabled={save.isPending || !can('employee:manage')}>
          {save.isPending ? 'Saving…' : employee ? 'Save changes' : 'Add employee'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
