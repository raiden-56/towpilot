import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Skeleton,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import DirectionsCarOutlinedIcon from '@mui/icons-material/DirectionsCarOutlined';
import CardMembershipOutlinedIcon from '@mui/icons-material/CardMembershipOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import SettingsBrightnessOutlinedIcon from '@mui/icons-material/SettingsBrightnessOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import type { Me } from '@/api/types';
import { ErrorState, errorMessage, PageHeader, SectionCard } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { setThemeMode, useAppDispatch, useAppSelector, userUpdated } from '@/store';
import { FilePickButton, IMAGE_ACCEPT, MAX_UPLOAD_BYTES, useToast } from './components/shared';
import { AddressesSection, EmergencyContactsSection, PrivacySection } from './components/accountParts';

type Toast = ReturnType<typeof useToast>['toast'];
type Profile = NonNullable<Me['customerProfile']>;
type PrefKey = 'notifySms' | 'notifyEmail' | 'notifyPush' | 'locationConsent' | 'marketingConsent' | 'preferredLanguage';

const DEFAULT_PROFILE: Profile = { marketingConsent: false, locationConsent: false, notifySms: true, notifyEmail: true, notifyPush: true, preferredLanguage: 'en', consentVersion: null };

const formatPhone = (p: string | null) => {
  if (!p) return '—';
  const m = /^\+91(\d{5})(\d{5})$/.exec(p);
  return m ? `+91 ${m[1]} ${m[2]}` : p;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

export default function Account() {
  const { toast, toastNode } = useToast();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me') });

  return (
    <Box>
      <PageHeader title="Account" subtitle="Your profile, saved places, preferences and privacy." />
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Stack spacing={2.5}>
            {me.isPending && <ProfileSkeleton />}
            {me.isError && <ErrorState error={me.error} onRetry={() => me.refetch()} title="Could not load your profile" />}
            {me.data && <ProfileSection me={me.data} toast={toast} />}
            {me.data && <PreferencesSection me={me.data} toast={toast} />}
            <AddressesSection toast={toast} />
            <EmergencyContactsSection toast={toast} />
            <PrivacySection toast={toast} />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={2.5} sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
            <QuickLinks />
            <AppearanceSection />
            <SignOutSection />
          </Stack>
        </Grid>
      </Grid>
      {toastNode}
    </Box>
  );
}

function ProfileSkeleton() {
  return (
    <SectionCard title="Profile">
      <Stack direction="row" spacing={2} alignItems="center" aria-busy="true" aria-label="Loading profile">
        <Skeleton variant="circular" width={72} height={72} />
        <Box sx={{ flex: 1 }}>
          <Skeleton width="50%" height={28} />
          <Skeleton width="35%" />
        </Box>
      </Stack>
      <Skeleton variant="rounded" height={56} sx={{ mt: 2 }} />
      <Skeleton variant="rounded" height={56} sx={{ mt: 2 }} />
    </SectionCard>
  );
}

// ─── Profile ────────────────────────────────────────────────────────

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(100, 'Keep it under 100 characters'),
  email: z
    .string()
    .trim()
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address'),
});
type ProfileForm = z.infer<typeof profileSchema>;

function ProfileSection({ me, toast }: { me: Me; toast: Toast }) {
  const qc = useQueryClient();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), defaultValues: { fullName: me.fullName, email: me.email ?? '' } });

  // Keep the form in sync with fresh server data unless the user is mid-edit.
  useEffect(() => {
    if (!isDirty) reset({ fullName: me.fullName, email: me.email ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.fullName, me.email]);

  const syncUser = (patch: Partial<Me>) => {
    if (user) dispatch(userUpdated({ ...user, ...patch }));
  };

  const onSubmit = async (v: ProfileForm) => {
    setFormError(null);
    try {
      const updated = await api.patch<Me>('/me', { fullName: v.fullName.trim(), email: v.email.trim() ? v.email.trim().toLowerCase() : null });
      const merged: Me = { ...me, ...updated, photoUrl: me.photoUrl };
      qc.setQueryData(['me'], merged);
      void qc.invalidateQueries({ queryKey: ['me'], exact: true });
      syncUser({ fullName: merged.fullName, email: merged.email });
      reset({ fullName: merged.fullName, email: merged.email ?? '' });
      toast('Profile updated');
    } catch (e) {
      if (e instanceof ApiError) {
        const fe = e.fieldErrors;
        if (fe.fullName || fe.email) {
          if (fe.fullName) setError('fullName', { message: fe.fullName });
          if (fe.email) setError('email', { message: fe.email });
          return;
        }
        if (e.status === 409) {
          setError('email', { message: 'This email is already linked to another account.' });
          return;
        }
      }
      setFormError(errorMessage(e));
    }
  };

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('photo', file);
      return api.upload<{ photoUrl: string }>('/me/photo', fd);
    },
    onSuccess: (r) => {
      qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, photoUrl: r.photoUrl } : old));
      syncUser({ photoUrl: r.photoUrl });
      toast('Profile photo updated');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const pickPhoto = ([file]: File[]) => {
    if (!file) return;
    if (!IMAGE_ACCEPT.split(',').includes(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) return toast('Use a JPEG, PNG, WebP or HEIC image.', 'error');
    if (file.size > MAX_UPLOAD_BYTES) return toast(`Photo must be under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 'error');
    upload.mutate(file);
  };

  return (
    <SectionCard title="Profile">
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2.5 }}>
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <Avatar src={me.photoUrl ?? undefined} alt={me.fullName} sx={{ width: 72, height: 72, bgcolor: 'secondary.main', color: 'secondary.contrastText', fontSize: 26, fontWeight: 700 }}>
            {initials(me.fullName)}
          </Avatar>
          {upload.isPending && <CircularProgress size={80} sx={{ position: 'absolute', top: -4, left: -4 }} aria-label="Uploading photo" />}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="p" sx={{ wordBreak: 'break-word' }}>
            {me.fullName}
          </Typography>
          <FilePickButton accept={IMAGE_ACCEPT} onFiles={pickPhoto} size="small" startIcon={<PhotoCameraOutlinedIcon />} disabled={upload.isPending} sx={{ ml: -0.75, mt: 0.25 }}>
            {upload.isPending ? 'Uploading…' : me.photoUrl ? 'Change photo' : 'Add photo'}
          </FilePickButton>
        </Box>
      </Stack>

      {formError && (
        <Alert severity="error" sx={{ mb: 2 }} role="alert">
          {formError}
        </Alert>
      )}
      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Stack spacing={2}>
          <TextField label="Full name" required fullWidth autoComplete="name" {...register('fullName')} error={!!errors.fullName} helperText={errors.fullName?.message} slotProps={{ htmlInput: { maxLength: 100 } }} />
          <TextField
            label="Email (optional)"
            type="email"
            fullWidth
            autoComplete="email"
            {...register('email')}
            error={!!errors.email}
            helperText={errors.email?.message ?? 'For invoices and receipts. Leave blank to remove.'}
            slotProps={{ htmlInput: { inputMode: 'email' } }}
          />
          <TextField
            label="Mobile number"
            value={formatPhone(me.phone)}
            fullWidth
            helperText="Your sign-in number. Contact support to change it."
            slotProps={{ input: { readOnly: true }, htmlInput: { 'aria-readonly': true } }}
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            {isDirty && (
              <Button onClick={() => reset({ fullName: me.fullName, email: me.email ?? '' })} disabled={isSubmitting}>
                Discard
              </Button>
            )}
            <Button type="submit" variant="contained" disabled={!isDirty || isSubmitting} startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : undefined}>
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </SectionCard>
  );
}

// ─── Preferences & consent ──────────────────────────────────────────

const SWITCHES: { key: Exclude<PrefKey, 'preferredLanguage'>; label: string; hint: string }[] = [
  { key: 'notifySms', label: 'SMS updates', hint: 'Booking status changes, payments and refunds by SMS.' },
  { key: 'notifyEmail', label: 'Email updates', hint: 'Payment receipts and support replies by email (needs an email on your profile).' },
  { key: 'notifyPush', label: 'Push notifications', hint: 'Booking status alerts on your device.' },
  { key: 'locationConsent', label: 'Location sharing', hint: 'Use my location to find services and show it to your assigned driver.' },
  { key: 'marketingConsent', label: 'Offers and news', hint: 'Occasional offers, membership deals and service news. You can opt out any time.' },
];

function PreferencesSection({ me, toast }: { me: Me; toast: Toast }) {
  const qc = useQueryClient();
  const prefs: Profile = { ...DEFAULT_PROFILE, ...(me.customerProfile ?? {}) };

  const save = useMutation({
    mutationFn: (patch: Partial<Pick<Profile, PrefKey>>) => api.put<Profile>('/me/preferences', patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['me'], exact: true });
      const previous = qc.getQueryData<Me>(['me']);
      qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, customerProfile: { ...DEFAULT_PROFILE, ...(old.customerProfile ?? {}), ...patch } } : old));
      return { previous };
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(['me'], ctx.previous);
      toast(`Could not save: ${errorMessage(e)}`, 'error');
    },
    onSuccess: (profile) => {
      qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, customerProfile: { ...DEFAULT_PROFILE, ...(old.customerProfile ?? {}), ...profile } } : old));
      toast('Preference saved');
    },
  });

  return (
    <SectionCard title="Preferences & consent">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        In-app notifications are always on so you never miss a booking update. Changes save instantly.
      </Typography>
      <Stack divider={<Divider flexItem />}>
        {SWITCHES.map((s) => (
          <FormControlLabel
            key={s.key}
            labelPlacement="start"
            control={<Switch checked={!!prefs[s.key]} onChange={(e) => save.mutate({ [s.key]: e.target.checked })} slotProps={{ input: { 'aria-describedby': `pref-${s.key}-hint` } }} />}
            label={
              <Box sx={{ pr: 1 }}>
                <Typography sx={{ fontWeight: 600 }}>{s.label}</Typography>
                <Typography variant="body2" color="text.secondary" id={`pref-${s.key}-hint`}>
                  {s.hint}
                </Typography>
              </Box>
            }
            sx={{ mx: 0, py: 1.25, justifyContent: 'space-between', alignItems: 'center', '& .MuiFormControlLabel-label': { flex: 1 } }}
          />
        ))}
      </Stack>
      <TextField
        select
        label="Preferred language"
        value={prefs.preferredLanguage === 'hi' ? 'hi' : 'en'}
        onChange={(e) => save.mutate({ preferredLanguage: e.target.value })}
        fullWidth
        sx={{ mt: 2 }}
        helperText="The language you would like us to use when communicating with you."
      >
        <MenuItem value="en">English</MenuItem>
        <MenuItem value="hi" lang="hi">
          हिन्दी (Hindi)
        </MenuItem>
      </TextField>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        {prefs.consentVersion ? `Consent recorded under privacy notice version ${prefs.consentVersion}.` : 'No consent version recorded yet.'}
      </Typography>
    </SectionCard>
  );
}

// ─── Appearance ─────────────────────────────────────────────────────

function AppearanceSection() {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((s) => s.ui.themeMode);
  return (
    <SectionCard title="Appearance">
      <Typography id="theme-label" variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Theme
      </Typography>
      <ToggleButtonGroup exclusive fullWidth value={mode} onChange={(_, v) => v && dispatch(setThemeMode(v))} aria-labelledby="theme-label" color="primary">
        <ToggleButton value="light" sx={{ gap: 0.75, py: 1.25 }}>
          <LightModeOutlinedIcon fontSize="small" /> Light
        </ToggleButton>
        <ToggleButton value="dark" sx={{ gap: 0.75, py: 1.25 }}>
          <DarkModeOutlinedIcon fontSize="small" /> Dark
        </ToggleButton>
        <ToggleButton value="system" sx={{ gap: 0.75, py: 1.25 }}>
          <SettingsBrightnessOutlinedIcon fontSize="small" /> System
        </ToggleButton>
      </ToggleButtonGroup>
    </SectionCard>
  );
}

// ─── Quick links ────────────────────────────────────────────────────

const LINKS = [
  { to: '/app/vehicles', label: 'My vehicles', hint: 'Add or update your vehicles', icon: <DirectionsCarOutlinedIcon /> },
  { to: '/app/memberships', label: 'Memberships', hint: 'Plans and roadside cover', icon: <CardMembershipOutlinedIcon /> },
  { to: '/app/billing', label: 'Billing', hint: 'Invoices, payments and receipts', icon: <ReceiptLongOutlinedIcon /> },
  { to: '/app/support', label: 'Support', hint: 'Get help or track a ticket', icon: <SupportAgentOutlinedIcon /> },
  { to: '/app/notifications', label: 'Notifications', hint: 'All your updates in one place', icon: <NotificationsNoneOutlinedIcon /> },
];

function QuickLinks() {
  return (
    <SectionCard title="Shortcuts">
      <List disablePadding sx={{ mx: -1 }}>
        {LINKS.map((l) => (
          <ListItemButton key={l.to} component={RouterLink} to={l.to} sx={{ borderRadius: 2, py: 1.25 }}>
            <ListItemIcon sx={{ minWidth: 40, color: 'primary.main' }}>{l.icon}</ListItemIcon>
            <ListItemText primary={l.label} secondary={l.hint} slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
            <ChevronRightIcon color="action" aria-hidden />
          </ListItemButton>
        ))}
      </List>
    </SectionCard>
  );
}

// ─── Sign out ───────────────────────────────────────────────────────

function SignOutSection() {
  const { logout } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await logout();
    } catch {
      /* session is cleared locally regardless */
    }
    nav('/login', { replace: true });
  };
  return (
    <SectionCard>
      <Button fullWidth size="large" variant="outlined" color="error" startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <LogoutIcon />} onClick={signOut} disabled={busy}>
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
    </SectionCard>
  );
}
