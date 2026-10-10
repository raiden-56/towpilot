import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Card, Checkbox, Chip, FormControlLabel, Grid, IconButton, LinearProgress, Link, MenuItem, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined';
import { api, ApiError } from '@/api/client';
import { ConfirmDialog, ErrorState, KeyValue, LoadingBlock, Money, PageHeader, PaymentChip, SampleTag, SectionCard } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { date, humanize, inr, VEHICLE_CLASS_LABELS } from '@/lib/format';
import { AGEING_KEYS, AGEING_LABELS, type FleetAccountDetail, type FleetContract, type VehicleRow } from './biz/types';
import { BackLink, daysPastDue, EnumChip, FormDialog, numOpt, SimpleTable, toDateInput, localDateToIso, useTabParam, useToast, num } from './biz/shared';
import { AccountFormDialog } from './biz/AccountForm';

const TABS = ['overview', 'members', 'vehicles', 'contracts', 'invoices'] as const;
type TabKey = (typeof TABS)[number];

const contractSchema = z
  .object({
    name: z.string().trim().min(2, 'At least 2 characters').max(120),
    startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date'),
    endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick an end date'),
    discountPct: z.number({ error: 'Enter a discount (0 for none)' }).min(0).max(60, 'Maximum 60%'),
    slaResponseMinutes: z.number().int().positive().max(600).optional(),
    monthlyServiceLimit: z.number().int().positive().optional(),
    notes: z.string().max(2000),
    active: z.boolean(),
  })
  .refine((v) => v.endsAt > v.startsAt, { path: ['endsAt'], message: 'End must be after start' });
type ContractValues = z.infer<typeof contractSchema>;

function ContractDialog({ open, onClose, contract, accountId, onSaved }: { open: boolean; onClose: () => void; contract: FleetContract | null; accountId: string; onSaved: (msg: string) => void }) {
  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<ContractValues>({ resolver: zodResolver(contractSchema) });
  useEffect(() => {
    if (!open) return;
    const today = toDateInput(new Date());
    reset(
      contract
        ? { name: contract.name, startsAt: toDateInput(contract.startsAt), endsAt: toDateInput(contract.endsAt), discountPct: contract.discountBps / 100, slaResponseMinutes: contract.slaResponseMinutes ?? undefined, monthlyServiceLimit: contract.monthlyServiceLimit ?? undefined, notes: contract.notes ?? '', active: contract.active }
        : { name: '', startsAt: today, endsAt: toDateInput(new Date(Date.now() + 365 * 86_400_000)), discountPct: 0, slaResponseMinutes: undefined, monthlyServiceLimit: undefined, notes: '', active: true },
    );
  }, [open, contract, reset]);
  const save = useMutation({
    mutationFn: (v: ContractValues) => {
      const body = { ...v, startsAt: localDateToIso(v.startsAt), endsAt: localDateToIso(v.endsAt), notes: v.notes };
      return contract ? api.patch(`/admin/fleet-accounts/${accountId}/contracts/${contract.id}`, body) : api.post(`/admin/fleet-accounts/${accountId}/contracts`, body);
    },
    onSuccess: () => onSaved(contract ? 'Contract updated' : 'Contract created'),
  });
  useEffect(() => {
    if (open) save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const e = formState.errors;
  return (
    <FormDialog open={open} title={contract ? 'Edit contract' : 'New contract'} onClose={onClose} onSubmit={handleSubmit((v) => save.mutate(v))} submitting={save.isPending} error={save.error} submitLabel={contract ? 'Save contract' : 'Create contract'}
      intro={<Typography variant="body2" color="text.secondary">The contract discount applies to new quotes for this account’s bookings while the contract is active. Existing quotes and invoices are not changed.</Typography>}
    >
      <Grid container spacing={2}>
        <Grid size={12}>
          <TextField label="Contract name" fullWidth required {...register('name')} error={!!e.name} helperText={e.name?.message} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Starts" type="date" fullWidth required {...register('startsAt')} error={!!e.startsAt} helperText={e.startsAt?.message} slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Ends" type="date" fullWidth required {...register('endsAt')} error={!!e.endsAt} helperText={e.endsAt?.message} slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField label="Discount %" type="number" fullWidth required {...register('discountPct', numOpt)} error={!!e.discountPct} helperText={e.discountPct?.message ?? 'On service charges'} slotProps={{ htmlInput: { step: 0.5, min: 0, max: 60 } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField label="SLA response (min)" type="number" fullWidth {...register('slaResponseMinutes', numOpt)} error={!!e.slaResponseMinutes} helperText={e.slaResponseMinutes?.message ?? 'Optional'} slotProps={{ htmlInput: { min: 1, max: 600 } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField label="Monthly service limit" type="number" fullWidth {...register('monthlyServiceLimit', numOpt)} error={!!e.monthlyServiceLimit} helperText={e.monthlyServiceLimit?.message ?? 'Optional; bookings / month'} slotProps={{ htmlInput: { min: 1 } }} />
        </Grid>
        <Grid size={12}>
          <TextField label="Notes" fullWidth multiline minRows={2} {...register('notes')} error={!!e.notes} helperText={e.notes?.message} />
        </Grid>
        <Grid size={12}>
          <FormControlLabel control={<Switch checked={!!watch('active')} onChange={(ev) => setValue('active', ev.target.checked)} />} label="Active" />
        </Grid>
      </Grid>
    </FormDialog>
  );
}

function AddMemberDialog({ open, onClose, accountId, onSaved }: { open: boolean; onClose: () => void; accountId: string; onSaved: (m: string) => void }) {
  const [phone, setPhone] = useState('');
  const [isManager, setIsManager] = useState(false);
  const add = useMutation({ mutationFn: () => api.post(`/admin/fleet-accounts/${accountId}/members`, { phone: phone.trim(), isManager }), onSuccess: () => onSaved('Member added') });
  useEffect(() => {
    if (open) {
      setPhone('');
      setIsManager(false);
      add.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const valid = /^(\+?91)?[6-9]\d{9}$/.test(phone.replace(/[\s-]/g, ''));
  return (
    <FormDialog open={open} title="Add member" onClose={onClose} onSubmit={() => add.mutate()} submitting={add.isPending} submitDisabled={!valid} error={add.error} submitLabel="Add member" maxWidth="xs"
      intro={<Typography variant="body2" color="text.secondary">The person must already have a TowPilot customer account. Their bookings can then be billed to this business.</Typography>}
    >
      <Stack spacing={2}>
        <TextField autoFocus label="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} required fullWidth error={!!phone && !valid} helperText={phone && !valid ? 'Enter a 10-digit Indian mobile number' : 'e.g. 98765 43210'} slotProps={{ htmlInput: { inputMode: 'tel' } }} />
        <FormControlLabel control={<Checkbox checked={isManager} onChange={(e) => setIsManager(e.target.checked)} />} label="Fleet manager (can book for the account’s vehicles)" />
      </Stack>
    </FormDialog>
  );
}

export default function BusinessAccountDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { toast, toastError, toastNode } = useToast();
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'overview');
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<{ userId: string; name: string } | null>(null);
  const [detachVehicle, setDetachVehicle] = useState<VehicleRow | null>(null);
  const [contractEdit, setContractEdit] = useState<{ contract: FleetContract | null } | null>(null);
  const [attachId, setAttachId] = useState('');
  const canManage = can('customer:manage');
  const canContracts = can('membership:manage');

  const q = useQuery({ queryKey: ['admin', 'fleet-account', id], queryFn: () => api.get<FleetAccountDetail>(`/admin/fleet-accounts/${id}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet-account', id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet-accounts'] });
  };

  // Members' vehicles (for attaching existing vehicles to corporate billing).
  const memberIds = q.data?.members.map((m) => m.userId) ?? [];
  const memberDetails = useQueries({
    queries: canManage && tab === 'vehicles' ? memberIds.map((uid) => ({ queryKey: ['admin', 'customer', uid], queryFn: () => api.get<{ id: string; fullName: string; vehicles: VehicleRow[] }>(`/admin/customers/${uid}`) })) : [],
  });
  const attachable = useMemo(() => memberDetails.flatMap((m) => (m.data ? m.data.vehicles.filter((v) => v.fleetAccountId !== id).map((v) => ({ ...v, ownerName: m.data!.fullName })) : [])), [memberDetails, id]);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/admin/fleet-accounts/${id}`, body),
    onSuccess: () => {
      toast('Account updated');
      setEditOpen(false);
      setStatusOpen(false);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.del(`/admin/fleet-accounts/${id}/members/${userId}`),
    onSuccess: () => {
      toast('Member removed');
      setRemoveMember(null);
      refresh();
    },
    onError: toastError,
  });
  const toggleManager = useMutation({
    mutationFn: (m: { phone: string; isManager: boolean }) => api.post(`/admin/fleet-accounts/${id}/members`, m),
    onSuccess: () => {
      toast('Member role updated');
      refresh();
    },
    onError: toastError,
  });
  const detach = useMutation({
    mutationFn: (vehicleId: string) => api.del(`/admin/fleet-accounts/${id}/vehicles/${vehicleId}`),
    onSuccess: () => {
      toast('Vehicle detached; future bookings bill the owner personally');
      setDetachVehicle(null);
      refresh();
      memberIds.forEach((uid) => void qc.invalidateQueries({ queryKey: ['admin', 'customer', uid] }));
    },
    onError: toastError,
  });
  const attach = useMutation({
    mutationFn: (vehicleId: string) => api.post(`/admin/fleet-accounts/${id}/vehicles`, { vehicleId }),
    onSuccess: () => {
      toast('Vehicle attached to corporate billing');
      setAttachId('');
      refresh();
      memberIds.forEach((uid) => void qc.invalidateQueries({ queryKey: ['admin', 'customer', uid] }));
    },
    onError: toastError,
  });

  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error('Account not found')} onRetry={() => void q.refetch()} />;
  const a = q.data;
  const now = Date.now();
  const outstanding = AGEING_KEYS.reduce((s, k) => s + (a.ageing[k] ?? 0), 0);
  const overdue = outstanding - (a.ageing.current ?? 0);
  const activeContract = a.contracts.find((c) => c.active && new Date(c.startsAt).getTime() <= now && new Date(c.endsAt).getTime() > now) ?? null;
  const limit = activeContract?.monthlyServiceLimit ?? null;
  const usagePct = limit ? Math.min(100, (a.usageThisMonth / limit) * 100) : null;
  const creditPct = a.creditLimit > 0 ? (outstanding / a.creditLimit) * 100 : null;

  return (
    <Box>
      <PageHeader
        back={<BackLink to="/admin/accounts" label="Business accounts" />}
        title={
          <>
            {a.name}
            <SampleTag show={a.isSample} />
          </>
        }
        subtitle={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap component="span">
            <EnumChip value={a.status} />
            {a.gstin && <span>GSTIN {a.gstin}</span>}
            <span>Net {a.paymentTermsDays} days</span>
          </Stack>
        }
        actions={
          canManage && (
            <>
              <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => { update.reset(); setEditOpen(true); }}>
                Edit
              </Button>
              <Button variant="outlined" color={a.status === 'ACTIVE' ? 'warning' : 'primary'} onClick={() => { update.reset(); setStatusOpen(true); }}>
                {a.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
              </Button>
            </>
          )
        }
      />
      {a.status === 'SUSPENDED' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This account is suspended. Members cannot bill new bookings to it until it is reactivated.
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">Outstanding</Typography>
            <Typography variant="h4" sx={num}>{inr(outstanding)}</Typography>
            <Typography variant="caption" color={overdue > 0 ? 'error.main' : 'text.secondary'}>
              {overdue > 0 ? `${inr(overdue)} overdue` : 'Nothing overdue'}
            </Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">Credit used</Typography>
            <Typography variant="h4" sx={num}>{creditPct == null ? 'No limit' : `${creditPct.toFixed(0)}%`}</Typography>
            {creditPct != null && <LinearProgress variant="determinate" value={Math.min(100, creditPct)} color={creditPct > 100 ? 'error' : creditPct > 80 ? 'warning' : 'primary'} sx={{ my: 0.75, height: 6, borderRadius: 3 }} />}
            <Typography variant="caption" color="text.secondary">Limit {inr(a.creditLimit)}</Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">Usage this month</Typography>
            <Typography variant="h4" sx={num}>
              {a.usageThisMonth}
              {limit ? <Typography component="span" color="text.secondary"> / {limit}</Typography> : null}
            </Typography>
            {usagePct != null && <LinearProgress variant="determinate" value={usagePct} color={a.usageThisMonth >= (limit ?? Infinity) ? 'error' : usagePct > 80 ? 'warning' : 'primary'} sx={{ my: 0.75, height: 6, borderRadius: 3 }} />}
            <Typography variant="caption" color="text.secondary">{limit ? 'Confirmed bookings vs contract monthly limit' : 'No monthly limit on the active contract'}</Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">Active contract</Typography>
            <Typography variant="h6" noWrap>{activeContract?.name ?? 'None'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {activeContract ? `${activeContract.discountBps / 100}% discount${activeContract.slaResponseMinutes ? ` · SLA ${activeContract.slaResponseMinutes} min` : ''} · until ${date(activeContract.endsAt)}` : 'Standard rates apply'}
            </Typography>
          </Card>
        </Grid>
      </Grid>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="overview" label="Overview" />
        <Tab value="members" label={`Members (${a.members.length})`} />
        <Tab value="vehicles" label={`Vehicles (${a.vehicles.length})`} />
        <Tab value="contracts" label={`Contracts (${a.contracts.length})`} />
        <Tab value="invoices" label={`Invoices (${a.invoices.length})`} />
      </Tabs>

      {tab === 'overview' && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 5 }}>
            <SectionCard title="Billing details">
              <KeyValue label="Billing email" value={a.billingEmail} />
              <KeyValue label="Billing phone" value={a.billingPhone ?? '—'} />
              <KeyValue label="Billing address" value={a.billingAddress ?? '—'} />
              <KeyValue label="GSTIN" value={a.gstin ?? '—'} />
              <KeyValue label="Payment terms" value={`${a.paymentTermsDays} days`} />
              <KeyValue label="Credit limit" value={<Money value={a.creditLimit} />} />
              <KeyValue label="Created" value={date(a.createdAt)} />
            </SectionCard>
            {a.subscriptions.length > 0 && (
              <SectionCard title="Fleet memberships" sx={{ mt: 2 }}>
                <SimpleTable rows={a.subscriptions} rowKey={(s) => s.id} columns={[{ key: 'p', header: 'Plan', render: (s) => s.membership.name }, { key: 's', header: 'Status', render: (s) => <EnumChip value={s.status} /> }, { key: 'e', header: 'Ends', render: (s) => date(s.endsAt) }, { key: 'u', header: 'Used', align: 'right', render: (s) => s.servicesUsed }]} />
              </SectionCard>
            )}
          </Grid>
          <Grid size={{ xs: 12, md: 7 }}>
            <SectionCard title="Receivables ageing">
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Outstanding balance on issued invoices, bucketed by days past the due date (issue date + {a.paymentTermsDays} days).
              </Typography>
              <Stack spacing={1.25}>
                {AGEING_KEYS.map((k) => {
                  const v = a.ageing[k] ?? 0;
                  const pct = outstanding ? (v / outstanding) * 100 : 0;
                  return (
                    <Box key={k}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="body2">{AGEING_LABELS[k]}</Typography>
                        <Typography variant="body2" sx={{ ...num, fontWeight: 600 }}>{inr(v)}</Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={pct} color={k === 'current' ? 'info' : k === '1-30' ? 'warning' : 'error'} sx={{ height: 6, borderRadius: 3, mt: 0.5 }} aria-label={`${AGEING_LABELS[k]} ${pct.toFixed(0)}%`} />
                    </Box>
                  );
                })}
              </Stack>
              <Stack direction="row" justifyContent="space-between" sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Total outstanding</Typography>
                <Typography variant="body2" sx={{ ...num, fontWeight: 700 }}>{inr(outstanding)}</Typography>
              </Stack>
            </SectionCard>
          </Grid>
        </Grid>
      )}

      {tab === 'members' && (
        <SectionCard
          title="Members"
          action={canManage && <Button size="small" startIcon={<AddIcon />} onClick={() => setMemberOpen(true)}>Add member</Button>}
        >
          <SimpleTable
            rows={a.members}
            rowKey={(m) => m.userId}
            empty="No members yet. Add the people who book on behalf of this business."
            columns={[
              { key: 'n', header: 'Name', render: (m) => <Link component={RouterLink} to={`/admin/customers/${m.userId}`}>{m.user.fullName}</Link> },
              { key: 'p', header: 'Phone', render: (m) => m.user.phone ?? '—', nowrap: true },
              {
                key: 'r',
                header: 'Fleet manager',
                render: (m) =>
                  canManage && m.user.phone ? (
                    <Switch size="small" checked={m.isManager} disabled={toggleManager.isPending} onChange={(e) => toggleManager.mutate({ phone: m.user.phone!, isManager: e.target.checked })} slotProps={{ input: { 'aria-label': `Fleet manager: ${m.user.fullName}` } }} />
                  ) : m.isManager ? (
                    'Yes'
                  ) : (
                    'No'
                  ),
              },
              { key: 'd', header: 'Added', render: (m) => date(m.createdAt) },
              {
                key: 'x',
                header: '',
                align: 'right',
                render: (m) =>
                  canManage && (
                    <Tooltip title="Remove from account">
                      <IconButton size="small" onClick={() => setRemoveMember({ userId: m.userId, name: m.user.fullName })} aria-label={`Remove ${m.user.fullName}`}>
                        <PersonRemoveOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ),
              },
            ]}
          />
        </SectionCard>
      )}

      {tab === 'vehicles' && (
        <Stack spacing={2}>
          {canManage && (
            <SectionCard title="Attach a member’s vehicle">
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Bookings for attached vehicles are billed to {a.name}. Only vehicles owned by members of this account can be attached.
              </Typography>
              {memberDetails.some((m) => m.isLoading) ? (
                <LinearProgress />
              ) : attachable.length === 0 ? (
                <Typography variant="body2" color="text.secondary">All member vehicles are already attached{a.members.length ? '' : ' (add members first)'}.</Typography>
              ) : (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField select size="small" label="Vehicle" value={attachId} onChange={(e) => setAttachId(e.target.value)} sx={{ minWidth: 320 }}>
                    {attachable.map((v) => (
                      <MenuItem key={v.id} value={v.id}>
                        {v.registrationNumber} · {v.make} {v.model} — {v.ownerName}
                        {v.fleetAccountId ? ' (billed to another account)' : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button variant="contained" disabled={!attachId || attach.isPending} onClick={() => attach.mutate(attachId)}>
                    Attach vehicle
                  </Button>
                </Stack>
              )}
            </SectionCard>
          )}
          <SectionCard title="Corporate vehicles">
            <SimpleTable
              rows={a.vehicles}
              rowKey={(v) => v.id}
              empty="No vehicles attached."
              columns={[
                { key: 'r', header: 'Registration', render: (v) => <strong>{v.registrationNumber}</strong>, nowrap: true },
                { key: 'm', header: 'Make & model', render: (v) => `${v.make} ${v.model}` },
                { key: 'c', header: 'Class', render: (v) => VEHICLE_CLASS_LABELS[v.vehicleClass] ?? v.vehicleClass },
                { key: 'f', header: 'Fuel', render: (v) => humanize(v.fuelType) },
                { key: 'o', header: 'Owner', render: (v) => { const m = a.members.find((x) => x.userId === v.ownerUserId); return m ? <Link component={RouterLink} to={`/admin/customers/${m.userId}`}>{m.user.fullName}</Link> : <Link component={RouterLink} to={`/admin/customers/${v.ownerUserId}`}>View owner</Link>; } },
                { key: 'x', header: '', align: 'right', render: (v) => canManage && <Button size="small" color="error" onClick={() => setDetachVehicle(v)}>Detach</Button> },
              ]}
            />
          </SectionCard>
        </Stack>
      )}

      {tab === 'contracts' && (
        <SectionCard title="Contracts" action={canContracts && <Button size="small" startIcon={<AddIcon />} onClick={() => setContractEdit({ contract: null })}>New contract</Button>}>
          <SimpleTable
            rows={a.contracts}
            rowKey={(c) => c.id}
            empty="No contracts. Without a contract, standard rate cards apply."
            minWidth={760}
            columns={[
              { key: 'n', header: 'Contract', render: (c) => (<><Typography variant="body2" sx={{ fontWeight: 600 }}>{c.name}</Typography>{c.notes && <Typography variant="caption" color="text.secondary">{c.notes}</Typography>}</>) },
              { key: 'p', header: 'Period', render: (c) => `${date(c.startsAt)} – ${date(c.endsAt)}`, nowrap: true },
              { key: 'd', header: 'Discount', align: 'right', render: (c) => `${c.discountBps / 100}%` },
              { key: 's', header: 'SLA', align: 'right', render: (c) => (c.slaResponseMinutes ? `${c.slaResponseMinutes} min` : '—') },
              { key: 'l', header: 'Monthly limit', align: 'right', render: (c) => c.monthlyServiceLimit ?? '—' },
              { key: 'rc', header: 'Contract rate cards', render: (c) => (c.rateCards?.length ? c.rateCards.map((r) => <Chip key={r.id} size="small" label={r.name} sx={{ mr: 0.5 }} />) : '—') },
              { key: 'a', header: 'Status', render: (c) => (c.active ? (new Date(c.endsAt).getTime() < now ? <EnumChip value="EXPIRED" /> : <EnumChip value="ACTIVE" />) : <EnumChip value="INACTIVE" />) },
              { key: 'e', header: '', align: 'right', render: (c) => canContracts && <IconButton size="small" aria-label={`Edit ${c.name}`} onClick={() => setContractEdit({ contract: c })}><EditOutlinedIcon fontSize="small" /></IconButton> },
            ]}
          />
        </SectionCard>
      )}

      {tab === 'invoices' && (
        <SectionCard title="Corporate invoices (latest 100)">
          <SimpleTable
            rows={a.invoices}
            rowKey={(i) => i.id}
            empty="No invoices billed to this account yet."
            onRowClick={can('finance:read') ? (i) => nav(`/admin/finance/invoices/${i.id}`) : undefined}
            minWidth={820}
            columns={[
              { key: 'n', header: 'Invoice', render: (i) => (can('finance:read') ? <Link component={RouterLink} to={`/admin/finance/invoices/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.number}</Link> : i.number), nowrap: true },
              { key: 'd', header: 'Issued', render: (i) => date(i.issuedAt), nowrap: true },
              { key: 'due', header: 'Due', render: (i) => date(i.dueAt), nowrap: true },
              { key: 't', header: 'Total', align: 'right', render: (i) => <Money value={i.total} /> },
              { key: 'p', header: 'Paid', align: 'right', render: (i) => <Money value={i.amountPaid} /> },
              { key: 'o', header: 'Outstanding', align: 'right', render: (i) => <Money value={i.outstanding} strong={i.outstanding > 0} /> },
              { key: 'age', header: 'Overdue', align: 'right', render: (i) => { const d = i.status === 'ISSUED' && i.outstanding > 0 ? daysPastDue(i.dueAt, i.issuedAt) : 0; return d > 0 ? <Typography variant="body2" color={d > 30 ? 'error.main' : 'warning.main'} sx={num}>{d} days</Typography> : '—'; } },
              { key: 's', header: 'Status', render: (i) => (i.status === 'VOID' ? <EnumChip value="VOID" /> : <PaymentChip status={i.paymentStatus} />) },
            ]}
          />
        </SectionCard>
      )}

      <AccountFormDialog open={editOpen} onClose={() => setEditOpen(false)} initial={a} onSubmit={(b) => update.mutate(b)} submitting={update.isPending} error={update.error} />
      <ConfirmDialog
        open={statusOpen}
        title={a.status === 'ACTIVE' ? 'Suspend business account?' : 'Reactivate business account?'}
        body={a.status === 'ACTIVE' ? 'Members will not be able to bill new bookings to this account. Existing invoices remain payable.' : 'Members will be able to bill bookings to this account again.'}
        confirmLabel={a.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
        danger={a.status === 'ACTIVE'}
        loading={update.isPending}
        onClose={() => setStatusOpen(false)}
        requireReason
        onConfirm={(reason) => update.mutate({ status: a.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE', reason })}
      >
        {update.error != null && <Alert severity="error" sx={{ mt: 2 }}>{update.error instanceof ApiError ? update.error.message : 'Update failed'}</Alert>}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!detachVehicle}
        title="Detach vehicle?"
        body={`${detachVehicle?.registrationNumber ?? ''} will no longer be billed to ${a.name}. New bookings for it are billed to the owner personally; existing invoices are unchanged.`}
        confirmLabel="Detach"
        danger
        loading={detach.isPending}
        onClose={() => setDetachVehicle(null)}
        onConfirm={() => detachVehicle && detach.mutate(detachVehicle.id)}
      />
      <ConfirmDialog
        open={!!removeMember}
        title="Remove member?"
        body={`${removeMember?.name ?? ''} will no longer be able to bill bookings to ${a.name}. Their vehicles stay attached until reassigned.`}
        confirmLabel="Remove"
        danger
        loading={remove.isPending}
        onClose={() => setRemoveMember(null)}
        onConfirm={() => removeMember && remove.mutate(removeMember.userId)}
      />
      <AddMemberDialog open={memberOpen} onClose={() => setMemberOpen(false)} accountId={id} onSaved={(m) => { toast(m); setMemberOpen(false); refresh(); }} />
      <ContractDialog open={!!contractEdit} contract={contractEdit?.contract ?? null} accountId={id} onClose={() => setContractEdit(null)} onSaved={(m) => { toast(m); setContractEdit(null); refresh(); }} />
      {toastNode}
    </Box>
  );
}
