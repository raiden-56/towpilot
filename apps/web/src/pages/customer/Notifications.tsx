import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Box, Button, Card, Chip, CircularProgress, Divider, IconButton, List, ListItem, ListItemButton, Pagination, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import DoneIcon from '@mui/icons-material/Done';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { NotificationItem } from '@/api/types';
import { EmptyState, ErrorState, errorMessage, LoadingBlock, PageHeader } from '@/components/common';
import { dateTime, relative } from '@/lib/format';
import { useToast } from './components/shared';

const PAGE_SIZE = 20;

function targetFor(n: NotificationItem): string | null {
  const d = n.data ?? {};
  const id = (k: string) => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : null);
  if (id('bookingId')) return `/app/bookings/${id('bookingId')}`;
  if (id('invoiceId')) return `/app/billing/${id('invoiceId')}`;
  if (id('ticketId')) return `/app/support/${id('ticketId')}`;
  return null;
}

function iconFor(n: NotificationItem): ReactNode {
  const d = n.data ?? {};
  if (d.bookingId || n.type.startsWith('booking')) return <LocalShippingOutlinedIcon fontSize="small" />;
  if (d.invoiceId || /^(payment|refund|invoice)/.test(n.type)) return <ReceiptLongOutlinedIcon fontSize="small" />;
  if (d.ticketId || n.type.startsWith('support')) return <SupportAgentOutlinedIcon fontSize="small" />;
  return <NotificationsNoneOutlinedIcon fontSize="small" />;
}

export default function Notifications() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast, toastNode } = useToast();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const q = useQuery({
    queryKey: ['notifications', 'page', page, unreadOnly],
    // Only send unread when filtering: the API coerces any present value (even "false") to true.
    queryFn: () => api.page<NotificationItem>('/me/notifications', { page, pageSize: PAGE_SIZE, unread: unreadOnly ? 'true' : undefined }),
    placeholderData: keepPreviousData,
  });

  const unread = typeof q.data?.meta.unread === 'number' ? q.data.meta.unread : null;
  const totalPages = q.data?.meta.totalPages ?? 0;

  // If marking items read empties the current page (Unread filter), step back.
  useEffect(() => {
    if (q.data && totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [q.data, totalPages, page]);

  const readAll = useMutation({
    mutationFn: () => api.post('/me/notifications/read-all'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      toast('All notifications marked as read');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/me/notifications/${id}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const open = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate(n.id);
    const to = targetFor(n);
    if (to) nav(to);
  };

  const items = q.data?.data ?? [];

  return (
    <Box>
      <PageHeader
        title="Notifications"
        subtitle={unread == null ? 'Updates about your bookings, payments and support requests.' : unread === 0 ? 'You’re all caught up.' : `${unread} unread notification${unread === 1 ? '' : 's'}`}
        actions={
          <Button variant="outlined" startIcon={readAll.isPending ? <CircularProgress size={18} /> : <DoneAllIcon />} onClick={() => readAll.mutate()} disabled={!unread || readAll.isPending}>
            Mark all as read
          </Button>
        }
      />

      <ToggleButtonGroup
        exclusive
        size="small"
        value={unreadOnly ? 'unread' : 'all'}
        onChange={(_, v) => {
          if (!v) return;
          setUnreadOnly(v === 'unread');
          setPage(1);
        }}
        aria-label="Filter notifications"
        color="primary"
        sx={{ mb: 2 }}
      >
        <ToggleButton value="all" sx={{ px: 2.5 }}>
          All
        </ToggleButton>
        <ToggleButton value="unread" sx={{ px: 2.5 }}>
          Unread{unread ? ` (${unread})` : ''}
        </ToggleButton>
      </ToggleButtonGroup>

      {q.isPending && <LoadingBlock rows={6} height={72} />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load notifications" />}

      {q.isSuccess && items.length === 0 && (
        <Card>
          <EmptyState
            icon={<NotificationsNoneOutlinedIcon sx={{ fontSize: 48, opacity: 0.6 }} />}
            title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
            body={unreadOnly ? 'You have read everything. Switch to All to see past updates.' : 'Booking updates, payment receipts and support replies will appear here.'}
            action={
              unreadOnly && (
                <Button
                  onClick={() => {
                    setUnreadOnly(false);
                    setPage(1);
                  }}
                >
                  Show all notifications
                </Button>
              )
            }
          />
        </Card>
      )}

      {q.isSuccess && items.length > 0 && (
        <Card sx={{ opacity: q.isPlaceholderData ? 0.6 : 1, transition: 'opacity 150ms' }} aria-busy={q.isFetching}>
          <List disablePadding>
            {items.map((n, i) => {
              const isUnread = !n.readAt;
              const to = targetFor(n);
              const interactive = isUnread || !!to;
              const content = (
                <Stack direction="row" spacing={1.5} sx={{ width: '100%', minWidth: 0 }}>
                  <Avatar sx={{ width: 36, height: 36, bgcolor: isUnread ? 'primary.main' : 'action.selected', color: isUnread ? 'primary.contrastText' : 'text.secondary', flexShrink: 0 }} aria-hidden>
                    {iconFor(n)}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      {isUnread && <Chip label="Unread" size="small" color="primary" sx={{ height: 20, fontSize: 11, fontWeight: 700 }} />}
                      <Typography component="h2" variant="body1" sx={{ fontWeight: isUnread ? 700 : 500, wordBreak: 'break-word' }}>
                        {n.title}
                      </Typography>
                    </Stack>
                    {n.body && (
                      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line', wordBreak: 'break-word', mt: 0.25 }}>
                        {n.body}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      <time dateTime={n.createdAt} title={dateTime(n.createdAt)}>
                        {relative(n.createdAt)} · {dateTime(n.createdAt)}
                      </time>
                    </Typography>
                  </Box>
                  {to && <ChevronRightIcon color="action" sx={{ alignSelf: 'center', flexShrink: 0 }} aria-hidden />}
                </Stack>
              );
              return (
                <Box component="li" key={n.id} sx={{ listStyle: 'none' }}>
                  {i > 0 && <Divider />}
                  <ListItem
                    component="div"
                    disablePadding
                    secondaryAction={
                      isUnread && (
                        <Tooltip title="Mark as read">
                          <span>
                            <IconButton aria-label={`Mark "${n.title}" as read`} onClick={() => markRead.mutate(n.id)} disabled={markRead.isPending && markRead.variables === n.id}>
                              <DoneIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )
                    }
                    sx={{
                      borderLeft: 4,
                      borderLeftColor: isUnread ? 'primary.main' : 'transparent',
                      bgcolor: isUnread ? 'action.hover' : undefined,
                      '& .MuiListItemSecondaryAction-root': { top: 12, transform: 'none' },
                    }}
                  >
                    {interactive ? (
                      <ListItemButton onClick={() => open(n)} sx={{ py: 1.5, pr: isUnread ? 7 : 2, alignItems: 'flex-start', borderRadius: 0 }}>
                        {content}
                      </ListItemButton>
                    ) : (
                      <Box sx={{ px: 2, py: 1.5, width: '100%' }}>{content}</Box>
                    )}
                  </ListItem>
                </Box>
              );
            })}
          </List>
        </Card>
      )}

      {totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 2.5 }}>
          <Pagination
            count={totalPages}
            page={Math.min(page, totalPages)}
            onChange={(_, p) => {
              setPage(p);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            color="primary"
            siblingCount={0}
            getItemAriaLabel={(type, p, selected) => (type === 'page' ? `${selected ? 'Current page, ' : ''}Page ${p}` : `Go to ${type} page`)}
          />
        </Stack>
      )}

      {toastNode}
    </Box>
  );
}
