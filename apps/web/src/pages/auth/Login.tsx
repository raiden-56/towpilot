import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Card, CardContent, Checkbox, Container, FormControlLabel, InputAdornment, Link, ListItemText, Menu, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import { ApiError } from '@/api/client';
import { homePathFor, useAuth } from '@/hooks/useAuth';
import { useConfig } from '@/hooks/useConfig';
import { EmergencyNotice, errorMessage, SandboxBanner } from '@/components/common';
import { Brand, ThemeToggle } from '@/layouts/shared';
import { brand } from '@/theme';
import { GUEST_MODE_ENABLED, GUEST_ROLES, type GuestRole } from '@/guest/session';

const phoneSchema = z.object({ phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number') });
const staffSchema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') });

export default function Login() {
  const [tab, setTab] = useState<'phone' | 'staff'>('phone');
  const { status, user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');

  useEffect(() => {
    if (status === 'authenticated' && user) nav(next && next.startsWith('/') ? next : homePathFor(user), { replace: true });
  }, [status, user, nav, next]);

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <SandboxBanner compact />
      <Box sx={{ bgcolor: brand.navy, color: '#fff', px: 2, py: 1.5, display: 'flex', alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Brand light />
        </Box>
        <ThemeToggle />
      </Box>
      <Container maxWidth="xs" sx={{ py: { xs: 3, sm: 6 }, flex: 1 }}>
        <Typography variant="h1" sx={{ mb: 1 }}>
          Stuck on the road?
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Sign in to request a tow or roadside help. Verified drivers, upfront prices, live tracking.
        </Typography>
        <Card>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth">
            <Tab value="phone" label="Mobile number" />
            <Tab value="staff" label="Staff sign-in" />
          </Tabs>
          <CardContent sx={{ p: 3 }}>{tab === 'phone' ? <PhoneLogin /> : <StaffLogin />}</CardContent>
        </Card>
        {GUEST_MODE_ENABLED && <GuestEntry />}
        <Box sx={{ mt: 3 }}>
          <EmergencyNotice />
        </Box>
      </Container>
    </Box>
  );
}

function PhoneLogin() {
  const { requestOtp, verifyOtp } = useAuth();
  const cfg = useConfig();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [sandboxOtp, setSandboxOtp] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [terms, setTerms] = useState(false);
  const [locationConsent, setLocationConsent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const form = useForm<{ phone: string }>({ resolver: zodResolver(phoneSchema) });

  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async (p: string) => {
    setError(null);
    setBusy(true);
    try {
      const r = await requestOtp(p);
      setPhone(p);
      setIsNew(r.isNewUser);
      setSandboxOtp(r.sandboxOtp ?? null);
      setStep('code');
      setCooldown(30);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyOtp({ phone, code, ...(isNew ? { fullName: name, acceptTerms: terms, locationConsent } : {}) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'phone')
    return (
      <Stack component="form" spacing={2} onSubmit={form.handleSubmit((v) => send(v.phone))} noValidate>
        <TextField
          label="Mobile number"
          autoFocus
          inputMode="numeric"
          autoComplete="tel-national"
          {...form.register('phone')}
          error={!!form.formState.errors.phone}
          helperText={form.formState.errors.phone?.message ?? 'We will send a 6-digit code by SMS'}
          slotProps={{ input: { startAdornment: <InputAdornment position="start">+91</InputAdornment> } }}
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" size="large" variant="contained" disabled={busy}>
          Send code
        </Button>
        <Typography variant="caption" color="text.secondary">
          Drivers and recovery workers also sign in with their registered mobile number.
        </Typography>
      </Stack>
    );

  return (
    <Stack component="form" spacing={2} onSubmit={(e) => (e.preventDefault(), verify())}>
      <Typography variant="body2">
        Code sent to <strong>+91 {phone}</strong>.{' '}
        <Link component="button" type="button" onClick={() => setStep('phone')}>
          Change
        </Link>
      </Typography>
      {sandboxOtp && cfg.data?.sms.sandbox && (
        <Alert severity="warning">
          Sandbox SMS — no message was sent. Your development code is <strong>{sandboxOtp}</strong>.
        </Alert>
      )}
      <TextField label="6-digit code" autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
      {isNew && (
        <>
          <TextField label="Your full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          <FormControlLabel
            control={<Checkbox checked={terms} onChange={(e) => setTerms(e.target.checked)} />}
            label={
              <Typography variant="body2">
                I agree to the Terms and the Privacy Notice, including processing of my phone number, vehicle details and location for providing assistance.
              </Typography>
            }
          />
          <FormControlLabel control={<Checkbox checked={locationConsent} onChange={(e) => setLocationConsent(e.target.checked)} />} label={<Typography variant="body2">Allow location use during active bookings</Typography>} />
        </>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <Button type="submit" size="large" variant="contained" disabled={busy || code.length !== 6 || (isNew && (!terms || name.trim().length < 2))}>
        {isNew ? 'Create account' : 'Sign in'}
      </Button>
      <Button disabled={cooldown > 0 || busy} onClick={() => send(phone)}>
        {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
      </Button>
    </Stack>
  );
}

function StaffLogin() {
  const { loginWithPassword } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string; password: string }>({ resolver: zodResolver(staffSchema) });
  return (
    <Stack
      component="form"
      spacing={2}
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await loginWithPassword(v.email, v.password);
        } catch (e) {
          setError(errorMessage(e));
        }
      })}
    >
      <TextField label="Work email" type="email" autoComplete="username" {...form.register('email')} error={!!form.formState.errors.email} helperText={form.formState.errors.email?.message} />
      <TextField label="Password" type="password" autoComplete="current-password" {...form.register('password')} error={!!form.formState.errors.password} helperText={form.formState.errors.password?.message} />
      {error && <Alert severity="error">{error}</Alert>}
      <Button type="submit" size="large" variant="contained" disabled={form.formState.isSubmitting}>
        Sign in
      </Button>
      <Typography variant="caption" color="text.secondary">
        For administrators, dispatchers and finance staff. Forgot your password? Reset it with an SMS code to your registered mobile via your administrator.
      </Typography>
    </Stack>
  );
}

/** Guest mode (VITE_GUEST_MODE=true): explore any portal with sample data, no account or server needed. */
function GuestEntry() {
  const { enterGuest } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = async (role: GuestRole) => {
    setAnchor(null);
    try {
      await enterGuest(role);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Card variant="outlined" sx={{ mt: 2, borderStyle: 'dashed', borderColor: 'primary.main' }}>
      <CardContent sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Just looking around?
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Explore TowPilot with sample data — no account needed. Pick the portal you want to see.
        </Typography>
        <Button fullWidth size="large" variant="contained" color="secondary" startIcon={<ExploreOutlinedIcon />} onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu" aria-controls={anchor ? 'guest-role-menu' : undefined}>
          Continue as guest
        </Button>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        <Menu id="guest-role-menu" anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { width: anchor?.offsetWidth, maxWidth: 'calc(100% - 32px)' } } }}>
          {GUEST_ROLES.map((r) => (
            <MenuItem key={r.role} onClick={() => void choose(r.role)}>
              <ListItemText primary={r.label} secondary={r.description} slotProps={{ secondary: { sx: { whiteSpace: 'normal' } } }} />
            </MenuItem>
          ))}
        </Menu>
      </CardContent>
    </Card>
  );
}
