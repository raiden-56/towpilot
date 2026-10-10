import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, ButtonBase, Card, CardActions, CardContent, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, Grid, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddAPhotoOutlinedIcon from '@mui/icons-material/AddAPhotoOutlined';
import DirectionsCarFilledOutlinedIcon from '@mui/icons-material/DirectionsCarFilledOutlined';
import ElectricBoltIcon from '@mui/icons-material/ElectricBolt';
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Vehicle } from '@/api/types';
import { ConfirmDialog, EmptyState, ErrorState, errorMessage, PageHeader } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { VEHICLE_CLASS_LABELS } from '@/lib/format';
import { FilePickButton, FUEL_LABELS, IMAGE_ACCEPT, MAX_UPLOAD_BYTES, useToast } from './components/shared';
import { VehicleFormDialog } from './components/VehicleForm';

const MAX_PHOTOS = 8;
const MAX_PER_UPLOAD = 4;
const IMAGE_TYPES = IMAGE_ACCEPT.split(',');

/** "KA01AB1234" → "KA 01 AB 1234"; "22BH1234AA" → "22 BH 1234 AA". */
function formatReg(reg: string) {
  const bh = /^(\d{2})(BH)(\d{4})([A-Z]{1,2})$/.exec(reg);
  if (bh) return bh.slice(1).join(' ');
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(reg);
  if (m) return m.slice(1).filter(Boolean).join(' ');
  return reg;
}

type OwnedVehicle = Vehicle & { ownerUserId?: string };

export default function Vehicles() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast, toastNode } = useToast();
  const q = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<OwnedVehicle[]>('/vehicles') });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [deleting, setDeleting] = useState<Vehicle | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ vehicle: Vehicle; index: number } | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/vehicles/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast('Vehicle removed');
      setDeleting(null);
    },
    onError: (e) => setDeleteError(errorMessage(e)),
  });

  const upload = useMutation({
    mutationFn: ({ id, files }: { id: string; files: File[] }) => {
      const fd = new FormData();
      files.forEach((f) => fd.append('photos', f));
      return api.upload<Vehicle>(`/vehicles/${id}/photos`, fd);
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast(vars.files.length === 1 ? 'Photo added' : `${vars.files.length} photos added`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const pickPhotos = (v: Vehicle, files: File[]) => {
    const bad = files.find((f) => !IMAGE_TYPES.includes(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (bad) return toast(`"${bad.name}" is not a supported image. Use JPEG, PNG, WebP or HEIC.`, 'error');
    const big = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (big) return toast(`"${big.name}" is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 'error');
    const room = Math.min(MAX_PER_UPLOAD, MAX_PHOTOS - v.photoUrls.length);
    if (room <= 0) return toast(`Up to ${MAX_PHOTOS} photos per vehicle.`, 'error');
    const chosen = files.slice(0, room);
    if (files.length > room) toast(`Only ${room} more photo${room === 1 ? '' : 's'} can be added now — uploading the first ${room}.`, 'warning');
    upload.mutate({ id: v.id, files: chosen });
  };

  const canManage = (v: OwnedVehicle) => (v.ownerUserId && user ? v.ownerUserId === user.id : !v.fleetAccount);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const vehicles = q.data ?? [];

  return (
    <Box>
      <PageHeader
        title="My vehicles"
        subtitle="Save your vehicles once so requesting help takes seconds."
        actions={
          vehicles.length > 0 && (
            <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={openAdd}>
              Add vehicle
            </Button>
          )
        }
      />

      {q.isPending && (
        <Grid container spacing={2} aria-busy="true" aria-label="Loading vehicles">
          {[0, 1, 2].map((i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Card aria-hidden>
                <Box sx={{ height: 150, bgcolor: 'action.hover' }} />
                <CardContent>
                  <Box sx={{ height: 24, width: '60%', bgcolor: 'action.hover', borderRadius: 1, mb: 1 }} />
                  <Box sx={{ height: 16, width: '40%', bgcolor: 'action.hover', borderRadius: 1 }} />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load your vehicles" />}

      {q.isSuccess && vehicles.length === 0 && (
        <Card>
          <EmptyState
            icon={<DirectionsCarFilledOutlinedIcon sx={{ fontSize: 52, color: 'primary.main' }} />}
            title="No vehicles yet"
            body="Add your car, bike or commercial vehicle so we can send the right truck and equipment when you need help."
            action={
              <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={openAdd}>
                Add your first vehicle
              </Button>
            }
          />
        </Card>
      )}

      {q.isSuccess && vehicles.length > 0 && (
        <Grid container spacing={2}>
          {vehicles.map((v) => {
            const manageable = canManage(v);
            const uploading = upload.isPending && upload.variables?.id === v.id;
            const green = v.fuelType === 'ELECTRIC' || v.fuelType === 'HYBRID';
            const details = [v.color, v.year].filter(Boolean).join(' · ');
            return (
              <Grid key={v.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <PhotoStrip vehicle={v} onOpen={(index) => setViewer({ vehicle: v, index })} uploading={uploading} />
                  <CardContent sx={{ flex: 1, pb: 1 }}>
                    <Box
                      component="p"
                      aria-label={`Registration ${v.registrationNumber}`}
                      sx={{
                        m: 0,
                        display: 'inline-block',
                        px: 1.25,
                        py: 0.5,
                        border: 2,
                        borderColor: 'text.primary',
                        borderRadius: 1.5,
                        fontFamily: '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                        fontWeight: 800,
                        fontSize: '1.15rem',
                        letterSpacing: '0.08em',
                        lineHeight: 1.3,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatReg(v.registrationNumber)}
                    </Box>
                    <Typography variant="h5" component="h2" sx={{ mt: 1.25, wordBreak: 'break-word' }}>
                      {v.make} {v.model}
                    </Typography>
                    {details && (
                      <Typography variant="body2" color="text.secondary">
                        {details}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                      <Chip size="small" label={VEHICLE_CLASS_LABELS[v.vehicleClass] ?? v.vehicleClass} variant="outlined" />
                      <Chip size="small" label={FUEL_LABELS[v.fuelType] ?? v.fuelType} color={green ? 'success' : 'default'} variant={green ? 'filled' : 'outlined'} icon={green ? <ElectricBoltIcon /> : undefined} />
                      {v.fleetAccount && <Chip size="small" color="secondary" variant="outlined" icon={<BusinessOutlinedIcon />} label={`Managed by ${v.fleetAccount.name}`} sx={{ maxWidth: '100%' }} />}
                    </Stack>
                    {!manageable && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        This fleet vehicle is managed by your organisation. Contact your fleet admin to change its details.
                      </Typography>
                    )}
                  </CardContent>
                  <CardActions sx={{ px: 2, pb: 2, pt: 0, flexDirection: 'column', alignItems: 'stretch', gap: 1 }}>
                    <Button component={RouterLink} to={`/app/request?vehicleId=${encodeURIComponent(v.id)}`} variant="contained" size="large" startIcon={<LocalShippingOutlinedIcon />} fullWidth>
                      Request help for this vehicle
                    </Button>
                    {manageable && (
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ ml: '0 !important' }}>
                        <Button
                          startIcon={<EditOutlinedIcon />}
                          onClick={() => {
                            setEditing(v);
                            setFormOpen(true);
                          }}
                          aria-label={`Edit ${v.registrationNumber}`}
                        >
                          Edit
                        </Button>
                        <FilePickButton
                          accept={IMAGE_ACCEPT}
                          multiple
                          onFiles={(files) => pickPhotos(v, files)}
                          disabled={uploading || v.photoUrls.length >= MAX_PHOTOS}
                          startIcon={uploading ? <CircularProgress size={16} /> : <AddAPhotoOutlinedIcon />}
                          aria-label={`Add photos of ${v.registrationNumber}`}
                        >
                          {uploading ? 'Uploading…' : v.photoUrls.length >= MAX_PHOTOS ? 'Photo limit' : 'Photos'}
                        </FilePickButton>
                        <Box sx={{ flex: 1 }} />
                        <Tooltip title="Remove vehicle">
                          <IconButton
                            aria-label={`Remove ${v.registrationNumber}`}
                            color="error"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleting(v);
                            }}
                          >
                            <DeleteOutlineIcon />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    )}
                  </CardActions>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {q.isSuccess && vehicles.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Photos help the crew match your vehicle and record its condition. Up to {MAX_PHOTOS} photos per vehicle (JPEG, PNG, WebP or HEIC, max {MAX_UPLOAD_BYTES / 1024 / 1024} MB each).
        </Typography>
      )}

      <VehicleFormDialog
        open={formOpen}
        vehicle={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(v) => {
          setFormOpen(false);
          toast(editing ? `${formatReg(v.registrationNumber)} updated` : `${formatReg(v.registrationNumber)} added`);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Remove this vehicle?"
        danger
        confirmLabel={remove.isPending ? 'Removing…' : 'Remove vehicle'}
        loading={remove.isPending}
        body={
          deleting && (
            <>
              <strong>{formatReg(deleting.registrationNumber)}</strong> ({deleting.make} {deleting.model}) will no longer appear in your vehicles or when requesting help. Past bookings and invoices keep their records of this vehicle.
            </>
          )
        }
        onClose={() => !remove.isPending && setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      >
        {deleteError && (
          <Alert severity="error" sx={{ mt: 2 }} role="alert">
            {deleteError}
          </Alert>
        )}
      </ConfirmDialog>

      <Dialog open={!!viewer} onClose={() => setViewer(null)} fullWidth maxWidth="md" aria-labelledby="photo-viewer-title">
        {viewer && (
          <>
            <DialogTitle id="photo-viewer-title" sx={{ pr: 7 }}>
              {formatReg(viewer.vehicle.registrationNumber)} · photo {viewer.index + 1} of {viewer.vehicle.photoUrls.length}
              <IconButton aria-label="Close photos" onClick={() => setViewer(null)} sx={{ position: 'absolute', right: 8, top: 8 }}>
                <CloseIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent>
              <Box component="img" src={viewer.vehicle.photoUrls[viewer.index]} alt={`${viewer.vehicle.make} ${viewer.vehicle.model}, photo ${viewer.index + 1}`} sx={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 2, bgcolor: 'action.hover' }} />
              {viewer.vehicle.photoUrls.length > 1 && (
                <Stack direction="row" spacing={1} sx={{ mt: 1.5, overflowX: 'auto', pb: 0.5 }}>
                  {viewer.vehicle.photoUrls.map((url, i) => (
                    <ButtonBase
                      key={url}
                      onClick={() => setViewer({ vehicle: viewer.vehicle, index: i })}
                      aria-label={`Show photo ${i + 1}`}
                      aria-current={i === viewer.index}
                      sx={{ flexShrink: 0, borderRadius: 1.5, outline: i === viewer.index ? 3 : 0, outlineColor: 'primary.main', overflow: 'hidden' }}
                    >
                      <Box component="img" src={url} alt="" sx={{ width: 72, height: 54, objectFit: 'cover', display: 'block' }} />
                    </ButtonBase>
                  ))}
                </Stack>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>

      {toastNode}
    </Box>
  );
}

function PhotoStrip({ vehicle, onOpen, uploading }: { vehicle: Vehicle; onOpen: (index: number) => void; uploading: boolean }) {
  const photos = vehicle.photoUrls;
  if (!photos.length) {
    return (
      <Box sx={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', color: 'text.disabled', position: 'relative' }}>
        <DirectionsCarFilledOutlinedIcon sx={{ fontSize: 56 }} aria-hidden />
        {uploading && <CircularProgress size={28} sx={{ position: 'absolute' }} aria-label="Uploading photos" />}
      </Box>
    );
  }
  const extra = photos.length - 3;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: photos.length === 1 ? '1fr' : '2fr 1fr', gridTemplateRows: photos.length > 2 ? '1fr 1fr' : '1fr', gap: '2px', height: 150, position: 'relative', bgcolor: 'divider' }}>
      {photos.slice(0, 3).map((url, i) => (
        <ButtonBase
          key={url}
          onClick={() => onOpen(i)}
          aria-label={`View photo ${i + 1} of ${photos.length} of ${vehicle.registrationNumber}`}
          sx={{ gridRow: i === 0 && photos.length > 2 ? 'span 2' : undefined, overflow: 'hidden', position: 'relative', minWidth: 0 }}
        >
          <Box component="img" src={url} alt="" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          {i === 2 && extra > 0 && (
            <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>+{extra}</Box>
          )}
        </ButtonBase>
      ))}
      {uploading && (
        <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={28} sx={{ color: '#fff' }} aria-label="Uploading photos" />
        </Box>
      )}
    </Box>
  );
}
