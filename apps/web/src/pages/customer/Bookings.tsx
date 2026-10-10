import { useSearchParams, Link as RouterLink } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Box, Button, Pagination, Stack, Tab, Tabs } from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import AddIcon from '@mui/icons-material/Add';
import { api } from '@/api/client';
import type { BookingSummary } from '@/api/types';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/common';
import { BookingCard } from './components/bookingParts';

type Group = 'active' | 'completed' | 'cancelled';
const GROUPS: { value: Group; label: string; empty: string; body: string }[] = [
  { value: 'active', label: 'Active', empty: 'No active bookings', body: 'When you request help, you can follow its progress here.' },
  { value: 'completed', label: 'Completed', empty: 'No completed bookings yet', body: 'Finished jobs, invoices and ratings appear here.' },
  { value: 'cancelled', label: 'Cancelled', empty: 'No cancelled bookings', body: 'Cancelled or unsuccessful requests appear here.' },
];
const PAGE_SIZE = 10;

export default function Bookings() {
  const [params, setParams] = useSearchParams();
  const group = (GROUPS.find((g) => g.value === params.get('tab'))?.value ?? 'active') as Group;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const meta = GROUPS.find((g) => g.value === group)!;

  const q = useQuery({
    queryKey: ['bookings', group, page],
    queryFn: () => api.page<BookingSummary>('/bookings', { group, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    refetchInterval: group === 'active' ? 60_000 : false,
  });

  const set = (next: { tab?: Group; page?: number }) => {
    const p = new URLSearchParams(params);
    if (next.tab) {
      p.set('tab', next.tab);
      p.delete('page');
    }
    if (next.page) p.set('page', String(next.page));
    setParams(p, { replace: true });
  };

  return (
    <Box>
      <PageHeader
        title="My bookings"
        actions={
          <Button component={RouterLink} to="/app/request" variant="contained" startIcon={<AddIcon />}>
            New request
          </Button>
        }
      />
      <Tabs value={group} onChange={(_, v: Group) => set({ tab: v })} variant="fullWidth" sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} aria-label="Booking groups">
        {GROUPS.map((g) => (
          <Tab key={g.value} value={g.value} label={g.label} />
        ))}
      </Tabs>

      {q.isLoading ? (
        <LoadingBlock rows={3} height={140} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState
          title={meta.empty}
          body={meta.body}
          action={
            group === 'active' ? (
              <Button component={RouterLink} to="/app/request" variant="contained">
                Request help
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Stack spacing={1.25} sx={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
          {q.data.data.map((b) => (
            <BookingCard
              key={b.id}
              b={b}
              action={
                group !== 'active' && b.vehicle ? (
                  <Button size="small" startIcon={<ReplayIcon />} component={RouterLink} to={`/app/request?repeat=${b.id}`}>
                    Book again
                  </Button>
                ) : undefined
              }
            />
          ))}
          {q.data.meta.totalPages > 1 && (
            <Stack alignItems="center" sx={{ pt: 1 }}>
              <Pagination count={q.data.meta.totalPages} page={page} onChange={(_, p) => set({ page: p })} color="primary" siblingCount={0} />
            </Stack>
          )}
        </Stack>
      )}
    </Box>
  );
}
