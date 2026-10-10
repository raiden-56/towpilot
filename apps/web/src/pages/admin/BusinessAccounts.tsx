import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Button, InputAdornment, Stack, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '@/api/client';
import { DataTable, type Column } from '@/components/DataTable';
import { Money, PageHeader, SampleTag } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { date } from '@/lib/format';
import type { FleetAccountRow } from './biz/types';
import { EnumChip, FilterBar, num, useDebounced, useToast } from './biz/shared';
import { AccountFormDialog } from './biz/AccountForm';

export default function BusinessAccounts() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { toast, toastNode } = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const dq = useDebounced(q.trim());

  const list = useQuery({
    queryKey: ['admin', 'fleet-accounts', { q: dq, page, pageSize }],
    queryFn: () => api.page<FleetAccountRow>('/admin/fleet-accounts', { q: dq || undefined, page, pageSize }),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ id: string }>('/admin/fleet-accounts', body),
    onSuccess: (a) => {
      toast('Business account created');
      setCreateOpen(false);
      void qc.invalidateQueries({ queryKey: ['admin', 'fleet-accounts'] });
      nav(`/admin/accounts/${a.id}`);
    },
  });

  const columns: Column<FleetAccountRow>[] = [
    {
      key: 'name',
      header: 'Account',
      primary: true,
      render: (a) => (
        <Box>
          <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
            {a.name}
          </Typography>
          <SampleTag show={a.isSample} />
          <Typography variant="caption" color="text.secondary" display="block">
            {[a.gstin && `GSTIN ${a.gstin}`, a.billingEmail].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
      ),
    },
    { key: 'status', header: 'Status', render: (a) => <EnumChip value={a.status} /> },
    { key: 'members', header: 'Members', align: 'right', render: (a) => <Box sx={num}>{a._count.members}</Box> },
    { key: 'vehicles', header: 'Vehicles', align: 'right', render: (a) => <Box sx={num}>{a._count.vehicles}</Box> },
    { key: 'bookings', header: 'Bookings', align: 'right', render: (a) => <Box sx={num}>{a._count.bookings}</Box> },
    {
      key: 'contracts',
      header: 'Active contract',
      render: (a) =>
        a.contracts.length ? (
          <Tooltip title={a.contracts.map((c) => `${c.name}: ${c.discountBps / 100}% off, until ${date(c.endsAt)}`).join(' | ')}>
            <Typography variant="body2">
              {a.contracts[0]!.name}
              {a.contracts.length > 1 ? ` +${a.contracts.length - 1}` : ''}
            </Typography>
          </Tooltip>
        ) : (
          <Typography variant="body2" color="text.secondary">
            None
          </Typography>
        ),
    },
    { key: 'terms', header: 'Terms', align: 'right', render: (a) => <Box sx={num}>{a.paymentTermsDays} days</Box>, hideOnMobile: true },
    { key: 'limit', header: 'Credit limit', align: 'right', render: (a) => <Money value={a.creditLimit} />, hideOnMobile: true },
    {
      key: 'outstanding',
      header: 'Outstanding',
      align: 'right',
      render: (a) => (
        <Stack alignItems="flex-end">
          <Money value={a.outstanding} strong={a.outstanding > 0} negative={a.creditLimit > 0 && a.outstanding > a.creditLimit} />
          {a.creditLimit > 0 && a.outstanding > a.creditLimit && (
            <Typography variant="caption" color="error.main">
              Over credit limit
            </Typography>
          )}
        </Stack>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Business accounts"
        subtitle="Corporate and fleet customers with consolidated billing, contracts and credit terms"
        actions={
          can('customer:manage') && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                create.reset();
                setCreateOpen(true);
              }}
            >
              New account
            </Button>
          )
        }
      />
      <FilterBar>
        <TextField
          size="small"
          placeholder="Search by account name"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          sx={{ minWidth: { md: 320 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Search accounts', maxLength: 60 } }}
        />
      </FilterBar>
      <DataTable
        rows={list.data?.data}
        columns={columns}
        rowKey={(a) => a.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(a) => nav(`/admin/accounts/${a.id}`)}
        emptyTitle={dq ? 'No matching accounts' : 'No business accounts yet'}
        emptyBody={dq ? 'Try a different name.' : 'Create an account to bill a company for its members’ bookings.'}
        page={page}
        pageSize={pageSize}
        total={list.data?.meta.total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />
      <AccountFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSubmit={(b) => create.mutate(b)} submitting={create.isPending} error={create.error} />
      {toastNode}
    </Box>
  );
}
