import { useEffect, useRef } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertTitle, Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
import SendIcon from '@mui/icons-material/SendOutlined';
import { api, ApiError } from '@/api/client';
import { ErrorState, errorMessage, LoadingBlock, PageHeader, SectionCard } from '@/components/common';
import { useIsOnline } from '@/hooks/useOnline';
import { useConfig } from '@/hooks/useConfig';
import { dateTime, relative } from '@/lib/format';
import { BackLink, useToast } from './components/shared';
import { CATEGORY_LABELS, PRIORITY_LABELS, priorityColor, TICKET_STATUS_LABELS, ticketStatusColor, type TicketDetailData, type TicketMessage } from './components/supportTypes';

const replySchema = z.object({ body: z.string().trim().min(1, 'Write a message first').max(4000, 'Keep it under 4000 characters') });
type ReplyValues = z.infer<typeof replySchema>;

function Bubble({ m }: { m: TicketMessage }) {
  const mine = m.fromCustomer;
  return (
    <Stack alignItems={mine ? 'flex-end' : 'flex-start'} component="li" sx={{ listStyle: 'none' }}>
      <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, mb: 0.25 }}>
        {m.authorName ?? (mine ? 'You' : 'Support team')} · <time dateTime={m.createdAt} title={dateTime(m.createdAt)}>{dateTime(m.createdAt)}</time>
      </Typography>
      <Paper
        sx={{
          px: 1.75,
          py: 1.25,
          maxWidth: { xs: '88%', sm: '75%' },
          borderRadius: 3,
          borderTopRightRadius: mine ? 4 : undefined,
          borderTopLeftRadius: mine ? undefined : 4,
          bgcolor: mine ? 'secondary.main' : 'background.paper',
          color: mine ? 'secondary.contrastText' : 'text.primary',
          borderColor: mine ? 'secondary.main' : 'divider',
        }}
      >
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {m.body}
        </Typography>
      </Paper>
    </Stack>
  );
}

export default function TicketDetail() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const online = useIsOnline();
  const { toast, toastNode } = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const emergency = useConfig().data?.business.emergencyNumber ?? '112';

  const q = useQuery({ queryKey: ['support', 'ticket', id], queryFn: () => api.get<TicketDetailData>(`/support/tickets/${id}`), enabled: !!id, refetchInterval: 30_000 });
  const t = q.data;

  // Confirmation after creating a ticket on the Support page.
  const created = (location.state as { created?: string } | null)?.created;
  useEffect(() => {
    if (created) {
      toast(`Ticket ${created} created. We'll reply here and notify you.`);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [created, location.pathname, navigate, toast]);

  // Scroll to the newest message only when new ones arrive (not on first load).
  const count = t?.messages.length ?? 0;
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    if (!count) return;
    if (prevCount.current != null && count > prevCount.current) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    prevCount.current = count;
  }, [count]);

  const form = useForm<ReplyValues>({ resolver: zodResolver(replySchema), defaultValues: { body: '' } });
  const reply = useMutation({
    mutationFn: (v: ReplyValues) => api.post(`/support/tickets/${id}/messages`, { body: v.body.trim() }),
    onSuccess: () => {
      form.reset({ body: '' });
      toast('Message sent');
      void qc.invalidateQueries({ queryKey: ['support'] });
    },
    onError: (e) => {
      const fe = e instanceof ApiError ? e.fieldErrors.body : undefined;
      if (fe) form.setError('body', { message: fe });
      else toast(errorMessage(e), 'error');
    },
  });

  const back = <BackLink to="/app/support" label="Support" />;

  if (q.isPending)
    return (
      <Box>
        <PageHeader back={back} title="Ticket" />
        <LoadingBlock rows={4} height={64} />
      </Box>
    );
  if (q.isError || !t)
    return (
      <Box>
        <PageHeader back={back} title="Ticket" />
        <ErrorState error={q.error} title={q.error instanceof ApiError && q.error.status === 404 ? 'Ticket not found' : 'Could not load this ticket'} onRetry={() => void q.refetch()} />
      </Box>
    );

  const closed = t.status === 'RESOLVED' || t.status === 'CLOSED';

  return (
    <Box>
      <PageHeader back={back} title={t.subject} subtitle={`${t.number} · Opened ${dateTime(t.createdAt)} · Updated ${relative(t.updatedAt)}`} />

      <Stack spacing={2}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip color={ticketStatusColor(t.status)} variant={t.status === 'AWAITING_CUSTOMER' ? 'filled' : 'outlined'} label={TICKET_STATUS_LABELS[t.status] ?? t.status} />
          <Chip variant="outlined" label={CATEGORY_LABELS[t.category] ?? t.category} />
          {t.priority !== 'MEDIUM' && <Chip color={priorityColor(t.priority)} variant="outlined" label={PRIORITY_LABELS[t.priority] ?? t.priority} />}
          {t.booking && <Chip component={RouterLink} to={`/app/bookings/${t.booking.id}`} clickable variant="outlined" label={`Booking ${t.booking.code}`} />}
          {t.invoice && <Chip component={RouterLink} to={`/app/billing/${t.invoice.id}`} clickable variant="outlined" label={`Invoice ${t.invoice.number}`} />}
        </Stack>

        {t.status === 'AWAITING_CUSTOMER' && <Alert severity="warning">Our team is waiting for your reply.</Alert>}
        {t.category === 'SAFETY' && !closed && <Alert severity="error">If anyone is in danger right now, call {emergency} first.</Alert>}

        {t.resolution && (
          <Alert severity="success">
            <AlertTitle>Resolution{t.resolvedAt ? ` · ${dateTime(t.resolvedAt)}` : ''}</AlertTitle>
            <Box sx={{ whiteSpace: 'pre-wrap' }}>{t.resolution}</Box>
          </Alert>
        )}

        <SectionCard title="Conversation">
          {t.messages.length === 0 ? (
            <Typography color="text.secondary">No messages yet.</Typography>
          ) : (
            <Stack component="ol" spacing={2} sx={{ m: 0, p: 0 }} aria-label="Messages" aria-live="polite">
              {t.messages.map((m) => (
                <Bubble key={m.id} m={m} />
              ))}
            </Stack>
          )}
          <div ref={endRef} />
        </SectionCard>

        <SectionCard title="Reply">
          <Stack component="form" noValidate spacing={1.5} onSubmit={form.handleSubmit((v) => reply.mutate(v))}>
            {closed && <Alert severity="info">This ticket is {t.status === 'RESOLVED' ? 'resolved' : 'closed'}. You can still add a message here. If the issue isn't fixed, mention it clearly in your reply or create a new ticket.</Alert>}
            <TextField
              label="Your message"
              multiline
              minRows={3}
              {...form.register('body')}
              error={!!form.formState.errors.body}
              helperText={form.formState.errors.body?.message}
              slotProps={{ htmlInput: { maxLength: 4000 } }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void form.handleSubmit((v) => reply.mutate(v))();
              }}
            />
            {!online && <Alert severity="error">You are offline. Reconnect to send your reply.</Alert>}
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
              <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                Ctrl + Enter to send
              </Typography>
              <Button type="submit" variant="contained" endIcon={<SendIcon />} disabled={reply.isPending || !online} sx={{ ml: 'auto' }}>
                {reply.isPending ? 'Sending…' : 'Send'}
              </Button>
            </Stack>
          </Stack>
        </SectionCard>
      </Stack>
      {toastNode}
    </Box>
  );
}
