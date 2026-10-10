import { Box, Tab, Tabs } from '@mui/material';
import { PageHeader } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { useTabParam, useToast } from './biz/shared';
import { InvoicesTab, PaymentsTab, RefundsTab } from './biz/FinanceLedger';
import { AgeingTab, ExpensesTab, ReconciliationTab } from './biz/FinanceOps';

const TABS = ['invoices', 'payments', 'refunds', 'expenses', 'reconciliation', 'ageing'] as const;
type TabKey = (typeof TABS)[number];

export default function Finance() {
  const { can } = useAuth();
  const { toast, toastError, toastNode } = useToast();
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'invoices');
  const p = { toast, toastError, canManage: can('finance:manage') };
  return (
    <Box>
      <PageHeader title="Finance" subtitle="Invoices, collections, refunds, expenses and receivables. All amounts in INR." />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="invoices" label="Invoices" />
        <Tab value="payments" label="Payments" />
        <Tab value="refunds" label="Refunds" />
        <Tab value="expenses" label="Expenses & bills" />
        <Tab value="reconciliation" label="Reconciliation" />
        <Tab value="ageing" label="Ageing" />
      </Tabs>
      {tab === 'invoices' && <InvoicesTab {...p} />}
      {tab === 'payments' && <PaymentsTab {...p} />}
      {tab === 'refunds' && <RefundsTab {...p} />}
      {tab === 'expenses' && <ExpensesTab {...p} />}
      {tab === 'reconciliation' && <ReconciliationTab />}
      {tab === 'ageing' && <AgeingTab />}
      {toastNode}
    </Box>
  );
}
