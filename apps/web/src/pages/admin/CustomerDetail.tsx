import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Card, Checkbox, Chip, FormControlLabel, Grid, Link, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { api } from '@/api/client';
import type { BookingStatus, PaymentStatus, VehicleClass } from '@/api/types';
import { ErrorState, KeyValue, LoadingBlock, Money, PageHeader, PaymentChip, SampleTag, SectionCard, StatusChip } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { date, dateTime, humanize, VEHICLE_CLASS_LABELS } from '@/lib/format';
import type { InvoiceRow, PaymentRow, UserStatus, VehicleRow } from './biz/types';
import { BackLink, EnumChip, FormDialog, SandboxChip, SimpleTable, useTabParam, useToast } from './biz/shared';

interface CustomerDetailData {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string | null;
  isSample: boolean;
  customerProfile: {
    preferredLanguage: string;
    termsAcceptedAt: string | null;
    privacyConsentAt: string | null;
    consentVersion: string | null;
    marketingConsent: boolean;
    locationConsent: boolean;
    notifySms: boolean;
    notifyEmail: boolean;
    notifyPush: boolean;
  } | null;
  vehicles: VehicleRow[];
  savedAddresses: { id: string; label: string; address: string; landmark: string | null }[];
  emergencyContacts: { id: string; name: string; phone: string; relationship: string | null }[];
  bookings: { id: string; code: string; status: BookingStatus; createdAt: string; serviceCategory: { name: string }; invoice: { total: number; paymentStatus: PaymentStatus } | null }[];
  tickets: { id: string; number: string; category: string; status: string; subject: string; createdAt: string }[];
  subscriptions: { id: string; status: string; startsAt: string | null; endsAt: string | null; servicesUsed: number; planSnapshot: { includedServices?: number } | null; membership: { name: string } }[];
  fleetMemberships: { isManager: boolean; fleetAccount: { id: string; name: string } }[];
  invoices: InvoiceRow[] | null;
  payments: PaymentRow[] | null;
  communicationHistory: { id: string; channel: string; type: string; title: string; status: string; createdAt: string }[];
}

const TABS = ['overview', 'vehicles', 'bookings', 'billing', 'support', 'memberships', 'communications'] as const;
type TabKey = (typeof TABS)[number];

const yesNo = (v: boolean | undefined) => (v == null ? '—' : v ? <Chip size="small" color="success" variant="outlined" label="Yes" /> : <Chip size="small" variant="outlined" label="No" />);

export default function CustomerDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { toast, toastNode } = useToast();
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'overview');
  const [statusOpen, setStatusOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<UserStatus>('SUSPENDED');
  const [reason, setReason] = useState('');
  const [eraseOpen, setEraseOpen] = useState(false);
  const [eraseReason, setEraseReason] = useState('');
  const [eraseTicket, setEraseTicket] = useState('');
  const [eraseConfirm, setEraseConfirm] = useState(false);

  const q = useQuery({ queryKey: ['admin', 'customer', id], queryFn: () => api.get<CustomerDetailData>(`/admin/customers/${id}`) });

  const setStatus = useMutation({
    mutationFn: () => api.post(`/admin/customers/${id}/status`, { status: newStatus, reason: reason.trim() }),
    onSuccess: () => {
      toast(`Customer status set to ${humanize(newStatus).toLowerCase()}`);
      setStatusOpen(false);
      void qc.invalidateQueries({ queryKey: ['admin', 'customer', id] });
      void qc.invalidateQueries({ queryKey: ['admin', 'customers'] });
    },
  });

  const erase = useMutation({
    mutationFn: () => api.post<{ anonymized: boolean; retained: string }>(`/admin/customers/${id}/anonymize`, { reason: eraseReason.trim(), ...(eraseTicket ? { ticketId: eraseTicket } : {}) }),
    onSuccess: (r) => {
      toast(`Personal data erased. Retained: ${r.retained}`);
      setEraseOpen(false);
      void qc.invalidateQueries({ queryKey: ['admin', 'customer', id] });
      void qc.invalidateQueries({ queryKey: ['admin', 'customers'] });
    },
  });

  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error('Customer not found')} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const p = c.customerProfile;
  const finance = c.invoices !== null && can('finance:read');
  const outstanding = c.invoices?.filter((i) => i.status === 'ISSUED').reduce((a, i) => a + i.outstanding, 0) ?? 0;

  return (
    <Box>
      <PageHeader
        back={<BackLink to="/admin/customers" label="Customers" />}
        title={
          <>
            {c.fullName}
            <SampleTag show={c.isSample} />
          </>
        }
        subtitle={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap component="span">
            <EnumChip value={c.status} />
            <span>Customer since {date(c.createdAt)}</span>
            {c.fleetMemberships.map((m) => (
              <Chip key={m.fleetAccount.id} size="small" variant="outlined" label={`${m.fleetAccount.name}${m.isManager ? ' · manager' : ''}`} onClick={() => nav(`/admin/accounts/${m.fleetAccount.id}`)} />
            ))}
          </Stack>
        }
        actions={
          can('customer:manage') && (
            <>
            <Button
              variant="outlined"
              color={c.status === 'ACTIVE' ? 'warning' : 'primary'}
              onClick={() => {
                setNewStatus(c.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
                setReason('');
                setStatus.reset();
                setStatusOpen(true);
              }}
            >
              Change status
            </Button>
            <Button
              variant="outlined"
              color="error"
              onClick={() => {
                setEraseReason('');
                setEraseTicket('');
                setEraseConfirm(false);
                erase.reset();
                setEraseOpen(true);
              }}
            >
              Erase personal data (DPDP request)
            </Button>
            </>
          )
        }
      />

      {c.status !== 'ACTIVE' && (
        <Alert severity={c.status === 'DEACTIVATED' ? 'error' : 'warning'} sx={{ mb: 2 }}>
          This account is {c.status.toLowerCase()}. The customer cannot sign in or create bookings until it is reactivated.
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">Bookings</Typography>
            <Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.bookings.length}</Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">Vehicles</Typography>
            <Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.vehicles.length}</Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">Open tickets</Typography>
            <Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.tickets.filter((t) => !['RESOLVED', 'CLOSED'].includes(t.status)).length}</Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="overline" color="text.secondary">Outstanding</Typography>
            <Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums' }}>{finance ? <Money value={outstanding} /> : '—'}</Typography>
            {!finance && <Typography variant="caption" color="text.secondary">Requires finance access</Typography>}
          </Card>
        </Grid>
      </Grid>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="overview" label="Profile & consents" />
        <Tab value="vehicles" label={`Vehicles (${c.vehicles.length})`} />
        <Tab value="bookings" label={`Bookings (${c.bookings.length})`} />
        <Tab value="billing" label="Invoices & payments" />
        <Tab value="support" label={`Tickets (${c.tickets.length})`} />
        <Tab value="memberships" label={`Memberships (${c.subscriptions.length})`} />
        <Tab value="communications" label="Communications" />
      </Tabs>

      {tab === 'overview' && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <SectionCard title="Contact">
              <KeyValue label="Phone" value={c.phone ? <Link href={`tel:${c.phone}`}>{c.phone}</Link> : '—'} />
              <KeyValue label="Email" value={c.email ?? '—'} />
              <KeyValue label="Preferred language" value={p?.preferredLanguage?.toUpperCase() ?? '—'} />
              <KeyValue label="Last sign-in" value={dateTime(c.lastLoginAt)} />
              <KeyValue label="Account created" value={dateTime(c.createdAt)} />
            </SectionCard>
            <SectionCard title="Saved addresses" sx={{ mt: 2 }}>
              <SimpleTable rows={c.savedAddresses} rowKey={(a) => a.id} empty="No saved addresses." columns={[{ key: 'l', header: 'Label', render: (a) => a.label }, { key: 'a', header: 'Address', render: (a) => [a.address, a.landmark].filter(Boolean).join(' · ') }]} />
            </SectionCard>
            <SectionCard title="Emergency contacts" sx={{ mt: 2 }}>
              <SimpleTable rows={c.emergencyContacts} rowKey={(a) => a.id} empty="No emergency contacts." columns={[{ key: 'n', header: 'Name', render: (a) => a.name }, { key: 'r', header: 'Relationship', render: (a) => a.relationship ?? '—' }, { key: 'p', header: 'Phone', render: (a) => a.phone }]} />
            </SectionCard>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <SectionCard title="Consents & preferences">
              {!p ? (
                <Typography color="text.secondary">No customer profile recorded.</Typography>
              ) : (
                <>
                  <KeyValue label="Terms accepted" value={dateTime(p.termsAcceptedAt)} />
                  <KeyValue label="Privacy notice accepted" value={dateTime(p.privacyConsentAt)} />
                  <KeyValue label="Consent version" value={p.consentVersion ?? '—'} />
                  <KeyValue label="Location sharing consent" value={yesNo(p.locationConsent)} />
                  <KeyValue label="Marketing consent" value={yesNo(p.marketingConsent)} />
                  <KeyValue label="SMS notifications" value={yesNo(p.notifySms)} />
                  <KeyValue label="Email notifications" value={yesNo(p.notifyEmail)} />
                  <KeyValue label="Push notifications" value={yesNo(p.notifyPush)} />
                </>
              )}
            </SectionCard>
          </Grid>
        </Grid>
      )}

      {tab === 'vehicles' && (
        <SectionCard>
          <SimpleTable
            rows={c.vehicles}
            rowKey={(v) => v.id}
            empty="No vehicles registered."
            columns={[
              { key: 'reg', header: 'Registration', render: (v) => <strong>{v.registrationNumber}</strong>, nowrap: true },
              { key: 'mm', header: 'Make & model', render: (v) => `${v.make} ${v.model}${v.year ? ` (${v.year})` : ''}` },
              { key: 'cls', header: 'Class', render: (v) => VEHICLE_CLASS_LABELS[v.vehicleClass as VehicleClass] ?? v.vehicleClass },
              { key: 'fuel', header: 'Fuel', render: (v) => humanize(v.fuelType) },
              { key: 'fleet', header: 'Corporate billing', render: (v) => (v.fleetAccountId ? <Link component={RouterLink} to={`/admin/accounts/${v.fleetAccountId}`}>Business account</Link> : 'Personal') },
            ]}
          />
        </SectionCard>
      )}

      {tab === 'bookings' && (
        <SectionCard title="Most recent 50 bookings">
          <SimpleTable
            rows={c.bookings}
            rowKey={(b) => b.id}
            empty="No bookings yet."
            onRowClick={(b) => nav(`/admin/bookings/${b.id}`)}
            columns={[
              { key: 'code', header: 'Booking', render: (b) => <Link component={RouterLink} to={`/admin/bookings/${b.id}`} onClick={(e) => e.stopPropagation()}>{b.code}</Link>, nowrap: true },
              { key: 'svc', header: 'Service', render: (b) => b.serviceCategory.name },
              { key: 'st', header: 'Status', render: (b) => <StatusChip status={b.status} /> },
              { key: 'dt', header: 'Created', render: (b) => dateTime(b.createdAt), nowrap: true },
              { key: 'tot', header: 'Invoice total', align: 'right', render: (b) => (b.invoice ? <Money value={b.invoice.total} /> : '—') },
              { key: 'ps', header: 'Payment', render: (b) => (b.invoice ? <PaymentChip status={b.invoice.paymentStatus} /> : '—') },
            ]}
          />
        </SectionCard>
      )}

      {tab === 'billing' &&
        (!finance ? (
          <Alert severity="info">Invoices and payments are visible to staff with finance access.</Alert>
        ) : (
          <Stack spacing={2}>
            <SectionCard title="Invoices">
              <SimpleTable
                rows={c.invoices ?? []}
                rowKey={(i) => i.id}
                empty="No invoices."
                onRowClick={(i) => nav(`/admin/finance/invoices/${i.id}`)}
                minWidth={760}
                columns={[
                  { key: 'n', header: 'Number', render: (i) => <Link component={RouterLink} to={`/admin/finance/invoices/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.number}</Link>, nowrap: true },
                  { key: 't', header: 'Type', render: (i) => humanize(i.type) },
                  { key: 'd', header: 'Issued', render: (i) => date(i.issuedAt), nowrap: true },
                  { key: 'tot', header: 'Total', align: 'right', render: (i) => <Money value={i.total} /> },
                  { key: 'paid', header: 'Paid', align: 'right', render: (i) => <Money value={i.amountPaid} /> },
                  { key: 'out', header: 'Outstanding', align: 'right', render: (i) => <Money value={i.outstanding} strong={i.outstanding > 0} /> },
                  { key: 's', header: 'Status', render: (i) => (i.status === 'VOID' ? <EnumChip value="VOID" /> : <PaymentChip status={i.paymentStatus} />) },
                ]}
              />
            </SectionCard>
            <SectionCard title="Payments">
              <SimpleTable
                rows={c.payments ?? []}
                rowKey={(p) => p.id}
                empty="No payments."
                minWidth={720}
                columns={[
                  { key: 'd', header: 'Date', render: (p) => dateTime(p.succeededAt ?? p.createdAt), nowrap: true },
                  { key: 'm', header: 'Method', render: (p) => (<>{humanize(p.method)}<SandboxChip show={p.isSandbox} /></>) },
                  { key: 'r', header: 'Receipt', render: (p) => p.receiptNumber ?? '—', nowrap: true },
                  { key: 's', header: 'Status', render: (p) => <EnumChip value={p.status} /> },
                  { key: 'a', header: 'Amount', align: 'right', render: (p) => <Money value={p.amount} /> },
                  { key: 'i', header: 'Invoice', render: (p) => <Link component={RouterLink} to={`/admin/finance/invoices/${p.invoiceId}`}>View</Link> },
                ]}
              />
            </SectionCard>
          </Stack>
        ))}

      {tab === 'support' && (
        <SectionCard>
          <SimpleTable
            rows={c.tickets}
            rowKey={(t) => t.id}
            empty="No support tickets."
            columns={[
              { key: 'n', header: 'Ticket', render: (t) => t.number, nowrap: true },
              { key: 's', header: 'Subject', render: (t) => t.subject },
              { key: 'c', header: 'Category', render: (t) => humanize(t.category) },
              { key: 'st', header: 'Status', render: (t) => <EnumChip value={t.status} /> },
              { key: 'd', header: 'Opened', render: (t) => dateTime(t.createdAt), nowrap: true },
            ]}
          />
          {can('support:manage') && (
            <Button component={RouterLink} to="/admin/support" size="small" sx={{ mt: 1 }}>
              Open support desk
            </Button>
          )}
        </SectionCard>
      )}

      {tab === 'memberships' && (
        <SectionCard>
          <SimpleTable
            rows={c.subscriptions}
            rowKey={(s) => s.id}
            empty="No memberships."
            columns={[
              { key: 'p', header: 'Plan', render: (s) => s.membership.name },
              { key: 'st', header: 'Status', render: (s) => <EnumChip value={s.status} /> },
              { key: 'from', header: 'Starts', render: (s) => date(s.startsAt) },
              { key: 'to', header: 'Ends', render: (s) => date(s.endsAt) },
              { key: 'u', header: 'Services used', align: 'right', render: (s) => `${s.servicesUsed}${s.planSnapshot?.includedServices != null ? ` / ${s.planSnapshot.includedServices}` : ''}` },
            ]}
          />
        </SectionCard>
      )}

      {tab === 'communications' && (
        <SectionCard title="Last 50 notifications sent">
          <SimpleTable
            rows={c.communicationHistory}
            rowKey={(n) => n.id}
            empty="No notifications have been sent to this customer."
            columns={[
              { key: 'd', header: 'Sent', render: (n) => dateTime(n.createdAt), nowrap: true },
              { key: 'ch', header: 'Channel', render: (n) => humanize(n.channel) },
              { key: 't', header: 'Message', render: (n) => (<><Typography variant="body2">{n.title}</Typography><Typography variant="caption" color="text.secondary">{n.type}</Typography></>) },
              { key: 's', header: 'Delivery', render: (n) => <EnumChip value={n.status} color={n.status === 'SENT' ? 'success' : n.status === 'FAILED' ? 'error' : 'default'} /> },
            ]}
          />
        </SectionCard>
      )}

      <FormDialog
        open={statusOpen}
        title="Change customer status"
        onClose={() => setStatusOpen(false)}
        onSubmit={() => setStatus.mutate()}
        submitting={setStatus.isPending}
        submitLabel="Update status"
        danger={newStatus !== 'ACTIVE'}
        submitDisabled={newStatus === c.status || reason.trim().length < 3}
        error={setStatus.error}
        maxWidth="xs"
        intro={
          <Typography variant="body2" color="text.secondary">
            Suspending or deactivating signs the customer out of all devices immediately. The reason is recorded in the audit log.
          </Typography>
        }
      >
        <Stack spacing={2}>
          <TextField select label="New status" value={newStatus} onChange={(e) => setNewStatus(e.target.value as UserStatus)} fullWidth>
            <MenuItem value="ACTIVE">Active</MenuItem>
            <MenuItem value="SUSPENDED">Suspended (temporary)</MenuItem>
            <MenuItem value="DEACTIVATED">Deactivated</MenuItem>
          </TextField>
          <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} required fullWidth helperText="At least 3 characters" slotProps={{ htmlInput: { maxLength: 500 } }} />
        </Stack>
      </FormDialog>
      <FormDialog
        open={eraseOpen}
        title="Erase personal data (DPDP request)"
        onClose={() => setEraseOpen(false)}
        onSubmit={() => erase.mutate()}
        submitting={erase.isPending}
        submitLabel="Erase personal data"
        danger
        submitDisabled={eraseReason.trim().length < 5 || !eraseConfirm}
        error={erase.error}
        intro={
          <Alert severity="error" variant="outlined">
            This cannot be undone. The customer’s name, phone, email, saved addresses, emergency contacts, photos, location tracking history and notifications are erased or anonymised.
            Invoices and payment records are retained (in anonymised form) because tax law requires them to be kept. Customers with an active booking cannot be erased until it ends.
          </Alert>
        }
      >
        <Stack spacing={2}>
          <TextField
            select
            label="Linked privacy request (optional)"
            value={eraseTicket}
            onChange={(e) => setEraseTicket(e.target.value)}
            fullWidth
            helperText={c.tickets.some((t) => t.category === 'PRIVACY_REQUEST' && !['RESOLVED', 'CLOSED'].includes(t.status)) ? 'The selected ticket is resolved automatically' : 'This customer has no open privacy request tickets'}
          >
            <MenuItem value="">No ticket</MenuItem>
            {c.tickets
              .filter((t) => t.category === 'PRIVACY_REQUEST' && !['RESOLVED', 'CLOSED'].includes(t.status))
              .map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.number} · {t.subject}
                </MenuItem>
              ))}
          </TextField>
          <TextField label="Reason" value={eraseReason} onChange={(e) => setEraseReason(e.target.value)} multiline minRows={2} required fullWidth helperText="5–500 characters; recorded in the audit log" slotProps={{ htmlInput: { maxLength: 500 } }} />
          <FormControlLabel control={<Checkbox checked={eraseConfirm} onChange={(e) => setEraseConfirm(e.target.checked)} />} label={`I confirm ${c.fullName} has requested erasure and their identity has been verified`} />
        </Stack>
      </FormDialog>
      {toastNode}
    </Box>
  );
}
