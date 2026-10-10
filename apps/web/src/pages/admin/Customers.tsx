import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Box, Chip, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '@/api/client';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader, SampleTag } from '@/components/common';
import { date } from '@/lib/format';
import type { CustomerRow } from './biz/types';
import { EnumChip, FilterBar, num, useDebounced } from './biz/shared';

export default function Customers() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const dq = useDebounced(q.trim());

  const list = useQuery({
    queryKey: ['admin', 'customers', { q: dq, status, page, pageSize }],
    queryFn: () => api.page<CustomerRow>('/admin/customers', { q: dq || undefined, status: status || undefined, page, pageSize }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<CustomerRow>[] = [
    {
      key: 'name',
      header: 'Customer',
      primary: true,
      render: (c) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }} component="span">
            {c.fullName}
          </Typography>
          <SampleTag show={c.isSample} />
          <Typography variant="caption" color="text.secondary" display="block">
            {[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'}
          </Typography>
        </Box>
      ),
    },
    { key: 'status', header: 'Status', render: (c) => <EnumChip value={c.status} /> },
    {
      key: 'account',
      header: 'Business account',
      render: (c) =>
        c.fleetMemberships.length ? (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {c.fleetMemberships.map((m) => (
              <Chip
                key={m.fleetAccount.id}
                size="small"
                variant="outlined"
                label={m.fleetAccount.name}
                onClick={(e) => {
                  e.stopPropagation();
                  nav(`/admin/accounts/${m.fleetAccount.id}`);
                }}
              />
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Individual
          </Typography>
        ),
    },
    { key: 'bookings', header: 'Bookings', align: 'right', render: (c) => <Box sx={num}>{c._count.bookings}</Box> },
    { key: 'vehicles', header: 'Vehicles', align: 'right', render: (c) => <Box sx={num}>{c._count.vehicles}</Box> },
    { key: 'joined', header: 'Joined', render: (c) => date(c.createdAt), hideOnMobile: true },
  ];

  return (
    <Box>
      <PageHeader title="Customers" subtitle={list.data ? `${list.data.meta.total.toLocaleString('en-IN')} customer accounts` : 'Customer accounts, vehicles and history'} />
      <FilterBar>
        <TextField
          size="small"
          placeholder="Name, phone, email or vehicle number"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          sx={{ minWidth: { md: 340 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Search customers', maxLength: 60 } }}
        />
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          <MenuItem value="ACTIVE">Active</MenuItem>
          <MenuItem value="SUSPENDED">Suspended</MenuItem>
          <MenuItem value="DEACTIVATED">Deactivated</MenuItem>
        </TextField>
      </FilterBar>
      <DataTable
        rows={list.data?.data}
        columns={columns}
        rowKey={(c) => c.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(c) => nav(`/admin/customers/${c.id}`)}
        emptyTitle={dq || status ? 'No matching customers' : 'No customers yet'}
        emptyBody={dq || status ? 'Try a different search or clear the status filter.' : 'Customers appear here after they sign up with their phone number.'}
        page={page}
        pageSize={pageSize}
        total={list.data?.meta.total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />
    </Box>
  );
}
