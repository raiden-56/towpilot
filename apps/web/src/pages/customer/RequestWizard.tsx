import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import { api, ApiError } from '@/api/client';
import type { BookingDetail, Location, ServiceCategory, Vehicle } from '@/api/types';
import { ConfirmDialog, EmergencyNotice, ErrorState, LoadingBlock, PageHeader, SectionCard, errorMessage } from '@/components/common';
import { LocationPicker, type LocationValue } from '@/components/LocationPicker';
import { useAuth } from '@/hooks/useAuth';
import { useConfig } from '@/hooks/useConfig';
import { drafts, useIsOnline } from '@/hooks/useOnline';
import { dateTime, VEHICLE_CLASS_LABELS } from '@/lib/format';
import { ACCESS_LABELS, BREAKDOWN_LABELS, DESTINATION_LABELS, ServiceIcon, TRI_LABELS, TRI_QUESTIONS, placeLabel } from './components/bookingParts';
import { ConditionStep, defaultAssessment, type AssessmentState, type PendingFile } from './components/ConditionStep';
import { QuoteConfirmPanel } from './components/QuoteConfirm';
import { VehicleFormDialog } from './components/VehicleForm';
import { MAX_UPLOAD_BYTES } from './components/shared';

// ─── Draft model ─────────────────────────────────────────────────────

type StepKey = 'service' | 'pickup' | 'destination' | 'condition' | 'contact' | 'review';
type DestinationType = 'GARAGE' | 'SERVICE_CENTRE' | 'HOME' | 'CUSTOM';

interface Draft {
  clientRequestId: string;
  step: StepKey;
  serviceKey: string;
  vehicleId: string;
  type: 'EMERGENCY' | 'SCHEDULED';
  scheduledFor: string; // datetime-local value
  pickup: LocationValue | null;
  isSafeLocation: boolean | null;
  dropoff: LocationValue | null;
  destinationType: DestinationType;
  assessment: AssessmentState;
  crewRequested: number;
  contactName: string;
  contactPhone: string;
  instructions: string;
  promoCode: string;
  useMembership: boolean;
  bookingId: string | null;
}

const DRAFT_KEY = 'booking-request';
const STEP_TITLES: Record<StepKey, string> = {
  service: 'Service & vehicle',
  pickup: 'Pickup location',
  destination: 'Destination',
  condition: 'Vehicle condition',
  contact: 'Contact & extras',
  review: 'Review & quote',
};

const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultScheduleTime() {
  const d = new Date(Date.now() + 90 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(d);
}

function emptyDraft(): Draft {
  return {
    clientRequestId: newRequestId(),
    step: 'service',
    serviceKey: '',
    vehicleId: '',
    type: 'EMERGENCY',
    scheduledFor: defaultScheduleTime(),
    pickup: null,
    isSafeLocation: null,
    dropoff: null,
    destinationType: 'GARAGE',
    assessment: defaultAssessment(),
    crewRequested: 1,
    contactName: '',
    contactPhone: '',
    instructions: '',
    promoCode: '',
    useMembership: true,
    bookingId: null,
  };
}

const LOC_KEYS = ['accuracyM', 'capturedAt', 'address', 'landmark', 'highway', 'roadDirection', 'kmMarker', 'gateNumber', 'floor', 'parkingLevel', 'accessNotes', 'placeName'] as const;

/** Converts a stored location (which may contain nulls/DB fields) into the API's input shape. */
function toLocationInput(v: LocationValue) {
  const out: Record<string, unknown> = { lat: v.lat, lng: v.lng, source: v.source };
  for (const k of LOC_KEYS) {
    if (k === 'placeName') continue;
    const val = v[k];
    if (val == null) continue;
    if (typeof val === 'string') {
      if (val.trim()) out[k] = val.trim();
    } else out[k] = val;
  }
  return out;
}

function fromLocation(l: Location | null | undefined): LocationValue | null {
  if (!l) return null;
  const v: LocationValue = { lat: l.lat, lng: l.lng, source: l.source };
  for (const k of LOC_KEYS) if (l[k] != null) (v as unknown as Record<string, unknown>)[k] = l[k];
  return v;
}

const normalisePhone = (p: string) => p.replace(/[\s-]/g, '');
const hasPin = (v: LocationValue | null) => !!v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && !(v.lat === 0 && v.lng === 0);

// ─── Step validation (Zod) ───────────────────────────────────────────

function issuesToErrors(r: z.ZodSafeParseResult<unknown>): Record<string, string> {
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = i.path.join('.') || '_';
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

function validateStep(step: StepKey, d: Draft, ctx: { service?: ServiceCategory; vehicle?: Vehicle }): Record<string, string> {
  switch (step) {
    case 'service': {
      const schema = z
        .object({
          serviceKey: z.string().min(1, 'Choose the service you need'),
          vehicleId: z.string().min(1, 'Choose the vehicle that needs help'),
          type: z.enum(['EMERGENCY', 'SCHEDULED']),
          scheduledFor: z.string(),
        })
        .superRefine((v, c) => {
          if (v.serviceKey && !ctx.service) c.addIssue({ code: 'custom', path: ['serviceKey'], message: 'This service is no longer available. Choose another.' });
          if (v.vehicleId && !ctx.vehicle) c.addIssue({ code: 'custom', path: ['vehicleId'], message: 'Choose one of your vehicles' });
          if (ctx.service && ctx.vehicle && ctx.service.vehicleClasses.length && !ctx.service.vehicleClasses.includes(ctx.vehicle.vehicleClass))
            c.addIssue({ code: 'custom', path: ['serviceKey'], message: `${ctx.service.name} is not available for ${VEHICLE_CLASS_LABELS[ctx.vehicle.vehicleClass]?.toLowerCase()} vehicles. Choose another service.` });
          if (v.type === 'SCHEDULED') {
            const t = new Date(v.scheduledFor).getTime();
            const mins = (t - Date.now()) / 60000;
            if (!v.scheduledFor || Number.isNaN(t)) c.addIssue({ code: 'custom', path: ['scheduledFor'], message: 'Choose a date and time' });
            else if (mins < 30) c.addIssue({ code: 'custom', path: ['scheduledFor'], message: 'Choose a time at least 30 minutes from now' });
            else if (mins > 30 * 24 * 60) c.addIssue({ code: 'custom', path: ['scheduledFor'], message: 'You can schedule up to 30 days ahead' });
          }
        });
      return issuesToErrors(schema.safeParse(d));
    }
    case 'pickup': {
      const e: Record<string, string> = {};
      if (!hasPin(d.pickup)) e.pickup = 'Set the pickup point: use your location, search, paste a map link, or tap the map.';
      if (d.isSafeLocation == null) e.isSafeLocation = 'Please tell us whether the vehicle is in a safe place.';
      if (d.pickup?.address && d.pickup.address.length > 500) e.pickup = 'Address is too long (max 500 characters).';
      return e;
    }
    case 'destination': {
      const e: Record<string, string> = {};
      if (!hasPin(d.dropoff)) e.dropoff = 'Set the destination on the map, search for it, or pick a saved address.';
      return e;
    }
    case 'condition': {
      const schema = z.object({
        breakdownType: z.string().min(1, 'Tell us what happened'),
        notes: z.string().max(1000, 'Keep notes under 1000 characters'),
        passengersNeedingTransport: z.number().int().min(0).max(20),
      });
      return issuesToErrors(schema.safeParse(d.assessment));
    }
    case 'contact': {
      const schema = z.object({
        contactName: z.string().trim().min(2, 'Enter the name of the person at the vehicle').max(100),
        contactPhone: z
          .string()
          .transform(normalisePhone)
          .refine((p) => /^(\+91)?[6-9]\d{9}$/.test(p) || /^\+\d{10,15}$/.test(p), 'Enter a valid mobile number, e.g. 98765 43210'),
        instructions: z.string().max(1000, 'Keep instructions under 1000 characters'),
        promoCode: z.string().max(30, 'Promo code is too long'),
      });
      return issuesToErrors(schema.safeParse(d));
    }
    default:
      return {};
  }
}

// ─── Component ───────────────────────────────────────────────────────

interface ServicesResponse {
  zone: { id: string; name: string; city: string } | null;
  outsideServiceArea: boolean;
  services: ServiceCategory[];
}
interface SavedAddress {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  landmark: string | null;
}

type SubmitProblem = { kind: 'outside' } | { kind: 'duplicate'; bookingId: string; message: string } | { kind: 'error'; message: string; fields?: Record<string, string> };

export default function RequestWizard() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const cfg = useConfig();
  const online = useIsOnline();
  const topRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [restoredNotice, setRestoredNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ state: 'idle' | 'uploading' | 'done' | 'failed'; message?: string }>({ state: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<SubmitProblem | null>(null);
  const [vehicleDialog, setVehicleDialog] = useState(false);
  const [resetConfirm, setResetConfirm] = useState<null | { to: StepKey | 'restart' }>(null);
  const [resetting, setResetting] = useState(false);
  const [initError, setInitError] = useState<unknown>(null);

  const services = useQuery({ queryKey: ['catalog', 'services', null, null], queryFn: () => api.get<ServicesResponse>('/catalog/services'), staleTime: 5 * 60_000 });
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<Vehicle[]>('/vehicles') });
  const addresses = useQuery({ queryKey: ['me', 'addresses'], queryFn: () => api.get<SavedAddress[]>('/me/addresses') });

  // ── Initialise: ?repeat → saved draft → query params ──
  const repeatId = params.get('repeat');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = emptyDraft();
      const fromParams = (d: Draft): Draft => ({
        ...d,
        serviceKey: params.get('service') ?? d.serviceKey,
        vehicleId: params.get('vehicleId') ?? d.vehicleId,
        type: params.get('type') === 'scheduled' ? 'SCHEDULED' : d.type,
      });
      if (repeatId) {
        try {
          const b = await api.get<BookingDetail>(`/bookings/${repeatId}`);
          if (cancelled) return;
          const a = b.assessment;
          setDraft({
            ...base,
            serviceKey: b.serviceCategory.key,
            vehicleId: b.vehicle?.id ?? '',
            pickup: fromLocation(b.pickup),
            dropoff: fromLocation(b.dropoff),
            destinationType: (b.dropoff?.destinationType as DestinationType | null) ?? 'GARAGE',
            assessment: { ...base.assessment, isEvOrHybrid: a?.isEvOrHybrid ?? false, accessRestriction: a?.accessRestriction ?? 'NONE' },
            crewRequested: b.crewRequested ?? 1,
            contactName: b.contactName ?? '',
            contactPhone: b.contactPhone ?? '',
            instructions: b.instructions ?? '',
          });
          setDirty(true);
          setRestoredNotice(`Prefilled from booking ${b.code}. Please check the pickup point and tell us about the vehicle's condition today.`);
        } catch (e) {
          if (!cancelled) setInitError(e);
        }
        return;
      }
      const saved = drafts.load<Draft>(DRAFT_KEY);
      if (saved && saved.clientRequestId) {
        const restored: Draft = { ...base, ...saved, assessment: { ...base.assessment, ...saved.assessment } };
        setDraft(saved.bookingId ? restored : fromParams(restored));
        setDirty(true);
        setRestoredNotice(saved.bookingId ? 'You have a quote waiting for confirmation from your last visit.' : 'We restored your unfinished request from this device.');
        return;
      }
      setDraft(fromParams(base));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeatId]);

  // Prefill contact details from the profile (once).
  const prefilled = useRef(false);
  useEffect(() => {
    if (!draft || !user || prefilled.current) return;
    prefilled.current = true;
    if (!draft.contactName && !draft.contactPhone) setDraft({ ...draft, contactName: user.fullName ?? '', contactPhone: user.phone ?? '' });
  }, [draft, user]);

  // Persist the draft locally (never files) whenever the customer changes something.
  useEffect(() => {
    if (draft && dirty) drafts.save(DRAFT_KEY, draft);
  }, [draft, dirty]);

  // Release object URLs for previews.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  // Booking created for this draft (quote stage).
  const booking = useQuery({
    queryKey: ['booking', draft?.bookingId],
    queryFn: () => api.get<BookingDetail>(`/bookings/${draft!.bookingId}`),
    enabled: !!draft?.bookingId,
  });

  // If the booking moved on elsewhere (confirmed in another tab, cancelled by the system), react honestly.
  useEffect(() => {
    const b = booking.data;
    if (!b || !draft?.bookingId || b.id !== draft.bookingId) return;
    if (b.status === 'CANCELLED' || b.status === 'FAILED') {
      setDraft({ ...draft, bookingId: null, clientRequestId: newRequestId(), step: 'review' });
      setRestoredNotice(`Your earlier quote (${b.code}) is no longer active. Review your details and get a new quote.`);
    } else if (b.status !== 'QUOTED' && b.status !== 'REQUESTED') {
      drafts.clear(DRAFT_KEY);
      nav(`/app/bookings/${b.id}`, { replace: true });
    }
  }, [booking.data, draft, nav]);

  const service = services.data?.services.find((s) => s.key === draft?.serviceKey);
  const vehicle = vehicles.data?.find((v) => v.id === draft?.vehicleId);
  const towing = service ? service.kind === 'TOWING' : true;
  const steps: StepKey[] = useMemo(() => (towing ? ['service', 'pickup', 'destination', 'condition', 'contact', 'review'] : ['service', 'pickup', 'condition', 'contact', 'review']), [towing]);

  // Availability at the chosen pickup point.
  const pickupLat = draft?.pickup && hasPin(draft.pickup) ? draft.pickup.lat : null;
  const pickupLng = draft?.pickup && hasPin(draft.pickup) ? draft.pickup.lng : null;
  const here = useQuery({
    queryKey: ['catalog', 'services', pickupLat?.toFixed(3) ?? null, pickupLng?.toFixed(3) ?? null],
    queryFn: () => api.get<ServicesResponse>('/catalog/services', { lat: pickupLat!, lng: pickupLng! }),
    enabled: pickupLat != null && pickupLng != null && online,
    staleTime: 5 * 60_000,
  });
  const serviceHere = here.data?.services.find((s) => s.key === draft?.serviceKey);

  if (initError) return <ErrorState error={initError} title="Could not load the previous booking" onRetry={() => window.location.reload()} />;
  if (!draft || services.isLoading || vehicles.isLoading) return <LoadingBlock rows={5} />;
  if (services.error) return <ErrorState error={services.error} onRetry={() => services.refetch()} title="Could not load services" />;

  const stepIndex = Math.max(0, steps.indexOf(draft.step));
  const step = steps[stepIndex] ?? 'service';
  const supportPhone = cfg.data?.business.supportPhone;
  const locked = !!draft.bookingId; // details are frozen once a quote exists

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    if (Object.keys(errors).length) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k.split('.')[0]! in patch))));
  };
  const goTo = (s: StepKey) => {
    setErrors({});
    update({ step: s });
    setTimeout(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const next = () => {
    const e = validateStep(step, draft, { service, vehicle });
    setErrors(e);
    if (Object.keys(e).length) return;
    const n = steps[stepIndex + 1];
    if (n) goTo(n);
  };
  const back = () => {
    const p = steps[stepIndex - 1];
    if (p) goTo(p);
    else nav('/app');
  };

  const chooseVehicle = (v: Vehicle) => {
    const ev = v.fuelType === 'ELECTRIC' || v.fuelType === 'HYBRID';
    update({ vehicleId: v.id, assessment: { ...draft.assessment, isEvOrHybrid: ev || (draft.vehicleId === v.id && draft.assessment.isEvOrHybrid) } });
  };

  function addFiles(list: File[], kind: PendingFile['kind']) {
    setFileError(null);
    const okTypes = kind === 'DAMAGE_PHOTO' ? ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] : ['video/mp4', 'video/quicktime', 'video/webm'];
    const accepted: PendingFile[] = [];
    const rejected: string[] = [];
    for (const f of list) {
      if (!okTypes.includes(f.type)) rejected.push(`${f.name} (unsupported type)`);
      else if (f.size > MAX_UPLOAD_BYTES) rejected.push(`${f.name} (larger than 15 MB)`);
      else accepted.push({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`, file: f, url: URL.createObjectURL(f), kind });
    }
    setFiles((cur) => {
      const sameKind = cur.filter((c) => c.kind === kind).length;
      const room = Math.max(0, 6 - sameKind);
      if (accepted.length > room) rejected.push(`${accepted.length - room} file(s) over the limit of 6 ${kind === 'DAMAGE_PHOTO' ? 'photos' : 'videos'}`);
      accepted.slice(room).forEach((a) => URL.revokeObjectURL(a.url));
      return [...cur, ...accepted.slice(0, room)];
    });
    if (rejected.length) setFileError(`Not added: ${rejected.join(', ')}.`);
  }
  function removeFile(id: string) {
    setFiles((cur) => {
      const f = cur.find((c) => c.id === id);
      if (f) URL.revokeObjectURL(f.url);
      return cur.filter((c) => c.id !== id);
    });
  }

  async function uploadFiles(bookingId: string, pending: PendingFile[]) {
    if (!pending.length) return;
    setUpload({ state: 'uploading' });
    const failed: string[] = [];
    for (const kind of ['DAMAGE_PHOTO', 'DAMAGE_VIDEO'] as const) {
      const group = pending.filter((p) => p.kind === kind);
      if (!group.length) continue;
      const fd = new FormData();
      fd.append('kind', kind);
      group.forEach((g) => fd.append('files', g.file, g.file.name));
      try {
        await api.upload(`/bookings/${bookingId}/attachments`, fd);
      } catch (e) {
        failed.push(`${kind === 'DAMAGE_PHOTO' ? 'Photos' : 'Videos'}: ${errorMessage(e)}`);
      }
    }
    if (failed.length) setUpload({ state: 'failed', message: `${failed.join(' ')} You can add them again from the booking page.` });
    else {
      setUpload({ state: 'done' });
      setFiles((cur) => {
        cur.forEach((c) => URL.revokeObjectURL(c.url));
        return [];
      });
    }
  }

  async function submit() {
    // Re-validate everything before sending.
    for (const s of steps.filter((x) => x !== 'review')) {
      const e = validateStep(s, draft!, { service, vehicle });
      if (Object.keys(e).length) {
        setErrors(e);
        setDraft({ ...draft!, step: s });
        return;
      }
    }
    if (!service || !vehicle) return;
    setSubmitting(true);
    setProblem(null);
    const d = draft!;
    const body = {
      clientRequestId: d.clientRequestId,
      serviceCategoryId: service.id,
      vehicleId: d.vehicleId,
      type: d.type,
      scheduledFor: d.type === 'SCHEDULED' ? new Date(d.scheduledFor).toISOString() : undefined,
      pickup: { ...toLocationInput(d.pickup!), isSafeLocation: d.isSafeLocation ?? undefined },
      dropoff: towing && d.dropoff ? { ...toLocationInput(d.dropoff), destinationType: d.destinationType, placeName: d.dropoff.placeName?.trim() || undefined } : undefined,
      assessment: { ...d.assessment, notes: d.assessment.notes.trim() || undefined },
      crewRequested: d.crewRequested,
      contactName: d.contactName.trim(),
      contactPhone: normalisePhone(d.contactPhone),
      instructions: d.instructions.trim() || undefined,
      promoCode: d.promoCode.trim() || undefined,
      useMembership: d.useMembership,
    };
    try {
      const b = await api.post<BookingDetail>('/bookings', body);
      qc.setQueryData(['booking', b.id], b);
      qc.invalidateQueries({ queryKey: ['bookings'] });
      setDraft({ ...d, bookingId: b.id, step: 'review' });
      setDirty(true);
      void uploadFiles(b.id, files);
    } catch (e) {
      if (e instanceof ApiError) {
        const det = (e.details ?? {}) as { code?: string; bookingId?: string };
        if (e.status === 422 && det.code === 'OUTSIDE_SERVICE_AREA') setProblem({ kind: 'outside' });
        else if (e.status === 409 && det.bookingId) setProblem({ kind: 'duplicate', bookingId: det.bookingId, message: e.message });
        else if (e.code === 'VALIDATION_ERROR') setProblem({ kind: 'error', message: 'Some details need fixing:', fields: e.fieldErrors });
        else setProblem({ kind: 'error', message: e.message });
      } else setProblem({ kind: 'error', message: errorMessage(e) });
    } finally {
      setSubmitting(false);
    }
  }

  /** Discards the unconfirmed quote (free cancellation in QUOTED) so details can be edited or restarted. */
  async function discardQuote(then: StepKey | 'restart') {
    setResetting(true);
    try {
      if (draft!.bookingId) {
        try {
          await api.post(`/bookings/${draft!.bookingId}/cancel`, { reason: then === 'restart' ? 'Customer started a new request before confirming' : 'Customer edited the request before confirming' });
        } catch (e) {
          // Already cancelled/expired is fine; anything else is surfaced.
          if (!(e instanceof ApiError && (e.status === 409 || e.status === 404))) throw e;
        }
        qc.invalidateQueries({ queryKey: ['bookings'] });
      }
      if (then === 'restart') {
        drafts.clear(DRAFT_KEY);
        files.forEach((f) => URL.revokeObjectURL(f.url));
        setFiles([]);
        setUpload({ state: 'idle' });
        setDraft({ ...emptyDraft(), contactName: user?.fullName ?? '', contactPhone: user?.phone ?? '' });
        setDirty(false);
        setRestoredNotice(null);
      } else {
        update({ bookingId: null, clientRequestId: newRequestId(), step: then });
        setUpload({ state: 'idle' });
      }
      setProblem(null);
      setResetConfirm(null);
    } catch (e) {
      setProblem({ kind: 'error', message: errorMessage(e) });
      setResetConfirm(null);
    } finally {
      setResetting(false);
    }
  }

  const onConfirmed = (b: BookingDetail) => {
    drafts.clear(DRAFT_KEY);
    qc.setQueryData(['booking', b.id], b);
    qc.invalidateQueries({ queryKey: ['bookings'] });
    nav(`/app/bookings/${b.id}`, { replace: true, state: { justConfirmed: true } });
  };

  const editStep = (s: StepKey) => (locked ? setResetConfirm({ to: s }) : goTo(s));

  // ── Render ──
  return (
    <Box ref={topRef} sx={{ scrollMarginTop: 80 }}>
      <PageHeader
        title={draft.type === 'SCHEDULED' ? 'Schedule a service' : 'Get help now'}
        subtitle={`Step ${stepIndex + 1} of ${steps.length} · ${STEP_TITLES[step]}`}
        actions={
          dirty ? (
            <Button size="small" onClick={() => setResetConfirm({ to: 'restart' })} disabled={resetting}>
              Start over
            </Button>
          ) : undefined
        }
      />
      <LinearProgress variant="determinate" value={((stepIndex + 1) / steps.length) * 100} sx={{ mb: 2, height: 6, borderRadius: 3 }} aria-label={`Progress: step ${stepIndex + 1} of ${steps.length}`} />

      {restoredNotice && (
        <Alert severity="info" onClose={() => setRestoredNotice(null)} sx={{ mb: 2 }}>
          {restoredNotice}
        </Alert>
      )}
      {!online && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You are offline. You can keep filling in details — they are saved on this device — but nothing is sent until you reconnect.
        </Alert>
      )}

      {step === 'service' && (
        <Stack spacing={2.5}>
          {draft.type === 'EMERGENCY' && <EmergencyNotice />}
          <SectionCard title="When do you need help?">
            <ToggleButtonGroup exclusive fullWidth value={draft.type} onChange={(_, v) => v && update({ type: v })} aria-label="Request type" disabled={locked}>
              <ToggleButton value="EMERGENCY" sx={{ minHeight: 48 }}>
                Now
              </ToggleButton>
              <ToggleButton value="SCHEDULED" sx={{ minHeight: 48 }}>
                Schedule for later
              </ToggleButton>
            </ToggleButtonGroup>
            {draft.type === 'SCHEDULED' && (
              <TextField
                sx={{ mt: 2 }}
                type="datetime-local"
                label="Date and time"
                value={draft.scheduledFor}
                onChange={(e) => update({ scheduledFor: e.target.value })}
                error={!!errors.scheduledFor}
                helperText={errors.scheduledFor ?? 'At least 30 minutes from now, up to 30 days ahead.'}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: toLocalInput(new Date(Date.now() + 30 * 60_000)), max: toLocalInput(new Date(Date.now() + 30 * 86400_000)) } }}
                disabled={locked}
              />
            )}
          </SectionCard>

          <SectionCard
            title="Which vehicle?"
            action={
              <Button size="small" startIcon={<AddIcon />} onClick={() => setVehicleDialog(true)} disabled={locked}>
                Add
              </Button>
            }
          >
            {vehicles.error ? (
              <ErrorState error={vehicles.error} onRetry={() => vehicles.refetch()} />
            ) : !vehicles.data?.length ? (
              <Stack spacing={1.5} alignItems="flex-start">
                <Typography color="text.secondary">Add the vehicle that needs help. It takes less than a minute.</Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setVehicleDialog(true)}>
                  Add vehicle
                </Button>
              </Stack>
            ) : (
              <Stack spacing={1} role="group" aria-label="Vehicle">
                  {vehicles.data.map((v) => (
                    <ChoiceCard key={v.id} selected={draft.vehicleId === v.id} onClick={() => !locked && chooseVehicle(v)} disabled={locked}>
                      {draft.vehicleId === v.id ? <CheckCircleIcon color="primary" aria-label="Selected" /> : <RadioButtonUncheckedIcon color="disabled" aria-hidden />}
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700 }}>{v.registrationNumber}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {v.make} {v.model} · {VEHICLE_CLASS_LABELS[v.vehicleClass] ?? v.vehicleClass}
                          {(v.fuelType === 'ELECTRIC' || v.fuelType === 'HYBRID') && ` · ${v.fuelType === 'ELECTRIC' ? 'EV' : 'Hybrid'}`}
                        </Typography>
                      </Box>
                    </ChoiceCard>
                  ))}
              </Stack>
            )}
            {errors.vehicleId && (
              <Typography color="error" variant="body2" sx={{ mt: 1 }} role="alert">
                {errors.vehicleId}
              </Typography>
            )}
          </SectionCard>

          <SectionCard title="What do you need?">
            <Stack spacing={1}>
              {services.data?.services.map((s) => {
                const incompatible = !!vehicle && s.vehicleClasses.length > 0 && !s.vehicleClasses.includes(vehicle.vehicleClass);
                return (
                  <ChoiceCard key={s.id} selected={draft.serviceKey === s.key} onClick={() => !locked && update({ serviceKey: s.key })} disabled={locked} dim={incompatible}>
                    <Box sx={{ width: 40, height: 40, flexShrink: 0, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: s.kind === 'TOWING' ? 'secondary.main' : 'primary.main', color: s.kind === 'TOWING' ? 'secondary.contrastText' : 'primary.contrastText' }} aria-hidden>
                      <ServiceIcon icon={s.icon} />
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{ fontWeight: 700 }}>{s.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {s.description}
                      </Typography>
                      {incompatible && (
                        <Typography variant="caption" color="warning.main">
                          Not available for {VEHICLE_CLASS_LABELS[vehicle!.vehicleClass]?.toLowerCase()} vehicles
                        </Typography>
                      )}
                    </Box>
                    {draft.serviceKey === s.key && <CheckCircleIcon color="primary" aria-label="Selected" />}
                  </ChoiceCard>
                );
              })}
            </Stack>
            {errors.serviceKey && (
              <Typography color="error" variant="body2" sx={{ mt: 1 }} role="alert">
                {errors.serviceKey}
              </Typography>
            )}
          </SectionCard>
        </Stack>
      )}

      {step === 'pickup' && (
        <Stack spacing={2.5}>
          <SectionCard title="Where is the vehicle?">
            <LocationPicker value={draft.pickup} onChange={(v) => update({ pickup: v })} variant="pickup" autoLocate={!draft.pickup && !locked} />
            {errors.pickup && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {errors.pickup}
              </Alert>
            )}
            {here.data?.outsideServiceArea && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                <AlertTitle>This point looks outside our service area</AlertTitle>
                Check the pin is in the right place.{supportPhone && <> If it is, call support on <a href={`tel:${supportPhone.replace(/\s/g, '')}`}>{supportPhone}</a> for alternatives.</>}
              </Alert>
            )}
            {here.data?.zone && serviceHere?.availableHere === false && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                {serviceHere.name} is not offered in {here.data.zone.name} right now. Go back and choose another service, or call support.
              </Alert>
            )}
            {here.data?.zone && serviceHere?.availableHere && (
              <Alert severity="success" sx={{ mt: 1.5 }}>
                {serviceHere.name} is available in {here.data.zone.name}.
              </Alert>
            )}
          </SectionCard>

          <SectionCard title="Is the vehicle in a safe place?">
            <ToggleButtonGroup exclusive fullWidth value={draft.isSafeLocation == null ? null : draft.isSafeLocation ? 'yes' : 'no'} onChange={(_, v) => v && update({ isSafeLocation: v === 'yes' })} aria-label="Is the vehicle in a safe place">
              <ToggleButton value="yes" sx={{ minHeight: 48 }}>
                Yes, it's safe
              </ToggleButton>
              <ToggleButton value="no" sx={{ minHeight: 48 }} color="error">
                No / not sure
              </ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              For example: on a busy road, highway shoulder, blind curve, or anywhere you feel unsafe.
            </Typography>
            {errors.isSafeLocation && (
              <Typography color="error" variant="body2" sx={{ mt: 1 }} role="alert">
                {errors.isSafeLocation}
              </Typography>
            )}
            {draft.isSafeLocation === false && (
              <Alert severity="error" icon={<WarningAmberIcon />} sx={{ mt: 2 }}>
                <AlertTitle>Keep everyone safe while you wait</AlertTitle>
                <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
                  <li>Get everyone out of the vehicle on the side away from traffic, and move behind a barrier or well off the road.</li>
                  <li>Switch on hazard lights. Place a warning triangle only if you can do it without stepping into traffic.</li>
                  <li>Do not stand between the vehicle and traffic, and do not try to push or repair it on the roadway.</li>
                  <li>If anyone is hurt or in immediate danger, call {cfg.data?.business.emergencyNumber ?? '112'} first.</li>
                </Box>
                We'll flag this to the crew and prioritise your request.
              </Alert>
            )}
          </SectionCard>
        </Stack>
      )}

      {step === 'destination' && (
        <Stack spacing={2.5}>
          {addresses.data && addresses.data.length > 0 && (
            <SectionCard title="Saved places">
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {addresses.data.map((a) => (
                  <Chip
                    key={a.id}
                    icon={<BookmarkBorderIcon />}
                    label={a.label}
                    clickable
                    color={draft.dropoff && draft.dropoff.lat === a.lat && draft.dropoff.lng === a.lng ? 'primary' : 'default'}
                    onClick={() =>
                      update({
                        dropoff: { lat: a.lat, lng: a.lng, address: a.address, landmark: a.landmark ?? undefined, placeName: a.label, source: 'SAVED', accuracyM: null, capturedAt: new Date().toISOString() },
                        destinationType: /home/i.test(a.label) ? 'HOME' : draft.destinationType,
                      })
                    }
                    sx={{ minHeight: 36 }}
                  />
                ))}
              </Stack>
            </SectionCard>
          )}
          <SectionCard title="Where should we take it?">
            <TextField select label="Destination type" value={draft.destinationType} onChange={(e) => update({ destinationType: e.target.value as DestinationType })} sx={{ mb: 2 }}>
              {Object.entries(DESTINATION_LABELS).map(([k, l]) => (
                <MenuItem key={k} value={k}>
                  {l}
                </MenuItem>
              ))}
            </TextField>
            <LocationPicker value={draft.dropoff} onChange={(v) => update({ dropoff: v })} variant="dropoff" />
            {errors.dropoff && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {errors.dropoff}
              </Alert>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Towing distance is estimated from the pickup and destination points. The final price uses the actual distance, and you approve any extra chargeable work first.
            </Typography>
          </SectionCard>
        </Stack>
      )}

      {step === 'condition' && (
        <SectionCard>
          <ConditionStep
            value={draft.assessment}
            onChange={(p) => update({ assessment: { ...draft.assessment, ...p } })}
            errors={errors}
            towing={towing}
            crewRequested={draft.crewRequested}
            onCrewChange={(n) => update({ crewRequested: n })}
            files={files}
            onAddFiles={addFiles}
            onRemoveFile={removeFile}
            fileError={fileError}
          />
        </SectionCard>
      )}

      {step === 'contact' && (
        <Stack spacing={2.5}>
          <SectionCard title="Who should the driver contact?">
            <Stack spacing={2}>
              <TextField label="Contact name" value={draft.contactName} onChange={(e) => update({ contactName: e.target.value })} error={!!errors.contactName} helperText={errors.contactName} autoComplete="name" required />
              <TextField
                label="Mobile number"
                value={draft.contactPhone}
                onChange={(e) => update({ contactPhone: e.target.value })}
                error={!!errors.contactPhone}
                helperText={errors.contactPhone ?? 'The person who will be at the vehicle.'}
                type="tel"
                autoComplete="tel"
                required
              />
              <TextField
                label="Instructions for the driver (optional)"
                value={draft.instructions}
                onChange={(e) => update({ instructions: e.target.value })}
                multiline
                minRows={2}
                error={!!errors.instructions}
                helperText={errors.instructions ?? 'E.g. “Waiting at the petrol pump”, “Keys with security”.'}
                slotProps={{ htmlInput: { maxLength: 1000 } }}
              />
            </Stack>
          </SectionCard>
          <SectionCard title="Savings">
            <Stack spacing={1.5}>
              <TextField label="Promo code (optional)" value={draft.promoCode} onChange={(e) => update({ promoCode: e.target.value.toUpperCase() })} error={!!errors.promoCode} helperText={errors.promoCode} slotProps={{ htmlInput: { maxLength: 30, autoCapitalize: 'characters' } }} />
              <FormControlLabel control={<Switch checked={draft.useMembership} onChange={(e) => update({ useMembership: e.target.checked })} />} label="Use my membership benefits if this service is covered" />
              <Typography variant="caption" color="text.secondary">
                Discounts and membership benefits are applied in your quote, so you can see exactly what changes.
              </Typography>
            </Stack>
          </SectionCard>
        </Stack>
      )}

      {step === 'review' && (
        <Stack spacing={2.5}>
          <ReviewSummary draft={draft} service={service} vehicle={vehicle} towing={towing} files={files} onEdit={editStep} locked={locked} />

          {!locked && (
            <>
              {problem?.kind === 'outside' && (
                <Alert severity="warning" action={<Button color="inherit" onClick={() => goTo('pickup')}>Change</Button>}>
                  <AlertTitle>Outside our service area</AlertTitle>
                  We can't dispatch to this pickup point yet.{supportPhone && <> Call support on <a href={`tel:${supportPhone.replace(/\s/g, '')}`}>{supportPhone}</a> and we'll help you find alternatives.</>}
                </Alert>
              )}
              {problem?.kind === 'duplicate' && (
                <Alert
                  severity="warning"
                  action={
                    <Button color="inherit" component={RouterLink} to={`/app/bookings/${problem.bookingId}`}>
                      View
                    </Button>
                  }
                >
                  <AlertTitle>This vehicle already has an open booking</AlertTitle>
                  {problem.message} Open it to track, confirm or cancel it before requesting again.
                </Alert>
              )}
              {problem?.kind === 'error' && (
                <Alert severity="error">
                  {problem.message}
                  {problem.fields && (
                    <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.25 }}>
                      {Object.entries(problem.fields).map(([k, m]) => (
                        <li key={k}>
                          {k}: {m}
                        </li>
                      ))}
                    </Box>
                  )}
                </Alert>
              )}
              {!online && <Alert severity="warning">You're offline, so we can't get a quote yet. Your request has NOT been sent. Reconnect and tap “Get my quote”.</Alert>}
              <Button size="large" variant="contained" onClick={submit} disabled={submitting || !online} startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : undefined} sx={{ minHeight: 56 }}>
                {submitting ? 'Getting your quote…' : 'Get my quote'}
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
                Getting a quote is free. Nothing is dispatched until you confirm.
              </Typography>
            </>
          )}

          {locked && (
            <>
              {upload.state === 'uploading' && (
                <Alert severity="info" icon={<CircularProgress size={18} />}>
                  Uploading your photos/videos…
                </Alert>
              )}
              {upload.state === 'done' && <Alert severity="success">Photos and videos uploaded.</Alert>}
              {upload.state === 'failed' && <Alert severity="warning">{upload.message}</Alert>}
              {booking.isLoading ? (
                <LoadingBlock rows={4} />
              ) : booking.error ? (
                <ErrorState error={booking.error} onRetry={() => booking.refetch()} title="Could not load your quote" />
              ) : booking.data && booking.data.status === 'QUOTED' ? (
                <>
                  <Typography variant="body2" color="text.secondary">
                    Request {booking.data.code} · created {dateTime(booking.data.createdAt)}
                  </Typography>
                  <QuoteConfirmPanel booking={booking.data} onUpdated={(b) => qc.setQueryData(['booking', b.id], b)} onConfirmed={onConfirmed} />
                </>
              ) : null}
            </>
          )}
        </Stack>
      )}

      {/* Navigation */}
      {step !== 'review' && (
        <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
          <Button size="large" variant="outlined" onClick={back} startIcon={<ArrowBackIcon />} sx={{ flex: { xs: 1, sm: 'unset' } }}>
            Back
          </Button>
          <Button size="large" variant="contained" onClick={next} endIcon={<ArrowForwardIcon />} sx={{ flex: 2 }}>
            {steps[stepIndex + 1] === 'review' ? 'Review' : 'Continue'}
          </Button>
        </Stack>
      )}
      {step === 'review' && !locked && (
        <Button onClick={back} startIcon={<ArrowBackIcon />} sx={{ mt: 2 }}>
          Back
        </Button>
      )}
      {Object.keys(errors).length > 0 && step !== 'review' && (
        <Typography color="error" variant="body2" sx={{ mt: 1 }} role="alert">
          Please fix the highlighted details to continue.
        </Typography>
      )}

      <VehicleFormDialog
        open={vehicleDialog}
        onClose={() => setVehicleDialog(false)}
        vehicle={null}
        onSaved={(v) => {
          setVehicleDialog(false);
          chooseVehicle(v);
        }}
      />
      <ConfirmDialog
        open={!!resetConfirm}
        title={resetConfirm?.to === 'restart' ? 'Start a new request?' : 'Edit your request?'}
        body={
          locked
            ? "Your current quote hasn't been confirmed. Changing details discards it (free of charge) and you'll get a new quote. Nothing has been dispatched."
            : 'This clears the details you have entered on this device.'
        }
        confirmLabel={resetConfirm?.to === 'restart' ? 'Start over' : 'Discard quote and edit'}
        loading={resetting}
        onClose={() => setResetConfirm(null)}
        onConfirm={() => resetConfirm && discardQuote(resetConfirm.to)}
      />
    </Box>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────

function ChoiceCard({ selected, onClick, children, disabled, dim }: { selected: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; dim?: boolean }) {
  return (
    <Card sx={{ borderColor: selected ? 'primary.main' : 'divider', borderWidth: selected ? 2 : 1, opacity: dim ? 0.6 : 1 }}>
      <CardActionArea onClick={onClick} disabled={disabled} aria-pressed={selected}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1.25, px: 1.5, '&:last-child': { pb: 1.25 } }}>{children}</CardContent>
      </CardActionArea>
    </Card>
  );
}

function SummaryRow({ label, children, onEdit }: { label: string; children: ReactNode; onEdit?: () => void }) {
  return (
    <Box sx={{ py: 1.25 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="overline" color="text.secondary">
          {label}
        </Typography>
        {onEdit && (
          <Button size="small" onClick={onEdit} aria-label={`Edit ${label}`}>
            Edit
          </Button>
        )}
      </Stack>
      <Box sx={{ wordBreak: 'break-word' }}>{children}</Box>
    </Box>
  );
}

function ReviewSummary({ draft, service, vehicle, towing, files, onEdit, locked }: { draft: Draft; service?: ServiceCategory; vehicle?: Vehicle; towing: boolean; files: PendingFile[]; onEdit: (s: StepKey) => void; locked: boolean }) {
  const a = draft.assessment;
  const yesAnswers = TRI_QUESTIONS.filter((q) => a[q.key] !== 'NOT_SURE').map((q) => `${q.label.replace(/\?$/, '')}: ${TRI_LABELS[a[q.key]]}`);
  const people = [a.hasChildren && 'children', a.hasElderly && 'elderly person', a.needsAccessibility && 'accessibility needs'].filter(Boolean).join(', ');
  return (
    <SectionCard title={locked ? 'Your request' : 'Check your request'}>
      <SummaryRow label="Service" onEdit={() => onEdit('service')}>
        <Typography sx={{ fontWeight: 700 }}>{service?.name ?? '—'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {vehicle ? `${vehicle.registrationNumber} · ${vehicle.make} ${vehicle.model}` : '—'} · {draft.type === 'SCHEDULED' ? `Scheduled for ${dateTime(new Date(draft.scheduledFor))}` : 'As soon as possible'}
        </Typography>
      </SummaryRow>
      <Divider />
      <SummaryRow label="Pickup" onEdit={() => onEdit('pickup')}>
        <Typography variant="body2">{placeLabel(draft.pickup)}</Typography>
        {draft.pickup?.landmark && (
          <Typography variant="body2" color="text.secondary">
            Near {draft.pickup.landmark}
          </Typography>
        )}
        <Typography variant="body2" color={draft.isSafeLocation === false ? 'error.main' : 'text.secondary'} sx={{ fontWeight: draft.isSafeLocation === false ? 700 : 400 }}>
          {draft.isSafeLocation === false ? 'Not in a safe place — flagged to the crew' : 'In a safe place'}
        </Typography>
      </SummaryRow>
      {towing && (
        <>
          <Divider />
          <SummaryRow label="Destination" onEdit={() => onEdit('destination')}>
            <Typography variant="body2">{placeLabel(draft.dropoff)}</Typography>
            <Typography variant="body2" color="text.secondary">
              {DESTINATION_LABELS[draft.destinationType]}
            </Typography>
          </SummaryRow>
        </>
      )}
      <Divider />
      <SummaryRow label="Condition" onEdit={() => onEdit('condition')}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {BREAKDOWN_LABELS[a.breakdownType] ?? '—'}
          {a.isEvOrHybrid && ' · EV / hybrid'}
          {a.accessRestriction !== 'NONE' && ` · ${ACCESS_LABELS[a.accessRestriction]}`}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {yesAnswers.length ? yesAnswers.join(' · ') : 'All condition questions answered “Not sure”.'}
        </Typography>
        {(people || a.passengersNeedingTransport > 0) && (
          <Typography variant="body2" color="text.secondary">
            {people && `With: ${people}. `}
            {a.passengersNeedingTransport > 0 && `${a.passengersNeedingTransport} passenger(s) need a ride.`}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          Crew requested: {draft.crewRequested}
          {files.length > 0 && ` · ${files.length} photo/video file(s)`}
        </Typography>
      </SummaryRow>
      <Divider />
      <SummaryRow label="Contact" onEdit={() => onEdit('contact')}>
        <Typography variant="body2">
          {draft.contactName} · {draft.contactPhone}
        </Typography>
        {draft.instructions && (
          <Typography variant="body2" color="text.secondary">
            “{draft.instructions}”
          </Typography>
        )}
        {(draft.promoCode || !draft.useMembership) && (
          <Typography variant="body2" color="text.secondary">
            {draft.promoCode && `Promo ${draft.promoCode}. `}
            {!draft.useMembership && 'Membership benefits not used.'}
          </Typography>
        )}
      </SummaryRow>
    </SectionCard>
  );
}
