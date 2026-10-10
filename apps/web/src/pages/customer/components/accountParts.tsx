import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  type AlertColor,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import ContactPhoneOutlinedIcon from '@mui/icons-material/ContactPhoneOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { ConfirmDialog, EmptyState, ErrorState, errorMessage, LoadingBlock, SectionCard } from '@/components/common';
import { LocationPicker, type LocationValue } from '@/components/LocationPicker';
import { useConfig } from '@/hooks/useConfig';
import { saveJson } from './shared';

type Toast = (text: string, severity?: AlertColor) => void;

function useFullScreenDialog() {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('sm'));
}

// ─── Saved addresses ────────────────────────────────────────────────

interface SavedAddress {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  landmark: string | null;
  createdAt: string;
}

const MAX_ADDRESSES = 20;

export function AddressesSection({ toast }: { toast: Toast }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'addresses'], queryFn: () => api.get<SavedAddress[]>('/me/addresses') });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<SavedAddress | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/me/addresses/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me', 'addresses'] });
      setDeleting(null);
      toast('Address removed');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const list = q.data ?? [];
  const full = list.length >= MAX_ADDRESSES;

  return (
    <SectionCard
      title="Saved addresses"
      action={
        q.isSuccess &&
        list.length > 0 && (
          <Button startIcon={<AddIcon />} onClick={() => setAdding(true)} disabled={full}>
            Add
          </Button>
        )
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Home, office or your usual garage — pick them in one tap when requesting help.
      </Typography>
      {q.isPending && <LoadingBlock rows={2} height={64} />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load saved addresses" />}
      {q.isSuccess && list.length === 0 && (
        <EmptyState
          icon={<PlaceOutlinedIcon sx={{ fontSize: 40, opacity: 0.6 }} />}
          title="No saved addresses"
          body="Save places you visit often to speed up drop-off selection."
          action={
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
              Add address
            </Button>
          }
        />
      )}
      {q.isSuccess && list.length > 0 && (
        <List disablePadding>
          {list.map((a, i) => (
            <Box key={a.id}>
              {i > 0 && <Divider component="li" />}
              <ListItem
                disableGutters
                secondaryAction={
                  <Tooltip title="Remove address">
                    <IconButton edge="end" aria-label={`Remove address ${a.label}`} onClick={() => setDeleting(a)}>
                      <DeleteOutlineIcon />
                    </IconButton>
                  </Tooltip>
                }
                sx={{ pr: 6, alignItems: 'flex-start' }}
              >
                <ListItemIcon sx={{ minWidth: 40, mt: 0.5 }}>
                  <PlaceOutlinedIcon color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary={<Typography sx={{ fontWeight: 650 }}>{a.label}</Typography>}
                  secondary={
                    <>
                      <Typography variant="body2" component="span" sx={{ display: 'block', wordBreak: 'break-word' }}>
                        {a.address}
                      </Typography>
                      {a.landmark && (
                        <Typography variant="caption" component="span" sx={{ display: 'block' }}>
                          Near {a.landmark}
                        </Typography>
                      )}
                      <Link href={`https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}`} target="_blank" rel="noopener noreferrer" variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, mt: 0.25 }}>
                        View on map <OpenInNewIcon sx={{ fontSize: 12 }} aria-hidden />
                        <Box component="span" sx={visuallyHidden}>
                          (opens in a new tab)
                        </Box>
                      </Link>
                    </>
                  }
                />
              </ListItem>
            </Box>
          ))}
        </List>
      )}
      {full && (
        <Typography variant="caption" color="text.secondary">
          You can save up to {MAX_ADDRESSES} addresses. Remove one to add another.
        </Typography>
      )}

      <AddAddressDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          toast('Address saved');
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Remove this address?"
        danger
        confirmLabel={remove.isPending ? 'Removing…' : 'Remove'}
        loading={remove.isPending}
        body={deleting && <>“{deleting.label}” will be removed from your saved addresses. Past bookings are not affected.</>}
        onClose={() => !remove.isPending && setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </SectionCard>
  );
}

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;

function AddAddressDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const fullScreen = useFullScreenDialog();
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [loc, setLoc] = useState<LocationValue | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel('');
      setLoc(null);
      setTouched(false);
      setError(null);
    }
  }, [open]);

  const labelError = !label.trim() ? 'Give this place a name, e.g. Home' : label.trim().length > 40 ? 'Keep it under 40 characters' : null;
  const hasPin = !!loc && !!loc.lat && !!loc.lng;
  const addressError = !hasPin ? 'Drop a pin on the map, search, or paste a maps link' : (loc?.address ?? '').trim().length < 3 ? 'Enter the address (at least 3 characters)' : null;

  const save = useMutation({
    mutationFn: () => {
      const landmark = (loc?.landmark || loc?.placeName || '').trim();
      return api.post('/me/addresses', { label: label.trim(), address: loc!.address!.trim(), lat: loc!.lat, lng: loc!.lng, ...(landmark ? { landmark: landmark.slice(0, 200) } : {}) });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me', 'addresses'] });
      onSaved();
    },
    onError: (e) => {
      const fe = e instanceof ApiError ? e.fieldErrors : {};
      setError(Object.values(fe)[0] ?? errorMessage(e));
    },
  });

  const submit = () => {
    setTouched(true);
    setError(null);
    if (labelError || addressError) return;
    save.mutate();
  };

  return (
    <Dialog open={open} onClose={() => !save.isPending && onClose()} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby="add-address-title">
      <DialogTitle id="add-address-title">Add a saved address</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}
          <TextField
            label="Label"
            required
            placeholder="Home, Office, My garage…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            error={touched && !!labelError}
            helperText={touched && labelError ? labelError : undefined}
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
          <LocationPicker variant="dropoff" value={loc} onChange={setLoc} />
          {touched && addressError && (
            <Alert severity="warning" role="alert">
              {addressError}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button variant="contained" size="large" onClick={submit} disabled={save.isPending} startIcon={save.isPending ? <CircularProgress size={18} color="inherit" /> : undefined}>
          {save.isPending ? 'Saving…' : 'Save address'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Emergency contacts ─────────────────────────────────────────────

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
}

const MAX_CONTACTS = 5;

/** Strips spaces/dashes and a leading +91 / 91 / 0 to get the bare 10-digit mobile number. */
const bareMobile = (v: string) => {
  const d = v.replace(/[\s-()]/g, '');
  if (/^\+91\d{10}$/.test(d)) return d.slice(3);
  if (/^91\d{10}$/.test(d)) return d.slice(2);
  if (/^0\d{10}$/.test(d)) return d.slice(1);
  return d;
};

const prettyPhone = (p: string) => {
  const m = /^\+91(\d{5})(\d{5})$/.exec(p);
  return m ? `+91 ${m[1]} ${m[2]}` : p;
};

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter their name').max(100, 'Keep it under 100 characters'),
  phone: z.string().refine((v) => /^[6-9]\d{9}$/.test(bareMobile(v)), 'Enter a valid 10-digit Indian mobile number'),
  relationship: z.string().trim().max(40, 'Keep it under 40 characters'),
});
type ContactForm = z.infer<typeof contactSchema>;

export function EmergencyContactsSection({ toast }: { toast: Toast }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'emergency-contacts'], queryFn: () => api.get<EmergencyContact[]>('/me/emergency-contacts') });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<EmergencyContact | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/me/emergency-contacts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me', 'emergency-contacts'] });
      setDeleting(null);
      toast('Contact removed');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const list = q.data ?? [];
  const full = list.length >= MAX_CONTACTS;

  return (
    <SectionCard
      title="Emergency contacts"
      action={
        q.isSuccess &&
        list.length > 0 && (
          <Button startIcon={<AddIcon />} onClick={() => setAdding(true)} disabled={full}>
            Add
          </Button>
        )
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Kept on your account for your records and so our support team can refer to them if you ask us to. We do not contact them automatically.
      </Typography>
      {q.isPending && <LoadingBlock rows={2} height={56} />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load emergency contacts" />}
      {q.isSuccess && list.length === 0 && (
        <EmptyState
          icon={<ContactPhoneOutlinedIcon sx={{ fontSize: 40, opacity: 0.6 }} />}
          title="No emergency contacts"
          body={`Add up to ${MAX_CONTACTS} people you trust.`}
          action={
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
              Add contact
            </Button>
          }
        />
      )}
      {q.isSuccess && list.length > 0 && (
        <List disablePadding>
          {list.map((c, i) => (
            <Box key={c.id}>
              {i > 0 && <Divider component="li" />}
              <ListItem
                disableGutters
                sx={{ pr: 6 }}
                secondaryAction={
                  <Tooltip title="Remove contact">
                    <IconButton edge="end" aria-label={`Remove contact ${c.name}`} onClick={() => setDeleting(c)}>
                      <DeleteOutlineIcon />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <ContactPhoneOutlinedIcon color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography sx={{ fontWeight: 650, wordBreak: 'break-word' }}>
                      {c.name}
                      {c.relationship && (
                        <Typography component="span" variant="body2" color="text.secondary">
                          {' '}
                          · {c.relationship}
                        </Typography>
                      )}
                    </Typography>
                  }
                  secondary={
                    <Link href={`tel:${c.phone}`} underline="hover">
                      {prettyPhone(c.phone)}
                    </Link>
                  }
                />
              </ListItem>
            </Box>
          ))}
        </List>
      )}
      {full && (
        <Typography variant="caption" color="text.secondary">
          You have added the maximum of {MAX_CONTACTS} contacts.
        </Typography>
      )}

      <AddContactDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          toast('Emergency contact added');
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Remove this contact?"
        danger
        confirmLabel={remove.isPending ? 'Removing…' : 'Remove'}
        loading={remove.isPending}
        body={deleting && <>{deleting.name} will be removed from your emergency contacts.</>}
        onClose={() => !remove.isPending && setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </SectionCard>
  );
}

function AddContactDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const fullScreen = useFullScreenDialog();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactForm>({ resolver: zodResolver(contactSchema), defaultValues: { name: '', phone: '', relationship: '' } });

  useEffect(() => {
    if (open) {
      reset({ name: '', phone: '', relationship: '' });
      setFormError(null);
    }
  }, [open, reset]);

  const onSubmit = async (v: ContactForm) => {
    setFormError(null);
    try {
      await api.post('/me/emergency-contacts', { name: v.name.trim(), phone: bareMobile(v.phone), ...(v.relationship.trim() ? { relationship: v.relationship.trim() } : {}) });
      await qc.invalidateQueries({ queryKey: ['me', 'emergency-contacts'] });
      onSaved();
    } catch (e) {
      const fe = e instanceof ApiError ? e.fieldErrors : {};
      let mapped = false;
      for (const k of ['name', 'phone', 'relationship'] as const) {
        if (fe[k]) {
          setError(k, { message: fe[k] });
          mapped = true;
        }
      }
      if (!mapped) setFormError(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onClose={() => !isSubmitting && onClose()} fullScreen={fullScreen} fullWidth maxWidth="xs" aria-labelledby="add-contact-title">
      <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'contents' }}>
        <DialogTitle id="add-contact-title">Add emergency contact</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {formError && (
              <Alert severity="error" role="alert">
                {formError}
              </Alert>
            )}
            <TextField label="Name" required autoFocus autoComplete="off" {...register('name')} error={!!errors.name} helperText={errors.name?.message} slotProps={{ htmlInput: { maxLength: 100 } }} />
            <TextField
              label="Mobile number"
              required
              type="tel"
              placeholder="98765 43210"
              {...register('phone')}
              error={!!errors.phone}
              helperText={errors.phone?.message ?? '10-digit Indian mobile number'}
              slotProps={{ htmlInput: { inputMode: 'tel', maxLength: 16, autoComplete: 'off' } }}
            />
            <TextField label="Relationship (optional)" placeholder="Spouse, parent, friend…" {...register('relationship')} error={!!errors.relationship} helperText={errors.relationship?.message} slotProps={{ htmlInput: { maxLength: 40 } }} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" size="large" disabled={isSubmitting} startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : undefined}>
            {isSubmitting ? 'Saving…' : 'Add contact'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// ─── Privacy & data (DPDP Act) ──────────────────────────────────────

const PRIVACY_TYPES = [
  { value: 'ERASURE', label: 'Erase my personal data', hint: 'Delete or anonymise your personal data. Records we must keep by law (such as tax invoices) are retained.' },
  { value: 'CORRECTION', label: 'Correct my personal data', hint: 'Tell us what is wrong and what it should be.' },
  { value: 'WITHDRAW_CONSENT', label: 'Withdraw my consent', hint: 'Withdraw consent for a specific use of your data. Some services may stop working without it.' },
  { value: 'GRIEVANCE', label: 'Raise a privacy grievance', hint: 'Complain about how your personal data has been handled.' },
] as const;

const privacySchema = z.object({
  type: z.string().min(1, 'Choose a request type'),
  details: z.string().trim().min(5, 'Please describe your request (at least 5 characters)').max(2000, 'Keep it under 2,000 characters'),
});
type PrivacyForm = z.infer<typeof privacySchema>;

export function PrivacySection({ toast }: { toast: Toast }) {
  const cfg = useConfig();
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ ticket: { id: string; number: string }; note: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PrivacyForm>({ resolver: zodResolver(privacySchema), defaultValues: { type: '', details: '' } });
  const type = watch('type');
  const details = watch('details');
  const hint = PRIVACY_TYPES.find((t) => t.value === type)?.hint;

  const download = async () => {
    setExporting(true);
    try {
      const data = await api.get<unknown>('/me/data-export');
      saveJson(data, 'towpilot-my-data.json');
      toast('Your data has been downloaded');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setExporting(false);
    }
  };

  const onSubmit = async (v: PrivacyForm) => {
    setFormError(null);
    try {
      const r = await api.post<{ ticket: { id: string; number: string }; note: string }>('/me/privacy-request', { type: v.type, details: v.details.trim() });
      setResult(r);
      reset({ type: '', details: '' });
      toast(`Request ${r.ticket.number} submitted`);
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const noticeUrl = cfg.data?.privacy.noticeUrl;

  return (
    <SectionCard title="Privacy & your data">
      <Typography variant="body2" color="text.secondary">
        Under India’s Digital Personal Data Protection Act, 2023 you can access your data, ask us to correct or erase it, withdraw consent, or raise a grievance.
        {noticeUrl && (
          <>
            {' '}
            <Link href={noticeUrl} target="_blank" rel="noopener noreferrer">
              Read our privacy notice
              <Box component="span" sx={visuallyHidden}>
                (opens in a new tab)
              </Box>
            </Link>
            .
          </>
        )}
      </Typography>

      <Box sx={{ mt: 2 }}>
        <Typography variant="h6" component="h3">
          Download a copy
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          A JSON file with your profile, vehicles, bookings, invoices, payments, saved addresses, contacts, support tickets and notifications.
        </Typography>
        <Button variant="outlined" startIcon={exporting ? <CircularProgress size={18} /> : <DownloadOutlinedIcon />} onClick={download} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Download my data'}
        </Button>
      </Box>

      <Divider sx={{ my: 2.5 }} />

      <Typography variant="h6" component="h3">
        Make a privacy request
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        We create a support ticket and our grievance team responds there.
      </Typography>
      {result && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setResult(null)}>
          <AlertTitle>Request submitted — ticket {result.ticket.number}</AlertTitle>
          {result.note}{' '}
          <Link component={RouterLink} to={`/app/support/${result.ticket.id}`}>
            Track it in Support
          </Link>
        </Alert>
      )}
      {formError && (
        <Alert severity="error" sx={{ mb: 2 }} role="alert">
          {formError}
        </Alert>
      )}
      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Stack spacing={2}>
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <TextField select label="Request type" required fullWidth {...field} error={!!errors.type} helperText={errors.type?.message ?? hint}>
                {PRIVACY_TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
          <TextField
            label="Details"
            required
            multiline
            minRows={3}
            fullWidth
            {...register('details')}
            error={!!errors.details}
            helperText={errors.details?.message ?? `${details.length}/2000`}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <Box>
            <Button type="submit" variant="contained" color="secondary" disabled={isSubmitting} startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : undefined}>
              {isSubmitting ? 'Submitting…' : 'Submit request'}
            </Button>
          </Box>
        </Stack>
      </Box>
    </SectionCard>
  );
}
