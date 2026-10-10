import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertTitle, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import SosIcon from '@mui/icons-material/Sos';
import EventIcon from '@mui/icons-material/Event';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import WorkspacePremiumOutlinedIcon from '@mui/icons-material/WorkspacePremiumOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { api } from '@/api/client';
import type { BookingSummary, ServiceCategory, Vehicle } from '@/api/types';
import { EmergencyNotice, EmptyState, ErrorState, LoadingBlock, SectionCard } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { useConfig } from '@/hooks/useConfig';
import { useGeolocation } from '@/hooks/useGeolocation';
import { VEHICLE_CLASS_LABELS } from '@/lib/format';
import { brand } from '@/theme';
import { BookingCard, ServiceIcon } from './components/bookingParts';

interface ServicesResponse {
  zone: { id: string; name: string; city: string } | null;
  outsideServiceArea: boolean;
  services: ServiceCategory[];
}

interface MySubscription {
  id: string;
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  endsAt: string | null;
  membership: { name: string };
}

const VEHICLE_KEY = 'tp.home.vehicle';

export default function Home() {
  const { user } = useAuth();
  const nav = useNavigate();
  const cfg = useConfig();
  const geo = useGeolocation();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [vehicleId, setVehicleId] = useState<string>(() => {
    try {
      return localStorage.getItem(VEHICLE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<Vehicle[]>('/vehicles') });
  const active = useQuery({ queryKey: ['bookings', 'active', 'home'], queryFn: () => api.page<BookingSummary>('/bookings', { group: 'active', pageSize: 3 }), refetchInterval: 60_000 });
  const services = useQuery({
    queryKey: ['catalog', 'services', coords?.lat.toFixed(3) ?? null, coords?.lng.toFixed(3) ?? null],
    queryFn: () => api.get<ServicesResponse>('/catalog/services', coords ? { lat: coords.lat, lng: coords.lng } : undefined),
    staleTime: 5 * 60_000,
  });
  const subs = useQuery({ queryKey: ['memberships', 'mine'], queryFn: () => api.get<MySubscription[]>('/memberships/mine') });

  const vehicle = vehicles.data?.find((v) => v.id === vehicleId) ?? null;
  useEffect(() => {
    // Default to the first vehicle; drop a remembered vehicle that no longer exists.
    if (!vehicles.data) return;
    if (!vehicles.data.some((v) => v.id === vehicleId)) setVehicleId(vehicles.data[0]?.id ?? '');
  }, [vehicles.data, vehicleId]);
  useEffect(() => {
    try {
      if (vehicleId) localStorage.setItem(VEHICLE_KEY, vehicleId);
    } catch {
      /* storage unavailable */
    }
  }, [vehicleId]);

  const firstName = user?.fullName?.split(' ')[0];
  const activeSub = subs.data?.find((s) => s.status === 'ACTIVE');
  const pendingSub = subs.data?.find((s) => s.status === 'PENDING_PAYMENT');
  const supportPhone = cfg.data?.business.supportPhone;

  const sortedServices = useMemo(() => {
    const list = services.data?.services ?? [];
    return [...list].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'TOWING' ? -1 : 1));
  }, [services.data]);

  async function checkNearMe() {
    const f = await geo.locate();
    if (f) setCoords({ lat: f.lat, lng: f.lng });
  }

  const requestUrl = (serviceKey?: string, scheduled?: boolean) => {
    const p = new URLSearchParams();
    if (serviceKey) p.set('service', serviceKey);
    if (scheduled) p.set('type', 'scheduled');
    if (vehicleId) p.set('vehicleId', vehicleId);
    const s = p.toString();
    return `/app/request${s ? `?${s}` : ''}`;
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h2" component="h1">
          {firstName ? `Hi ${firstName}` : 'Welcome'}
        </Typography>
        <Typography color="text.secondary">Roadside help and towing, with upfront prices and live tracking.</Typography>
      </Box>

      {/* Primary emergency action */}
      <Card sx={{ bgcolor: brand.navy, color: '#fff', border: 'none' }}>
        <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Typography variant="h3" component="h2" sx={{ color: '#fff' }}>
            Broken down or stuck?
          </Typography>
          <Typography sx={{ mt: 0.5, color: 'rgba(255,255,255,0.8)' }}>Tell us where you are. You will see the price before anyone is dispatched.</Typography>
          <Button
            component={RouterLink}
            to={requestUrl()}
            size="large"
            fullWidth
            variant="contained"
            startIcon={<SosIcon />}
            sx={{ mt: 2, minHeight: 60, fontSize: '1.15rem', bgcolor: brand.amber, color: '#111827', '&:hover': { bgcolor: '#fbbf24' } }}
          >
            Get help now
          </Button>
          <Button component={RouterLink} to={requestUrl(undefined, true)} fullWidth startIcon={<EventIcon />} sx={{ mt: 1, color: '#fff', minHeight: 44 }}>
            Schedule a tow or service for later
          </Button>
        </CardContent>
      </Card>

      <EmergencyNotice />

      {/* Active bookings */}
      {active.isLoading ? (
        <LoadingBlock rows={1} height={120} />
      ) : active.error ? (
        <ErrorState error={active.error} onRetry={() => active.refetch()} title="Could not load your active bookings" />
      ) : active.data && active.data.data.length > 0 ? (
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h4" component="h2">
              Active {active.data.data.length === 1 ? 'booking' : 'bookings'}
            </Typography>
            {active.data.meta.total > 3 && (
              <Button component={RouterLink} to="/app/bookings" size="small" endIcon={<ChevronRightIcon />}>
                All {active.data.meta.total}
              </Button>
            )}
          </Stack>
          <Stack spacing={1.25}>
            {active.data.data.map((b) => (
              <BookingCard key={b.id} b={b} />
            ))}
          </Stack>
        </Box>
      ) : null}

      {/* Vehicle selector */}
      <SectionCard
        title="Your vehicle"
        action={
          <Button component={RouterLink} to="/app/vehicles" size="small">
            Manage
          </Button>
        }
      >
        {vehicles.isLoading ? (
          <LoadingBlock rows={1} />
        ) : vehicles.error ? (
          <ErrorState error={vehicles.error} onRetry={() => vehicles.refetch()} />
        ) : !vehicles.data?.length ? (
          <Stack spacing={1} alignItems="flex-start">
            <Typography color="text.secondary">Add your vehicle once so requests are faster next time.</Typography>
            <Button component={RouterLink} to="/app/vehicles" variant="outlined">
              Add a vehicle
            </Button>
          </Stack>
        ) : (
          <TextField select label="Vehicle needing help" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.data.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.registrationNumber} · {v.make} {v.model} ({VEHICLE_CLASS_LABELS[v.vehicleClass] ?? v.vehicleClass})
              </MenuItem>
            ))}
          </TextField>
        )}
      </SectionCard>

      {/* Services */}
      <Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1} sx={{ mb: 1 }}>
          <Typography variant="h4" component="h2">
            Services
          </Typography>
          <Button size="small" variant="outlined" onClick={checkNearMe} disabled={geo.loading} startIcon={geo.loading ? <CircularProgress size={16} /> : <MyLocationIcon />}>
            {coords ? 'Re-check my location' : 'Check services near me'}
          </Button>
        </Stack>
        {geo.errorText && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {geo.errorText}
          </Alert>
        )}
        {services.data?.outsideServiceArea && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            <AlertTitle>You appear to be outside our service area</AlertTitle>
            We can't dispatch a truck to this location yet.{supportPhone && (
              <>
                {' '}Call support on <a href={`tel:${supportPhone.replace(/\s/g, '')}`}>{supportPhone}</a> and we'll help you find alternatives.
              </>
            )}
          </Alert>
        )}
        {services.data?.zone && (
          <Alert severity="success" sx={{ mb: 1.5 }}>
            You're in our {services.data.zone.name} service area. Services marked “Available here” can be dispatched to you.
          </Alert>
        )}
        {services.isLoading ? (
          <LoadingBlock rows={3} height={84} />
        ) : services.error ? (
          <ErrorState error={services.error} onRetry={() => services.refetch()} title="Could not load services" />
        ) : !sortedServices.length ? (
          <EmptyState title="No services available right now" body={supportPhone ? `Please call support on ${supportPhone}.` : undefined} />
        ) : (
          <Grid container spacing={1.25}>
            {sortedServices.map((s) => {
              const incompatible = !!vehicle && s.vehicleClasses.length > 0 && !s.vehicleClasses.includes(vehicle.vehicleClass);
              const unavailable = s.availableHere === false;
              return (
                <Grid key={s.id} size={{ xs: 12, sm: 6 }}>
                  <Card sx={{ height: '100%', opacity: incompatible || unavailable ? 0.65 : 1 }}>
                    <CardActionArea onClick={() => nav(requestUrl(s.key))} sx={{ height: '100%' }} aria-label={`Request ${s.name}`}>
                      <CardContent sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                        <Box sx={{ width: 44, height: 44, flexShrink: 0, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: s.kind === 'TOWING' ? 'secondary.main' : 'primary.main', color: s.kind === 'TOWING' ? 'secondary.contrastText' : 'primary.contrastText' }} aria-hidden>
                          <ServiceIcon icon={s.icon} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="h6" component="h3">
                            {s.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {s.description}
                          </Typography>
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                            <Chip size="small" variant="outlined" label={s.kind === 'TOWING' ? 'Towing' : 'On-site fix'} />
                            {s.availableHere === true && <Chip size="small" color="success" label="Available here" />}
                            {unavailable && <Chip size="small" color="warning" variant="outlined" label="Not offered at your location" />}
                            {incompatible && <Chip size="small" variant="outlined" label={`Not for ${VEHICLE_CLASS_LABELS[vehicle!.vehicleClass]?.toLowerCase() ?? 'this vehicle'}`} />}
                          </Stack>
                        </Box>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        )}
        {!coords && !services.isLoading && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            We only use your location when you tap “Check services near me” or request help.
          </Typography>
        )}
      </Box>

      {/* Membership */}
      <Card>
        <CardActionArea component={RouterLink} to="/app/memberships">
          <CardContent sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <WorkspacePremiumOutlinedIcon color="primary" sx={{ fontSize: 36 }} aria-hidden />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {activeSub ? (
                <>
                  <Typography variant="h6">{activeSub.membership.name} is active</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Benefits apply automatically to covered services. View usage and terms.
                  </Typography>
                </>
              ) : pendingSub ? (
                <>
                  <Typography variant="h6">Your membership is awaiting payment</Typography>
                  <Typography variant="body2" color="text.secondary">
                    It activates once your payment is confirmed.
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6">Save with a membership</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Covered services, extra free kilometres and discounts. See plans, exclusions and terms.
                  </Typography>
                </>
              )}
            </Box>
            <ChevronRightIcon color="action" aria-hidden />
          </CardContent>
        </CardActionArea>
      </Card>
    </Stack>
  );
}
