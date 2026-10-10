import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, FormControlLabel, Grid, MenuItem, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { api } from '@/api/client';
import { ErrorState, LoadingBlock, PageHeader, SectionCard } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { date } from '@/lib/format';
import { SimpleTable, useTabParam, useToast } from './biz/shared';

type Obj = Record<string, unknown>;
type FieldDef = { path: string; label: string; type: 'text' | 'number' | 'bool' | 'select' | 'holidays'; min?: number; max?: number; step?: number; options?: [string | number, string][]; help?: string; size?: number; required?: boolean; pattern?: [RegExp, string] };
type SectionDef = { key: string; title: string; description: string; fields: FieldDef[]; weightsHint?: string };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Colombo', 'UTC'];

const SECTIONS: SectionDef[] = [
  {
    key: 'business',
    title: 'Business profile',
    description: 'Printed on invoices, receipts and customer messages.',
    fields: [
      { path: 'brandName', label: 'Brand name', type: 'text', required: true },
      { path: 'legalName', label: 'Legal entity name', type: 'text', size: 8 },
      { path: 'gstin', label: 'GSTIN', type: 'text', pattern: [/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN'] },
      { path: 'address', label: 'Registered address', type: 'text', size: 8 },
      { path: 'supportPhone', label: 'Support phone', type: 'text' },
      { path: 'supportEmail', label: 'Support email', type: 'text', required: true, pattern: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email'] },
      { path: 'emergencyNumber', label: 'Emergency number', type: 'text', help: 'Shown in safety prompts (112 in India)' },
      { path: 'logoUrl', label: 'Logo URL', type: 'text', size: 8 },
    ],
  },
  {
    key: 'locale',
    title: 'Locale & financial year',
    description: 'Report periods, day boundaries and document numbering use these.',
    fields: [
      { path: 'timezone', label: 'Business timezone', type: 'select', options: TIMEZONES.map((t) => [t, t]) },
      { path: 'fyStartMonth', label: 'Financial year starts', type: 'select', options: MONTHS.map((m, i) => [i + 1, m]), help: 'India: April' },
    ],
  },
  {
    key: 'dispatch',
    title: 'Dispatch',
    description: 'How jobs are offered to drivers automatically.',
    weightsHint: 'weights',
    fields: [
      { path: 'autoDispatch', label: 'Automatic dispatch', type: 'bool', help: 'Offer jobs to the best-ranked driver automatically' },
      { path: 'offerTimeoutSec', label: 'Offer timeout (seconds)', type: 'number', min: 20, max: 600 },
      { path: 'maxAutoAttempts', label: 'Auto-offer attempts', type: 'number', min: 1, max: 10, help: 'Then escalate to dispatchers' },
      { path: 'searchRadiusKm', label: 'Search radius (km)', type: 'number', min: 1, max: 200, step: 0.5 },
      { path: 'avgSpeedKmh', label: 'Average city speed (km/h)', type: 'number', min: 5, max: 80, help: 'Used for ETA estimates' },
      { path: 'locationStaleMinutes', label: 'Driver location stale after (min)', type: 'number', min: 1, max: 60 },
      { path: 'missedEtaGraceMinutes', label: 'Missed-ETA grace (min)', type: 'number', min: 1, max: 120 },
      { path: 'scheduledLeadMinutes', label: 'Scheduled job lead time (min)', type: 'number', min: 10, max: 240, help: 'Dispatch this long before the slot' },
      { path: 'weights.eta', label: 'Ranking weight: ETA', type: 'number', min: 0, max: 1, step: 0.05 },
      { path: 'weights.workload', label: 'Ranking weight: workload', type: 'number', min: 0, max: 1, step: 0.05 },
      { path: 'weights.rating', label: 'Ranking weight: rating', type: 'number', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    key: 'pricing',
    title: 'Pricing',
    description: 'Global pricing inputs. Rate-card amounts are edited under Services & pricing.',
    fields: [
      { path: 'roadDistanceFactor', label: 'Road distance factor', type: 'number', min: 1, max: 2, step: 0.05, help: 'Straight-line × factor when no routing provider is available' },
      { path: 'holidays', label: 'Public holidays (holiday surcharge applies)', type: 'holidays', size: 12 },
    ],
  },
  {
    key: 'retention',
    title: 'Data retention',
    description: 'Older records are purged automatically by the retention job.',
    fields: [
      { path: 'trackingDays', label: 'Live-tracking history (days)', type: 'number', min: 7, max: 3650 },
      { path: 'otpDays', label: 'OTP records (days)', type: 'number', min: 1, max: 90 },
      { path: 'notificationDays', label: 'Notifications (days)', type: 'number', min: 30, max: 3650 },
    ],
  },
  {
    key: 'shareLinks',
    title: 'Tracking share links',
    description: 'Customers can share live tracking with family; links expire automatically.',
    fields: [
      { path: 'defaultHours', label: 'Default validity (hours)', type: 'number', min: 0.5, max: 24, step: 0.5 },
      { path: 'maxHours', label: 'Maximum validity (hours)', type: 'number', min: 1, max: 48, step: 0.5 },
    ],
  },
  {
    key: 'performance',
    title: 'Driver performance score',
    description: 'Weights of each component in the driver performance score.',
    weightsHint: 'weights',
    fields: [
      { path: 'weights.punctuality', label: 'Punctuality', type: 'number', min: 0, max: 1, step: 0.05 },
      { path: 'weights.completion', label: 'Completion', type: 'number', min: 0, max: 1, step: 0.05 },
      { path: 'weights.safety', label: 'Safety', type: 'number', min: 0, max: 1, step: 0.05 },
      { path: 'weights.feedback', label: 'Customer feedback', type: 'number', min: 0, max: 1, step: 0.05 },
      { path: 'weights.difficulty', label: 'Job difficulty', type: 'number', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    key: 'privacy',
    title: 'Privacy',
    description: 'Changing the consent version asks customers to accept the updated notice at next sign-in.',
    fields: [
      { path: 'consentVersion', label: 'Consent version', type: 'text', required: true },
      { path: 'noticeUrl', label: 'Privacy notice URL', type: 'text', size: 8 },
    ],
  },
];

const getPath = (o: Obj | undefined, p: string): unknown => p.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Obj)[k] : undefined), o);
function setPath(o: Obj, p: string, v: unknown): Obj {
  const [h, ...rest] = p.split('.');
  return { ...o, [h!]: rest.length ? setPath(((o[h!] as Obj) ?? {}) as Obj, rest.join('.'), v) : v };
}
const fmtDefault = (v: unknown, f: FieldDef) => (v == null || v === '' ? '(empty)' : f.type === 'bool' ? (v ? 'On' : 'Off') : f.type === 'select' ? (f.options?.find((o) => o[0] === v)?.[1] ?? String(v)) : Array.isArray(v) ? `${v.length} dates` : String(v));

function HolidayEditor({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [d, setD] = useState('');
  const sorted = [...value].sort();
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <TextField size="small" type="date" label="Add holiday" value={d} onChange={(e) => setD(e.target.value)} disabled={disabled} slotProps={{ inputLabel: { shrink: true } }} />
        <Button size="small" variant="outlined" disabled={disabled || !/^\d{4}-\d{2}-\d{2}$/.test(d) || value.includes(d)} onClick={() => { onChange([...value, d]); setD(''); }}>Add</Button>
      </Stack>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {sorted.length === 0 && <Typography variant="body2" color="text.secondary">No holidays configured.</Typography>}
        {sorted.map((h) => <Chip key={h} label={date(`${h}T12:00:00+05:30`)} onDelete={disabled ? undefined : () => onChange(value.filter((x) => x !== h))} size="small" />)}
      </Stack>
    </Box>
  );
}

function SectionForm({ def, values, defaults, canEdit, onSaved, onError }: { def: SectionDef; values: Obj; defaults: Obj; canEdit: boolean; onSaved: (m: string) => void; onError: (e: unknown) => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Obj>(values);
  useEffect(() => setDraft(values), [values]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(values);
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    for (const f of def.fields) {
      const v = getPath(draft, f.path);
      if (f.type === 'number') {
        if (typeof v !== 'number' || !Number.isFinite(v)) e[f.path] = 'Enter a number';
        else if (f.min != null && v < f.min) e[f.path] = `Minimum ${f.min}`;
        else if (f.max != null && v > f.max) e[f.path] = `Maximum ${f.max}`;
      }
      if (f.type === 'text') {
        const s = String(v ?? '');
        if (f.required && !s.trim()) e[f.path] = 'Required';
        else if (f.pattern && !f.pattern[0].test(s)) e[f.path] = f.pattern[1];
      }
    }
    if (def.key === 'shareLinks' && Number(getPath(draft, 'defaultHours')) > Number(getPath(draft, 'maxHours'))) e.defaultHours = 'Cannot exceed the maximum';
    return e;
  }, [draft, def]);
  const weights = def.weightsHint ? Object.values((draft.weights as Record<string, number>) ?? {}).reduce((a, b) => a + (Number(b) || 0), 0) : null;
  const save = useMutation({
    mutationFn: () => api.put(`/admin/system/settings/${def.key}`, draft),
    onSuccess: () => {
      onSaved(`${def.title} saved`);
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void qc.invalidateQueries({ queryKey: ['config'] });
    },
    onError,
  });
  const field = (f: FieldDef): ReactNode => {
    const v = getPath(draft, f.path);
    const dv = getPath(defaults, f.path);
    const helper = errors[f.path] ?? [f.help, `Default: ${fmtDefault(dv, f)}`].filter(Boolean).join(' · ');
    const set = (x: unknown) => setDraft((d) => setPath(d, f.path, x));
    switch (f.type) {
      case 'bool':
        return (
          <Box>
            <FormControlLabel control={<Switch checked={!!v} onChange={(e) => set(e.target.checked)} disabled={!canEdit} />} label={f.label} />
            <Typography variant="caption" color="text.secondary" display="block">{helper}</Typography>
          </Box>
        );
      case 'select':
        return (
          <TextField select fullWidth size="small" label={f.label} value={v ?? ''} onChange={(e) => set(typeof f.options?.[0]?.[0] === 'number' ? Number(e.target.value) : e.target.value)} disabled={!canEdit} helperText={helper}>
            {(f.options ?? []).concat(f.options?.some((o) => o[0] === v) || v == null ? [] : [[v as string, String(v)]]).map(([k, l]) => <MenuItem key={String(k)} value={k}>{l}</MenuItem>)}
          </TextField>
        );
      case 'holidays':
        return (
          <Box>
            <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>{f.label}</Typography>
            <HolidayEditor value={(v as string[]) ?? []} onChange={set} disabled={!canEdit} />
          </Box>
        );
      case 'number':
        return <TextField fullWidth size="small" type="number" label={f.label} value={v ?? ''} onChange={(e) => set(e.target.value === '' ? NaN : Number(e.target.value))} disabled={!canEdit} error={!!errors[f.path]} helperText={helper} slotProps={{ htmlInput: { min: f.min, max: f.max, step: f.step ?? 1 } }} />;
      default:
        return <TextField fullWidth size="small" label={f.label} value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} disabled={!canEdit} error={!!errors[f.path]} helperText={helper} required={f.required} />;
    }
  };
  return (
    <SectionCard title={def.title} action={dirty && <Chip size="small" color="warning" label="Unsaved changes" />}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{def.description}</Typography>
      <Grid container spacing={2}>
        {def.fields.map((f) => (
          <Grid key={f.path} size={{ xs: 12, sm: f.size && f.size > 6 ? 12 : 6, md: f.size ?? 4 }}>
            {field(f)}
          </Grid>
        ))}
      </Grid>
      {weights != null && Math.abs(weights - 1) > 0.001 && (
        <Alert severity="warning" sx={{ mt: 2 }}>Weights add up to {weights.toFixed(2)}. They are normally set to total 1.00 so scores stay comparable.</Alert>
      )}
      {canEdit && (
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
          <Tooltip title="Fill the form with default values (not saved until you press Save)">
            <span><Button onClick={() => setDraft(structuredClone(defaults))} disabled={save.isPending || JSON.stringify(draft) === JSON.stringify(defaults)}>Use defaults</Button></span>
          </Tooltip>
          <Button onClick={() => setDraft(values)} disabled={!dirty || save.isPending}>Discard</Button>
          <Button variant="contained" onClick={() => save.mutate()} disabled={!dirty || save.isPending || Object.keys(errors).length > 0}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </Stack>
      )}
    </SectionCard>
  );
}

function RolesMatrix() {
  const r = useQuery({ queryKey: ['admin', 'system', 'roles'], queryFn: () => api.get<{ roles: Record<string, { name: string; description: string; permissions: string[] }>; permissions: Record<string, string> }>('/admin/system/roles') });
  if (r.isLoading) return <LoadingBlock />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  const roles = Object.entries(r.data.roles);
  const perms = Object.entries(r.data.permissions).map(([key, description]) => ({ key, description }));
  return (
    <SectionCard title="Roles & permissions">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Read-only reference. Permissions are enforced by the server on every request. Staff roles are granted on each employee’s profile.
      </Typography>
      <SimpleTable
        rows={perms}
        rowKey={(p) => p.key}
        minWidth={900}
        maxHeight={640}
        columns={[
          { key: 'p', header: 'Permission', render: (p) => (<Box><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{p.key}</Typography><Typography variant="caption" color="text.secondary">{p.description}</Typography></Box>) },
          ...roles.map(([k, role]) => ({
            key: k,
            header: <Tooltip title={role.description}><span>{role.name}</span></Tooltip>,
            align: 'center' as const,
            render: (p: { key: string }) => (role.permissions.includes(p.key) ? <CheckIcon fontSize="small" color="success" aria-label={`${role.name} has ${p.key}`} /> : <Typography variant="body2" color="text.disabled" aria-label="No">·</Typography>),
          })),
        ]}
      />
    </SectionCard>
  );
}

const TABS = ['settings', 'roles'] as const;

export default function Settings() {
  const { can } = useAuth();
  const canEdit = can('settings:manage');
  const canRoles = can('roles:manage') || can('employee:read');
  const { toast, toastError, toastNode } = useToast();
  const [tab, setTab] = useTabParam(TABS, 'settings');
  const s = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<{ values: Record<string, Obj>; defaults: Record<string, Obj> }>('/admin/system/settings') });
  return (
    <Box>
      <PageHeader title="Settings" subtitle="Business configuration. Every change is recorded in the audit log." />
      {!canEdit && <Alert severity="info" sx={{ mb: 2 }}>Read-only. Changing settings requires the settings permission.</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="settings" label="Business settings" />
        {canRoles && <Tab value="roles" label="Roles & permissions" />}
      </Tabs>
      {tab === 'settings' &&
        (s.isLoading ? <LoadingBlock rows={6} height={120} /> : s.error || !s.data ? <ErrorState error={s.error} onRetry={() => void s.refetch()} /> : (
          <Stack spacing={2}>
            {SECTIONS.map((d) => (
              <SectionForm key={d.key} def={d} values={s.data.values[d.key] ?? {}} defaults={s.data.defaults[d.key] ?? {}} canEdit={canEdit} onSaved={toast} onError={toastError} />
            ))}
          </Stack>
        ))}
      {tab === 'roles' && canRoles && <RolesMatrix />}
      {toastNode}
    </Box>
  );
}
