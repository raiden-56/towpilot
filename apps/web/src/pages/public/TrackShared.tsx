import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { Alert, Box, Card, CardContent, Chip, Container, Stack, Typography } from '@mui/material';
import { api, ApiError } from '@/api/client';
import { MapView, type MapMarker } from '@/components/MapView';
import { LoadingBlock } from '@/components/common';
import { Brand } from '@/layouts/shared';
import { dateTime, relative, time } from '@/lib/format';
import { brand } from '@/theme';

interface Shared {
  code: string;
  status: string;
  statusLabel: string;
  service: string;
  vehicle: string | null;
  etaAt: string | null;
  timeline: { status: string; label: string; at: string }[];
  driver: { firstName: string; truck: { registrationNumber: string; truckType: string } | null } | null;
  driverLocation: { lat: number; lng: number; at: string } | null;
  pickupArea: { lat: number; lng: number } | null;
  destination: string | null;
  expiresAt: string;
}

/** Public, time-limited tracking page for family/colleagues. Shows only limited details. */
export default function TrackShared() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['shared', token], queryFn: () => api.get<Shared>(`/public/track/${token}`), refetchInterval: 30_000, retry: false });

  useEffect(() => {
    const s = io({ path: '/socket.io', auth: { shareToken: token }, transports: ['websocket', 'polling'] });
    s.on('event', () => qc.invalidateQueries({ queryKey: ['shared', token] }));
    return () => void s.disconnect();
  }, [token, qc]);

  const d = q.data;
  const markers: MapMarker[] = [];
  if (d?.pickupArea) markers.push({ id: 'p', ...d.pickupArea, kind: 'pickup' });
  if (d?.driverLocation) markers.push({ id: 'd', lat: d.driverLocation.lat, lng: d.driverLocation.lng, kind: 'driver' });

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
      <Box sx={{ bgcolor: brand.navy, px: 2, py: 1.5 }}>
        <Brand light />
      </Box>
      <Container maxWidth="sm" sx={{ py: 3 }}>
        {q.isLoading && <LoadingBlock />}
        {q.error && (
          <Alert severity="warning">{q.error instanceof ApiError && q.error.status === 404 ? 'This tracking link has expired or was revoked by the person who shared it.' : 'Could not load tracking right now.'}</Alert>
        )}
        {d && (
          <Stack spacing={2}>
            <Typography variant="h2">{d.statusLabel}</Typography>
            <Typography color="text.secondary">
              {d.service}
              {d.vehicle ? ` · ${d.vehicle}` : ''} · Booking {d.code}
            </Typography>
            {d.etaAt && ['ACCEPTED', 'EN_ROUTE'].includes(d.status) && <Chip color="primary" label={`Driver expected around ${time(d.etaAt)}`} sx={{ alignSelf: 'flex-start' }} />}
            {markers.length > 0 && <MapView markers={markers} height={300} />}
            {d.driverLocation && (
              <Typography variant="caption" color="text.secondary">
                Driver location updated {relative(d.driverLocation.at)}. Pickup area is shown approximately.
              </Typography>
            )}
            {d.driver && (
              <Card>
                <CardContent>
                  <Typography variant="h6">Driver: {d.driver.firstName}</Typography>
                  {d.driver.truck && (
                    <Typography color="text.secondary">
                      Truck {d.driver.truck.registrationNumber} ({d.driver.truck.truckType.replace('_', ' ').toLowerCase()})
                    </Typography>
                  )}
                </CardContent>
              </Card>
            )}
            {d.destination && <Typography>Destination: {d.destination}</Typography>}
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Progress
                </Typography>
                {d.timeline.map((t) => (
                  <Stack key={t.status + t.at} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
                    <Typography variant="body2">{t.label}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {time(t.at)}
                    </Typography>
                  </Stack>
                ))}
              </CardContent>
            </Card>
            <Typography variant="caption" color="text.secondary">
              This link shows limited information and expires {dateTime(d.expiresAt)}.
            </Typography>
          </Stack>
        )}
      </Container>
    </Box>
  );
}
