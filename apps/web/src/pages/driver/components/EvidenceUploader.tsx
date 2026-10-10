import { useRef } from 'react';
import { Alert, Box, Button, ButtonBase, CircularProgress, Stack, Typography } from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Attachment } from '@/api/types';
import { errorMessage } from '@/components/common';
import { useIsOnline } from '@/hooks/useOnline';
import { time } from '@/lib/format';

export type FieldAttachmentKind = 'PICKUP_EVIDENCE' | 'DELIVERY_EVIDENCE' | 'TOLL_RECEIPT' | 'INCIDENT' | 'DAMAGE_PHOTO' | 'OTHER';

/**
 * Camera-first evidence upload to POST /driver/jobs/:id/attachments (multipart `files` + `kind`).
 * Files are sent in batches of 6 (server limit); the booking is refetched afterwards so the
 * new photos appear with fresh signed URLs.
 */
export function EvidenceUploader({
  bookingId,
  kind,
  label,
  document,
  disabled,
  onUploaded,
}: {
  bookingId: string;
  kind: FieldAttachmentKind;
  label: string;
  /** Receipts: allow PDF and gallery picking instead of forcing the camera. */
  document?: boolean;
  disabled?: boolean;
  onUploaded?: (rows: Attachment[]) => void;
}) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const out: Attachment[] = [];
      for (let i = 0; i < files.length; i += 6) {
        const form = new FormData();
        form.append('kind', kind);
        files.slice(i, i + 6).forEach((f) => form.append('files', f));
        out.push(...(await api.upload<Attachment[]>(`/driver/jobs/${bookingId}/attachments`, form)));
      }
      return out;
    },
    onSuccess: async (rows) => {
      onUploaded?.(rows);
      await qc.invalidateQueries({ queryKey: ['booking', bookingId] });
    },
  });

  return (
    <Stack spacing={1}>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={document ? 'image/jpeg,image/png,application/pdf' : 'image/*'}
        {...(document ? {} : { capture: 'environment' as const })}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) upload.mutate(files);
        }}
      />
      <Button
        size="large"
        variant="outlined"
        fullWidth
        startIcon={upload.isPending ? <CircularProgress size={20} /> : document ? <UploadFileIcon /> : <PhotoCameraIcon />}
        disabled={disabled || !online || upload.isPending}
        onClick={() => input.current?.click()}
        sx={{ borderWidth: 2, '&:hover': { borderWidth: 2 } }}
      >
        {upload.isPending ? 'Uploading…' : label}
      </Button>
      {upload.isSuccess && !upload.isPending && (
        <Alert severity="success" onClose={() => upload.reset()}>
          {upload.data.length} file{upload.data.length === 1 ? '' : 's'} uploaded.
        </Alert>
      )}
      {upload.error && <Alert severity="error">{errorMessage(upload.error)}</Alert>}
    </Stack>
  );
}

/** Grid of uploaded files. When `selected`/`onToggle` are given, tiles act as large toggles. */
export function AttachmentGrid({ attachments, selected, onToggle, empty }: { attachments: Attachment[]; selected?: string[]; onToggle?: (id: string) => void; empty?: string }) {
  if (!attachments.length)
    return empty ? (
      <Typography variant="body2" color="text.secondary">
        {empty}
      </Typography>
    ) : null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 1 }}>
      {attachments.map((a) => {
        const on = selected?.includes(a.id);
        const isImage = a.mimeType.startsWith('image/');
        const content = (
          <Box sx={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 2, overflow: 'hidden', border: 3, borderColor: on ? 'success.main' : 'divider', bgcolor: 'action.hover' }}>
            {isImage ? (
              <Box component="img" src={a.url} alt={`${a.kind.replace(/_/g, ' ').toLowerCase()} ${time(a.createdAt)}`} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
                <PictureAsPdfIcon fontSize="large" color="error" />
                <Typography variant="caption">PDF</Typography>
              </Stack>
            )}
            {on && <CheckCircleIcon color="success" sx={{ position: 'absolute', top: 4, right: 4, bgcolor: '#fff', borderRadius: '50%' }} />}
            <Typography variant="caption" sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', px: 0.5, fontWeight: 600 }}>
              {time(a.createdAt)}
            </Typography>
          </Box>
        );
        return onToggle ? (
          <ButtonBase key={a.id} onClick={() => onToggle(a.id)} aria-pressed={on} aria-label={`${on ? 'Remove' : 'Use'} photo taken ${time(a.createdAt)}`} sx={{ borderRadius: 2, display: 'block' }}>
            {content}
          </ButtonBase>
        ) : (
          <Box key={a.id} component="a" href={a.url} target="_blank" rel="noopener noreferrer" sx={{ display: 'block' }}>
            {content}
          </Box>
        );
      })}
    </Box>
  );
}
