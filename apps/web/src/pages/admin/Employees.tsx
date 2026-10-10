import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Avatar, Box, Button, Card, CardContent, Chip, InputAdornment, Link, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { api } from '@/api/client';
import { PageHeader, SampleTag, SectionCard } from '@/components/common';
import { DataTable, type Column } from '@/components/DataTable';
import { useAuth } from '@/hooks/useAuth';
import { date, humanize, relative } from '@/lib/format';
import { EmployeeFormDialog } from './ops/EmployeeFormDialog';
import {
  ACCOUNT_COLOR,
  ACCOUNT_STATUSES,
  AVAILABILITY_COLOR,
  AVAILABILITY_STATUSES,
  EMPLOYEE_ROLES,
  FilterSelect,
  opts,
  ROLE_LABELS,
  useDebounced,
  useNotice,
  useZones,
  VERIFICATION_COLOR,
  VERIFICATION_STATUSES,
} from './ops/shared';
import type { Employee } from './ops/types';

interface Expiring {
  licences: { id: string; userId: string; licenceClass: string; licenceExpiry: string; user: { id: string; fullName: string; status: string } }[];
  documents: { id: string; userId: string; type: string; numberMasked: string | null; expiresAt: string; user: { id: string; fullName: string } }[];
}

function ExpiryChip({ at }: { at: string }) {
  const expired = new Date(at).getTime() < Date.now();
  return <Chip size="small" color={expired ? 'error' : 'warning'} label={expired ? `Expired ${relative(at)}` : `Expires ${relative(at)}`} />;
}

function Compliance() {
  const [days, setDays] = useState('30');
  const q = useQuery({ queryKey: ['admin', 'employees', 'compliance', days], queryFn: () => api.get<Expiring>('/admin/employees/compliance/expiring', { days }) });
  const licCols: Column<Expiring['licences'][number]>[] = [
    { key: 'name', header: 'Driver', primary: true, render: (r) => <Link component={RouterLink} to={`/admin/employees/${r.user.id}`}>{r.user.fullName}</Link> },
    { key: 'class', header: 'Licence class', render: (r) => r.licenceClass },
    { key: 'expiry', header: 'Expiry', render: (r) => date(r.licenceExpiry) },
    { key: 'state', header: 'Status', render: (r) => <ExpiryChip at={r.licenceExpiry} /> },
    { key: 'account', header: 'Account', render: (r) => <Chip size="small" variant="outlined" color={ACCOUNT_COLOR(r.user.status)} label={humanize(r.user.status)} /> },
  ];
  const docCols: Column<Expiring['documents'][number]>[] = [
    { key: 'name', header: 'Employee', primary: true, render: (r) => <Link component={RouterLink} to={`/admin/employees/${r.user.id}`}>{r.user.fullName}</Link> },
    { key: 'type', header: 'Document', render: (r) => `${humanize(r.type)}${r.numberMasked ? ` (${r.numberMasked})` : ''}` },
    { key: 'expiry', header: 'Expiry', render: (r) => date(r.expiresAt) },
    { key: 'state', header: 'Status', render: (r) => <ExpiryChip at={r.expiresAt} /> },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <FilterSelect
          label="Window"
          value={days}
          onChange={setDays}
          allLabel={null}
          options={[
            { value: '30', label: 'Expired or expiring in 30 days' },
            { value: '60', label: 'Expired or expiring in 60 days' },
            { value: '90', label: 'Expired or expiring in 90 days' },
            { value: '365', label: 'Expired or expiring in 1 year' },
          ]}
          minWidth={260}
        />
        <Typography variant="body2" color="text.secondary">
          Expired licences block dispatch automatically; renew them and upload the new document.
        </Typography>
      </Stack>
      <SectionCard title={`Driving licences (${q.data?.licences.length ?? 0})`}>
        <DataTable rows={q.data?.licences} columns={licCols} rowKey={(r) => r.id} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} emptyTitle="No licences expiring in this window" dense />
      </SectionCard>
      <SectionCard title={`Approved documents (${q.data?.documents.length ?? 0})`}>
        <DataTable rows={q.data?.documents} columns={docCols} rowKey={(r) => r.id} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} emptyTitle="No documents expiring in this window" dense />
      </SectionCard>
    </Stack>
  );
}

export default function Employees() {
  const nav = useNavigate();
  const { can } = useAuth();
  const { notify, fail, node } = useNotice();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const tab = get('tab') === 'compliance' ? 'compliance' : 'directory';
  const page = Number(get('page') || 1);
  const pageSize = Number(get('pageSize') || 20);
  const [search, setSearch] = useState(get('q'));
  const q = useDebounced(search.trim());
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const zones = useZones();

  const update = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (q !== get('q')) update({ q: q || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = { q: get('q') || undefined, role: get('role') || undefined, verification: get('verification') || undefined, status: get('status') || undefined, zoneId: get('zoneId') || undefined, availability: get('availability') || undefined, page, pageSize };
  const list = useQuery({ queryKey: ['admin', 'employees', 'list', query], queryFn: () => api.page<Employee>('/admin/employees', query), enabled: tab === 'directory', placeholderData: keepPreviousData });

  const doExport = async () => {
    setExporting(true);
    try {
      await api.download('/admin/employees/export.csv', 'employees.csv');
      notify('Employee CSV downloaded');
    } catch (e) {
      fail(e);
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<Employee>[] = [
    {
      key: 'name',
      header: 'Employee',
      primary: true,
      render: (e) => (
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Avatar src={e.photoUrl ?? undefined} sx={{ width: 32, height: 32, fontSize: 14, display: { xs: 'none', sm: 'flex' } }}>
            {e.fullName[0]}
          </Avatar>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {e.fullName}
              <SampleTag show={e.isSample} />
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {e.workerProfile?.employeeCode ?? '—'} · {e.phone ?? e.email ?? ''}
            </Typography>
          </Box>
        </Stack>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (e) => (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {e.roles.filter((r) => r !== 'customer').map((r) => (
            <Chip key={r} size="small" variant="outlined" label={ROLE_LABELS[r] ?? r} />
          ))}
        </Stack>
      ),
    },
    { key: 'verification', header: 'Verification', render: (e) => <Chip size="small" color={VERIFICATION_COLOR(e.workerProfile?.verificationStatus)} variant="outlined" label={humanize(e.workerProfile?.verificationStatus ?? 'PENDING')} /> },
    { key: 'status', header: 'Account', render: (e) => <Chip size="small" color={ACCOUNT_COLOR(e.status)} label={humanize(e.status)} /> },
    { key: 'availability', header: 'Availability', render: (e) => (e.availability ? <Chip size="small" variant="outlined" color={AVAILABILITY_COLOR(e.availability.status)} label={humanize(e.availability.status)} /> : <Typography variant="caption" color="text.secondary">Office</Typography>) },
    { key: 'zones', header: 'Zones', hideOnMobile: true, render: (e) => e.workerProfile?.zones.map((z) => z.name).join(', ') || '—' },
    { key: 'truck', header: 'Truck', hideOnMobile: true, render: (e) => e.assignedTruck?.registrationNumber ?? '—' },
    {
      key: 'licence',
      header: 'Licence expiry',
      hideOnMobile: true,
      render: (e) => (e.driverProfile ? <Typography variant="body2" color={new Date(e.driverProfile.licenceExpiry) < new Date() ? 'error.main' : undefined}>{date(e.driverProfile.licenceExpiry)}</Typography> : '—'),
    },
  ];

  const filtersActive = ['q', 'role', 'verification', 'status', 'zoneId', 'availability'].some((k) => params.get(k));

  return (
    <Box>
      <PageHeader
        title="Employees"
        subtitle="Drivers, recovery workers and office staff"
        actions={
          <>
            {can('employee:manage') && (
              <Button variant="outlined" startIcon={<FileDownloadOutlinedIcon />} disabled={exporting} onClick={() => void doExport()}>
                {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            )}
            {can('employee:manage') && (
              <Button variant="contained" startIcon={<PersonAddAlt1OutlinedIcon />} onClick={() => setAdding(true)}>
                Add employee
              </Button>
            )}
          </>
        }
      />
      <Tabs value={tab} onChange={(_, v) => update({ tab: v === 'compliance' ? 'compliance' : null })} sx={{ mb: 2 }}>
        <Tab value="directory" label="Directory" />
        <Tab value="compliance" label="Compliance & expiries" />
      </Tabs>
      {tab === 'compliance' ? (
        <Compliance />
      ) : (
        <>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <TextField
                  size="small"
                  placeholder="Name, phone, email or employee code"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                  }}
                  sx={{ flex: '1 1 240px' }}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Search employees', maxLength: 60 } }}
                />
                <FilterSelect label="Role" value={get('role')} onChange={(v) => update({ role: v })} options={EMPLOYEE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r]! }))} />
                <FilterSelect label="Verification" value={get('verification')} onChange={(v) => update({ verification: v })} options={opts(VERIFICATION_STATUSES)} />
                <FilterSelect label="Account" value={get('status')} onChange={(v) => update({ status: v })} options={opts(ACCOUNT_STATUSES)} />
                <FilterSelect label="Zone" value={get('zoneId')} onChange={(v) => update({ zoneId: v })} options={(zones.data ?? []).map((z) => ({ value: z.id, label: z.name }))} />
                <FilterSelect label="Availability" value={get('availability')} onChange={(v) => update({ availability: v })} options={opts(AVAILABILITY_STATUSES)} />
                {filtersActive && (
                  <Button
                    onClick={() => {
                      setSearch('');
                      setParams(new URLSearchParams(), { replace: true });
                    }}
                  >
                    Clear
                  </Button>
                )}
              </Stack>
            </CardContent>
          </Card>
          <DataTable
            rows={list.data?.data}
            columns={columns}
            rowKey={(e) => e.id}
            loading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            onRowClick={(e) => nav(`/admin/employees/${e.id}`)}
            emptyTitle={filtersActive ? 'No employees match these filters' : 'No employees yet'}
            page={query.page}
            pageSize={pageSize}
            total={list.data?.meta.total}
            onPageChange={(p) => update({ page: String(p) }, false)}
            onPageSizeChange={(s) => update({ pageSize: String(s) })}
          />
        </>
      )}
      <EmployeeFormDialog open={adding} onClose={() => setAdding(false)} notify={notify} onSaved={(e) => nav(`/admin/employees/${e.id}`)} />
      {node}
    </Box>
  );
}
