import { Alert, Box, Tab, Tabs } from '@mui/material';
import { PageHeader } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { useTabParam, useToast } from './biz/shared';
import { ServicesTab, ZonesTab } from './biz/PricingCatalog';
import { RateCardsTab } from './biz/RateCards';
import { PromosTab } from './biz/Promos';

const TABS = ['services', 'zones', 'rate-cards', 'promos'] as const;
type TabKey = (typeof TABS)[number];

export default function Pricing() {
  const { can } = useAuth();
  const canManage = can('pricing:manage');
  const { toast, toastError, toastNode } = useToast();
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'rate-cards');
  return (
    <Box>
      <PageHeader title="Services & pricing" subtitle="Service catalogue, operating zones, versioned rate cards and promotions" />
      {!canManage && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Read-only view. Changing services, zones or prices requires the pricing manager permission.
        </Alert>
      )}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="rate-cards" label="Rate cards" />
        <Tab value="services" label="Services" />
        <Tab value="zones" label="Zones" />
        <Tab value="promos" label="Promo codes" />
      </Tabs>
      {tab === 'services' && <ServicesTab canManage={canManage} toast={toast} />}
      {tab === 'zones' && <ZonesTab canManage={canManage} toast={toast} />}
      {tab === 'rate-cards' && <RateCardsTab canManage={canManage} toast={toast} toastError={toastError} />}
      {tab === 'promos' && <PromosTab canManage={canManage} toast={toast} toastError={toastError} />}
      {toastNode}
    </Box>
  );
}
