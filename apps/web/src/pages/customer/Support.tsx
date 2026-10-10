import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardActionArea, Chip, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import PhoneIcon from '@mui/icons-material/PhoneOutlined';
import MailIcon from '@mui/icons-material/MailOutline';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
import { api, ApiError } from '@/api/client';
import type { BookingSummary } from '@/api/types';
import { EmergencyNotice, errorMessage, PageHeader, SectionCard } from '@/components/common';
import { DataTable, type Column } from '@/components/DataTable';
import { useConfig } from '@/hooks/useConfig';
import { useIsOnline } from '@/hooks/useOnline';
import { date, relative } from '@/lib/format';
import { useToast } from './components/shared';
import { CATEGORY_LABELS, CUSTOMER_CATEGORIES, TICKET_STATUS_LABELS, ticketStatusColor, type CustomerCategory, type TicketSummary } from './components/supportTypes';

const PAGE_SIZE = 20;

const CATEGORY_HINTS: Record<CustomerCategory, string> = {
  GENERAL: 'Questions about our service, your account or a booking.',
  COMPLAINT: 'Something went wrong with a service or our staff.',
  BILLING_DISPUTE: 'You think an invoice is incorrect. You can also dispute from the invoice page.',
  REFUND_REQUEST: 'For paid invoices, the quickest way is "Request a refund" on the invoice page.',
  SAFETY: 'A safety concern about a driver, vehicle or incident.',
};

const schema = z.object({
  category: z.enum(CUSTOMER_CATEGORIES, 'Choose a category'),
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(150, 'Subject must be at most 150 characters'),
  message: z.string().trim().min(5, 'Message must be at least 5 characters').max(4000, 'Message must be at most 4000 characters'),
  bookingId: z.string(),
});
type Values = z.infer<typeof schema>;
const FIELDS = ['category', 'subject', 'message', 'bookingId'] as const;

function ContactCard() {
  const { data: config } = useConfig();
  const phone = config?.business.supportPhone;
  const email = config?.business.supportEmail;
  if (!phone && !email) return null;
  return (
    <Grid container spacing={1.5}>
      {phone && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardActionArea href={`tel:${phone.replace(/\s/g, '')}`} sx={{ p: 2, height: '100%' }} aria-label={`Call support on ${phone}`}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <PhoneIcon color="primary" />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    Call support (24×7)
                  </Typography>
                  <Typography fontWeight={700}>{phone}</Typography>
                </Box>
              </Stack>
            </CardActionArea>
          </Card>
        </Grid>
      )}
      {email && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardActionArea href={`mailto:${email}`} sx={{ p: 2, height: '100%' }} aria-label={`Email support at ${email}`}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <MailIcon color="primary" />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    Email support
                  </Typography>
                  <Typography fontWeight={700} sx={{ wordBreak: 'break-all' }}>
                    {email}
                  </Typography>
                </Box>
              </Stack>
            </CardActionArea>
          </Card>
        </Grid>
      )}
    </Grid>
  );
}

function NewTicketForm({ formRef }: { formRef: React.RefObject<HTMLDivElement | null> }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const online = useIsOnline();
  const { toast, toastNode } = useToast();
  const emergency = useConfig().data?.business.emergencyNumber ?? '112';

  const initialCategory = (CUSTOMER_CATEGORIES as readonly string[]).includes(params.get('category') ?? '') ? (params.get('category') as CustomerCategory) : 'GENERAL';
  const initialBooking = params.get('bookingId') ?? '';

  const bookings = useQuery({ queryKey: ['bookings', 'support-picker'], queryFn: () => api.page<BookingSummary>('/bookings', { pageSize: 50 }) });

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { category: initialCategory, subject: '', message: '', bookingId: initialBooking } });
  const category = form.watch('category');
  const bookingId = form.watch('bookingId');

  // Re-apply deep-link params when they change while mounted.
  useEffect(() => {
    if (params.get('bookingId')) form.setValue('bookingId', params.get('bookingId')!);
    const c = params.get('category');
    if (c && (CUSTOMER_CATEGORIES as readonly string[]).includes(c)) form.setValue('category', c as CustomerCategory);
  }, [params, form]);

  const options = useMemo(() => bookings.data?.data ?? [], [bookings.data]);
  const unknownSelected = !!bookingId && !bookings.isPending && !options.some((b) => b.id === bookingId);

  const m = useMutation({
    mutationFn: (v: Values) =>
      api.post<{ id: string; number: string }>('/support/tickets', { category: v.category, subject: v.subject.trim(), message: v.message.trim(), ...(v.bookingId ? { bookingId: v.bookingId } : {}) }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['support'] });
      navigate(`/app/support/${t.id}`, { state: { created: t.number } });
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) {
        let mapped = false;
        for (const [path, message] of Object.entries(e.fieldErrors)) {
          const f = FIELDS.find((x) => x === path);
          if (f) {
            form.setError(f, { message });
            mapped = true;
          }
        }
        if (mapped) return;
      }
      if (e instanceof ApiError && e.status === 404 && /booking/i.test(e.message)) {
        form.setError('bookingId', { message: 'We could not find that booking on your account.' });
        return;
      }
      toast(errorMessage(e), 'error');
    },
  });

  const err = form.formState.errors;

  return (
    <SectionCard
      title={
        <Typography variant="h5" component="h2" id="new-ticket-heading">
          Raise a ticket
        </Typography>
      }
    >
      <Box ref={formRef} component="form" noValidate aria-labelledby="new-ticket-heading" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Stack spacing={2}>
          <Controller
            control={form.control}
            name="category"
            render={({ field }) => (
              <TextField select label="Category" {...field} error={!!err.category} helperText={err.category?.message ?? CATEGORY_HINTS[field.value]}>
                {CUSTOMER_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
          {category === 'SAFETY' && (
            <Alert severity="error">
              Safety tickets are prioritised and reviewed urgently by our team. <strong>If anyone is in danger right now, call {emergency} first.</strong>
            </Alert>
          )}
          <Controller
            control={form.control}
            name="bookingId"
            render={({ field }) => (
              <TextField
                select
                label="Related booking (optional)"
                {...field}
                error={!!err.bookingId || bookings.isError}
                helperText={err.bookingId?.message ?? (bookings.isError ? `Could not load your bookings: ${errorMessage(bookings.error)}` : bookings.isPending ? 'Loading your bookings…' : 'Linking a booking helps us resolve this faster.')}
              >
                <MenuItem value="">
                  <em>No booking</em>
                </MenuItem>
                {unknownSelected && <MenuItem value={bookingId}>Selected booking</MenuItem>}
                {options.map((b) => (
                  <MenuItem key={b.id} value={b.id} sx={{ whiteSpace: 'normal' }}>
                    {b.code} · {b.serviceCategory.name} · {date(b.createdAt)}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
          <TextField label="Subject" {...form.register('subject')} error={!!err.subject} helperText={err.subject?.message ?? 'A short summary (3–150 characters)'} slotProps={{ htmlInput: { maxLength: 150 } }} />
          <TextField
            label="Message"
            multiline
            minRows={4}
            {...form.register('message')}
            error={!!err.message}
            helperText={err.message?.message ?? 'Tell us what happened. Include dates, amounts or locations if relevant.'}
            slotProps={{ htmlInput: { maxLength: 4000 } }}
          />
          {!online && <Alert severity="error">You are offline. Reconnect to submit your ticket.</Alert>}
          <Stack direction="row" justifyContent="flex-end">
            <Button type="submit" variant="contained" size="large" disabled={m.isPending || !online}>
              {m.isPending ? 'Submitting…' : 'Submit ticket'}
            </Button>
          </Stack>
        </Stack>
      </Box>
      {toastNode}
    </SectionCard>
  );
}

function MyTickets() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['support', 'tickets', page], queryFn: () => api.page<TicketSummary>('/support/tickets', { page, pageSize: PAGE_SIZE }), placeholderData: keepPreviousData });

  const columns: Column<TicketSummary>[] = [
    {
      key: 'ticket',
      header: 'Ticket',
      primary: true,
      render: (t) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={700} sx={{ wordBreak: 'break-word' }}>
            {t.subject}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t.number}
          </Typography>
        </Box>
      ),
    },
    { key: 'category', header: 'Category', render: (t) => CATEGORY_LABELS[t.category] ?? t.category },
    { key: 'status', header: 'Status', render: (t) => <Chip size="small" color={ticketStatusColor(t.status)} variant={t.status === 'AWAITING_CUSTOMER' ? 'filled' : 'outlined'} label={TICKET_STATUS_LABELS[t.status] ?? t.status} /> },
    { key: 'booking', header: 'Booking', render: (t) => t.booking?.code ?? '—', hideOnMobile: true },
    { key: 'updated', header: 'Updated', render: (t) => relative(t.updatedAt) },
  ];

  return (
    <Box component="section" aria-labelledby="my-tickets-heading">
      <Typography variant="h5" component="h2" id="my-tickets-heading" sx={{ mb: 1.5 }}>
        My tickets
      </Typography>
      <DataTable
        rows={q.data?.data}
        columns={columns}
        rowKey={(t) => t.id}
        loading={q.isPending}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        onRowClick={(t) => navigate(`/app/support/${t.id}`)}
        emptyTitle="No tickets yet"
        emptyBody="When you raise a ticket, you can follow the conversation with our team here."
        page={page}
        pageSize={PAGE_SIZE}
        total={q.data?.meta.total}
        onPageChange={setPage}
      />
    </Box>
  );
}

export default function Support() {
  const [params] = useSearchParams();
  const formRef = useRef<HTMLDivElement>(null);
  const deepLinked = params.has('bookingId') || params.has('category');

  useEffect(() => {
    if (deepLinked) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [deepLinked]);

  const goToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    formRef.current?.querySelector<HTMLElement>('[role="combobox"], input, textarea')?.focus({ preventScroll: true });
  };

  const form = <NewTicketForm formRef={formRef} />;

  return (
    <Box>
      <PageHeader
        title="Help & support"
        subtitle="Talk to us about a booking, a bill or anything else. We reply on your ticket and by email."
        actions={
          <Button variant="contained" startIcon={<AddCommentOutlinedIcon />} onClick={goToForm}>
            New ticket
          </Button>
        }
      />
      <Stack spacing={3}>
        <EmergencyNotice />
        <ContactCard />
        {deepLinked ? (
          <>
            {form}
            <MyTickets />
          </>
        ) : (
          <>
            <MyTickets />
            {form}
          </>
        )}
      </Stack>
    </Box>
  );
}
