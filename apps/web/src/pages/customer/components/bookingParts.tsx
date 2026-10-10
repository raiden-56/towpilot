import type { ReactNode } from 'react';
import { Box, Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import TwoWheelerIcon from '@mui/icons-material/TwoWheeler';
import DiamondOutlinedIcon from '@mui/icons-material/DiamondOutlined';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import RvHookupIcon from '@mui/icons-material/RvHookup';
import CarCrashIcon from '@mui/icons-material/CarCrash';
import BatteryChargingFullIcon from '@mui/icons-material/BatteryChargingFull';
import TireRepairIcon from '@mui/icons-material/TireRepair';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import KeyIcon from '@mui/icons-material/Key';
import BuildIcon from '@mui/icons-material/Build';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import type { BookingStatus, BookingSummary, Location } from '@/api/types';
import { PaymentChip, StatusChip, Money } from '@/components/common';
import { dateTime } from '@/lib/format';

const ICONS: Record<string, ReactNode> = {
  car: <DirectionsCarIcon />,
  bike: <TwoWheelerIcon />,
  premium: <DiamondOutlinedIcon />,
  flatbed: <LocalShippingIcon />,
  truck: <LocalShippingIcon />,
  wheellift: <RvHookupIcon />,
  accident: <CarCrashIcon />,
  battery: <BatteryChargingFullIcon />,
  tyre: <TireRepairIcon />,
  fuel: <LocalGasStationIcon />,
  key: <KeyIcon />,
};

export function ServiceIcon({ icon }: { icon?: string | null }) {
  return <>{(icon && ICONS[icon]) ?? <BuildIcon />}</>;
}

/** Statuses where we are still looking for a provider — shown honestly to the customer. */
export const SEARCHING_STATUSES: BookingStatus[] = ['CONFIRMED', 'SEARCHING_FOR_PROVIDER', 'REJECTED', 'REASSIGNMENT_REQUIRED', 'ASSIGNED'];
export const LIVE_STATUSES: BookingStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT'];
export const CLOSED_STATUSES: BookingStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED'];

export function placeLabel(l: Pick<Location, 'address' | 'placeName' | 'landmark' | 'lat' | 'lng'> | { address: string | null; placeName: string | null; lat: number; lng: number; landmark?: string | null } | null | undefined) {
  if (!l) return '—';
  return l.placeName || l.address || l.landmark || `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`;
}

/** Compact booking card for lists (home, bookings tabs). */
export function BookingCard({ b, action }: { b: BookingSummary; action?: ReactNode }) {
  const pickup = b.locations.find((l) => l.kind === 'PICKUP');
  const drop = b.locations.find((l) => l.kind === 'DROPOFF');
  const quote = b.quotes[0];
  return (
    <Card>
      <CardActionArea component={RouterLink} to={`/app/bookings/${b.id}`} aria-label={`Open booking ${b.code}`}>
        <CardContent sx={{ pb: action ? 1 : undefined }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h5" component="h3" noWrap>
                {b.serviceCategory.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {b.code} · {b.type === 'SCHEDULED' && b.scheduledFor ? `Scheduled ${dateTime(b.scheduledFor)}` : dateTime(b.createdAt)}
              </Typography>
            </Box>
            <StatusChip status={b.status} />
          </Stack>
          {b.vehicle && (
            <Typography variant="body2" sx={{ mt: 1, fontWeight: 600 }}>
              {b.vehicle.registrationNumber} · {b.vehicle.make} {b.vehicle.model}
            </Typography>
          )}
          <Stack spacing={0.25} sx={{ mt: 0.75 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
              <PlaceOutlinedIcon sx={{ fontSize: 16, color: 'error.main' }} aria-hidden />
              <Typography variant="body2" color="text.secondary" noWrap>
                {placeLabel(pickup)}
              </Typography>
            </Stack>
            {drop && (
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                <FlagOutlinedIcon sx={{ fontSize: 16, color: 'success.main' }} aria-hidden />
                <Typography variant="body2" color="text.secondary" noWrap>
                  {placeLabel(drop)}
                </Typography>
              </Stack>
            )}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            {b.invoice ? (
              <>
                <Typography variant="body2">
                  Invoice <Money value={b.invoice.total} strong />
                </Typography>
                <PaymentChip status={b.invoice.paymentStatus} />
              </>
            ) : quote ? (
              <Typography variant="body2" color="text.secondary">
                {quote.status === 'APPROVED' ? 'Approved quote' : 'Quote'} <Money value={quote.total} strong />
              </Typography>
            ) : null}
            {b.safetyFlags.length > 0 && <Chip size="small" color="warning" variant="outlined" label="Safety flagged" />}
          </Stack>
        </CardContent>
      </CardActionArea>
      {action && <Box sx={{ px: 2, pb: 1.5 }}>{action}</Box>}
    </Card>
  );
}

export const BREAKDOWN_LABELS: Record<string, string> = {
  MECHANICAL: 'Mechanical breakdown',
  COLLISION: 'Accident / collision',
  ENGINE: 'Engine problem / overheating',
  BATTERY: 'Battery dead',
  TYRE: 'Flat or burst tyre',
  TRANSMISSION: 'Gearbox / clutch',
  FLOOD: 'Water / flood damage',
  FUEL: 'Out of fuel / wrong fuel',
  LOCKOUT: 'Locked out / lost key',
  OTHER: 'Something else',
};

export const ACCESS_LABELS: Record<string, string> = {
  NONE: 'No restrictions',
  BASEMENT: 'Basement parking',
  NARROW_LANE: 'Narrow lane',
  PARKING_STRUCTURE: 'Multi-level parking',
  RESTRICTED_AREA: 'Gated / restricted area',
};

export const DESTINATION_LABELS: Record<string, string> = {
  GARAGE: 'My garage / mechanic',
  SERVICE_CENTRE: 'Authorised service centre',
  HOME: 'Home',
  CUSTOM: 'Other place',
};

export const TRI_QUESTIONS: { key: 'engineStarts' | 'wheelsRotate' | 'steeringWorks' | 'brakesWork' | 'isStuck' | 'isOverturned' | 'isSubmerged' | 'blockingTraffic' | 'majorDamage'; label: string }[] = [
  { key: 'engineStarts', label: 'Does the engine start?' },
  { key: 'wheelsRotate', label: 'Do the wheels roll freely?' },
  { key: 'steeringWorks', label: 'Does the steering turn?' },
  { key: 'brakesWork', label: 'Do the brakes work?' },
  { key: 'isStuck', label: 'Is it stuck (ditch, mud, kerb)?' },
  { key: 'isOverturned', label: 'Is it overturned or on its side?' },
  { key: 'isSubmerged', label: 'Is it in water or flooded?' },
  { key: 'blockingTraffic', label: 'Is it blocking traffic?' },
  { key: 'majorDamage', label: 'Is there major visible damage?' },
];

export const TRI_LABELS: Record<string, string> = { YES: 'Yes', NO: 'No', NOT_SURE: 'Not sure' };

export const SAFETY_FLAG_LABELS: Record<string, string> = {
  UNSAFE_LOCATION: 'Vehicle is in an unsafe spot',
  BLOCKING_TRAFFIC: 'Blocking traffic',
  EV_OR_HYBRID: 'Electric / hybrid high-voltage system',
  OVERTURNED: 'Possibly overturned',
  FLOOD_EXPOSURE: 'Possible flood / water exposure',
  HEIGHT_RESTRICTED: 'Height-restricted access',
  NARROW_ACCESS: 'Narrow access',
  RESTRICTED_ACCESS: 'Restricted-access area',
  CHILDREN_PRESENT: 'Children present',
  ELDERLY_PRESENT: 'Elderly person present',
  ACCESSIBILITY_NEEDS: 'Accessibility needs',
  PASSENGER_TRANSPORT: 'Passengers need transport',
};
export const flagLabel = (f: string) => SAFETY_FLAG_LABELS[f] ?? f.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
