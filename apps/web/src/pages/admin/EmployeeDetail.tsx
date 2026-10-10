import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  Grid,
  LinearProgress,
  Link,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { api } from '@/api/client';
import { EmptyState, ErrorState, KeyValue, LoadingBlock, Money, PageHeader, SampleTag, SectionCard } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { date, dateTime, humanize, relative } from '@/lib/format';
import { EmployeeFormDialog } from './ops/EmployeeFormDialog';
import {
  ACCOUNT_COLOR,
  ASSIGNMENT_COLOR,
  AVAILABILITY_COLOR,
  BackLink,
  BookingLink,
  DOCUMENT_TYPES,
  durationBetween,
  EMPLOYEE_ROLES,
  ESCALATION_COLOR,
  PriorityChip,
  ReasonDialog,
  ROLE_LABELS,
  useNotice,
  VERIFICATION_COLOR,
  type Notify,
} from './ops/shared';
import type { EmployeeDetail as EmployeeData, EmployeeDocument, Truck } from './ops/types';

type TabKey = 'overview' | 'compensation' | 'documents' | 'performance' | 'attendance' | 'assignments' | 'incidents';

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
  };
}

function VerificationCard({ e, notify }: { e: EmployeeData; notify: Notify }) {
  const refresh = useInvalidate();
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED' | 'DOCUMENTS_REQUESTED' | 'SUSPENDED'>('APPROVED');
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<{ verificationStatus: string }>(`/admin/employees/${e.id}/verification`, { decision, note: note.trim() }),
    onSuccess: (r) => {
      refresh();
      setNote('');
      notify(`Verification set to ${humanize(r.verificationStatus).toLowerCase()}. The employee has been notified by SMS.`);
    },
    onError: (err) => notify((err as Error).message, 'error'),
  });
  const wp = e.workerProfile;
  return (
    <SectionCard title="Verification">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Chip color={VERIFICATION_COLOR(wp?.verificationStatus)} label={humanize(wp?.verificationStatus ?? 'PENDING')} />
        {wp?.verifiedAt && (
          <Typography variant="caption" color="text.secondary">
            decided {dateTime(wp.verifiedAt)}
          </Typography>
        )}
      </Stack>
      {wp?.verificationNote && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Note: {wp.verificationNote}
        </Typography>
      )}
      <Stack spacing={1.5}>
        <TextField select size="small" label="Decision" value={decision} onChange={(ev) => setDecision(ev.target.value as typeof decision)}>
          <MenuItem value="APPROVED">Approve (can receive jobs)</MenuItem>
          <MenuItem value="DOCUMENTS_REQUESTED">Request documents</MenuItem>
          <MenuItem value="REJECTED">Reject</MenuItem>
          <MenuItem value="SUSPENDED">Suspend verification</MenuItem>
        </TextField>
        <TextField size="small" label="Note to the employee" multiline minRows={2} value={note} onChange={(ev) => setNote(ev.target.value.slice(0, 1000))} helperText="Required (min 3 characters). Sent by SMS." />
        <Typography variant="caption" color="text.secondary">
          Approval needs approved, unexpired ID proof and photo{e.driverProfile ? ', a driving licence document and a valid licence' : ''}. Any decision other than approve takes them off duty.
        </Typography>
        <Button variant="contained" color={decision === 'APPROVED' ? 'success' : decision === 'DOCUMENTS_REQUESTED' ? 'primary' : 'error'} disabled={note.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? 'Saving…' : 'Record decision'}
        </Button>
      </Stack>
    </SectionCard>
  );
}

function AccountCard({ e, notify }: { e: EmployeeData; notify: Notify }) {
  const { user } = useAuth();
  const refresh = useInvalidate();
  const [target, setTarget] = useState<'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | null>(null);
  const m = useMutation({
    mutationFn: (v: { status: string; reason: string }) => api.post(`/admin/employees/${e.id}/status`, v),
    onSuccess: (_, v) => {
      refresh();
      setTarget(null);
      notify(v.status === 'ACTIVE' ? 'Account activated' : `Account ${v.status.toLowerCase()}; all sessions were signed out`);
    },
    onError: (err) => notify((err as Error).message, 'error'),
  });
  const self = user?.id === e.id;
  const options = (['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const).filter((s) => s !== e.status);
  return (
    <SectionCard title="Account status">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Chip color={ACCOUNT_COLOR(e.status)} label={humanize(e.status)} />
        <Typography variant="caption" color="text.secondary">
          Last sign-in {e.lastLoginAt ? relative(e.lastLoginAt) : 'never'}
        </Typography>
      </Stack>
      {self ? (
        <Typography variant="body2" color="text.secondary">
          You cannot change your own account status.
        </Typography>
      ) : (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {options.map((s) => (
            <Button key={s} variant="outlined" color={s === 'ACTIVE' ? 'success' : 'error'} onClick={() => setTarget(s)}>
              {s === 'ACTIVE' ? 'Activate' : s === 'SUSPENDED' ? 'Suspend' : 'Deactivate'}
            </Button>
          ))}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
        Suspending or deactivating signs the person out of every device immediately and sets them off duty. Reassign any active job first.
      </Typography>
      <ReasonDialog
        open={!!target}
        title={target === 'ACTIVE' ? `Activate ${e.fullName}?` : `${target === 'SUSPENDED' ? 'Suspend' : 'Deactivate'} ${e.fullName}?`}
        body={target === 'ACTIVE' ? 'They will be able to sign in again.' : 'All their sessions are revoked immediately; they cannot sign in or receive jobs.'}
        label="Reason (audited)"
        danger={target !== 'ACTIVE'}
        loading={m.isPending}
        confirmLabel={target === 'ACTIVE' ? 'Activate' : target === 'SUSPENDED' ? 'Suspend' : 'Deactivate'}
        onClose={() => setTarget(null)}
        onConfirm={(reason) => target && m.mutate({ status: target, reason })}
      />
    </SectionCard>
  );
}

function RolesCard({ e, notify }: { e: EmployeeData; notify: Notify }) {
  const { user, hasRole } = useAuth();
  const refresh = useInvalidate();
  const current = e.roles.filter((r) => (EMPLOYEE_ROLES as readonly string[]).includes(r));
  const [roles, setRoles] = useState<string[]>(current);
  useEffect(() => setRoles(e.roles.filter((r) => (EMPLOYEE_ROLES as readonly string[]).includes(r))), [e.roles]);
  const m = useMutation({
    mutationFn: () => api.put(`/admin/employees/${e.id}/roles`, { roles }),
    onSuccess: () => {
      refresh();
      notify('Roles updated. Permissions apply on their next request.');
    },
    onError: (err) => notify((err as Error).message, 'error'),
  });
  const changed = roles.slice().sort().join() !== current.slice().sort().join();
  return (
    <SectionCard title="Roles & access">
      <FormGroup>
        {EMPLOYEE_ROLES.map((r) => (
          <FormControlLabel
            key={r}
            control={<Checkbox size="small" checked={roles.includes(r)} disabled={(r === 'admin' && !hasRole('admin')) || (r === 'admin' && user?.id === e.id)} onChange={(ev) => setRoles(ev.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />}
            label={ROLE_LABELS[r]}
          />
        ))}
      </FormGroup>
      {roles.includes('driver') && !e.driverProfile && (
        <Alert severity="warning" sx={{ my: 1 }}>
          This person has no driver profile (licence details), so they will not appear as a dispatch candidate.
        </Alert>
      )}
      <Button variant="contained" disabled={!changed || !roles.length || m.isPending} onClick={() => m.mutate()} sx={{ mt: 1 }}>
        {m.isPending ? 'Saving…' : 'Save roles'}
      </Button>
    </SectionCard>
  );
}

function TruckCard({ e, notify }: { e: EmployeeData; notify: Notify }) {
  const { can } = useAuth();
  const refresh = useInvalidate();
  const trucks = useQuery({ queryKey: ['admin', 'fleet', 'trucks', 'all-for-assign'], queryFn: () => api.page<Truck>('/admin/fleet/trucks', { pageSize: 100 }), enabled: can('fleet:read') });
  const [truckId, setTruckId] = useState(e.assignedTruck?.id ?? '');
  useEffect(() => setTruckId(e.assignedTruck?.id ?? ''), [e.assignedTruck?.id]);
  const m = useMutation({
    mutationFn: () => api.put(`/admin/employees/${e.id}/truck`, { truckId: truckId || null }),
    onSuccess: () => {
      refresh();
      notify(truckId ? 'Truck assigned' : 'Truck unassigned');
    },
    onError: (err) => notify((err as Error).message, 'error'),
  });
  const chosen = trucks.data?.data.find((t) => t.id === truckId);
  const takenBy = chosen?.assignedDriver && chosen.assignedDriver.id !== e.id ? chosen.assignedDriver.fullName : null;
  return (
    <SectionCard title="Assigned truck">
      {e.assignedTruck ? (
        <KeyValue
          label="Current"
          value={
            <Link component={RouterLink} to={`/admin/fleet/${e.assignedTruck.id}`}>
              {e.assignedTruck.registrationNumber} · {humanize(e.assignedTruck.truckType)} ({humanize(e.assignedTruck.status).toLowerCase()})
            </Link>
          }
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          No truck assigned — this driver cannot be dispatched until one is.
        </Typography>
      )}
      {can('fleet:manage') && (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <TextField select size="small" label="Change truck" value={truckId} onChange={(ev) => setTruckId(ev.target.value)} disabled={trucks.isLoading}>
            <MenuItem value="">No truck</MenuItem>
            {(trucks.data?.data ?? []).map((t) => (
              <MenuItem key={t.id} value={t.id} disabled={t.status === 'IN_USE' && t.id !== e.assignedTruck?.id}>
                {t.registrationNumber} · {humanize(t.truckType)} · {humanize(t.status).toLowerCase()}
                {t.assignedDriver && t.assignedDriver.id !== e.id ? ` · with ${t.assignedDriver.fullName}` : ''}
              </MenuItem>
            ))}
          </TextField>
          {takenBy && <Alert severity="warning">This truck is currently assigned to {takenBy}; saving moves it to {e.fullName}.</Alert>}
          <Button variant="outlined" disabled={truckId === (e.assignedTruck?.id ?? '') || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Saving…' : 'Save truck assignment'}
          </Button>
        </Stack>
      )}
    </SectionCard>
  );
}

function DocumentsTab({ e, notify }: { e: EmployeeData; notify: Notify }) {
  const { can } = useAuth();
  const refresh = useInvalidate();
  const [type, setType] = useState<string>('ID_PROOF');
  const [number, setNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [review, setReview] = useState<{ doc: EmployeeDocument; status: 'APPROVED' | 'REJECTED' } | null>(null);
  const upload = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.append('file', file!);
      f.append('type', type);
      if (number.trim()) f.append('number', number.trim());
      if (expiresAt) f.append('expiresAt', new Date(`${expiresAt}T00:00:00`).toISOString());
      return api.upload(`/admin/employees/${e.id}/documents`, f);
    },
    onSuccess: () => {
      refresh();
      setFile(null);
      setNumber('');
      setExpiresAt('');
      setInputKey((k) => k + 1);
      notify('Document uploaded — review it to count towards verification');
    },
    onError: (err) => notify((err as Error).message, 'error'),
  });
  const reviewM = useMutation({
    mutationFn: (v: { docId: string; status: string; note?: string }) => api.post(`/admin/employees/${e.id}/documents/${v.docId}/review`, { status: v.status, note: v.note }),
    onSuccess: (_, v) => {
      refresh();
      setReview(null);
      notify(`Document ${v.status.toLowerCase()}`);
    },
    onError: (err) => notify((err as Error).message, 'error'),
  });
  const view = async (doc: EmployeeDocument) => {
    // Open the tab synchronously so popup blockers allow it, then point it at the short-lived signed URL.
    const w = window.open('', '_blank');
    try {
      const { url } = await api.get<{ url: string }>(`/admin/employees/${e.id}/documents/${doc.id}/url`);
      if (w) {
        w.opener = null;
        w.location.href = url;
      } else window.location.assign(url);
    } catch (err) {
      w?.close();
      notify((err as Error).message, 'error');
    }
  };

  if (e.documents === null) return <Alert severity="info">Viewing employee documents requires the employee-documents permission.</Alert>;
  return (
    <Stack spacing={2}>
      <SectionCard title={`Documents (${e.documents.length})`}>
        {!e.documents.length ? (
          <EmptyState title="No documents uploaded" body="Upload ID proof, a photo and (for drivers) the driving licence, then approve them." />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Number</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Expiry</TableCell>
                  <TableCell>Uploaded</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {e.documents.map((d) => {
                  const expired = d.expiresAt && new Date(d.expiresAt) < new Date();
                  return (
                    <TableRow key={d.id}>
                      <TableCell>{humanize(d.type)}</TableCell>
                      <TableCell>{d.numberMasked ?? '—'}</TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" color={d.status === 'APPROVED' ? 'success' : d.status === 'REJECTED' ? 'error' : 'warning'} label={humanize(d.status)} />
                        {d.reviewNote && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {d.reviewNote}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color={expired ? 'error.main' : undefined}>
                          {d.expiresAt ? date(d.expiresAt) : '—'}
                          {expired && ' (expired)'}
                        </Typography>
                      </TableCell>
                      <TableCell>{date(d.createdAt)}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Button size="small" onClick={() => void view(d)}>
                            View
                          </Button>
                          {can('employee:verify') && d.status !== 'APPROVED' && (
                            <Button size="small" color="success" onClick={() => setReview({ doc: d, status: 'APPROVED' })}>
                              Approve
                            </Button>
                          )}
                          {can('employee:verify') && d.status !== 'REJECTED' && (
                            <Button size="small" color="error" onClick={() => setReview({ doc: d, status: 'REJECTED' })}>
                              Reject
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </SectionCard>
      <SectionCard title="Upload a document">
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField select fullWidth size="small" label="Type" value={type} onChange={(ev) => setType(ev.target.value)}>
              {DOCUMENT_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  {humanize(t)}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField fullWidth size="small" label="Document number (optional)" value={number} onChange={(ev) => setNumber(ev.target.value.slice(0, 40))} helperText="Stored masked" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField fullWidth size="small" type="date" label="Expiry (optional)" value={expiresAt} onChange={(ev) => setExpiresAt(ev.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Button component="label" variant="outlined" fullWidth startIcon={<UploadFileOutlinedIcon />} sx={{ justifyContent: 'flex-start', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {file ? file.name : 'Choose file (PDF or image)'}
              <input key={inputKey} hidden type="file" accept="application/pdf,image/*" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} />
            </Button>
          </Grid>
        </Grid>
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button variant="contained" disabled={!file || upload.isPending || !can('employee:documents')} onClick={() => upload.mutate()}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Documents are private: they open through short-lived signed links and every view is audited. A photo upload also becomes the profile photo.
        </Typography>
      </SectionCard>
      <ReasonDialog
        open={!!review}
        title={`${review?.status === 'APPROVED' ? 'Approve' : 'Reject'} ${humanize(review?.doc.type)}?`}
        label="Review note"
        optional={review?.status === 'APPROVED'}
        minLength={3}
        danger={review?.status === 'REJECTED'}
        loading={reviewM.isPending}
        confirmLabel={review?.status === 'APPROVED' ? 'Approve' : 'Reject'}
        onClose={() => setReview(null)}
        onConfirm={(note) => review && reviewM.mutate({ docId: review.doc.id, status: review.status, note: note || undefined })}
      />
    </Stack>
  );
}

function CompensationTab({ e }: { e: EmployeeData }) {
  const { can } = useAuth();
  const w = e.workerProfile;
  const restricted = w?.baseSalary === undefined;
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 7 }}>
        <SectionCard title="Pay rules (obligations)">
          {restricted ? (
            <Alert severity="info">Compensation details are visible only to staff with employee-management or payroll permission.</Alert>
          ) : (
            <>
              <KeyValue label="Employment type" value={humanize(w?.employmentType)} />
              {w?.partnerCompany && <KeyValue label="Partner company" value={w.partnerCompany} />}
              <KeyValue label="Pay frequency" value={w?.payFrequency ? humanize(w.payFrequency) : 'Not set'} />
              <KeyValue label="Base salary" value={w?.baseSalary != null ? <Money value={w.baseSalary} /> : '—'} />
              <KeyValue label="Commission" value={w?.commissionBps != null ? `${w.commissionBps / 100}% of job revenue` : '—'} />
              <KeyValue label="Per-job amount" value={w?.perJobAmount != null ? <Money value={w.perJobAmount} /> : '—'} />
              <KeyValue label="Payout method" value={w?.payoutMethod ? `${humanize(w.payoutMethod)}${w.payoutDetailsMasked ? ` · ${w.payoutDetailsMasked}` : ''}` : 'Not set'} />
            </>
          )}
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}>
        <SectionCard title="Obligations vs payouts">
          <Typography variant="body2" sx={{ mb: 1 }}>
            The rules on the left define what is <strong>owed</strong>: salaried staff accrue salary per period; commission and per-job workers earn per completed job.
          </Typography>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            <strong>Actual payments</strong> (salary records, driver earnings and payouts, with their paid/pending status) are recorded and paid in Payroll — they are not changed by editing these rules, and rule changes do not alter past earnings.
          </Typography>
          {can('payroll:manage') && (
            <Button component={RouterLink} to="/admin/payroll" variant="outlined">
              Open payroll & payouts
            </Button>
          )}
        </SectionCard>
      </Grid>
    </Grid>
  );
}

const COMPONENT_LABELS: Record<string, string> = { punctuality: 'Punctuality', completion: 'Completion', safety: 'Safety & evidence', feedback: 'Verified feedback', difficulty: 'Difficult jobs (bonus)' };
const INPUT_LABELS: Record<string, string> = {
  assignmentsOffered: 'Offers received',
  accepted: 'Offers accepted',
  completed: 'Jobs completed',
  cancelledByWorker: 'Released / withdrawn',
  arrivals: 'Arrivals with ETA',
  onTimeArrivals: 'On-time arrivals',
  ratingsAvg: 'Average rating',
  ratingsCount: 'Ratings received',
  verifiedComplaints: 'Verified complaints',
  safetyIncidentsReported: 'Safety incidents reported (never penalised)',
  checklistComplete: 'Jobs with full evidence & custody',
  difficultJobs: 'Difficult jobs completed',
};

function PerformanceTab({ e }: { e: EmployeeData }) {
  const p = e.performance;
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 5 }}>
        <SectionCard title={`Performance score (last ${p.windowDays} days)`}>
          <Typography variant="h1" component="div" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {p.score ?? '—'}
            <Typography component="span" color="text.secondary" sx={{ fontSize: 18, ml: 0.5 }}>
              / 100
            </Typography>
          </Typography>
          {!p.sufficientData && (
            <Alert severity="info" sx={{ my: 1 }}>
              Not enough recent jobs for a reliable score.
            </Alert>
          )}
          <Stack spacing={1.25} sx={{ mt: 1.5 }}>
            {Object.entries(p.components).map(([k, v]) => (
              <Box key={k}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2">
                    {COMPONENT_LABELS[k] ?? humanize(k)}{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      (weight {Math.round((p.weights[k] ?? 0) * 100)}%)
                    </Typography>
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {Math.round(v)}
                  </Typography>
                </Stack>
                <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, v))} sx={{ height: 6, borderRadius: 3 }} />
              </Box>
            ))}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {p.explanation}
          </Typography>
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 7 }}>
        <SectionCard title="Inputs (from real records)">
          {Object.entries(p.inputs).map(([k, v]) => (
            <KeyValue key={k} label={INPUT_LABELS[k] ?? humanize(k)} value={v == null ? '—' : k === 'ratingsAvg' ? Number(v).toFixed(2) : v} />
          ))}
          <Typography variant="caption" color="text.secondary">
            Complaints count only when support marks them verified. Resolve a performance challenge in the worker’s favour by marking the related complaint unverified in the Support desk.
          </Typography>
        </SectionCard>
      </Grid>
    </Grid>
  );
}

export default function EmployeeDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { notify, node } = useNotice();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabKey) || 'overview';
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['admin', 'employees', 'detail', id], queryFn: () => api.get<EmployeeData>(`/admin/employees/${id}`) });
  const e = q.data;

  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.error || !e)
    return (
      <Box>
        <BackLink to="/admin/employees" label="Employees" />
        <ErrorState error={q.error ?? new Error('Employee not found')} onRetry={() => void q.refetch()} />
      </Box>
    );
  const wp = e.workerProfile;
  const field = e.roles.includes('driver') || e.roles.includes('worker');
  const setTab = (t: TabKey) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });

  return (
    <Box>
      <BackLink to="/admin/employees" label="Employees" />
      <PageHeader
        title={
          <Stack direction="row" spacing={1.5} alignItems="center" component="span">
            <Avatar src={e.photoUrl ?? undefined} sx={{ width: 44, height: 44 }}>
              {e.fullName[0]}
            </Avatar>
            <span>
              {e.fullName}
              <SampleTag show={e.isSample} />
            </span>
          </Stack>
        }
        subtitle={
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center" component="span">
            <span>{wp?.employeeCode}</span>
            {e.roles
              .filter((r) => r !== 'customer')
              .map((r) => (
                <Chip key={r} size="small" variant="outlined" label={ROLE_LABELS[r] ?? r} />
              ))}
            <Chip size="small" color={ACCOUNT_COLOR(e.status)} label={humanize(e.status)} />
            <Chip size="small" variant="outlined" color={VERIFICATION_COLOR(wp?.verificationStatus)} label={`Verification: ${humanize(wp?.verificationStatus).toLowerCase()}`} />
            {e.availability && <Chip size="small" variant="outlined" color={AVAILABILITY_COLOR(e.availability.status)} label={`${humanize(e.availability.status)} since ${relative(e.availability.statusSince)}`} />}
          </Stack>
        }
        actions={
          can('employee:manage') && (
            <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => setEditing(true)}>
              Edit profile
            </Button>
          )
        }
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="overview" label="Overview" />
        <Tab value="compensation" label="Compensation" />
        <Tab value="documents" label="Documents" />
        {field && <Tab value="performance" label="Performance" />}
        {field && <Tab value="attendance" label="Attendance" />}
        {field && <Tab value="assignments" label={`Assignments (${e.assignments.length})`} />}
        {field && <Tab value="incidents" label={`Incidents (${e.incidents.length})`} />}
      </Tabs>

      {tab === 'overview' && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Stack spacing={2}>
              <SectionCard title="Profile">
                <KeyValue label="Phone" value={e.phone ? <Link href={`tel:${e.phone}`}>{e.phone}</Link> : '—'} />
                <KeyValue label="Email" value={e.email ?? '—'} />
                <KeyValue label="Joined" value={date(wp?.joinedAt)} />
                <KeyValue label="Zones" value={wp?.zones.map((z) => z.name).join(', ') || 'None — will not receive jobs'} />
                <KeyValue label="Skills" value={wp?.skills.length ? wp.skills.join(', ') : '—'} />
                <KeyValue label="Emergency contact" value={wp?.emergencyContactName ? `${wp.emergencyContactName}${wp.emergencyContactPhone ? ` · ${wp.emergencyContactPhone}` : ''}` : '—'} />
                {e.availability && (
                  <KeyValue
                    label="Last location"
                    value={e.availability.lastLocationAt ? `${relative(e.availability.lastLocationAt)} (sharing ${e.availability.locationSharing ? 'on' : 'off'})` : 'Never reported'}
                  />
                )}
              </SectionCard>
              {e.driverProfile && (
                <SectionCard title="Driving licence">
                  <KeyValue label="Number" value={e.driverProfile.licenceNumberMask} />
                  <KeyValue label="Class" value={e.driverProfile.licenceClass} />
                  <KeyValue
                    label="Expiry"
                    value={
                      <Typography variant="body2" color={new Date(e.driverProfile.licenceExpiry) < new Date() ? 'error.main' : undefined} component="span">
                        {date(e.driverProfile.licenceExpiry)} ({relative(e.driverProfile.licenceExpiry)})
                      </Typography>
                    }
                  />
                  <KeyValue label="Heavy-vehicle certified" value={e.driverProfile.heavyVehicleCert ? 'Yes' : 'No'} />
                  <KeyValue label="Can lead a team" value={e.driverProfile.canLeadTeam ? 'Yes' : 'No'} />
                </SectionCard>
              )}
              {e.driverProfile && <TruckCard e={e} notify={notify} />}
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <Stack spacing={2}>
              {can('employee:verify') && field && <VerificationCard e={e} notify={notify} />}
              {can('employee:manage') && <AccountCard e={e} notify={notify} />}
              {can('roles:manage') && <RolesCard e={e} notify={notify} />}
              {!can('employee:verify') && !can('employee:manage') && !can('roles:manage') && <Alert severity="info">You have read-only access to employee records.</Alert>}
            </Stack>
          </Grid>
        </Grid>
      )}
      {tab === 'compensation' && <CompensationTab e={e} />}
      {tab === 'documents' && <DocumentsTab e={e} notify={notify} />}
      {tab === 'performance' && field && <PerformanceTab e={e} />}
      {tab === 'attendance' && field && (
        <SectionCard title="Availability log (latest 60 entries)">
          {!e.attendance.length ? (
            <EmptyState title="No availability changes recorded" />
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Status</TableCell>
                    <TableCell>From</TableCell>
                    <TableCell>To</TableCell>
                    <TableCell>Duration</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {e.attendance.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Chip size="small" variant="outlined" color={AVAILABILITY_COLOR(a.status)} label={humanize(a.status)} />
                      </TableCell>
                      <TableCell>{dateTime(a.startedAt)}</TableCell>
                      <TableCell>{a.endedAt ? dateTime(a.endedAt) : 'Now'}</TableCell>
                      <TableCell>{durationBetween(a.startedAt, a.endedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </SectionCard>
      )}
      {tab === 'assignments' && field && (
        <SectionCard title="Job offers & assignments (latest 50)">
          {!e.assignments.length ? (
            <EmptyState title="No job offers yet" />
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Booking</TableCell>
                    <TableCell>Outcome</TableCell>
                    <TableCell>Offered</TableCell>
                    <TableCell>Responded</TableCell>
                    <TableCell>Distance / ETA</TableCell>
                    <TableCell>Reason</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {e.assignments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <BookingLink id={a.bookingId} code={a.booking.code} />
                        <Typography variant="caption" color="text.secondary" display="block">
                          {humanize(a.method)} · booking {humanize(a.booking.status).toLowerCase()}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" color={ASSIGNMENT_COLOR(a.status)} label={humanize(a.status)} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{dateTime(a.offeredAt)}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{dateTime(a.respondedAt)}</TableCell>
                      <TableCell>
                        {a.distanceKm != null ? `${a.distanceKm} km` : '—'} / {a.etaMinutes != null ? `${a.etaMinutes} min` : '—'}
                      </TableCell>
                      <TableCell>{a.rejectionReason ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </SectionCard>
      )}
      {tab === 'incidents' && field && (
        <SectionCard title="Incidents reported by this employee">
          {!e.incidents.length ? (
            <EmptyState title="No incidents reported" body="Reporting incidents is never penalised in performance scoring." />
          ) : (
            <Stack spacing={1}>
              {e.incidents.map((i) => (
                <Box key={i.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.25 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography sx={{ fontWeight: 700 }}>{humanize(i.type)}</Typography>
                    <PriorityChip priority={i.severity} />
                    <Chip size="small" color={ESCALATION_COLOR(i.status)} label={humanize(i.status)} />
                    {i.bookingId && <BookingLink id={i.bookingId} code="View booking" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {i.description}
                  </Typography>
                  {i.resolution && <Typography variant="caption">Resolution: {i.resolution}</Typography>}
                  <Typography variant="caption" color="text.secondary" display="block">
                    {dateTime(i.createdAt)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </SectionCard>
      )}
      <EmployeeFormDialog open={editing} onClose={() => setEditing(false)} employee={e} notify={notify} />
      {node}
    </Box>
  );
}
