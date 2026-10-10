import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Card, CardContent, FormControlLabel, MenuItem, Stack, Switch, Tab, Tabs, TextField } from '@mui/material';
import { api } from '@/api/client';
import { PageHeader } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { addDaysInput, todayInput, useTabParam, useToast } from './biz/shared';
import { useCategories, useZones } from './biz/queries';
import type { ReportQuery } from './biz/reportsShared';
import { ProfitabilityTab, ProfitLossTab, TrendsTab } from './biz/ReportsFinance';
import { CancellationsReport, CustomersReport, DemandReport, DriversReport, TrucksReport, ZonesReport } from './biz/ReportsOps';

const PERIODS: [string, string][] = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this_week', 'This week'],
  ['last_week', 'Last week'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'],
  ['this_fy', 'This financial year'],
  ['last_fy', 'Last financial year'],
  ['custom', 'Custom range'],
];

const FINANCE_TABS = ['pnl', 'trends', 'profitability'] as const;
const OPS_TABS = ['zones', 'drivers', 'trucks', 'customers', 'cancellations', 'demand'] as const;
const ALL_TABS = [...FINANCE_TABS, ...OPS_TABS] as const;
type TabKey = (typeof ALL_TABS)[number];
const LABELS: Record<TabKey, string> = { pnl: 'Profit & loss', trends: 'Trends', profitability: 'Profitability by service', zones: 'Zones', drivers: 'Drivers', trucks: 'Trucks', customers: 'Customers', cancellations: 'Cancellations', demand: 'Demand & coverage' };

export default function Reports() {
  const { can } = useAuth();
  const finance = can('finance:read');
  const ops = can('reports:read');
  const available = useMemo(() => [...(finance ? FINANCE_TABS : []), ...(ops ? OPS_TABS : [])] as TabKey[], [finance, ops]);
  const [tab, setTab] = useTabParam<TabKey>(available.length ? available : ['pnl'], available[0] ?? 'pnl');
  const { toastError, toastNode } = useToast();
  const [period, setPeriod] = useState('this_month');
  const [from, setFrom] = useState(addDaysInput(todayInput(), -30));
  const [to, setTo] = useState(todayInput());
  const [exclude, setExclude] = useState(false);
  const [zoneId, setZoneId] = useState('');
  const [serviceCategoryId, setService] = useState('');
  const zones = useZones(can('pricing:read'));
  const cats = useCategories(can('pricing:read'));
  const defs = useQuery({ queryKey: ['admin', 'reports', 'definitions'], queryFn: () => api.get<Record<string, string>>('/admin/reports/definitions'), staleTime: Infinity });

  const customBad = period === 'custom' && (!from || !to || to < from);
  const q: ReportQuery = useMemo(
    () => ({ period, ...(period === 'custom' ? { from, to } : {}), ...(exclude ? { excludeSample: true as const } : {}), ...(zoneId ? { zoneId } : {}), ...(serviceCategoryId ? { serviceCategoryId } : {}) }),
    [period, from, to, exclude, zoneId, serviceCategoryId],
  );
  useEffect(() => {
    if (available.length && !available.includes(tab)) setTab(available[0]!);
  }, [available, tab, setTab]);

  return (
    <Box>
      <PageHeader title="Reports & analytics" subtitle="Accrual operating results, cash flow, and operational performance — every figure computed from recorded transactions" />
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} useFlexGap flexWrap="wrap">
            <TextField select size="small" label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} sx={{ minWidth: 190 }}>
              {PERIODS.map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
            </TextField>
            {period === 'custom' && (
              <>
                <TextField size="small" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                <TextField size="small" type="date" label="To (inclusive)" value={to} onChange={(e) => setTo(e.target.value)} error={customBad} slotProps={{ inputLabel: { shrink: true } }} />
              </>
            )}
            <TextField select size="small" label="Zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)} sx={{ minWidth: 180 }} disabled={!zones.data}>
              <MenuItem value="">All zones</MenuItem>
              {(zones.data ?? []).map((z) => <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Service" value={serviceCategoryId} onChange={(e) => setService(e.target.value)} sx={{ minWidth: 180 }} disabled={!cats.data}>
              <MenuItem value="">All services</MenuItem>
              {(cats.data ?? []).map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <FormControlLabel control={<Switch checked={exclude} onChange={(e) => setExclude(e.target.checked)} />} label="Exclude sample/sandbox data" />
          </Stack>
        </CardContent>
      </Card>
      {!available.length ? (
        <Alert severity="info">You need reports or finance access to view analytics.</Alert>
      ) : (
        <>
          <Tabs value={available.includes(tab) ? tab : available[0]} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
            {available.map((t) => <Tab key={t} value={t} label={LABELS[t]} />)}
          </Tabs>
          {customBad ? (
            <Alert severity="warning">Choose a valid custom range (the end date must be on or after the start date).</Alert>
          ) : (
            <>
              {tab === 'pnl' && finance && <ProfitLossTab q={q} toastError={toastError} />}
              {tab === 'trends' && finance && <TrendsTab q={q} />}
              {tab === 'profitability' && finance && <ProfitabilityTab q={q} definition={defs.data?.contributionMargin} />}
              {tab === 'zones' && ops && <ZonesReport q={q} />}
              {tab === 'drivers' && ops && <DriversReport q={q} />}
              {tab === 'trucks' && ops && <TrucksReport q={q} />}
              {tab === 'customers' && ops && <CustomersReport q={q} />}
              {tab === 'cancellations' && ops && <CancellationsReport q={q} />}
              {tab === 'demand' && ops && <DemandReport q={q} />}
            </>
          )}
        </>
      )}
      {toastNode}
    </Box>
  );
}
