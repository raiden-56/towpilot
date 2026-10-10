import { useState } from 'react';
import { Badge, Box, Button, Divider, IconButton, List, ListItemButton, ListItemText, Popover, Stack, Typography } from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Paged } from '@/api/client';
import type { NotificationItem } from '@/api/types';
import { relative } from '@/lib/format';
import { useAuth, homePathFor } from '@/hooks/useAuth';

export function NotificationsBell() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['notifications', 'bell'], queryFn: () => api.page<NotificationItem>('/me/notifications', { pageSize: 15 }), refetchInterval: 60_000 });
  const readAll = useMutation({ mutationFn: () => api.post('/me/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unread = (q.data as Paged<NotificationItem> | undefined)?.meta.unread as number | undefined;

  const open = (n: NotificationItem) => {
    void api.post(`/me/notifications/${n.id}/read`).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
    const bookingId = n.data?.bookingId as string | undefined;
    const invoiceId = n.data?.invoiceId as string | undefined;
    const home = homePathFor(user);
    setAnchor(null);
    if (bookingId) nav(home === '/admin' ? `/admin/bookings/${bookingId}` : home === '/driver' ? `/driver/jobs/${bookingId}` : `/app/bookings/${bookingId}`);
    else if (invoiceId && home === '/app') nav(`/app/billing/${invoiceId}`);
  };

  return (
    <>
      <IconButton color="inherit" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={(e) => setAnchor(e.currentTarget)}>
        <Badge color="error" badgeContent={unread || 0} max={99}>
          <NotificationsNoneIcon />
        </Badge>
      </IconButton>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { width: 360, maxWidth: 'calc(100vw - 24px)' } } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.25 }}>
          <Typography variant="h6">Notifications</Typography>
          <Button size="small" onClick={() => readAll.mutate()} disabled={!unread}>
            Mark all read
          </Button>
        </Stack>
        <Divider />
        <List dense sx={{ maxHeight: 420, overflow: 'auto', py: 0 }}>
          {q.data?.data.length === 0 && (
            <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
              <Typography variant="body2">You are all caught up.</Typography>
            </Box>
          )}
          {q.data?.data.map((n) => (
            <ListItemButton key={n.id} onClick={() => open(n)} sx={{ alignItems: 'flex-start', bgcolor: n.readAt ? undefined : 'action.hover', borderRadius: 0 }}>
              <ListItemText
                primary={<Typography variant="body2" sx={{ fontWeight: n.readAt ? 500 : 700 }}>{n.title}</Typography>}
                secondary={
                  <>
                    <Typography variant="caption" component="span" sx={{ display: 'block', whiteSpace: 'pre-line' }}>
                      {n.body}
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      {relative(n.createdAt)}
                    </Typography>
                  </>
                }
              />
            </ListItemButton>
          ))}
        </List>
      </Popover>
    </>
  );
}
