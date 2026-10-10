import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Money, PageHeader, StatusChip } from '@/components/common';
import { DataTable, type Column } from '@/components/DataTable';
import { dateTime } from '@/lib/format';
import type { DriverJobRow } from './components/driverShared';

// Deductions are stored as negative amounts, so a plain sum is the net for the job.
const earned = (r: DriverJobRow) => r.earnings.reduce((s, e) => s + e.amount, 0);

const columns: Column<DriverJobRow>[] = [
  {
    key: 'vehicle',
    header: 'Vehicle',
    primary: true,
    render: (r) => (
      <Box>
        <Typography sx={{ fontWeight: 800, fontSize: '1.05rem' }}>{r.vehicle?.registrationNumber ?? '—'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {r.vehicle ? `${r.vehicle.make} ${r.vehicle.model} · ` : ''}
          {r.code}
        </Typography>
      </Box>
    ),
  },
  { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
  { key: 'service', header: 'Service', render: (r) => r.serviceCategory.name },
  { key: 'date', header: 'Date', render: (r) => dateTime(r.completedAt ?? r.createdAt) },
  {
    key: 'earn',
    header: 'My earnings',
    align: 'right',
    render: (r) =>
      r.earnings.length ? (
        <Money value={earned(r)} strong />
      ) : (
        <Typography variant="body2" color="text.secondary" component="span">
          —
        </Typography>
      ),
  },
];

export default function DriverJobs() {
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const q = useQuery({ queryKey: ['driver', 'jobs', page, pageSize], queryFn: () => api.page<DriverJobRow>('/driver/jobs', { page, pageSize }), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="My jobs" subtitle="Every job you worked on, newest first. Earnings show your own share once a job is closed." />
      <DataTable
        rows={q.data?.data}
        columns={columns}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        onRowClick={(r) => nav(`/driver/jobs/${r.id}`)}
        emptyTitle="No jobs yet"
        emptyBody="Jobs you accept or join appear here."
        page={page}
        pageSize={pageSize}
        total={q.data?.meta.total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />
    </>
  );
}
