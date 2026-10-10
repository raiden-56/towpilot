import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, Link, Stack, Tab, Tabs, Typography, useMediaQuery, useTheme } from '@mui/material';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import { api } from '@/api/client';
import { Money, PageHeader, PaymentChip } from '@/components/common';
import { DataTable, type Column } from '@/components/DataTable';
import { date, dateTime, inr } from '@/lib/format';
import { INVOICE_TYPE_LABELS, METHOD_LABELS, TXN_LABELS, txnColor, type InvoiceListRow, type PaymentHistoryRow } from './components/billingTypes';

const PAGE_SIZE = 20;

/** On phones the whole card is a button, so nested links would be invalid; on desktop a real link keeps rows keyboard-accessible. */
function useIsPhone() {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('sm'));
}

function InvoicesTab() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['invoices', 'list', page], queryFn: () => api.page<InvoiceListRow>('/invoices', { page, pageSize: PAGE_SIZE }), placeholderData: keepPreviousData });
  const rows = q.data?.data;
  const outstandingRows = (rows ?? []).filter((r) => r.status === 'ISSUED' && r.outstanding > 0);
  const outstandingTotal = outstandingRows.reduce((a, r) => a + r.outstanding, 0);

  const columns: Column<InvoiceListRow>[] = [
    {
      key: 'number',
      header: 'Invoice',
      primary: true,
      render: (r) => (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {phone ? (
            <Box component="span" sx={{ fontWeight: 700, wordBreak: 'break-all' }}>
              {r.number}
            </Box>
          ) : (
            <Link component={RouterLink} to={`/app/billing/${r.id}`} onClick={(e) => e.stopPropagation()} sx={{ fontWeight: 700 }}>
              {r.number}
            </Link>
          )}
          {r.status === 'VOID' && <Chip size="small" variant="outlined" label="Void" />}
        </Stack>
      ),
    },
    { key: 'type', header: 'Type', render: (r) => INVOICE_TYPE_LABELS[r.type] ?? r.type },
    { key: 'booking', header: 'Booking', render: (r) => r.booking?.code ?? '—', hideOnMobile: true },
    { key: 'issued', header: 'Issued', render: (r) => date(r.issuedAt) },
    { key: 'total', header: 'Total', align: 'right', render: (r) => <Money value={r.total} /> },
    { key: 'outstanding', header: 'Outstanding', align: 'right', render: (r) => (r.status === 'VOID' ? '—' : <Money value={r.outstanding} strong={r.outstanding > 0} negative={r.outstanding > 0} />) },
    { key: 'status', header: 'Status', render: (r) => <PaymentChip status={r.paymentStatus} /> },
  ];

  return (
    <Stack spacing={2}>
      {outstandingTotal > 0 && (
        <Alert
          severity="warning"
          action={
            outstandingRows.length === 1 ? (
              <Button color="inherit" size="small" component={RouterLink} to={`/app/billing/${outstandingRows[0]!.id}`}>
                Pay now
              </Button>
            ) : undefined
          }
        >
          <strong>{inr(outstandingTotal)}</strong> outstanding across {outstandingRows.length} invoice{outstandingRows.length === 1 ? '' : 's'}
          {(q.data?.meta.totalPages ?? 1) > 1 ? ' on this page' : ''}. Open an invoice to pay.
        </Alert>
      )}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        onRowClick={(r) => navigate(`/app/billing/${r.id}`)}
        emptyTitle="No invoices yet"
        emptyBody="Invoices appear here after a completed service, a cancellation fee or a membership purchase."
        page={page}
        pageSize={PAGE_SIZE}
        total={q.data?.meta.total}
        onPageChange={setPage}
      />
    </Stack>
  );
}

function PaymentsTab() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['invoices', 'payments', page], queryFn: () => api.page<PaymentHistoryRow>('/payments/history', { page, pageSize: PAGE_SIZE }), placeholderData: keepPreviousData });

  const columns: Column<PaymentHistoryRow>[] = [
    {
      key: 'amount',
      header: 'Amount',
      primary: true,
      render: (r) => (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Money value={r.amount} strong />
          <Typography component="span" variant="body2" color="text.secondary">
            {METHOD_LABELS[r.method] ?? r.method}
          </Typography>
        </Stack>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap justifyContent={{ xs: 'flex-end', sm: 'flex-start' }}>
          <Chip size="small" color={txnColor(r.status)} variant={r.status === 'SUCCEEDED' ? 'filled' : 'outlined'} label={r.method === 'CASH' && r.status === 'PENDING' ? 'Awaiting finance confirmation' : TXN_LABELS[r.status]} />
          {r.isSandbox && <Chip size="small" color="warning" variant="outlined" icon={<ScienceOutlinedIcon />} label="Sandbox — not real money" />}
        </Stack>
      ),
    },
    { key: 'receipt', header: 'Receipt', render: (r) => r.receiptNumber ?? '—' },
    {
      key: 'invoice',
      header: 'Invoice',
      render: (r) =>
        phone ? (
          r.invoice.number
        ) : (
          <Link component={RouterLink} to={`/app/billing/${r.invoice.id}`} onClick={(e) => e.stopPropagation()}>
            {r.invoice.number}
          </Link>
        ),
    },
    { key: 'date', header: 'Date', render: (r) => dateTime(r.succeededAt ?? r.createdAt) },
    {
      key: 'note',
      header: 'Note',
      render: (r) =>
        r.failureReason ? (
          <Typography variant="body2" color="error.main" component="span">
            {r.failureReason}
          </Typography>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <DataTable
      rows={q.data?.data}
      columns={columns}
      rowKey={(r) => r.id}
      loading={q.isPending}
      error={q.isError ? q.error : undefined}
      onRetry={() => void q.refetch()}
      onRowClick={(r) => navigate(`/app/billing/${r.invoice.id}`)}
      emptyTitle="No payments yet"
      emptyBody="Payments you make online, and cash payments confirmed by our team, are listed here."
      page={page}
      pageSize={PAGE_SIZE}
      total={q.data?.meta.total}
      onPageChange={setPage}
    />
  );
}

export default function Billing() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'payments' ? 'payments' : 'invoices';

  return (
    <Box>
      <PageHeader title="Billing" subtitle="Your invoices, payments, refunds and receipts." />
      <Tabs
        value={tab}
        onChange={(_, v: string) => setParams(v === 'payments' ? { tab: 'payments' } : {}, { replace: true })}
        aria-label="Billing sections"
        variant="fullWidth"
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', maxWidth: 420 }}
      >
        <Tab value="invoices" label="Invoices" id="billing-tab-invoices" aria-controls="billing-panel-invoices" />
        <Tab value="payments" label="Payment history" id="billing-tab-payments" aria-controls="billing-panel-payments" />
      </Tabs>
      <Box role="tabpanel" id={`billing-panel-${tab}`} aria-labelledby={`billing-tab-${tab}`}>
        {tab === 'invoices' ? <InvoicesTab /> : <PaymentsTab />}
      </Box>
    </Box>
  );
}
