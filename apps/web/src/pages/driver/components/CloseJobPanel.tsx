import { useState } from 'react';
import { Alert, AlertTitle, Box, Button, Divider, IconButton, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PaymentsIcon from '@mui/icons-material/Payments';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { BookingDetail } from '@/api/types';
import { errorMessage, Money, PaymentChip } from '@/components/common';
import { useIsOnline } from '@/hooks/useOnline';
import { inr } from '@/lib/format';
import { AttachmentGrid, EvidenceUploader } from './EvidenceUploader';
import { parseRupees } from './driverShared';

type ExpenseCategory = 'FUEL' | 'TOLLS_PARKING' | 'OTHER';
interface ExpenseDraft {
  category: ExpenseCategory;
  amount: string;
  description: string;
  attachmentId: string;
}
const CATEGORY_LABELS: Record<ExpenseCategory, string> = { FUEL: 'Fuel', TOLLS_PARKING: 'Tolls / parking', OTHER: 'Other' };

const rupeeField = (label: string, value: string, set: (v: string) => void, helper?: string, error?: boolean) => (
  <TextField
    label={label}
    value={value}
    onChange={(e) => set(e.target.value.replace(/[^\d.]/g, ''))}
    error={error}
    helperText={error ? 'Enter rupees with at most 2 decimals' : helper}
    slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }}
  />
);

const badAmount = (v: string) => {
  const n = parseRupees(v);
  return n != null && (Number.isNaN(n) || n < 0);
};

/** Close the job after handover: actual tolls/parking (receipts required), odometer, expenses, cash collected. */
export function CloseJobForm({ booking }: { booking: BookingDetail }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const [tolls, setTolls] = useState('');
  const [parking, setParking] = useState('');
  const [odometer, setOdometer] = useState('');
  const [notes, setNotes] = useState('');
  const [cash, setCash] = useState('');
  const [expenses, setExpenses] = useState<ExpenseDraft[]>([]);
  const receipts = (booking.attachments ?? []).filter((a) => a.kind === 'TOLL_RECEIPT');
  const otherFiles = (booking.attachments ?? []).filter((a) => a.kind === 'OTHER');
  const passThrough = (parseRupees(tolls) || 0) + (parseRupees(parking) || 0);
  const needReceipt = passThrough > 0 && receipts.length === 0;
  const expenseErrors = expenses.map((e) => {
    const n = parseRupees(e.amount);
    if (n == null || Number.isNaN(n) || n <= 0) return 'Enter an amount above ₹0';
    if (e.description.trim().length < 3) return 'Describe the expense';
    return null;
  });
  const odoValid = odometer === '' || /^\d{1,7}$/.test(odometer);
  const valid = !badAmount(tolls) && !badAmount(parking) && !badAmount(cash) && odoValid && !needReceipt && expenseErrors.every((e) => !e);

  const close = useMutation({
    mutationFn: () =>
      api.post<{ invoiceId: string; invoiceNumber: string; total: number }>(`/driver/jobs/${booking.id}/close`, {
        tolls: parseRupees(tolls) ?? 0,
        parking: parseRupees(parking) ?? 0,
        odometerKm: odometer ? Number(odometer) : undefined,
        notes: notes.trim() || undefined,
        cashCollected: parseRupees(cash) || undefined,
        expenses: expenses.map((e) => ({ category: e.category, amount: parseRupees(e.amount), description: e.description.trim(), attachmentId: e.attachmentId || undefined })),
      }),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['booking', booking.id] }), qc.invalidateQueries({ queryKey: ['driver'] })]);
    },
  });

  if (close.data)
    return (
      <Alert severity="success">
        <AlertTitle sx={{ fontWeight: 800 }}>Job closed</AlertTitle>
        Invoice <strong>{close.data.invoiceNumber}</strong> issued for <strong>{inr(close.data.total)}</strong>.
      </Alert>
    );

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Enter only actual amounts paid during this job. Tolls and parking are charged to the customer at actuals and need a receipt photo.
      </Typography>
      {rupeeField('Tolls paid', tolls, setTolls, 'Leave empty if none', badAmount(tolls))}
      {rupeeField('Parking paid', parking, setParking, 'Leave empty if none', badAmount(parking))}
      <Box>
        <EvidenceUploader bookingId={booking.id} kind="TOLL_RECEIPT" document label="Upload toll / parking receipt" />
        <Box sx={{ mt: 1 }}>
          <AttachmentGrid attachments={receipts} empty="No receipts uploaded." />
        </Box>
        {needReceipt && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Upload at least one toll/parking receipt before adding these charges.
          </Alert>
        )}
      </Box>
      <TextField label="Truck odometer now (km)" value={odometer} onChange={(e) => setOdometer(e.target.value.replace(/\D/g, ''))} error={!odoValid} slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 7 } }} helperText="Optional — updates the truck record" />
      <TextField label="Closing notes" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1000 } }} />

      <Divider />
      <Box>
        <Typography variant="h6">Reimbursable expenses</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Money you paid yourself for this job (fuel, tolls, other). Finance reviews each claim.
        </Typography>
        <Stack spacing={1.5}>
          {expenses.map((e, i) => (
            <Box key={i} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField select label="Type" value={e.category} onChange={(ev) => setExpenses((xs) => xs.map((x, j) => (j === i ? { ...x, category: ev.target.value as ExpenseCategory } : x)))}>
                    {(Object.keys(CATEGORY_LABELS) as ExpenseCategory[]).map((c) => (
                      <MenuItem key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <IconButton aria-label={`Remove expense ${i + 1}`} onClick={() => setExpenses((xs) => xs.filter((_, j) => j !== i))} sx={{ width: 48, height: 48 }}>
                    <DeleteOutlineIcon />
                  </IconButton>
                </Stack>
                {rupeeField('Amount', e.amount, (v) => setExpenses((xs) => xs.map((x, j) => (j === i ? { ...x, amount: v } : x))))}
                <TextField label="Description" value={e.description} onChange={(ev) => setExpenses((xs) => xs.map((x, j) => (j === i ? { ...x, description: ev.target.value } : x)))} slotProps={{ htmlInput: { maxLength: 200 } }} />
                <TextField select label="Receipt" value={e.attachmentId} onChange={(ev) => setExpenses((xs) => xs.map((x, j) => (j === i ? { ...x, attachmentId: ev.target.value } : x)))} helperText="Pick an uploaded receipt (optional)">
                  <MenuItem value="">No receipt</MenuItem>
                  {[...receipts, ...otherFiles].map((a, n) => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.kind === 'TOLL_RECEIPT' ? 'Toll/parking receipt' : 'Receipt photo'} {n + 1}
                    </MenuItem>
                  ))}
                </TextField>
                {expenseErrors[i] && (e.amount || e.description) && (
                  <Typography variant="caption" color="error">
                    {expenseErrors[i]}
                  </Typography>
                )}
              </Stack>
            </Box>
          ))}
          <EvidenceUploader bookingId={booking.id} kind="OTHER" label="Photo of fuel / other receipt" />
          <Button size="large" variant="outlined" startIcon={<AddIcon />} disabled={expenses.length >= 10} onClick={() => setExpenses((xs) => [...xs, { category: 'FUEL', amount: '', description: '', attachmentId: '' }])}>
            Add expense claim
          </Button>
        </Stack>
      </Box>

      <Divider />
      {rupeeField('Cash collected from customer', cash, setCash, 'Only if the customer paid you in cash', badAmount(cash))}

      {close.error && <Alert severity="error">{errorMessage(close.error)}</Alert>}
      <Button size="large" variant="contained" color="success" startIcon={<ReceiptLongIcon />} disabled={!valid || close.isPending || !online} onClick={() => close.mutate()} sx={{ minHeight: 60, fontSize: '1.1rem' }}>
        {close.isPending ? 'Closing…' : 'Close job & issue invoice'}
      </Button>
    </Stack>
  );
}

/** After closing: invoice status and recording cash the customer paid on site. */
export function InvoiceAndCash({ booking, canRecord }: { booking: BookingDetail; canRecord: boolean }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const inv = booking.invoice;
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const n = parseRupees(amount);
  const amountOk = n != null && !Number.isNaN(n) && n > 0;
  const record = useMutation({
    mutationFn: () => api.post(`/driver/jobs/${booking.id}/cash`, { amount: n, note: note.trim() || undefined }),
    onSuccess: async () => {
      setAmount('');
      setNote('');
      await qc.invalidateQueries({ queryKey: ['booking', booking.id] });
    },
  });
  if (!inv) return null;
  // Cash already recorded stays in `outstanding` until finance confirms the deposit.
  const toCollect = Math.max(0, inv.outstanding - inv.amountPendingCash);
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Invoice
          </Typography>
          <Typography variant="h5">{inv.number}</Typography>
        </Box>
        <PaymentChip status={inv.paymentStatus} size="medium" />
      </Stack>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Total
          </Typography>
          <Typography sx={{ fontSize: '1.3rem', fontWeight: 800 }}>
            <Money value={inv.total} />
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Paid
          </Typography>
          <Typography sx={{ fontSize: '1.3rem', fontWeight: 800 }}>
            <Money value={inv.amountPaid} />
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Outstanding
          </Typography>
          <Typography sx={{ fontSize: '1.3rem', fontWeight: 800 }} color={inv.outstanding > 0 ? 'error.main' : 'success.main'}>
            <Money value={inv.outstanding} />
          </Typography>
        </Box>
      </Stack>
      {inv.amountPendingCash > 0 && (
        <Alert severity="info">
          {inr(inv.amountPendingCash)} cash recorded and awaiting deposit confirmation by finance.
        </Alert>
      )}
      {record.isSuccess && <Alert severity="success">Cash payment recorded. Hand it over to finance as instructed.</Alert>}
      {canRecord && toCollect > 0 && (
        <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
          <Typography variant="h6" gutterBottom>
            Record cash payment
          </Typography>
          <Stack spacing={1.5}>
            {rupeeField('Cash received', amount, setAmount, `Still to collect ${inr(toCollect)}`, n != null && Number.isNaN(n))}
            {amountOk && n! * 100 > toCollect && <Alert severity="warning">This is more than the {inr(toCollect)} still to collect. Check the amount.</Alert>}
            <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
            {record.error && <Alert severity="error">{errorMessage(record.error)}</Alert>}
            <Button size="large" variant="contained" startIcon={<PaymentsIcon />} disabled={!amountOk || record.isPending || !online} onClick={() => record.mutate()}>
              {record.isPending ? 'Recording…' : 'Record cash payment'}
            </Button>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
