import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertTitle,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Rating,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import PhoneIcon from '@mui/icons-material/Phone';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareIcon from '@mui/icons-material/Share';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import AddAPhotoOutlinedIcon from '@mui/icons-material/AddAPhotoOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import PhoneDisabledIcon from '@mui/icons-material/PhoneDisabled';
import { api } from '@/api/client';
import type { Attachment, BookingDetail, Quote } from '@/api/types';
import { QuoteBreakdown } from '@/components/QuoteBreakdown';
import { ConfirmDialog, errorMessage, SectionCard } from '@/components/common';
import { useConfig } from '@/hooks/useConfig';
import { useIsOnline } from '@/hooks/useOnline';
import { dateTime, humanize, inr, relative, time } from '@/lib/format';
import { FilePickButton, IMAGE_ACCEPT, MAX_UPLOAD_BYTES, VIDEO_ACCEPT } from './shared';

type Toast = (text: string, severity?: 'success' | 'error' | 'info' | 'warning') => void;

const invalidateBooking = (qc: ReturnType<typeof useQueryClient>, id: string) => {
  qc.invalidateQueries({ queryKey: ['booking', id] });
  qc.invalidateQueries({ queryKey: ['bookings'] });
};

// ─── Driver ──────────────────────────────────────────────────────────

export function DriverCard({ booking, toast }: { booking: BookingDetail; toast: Toast }) {
  const d = booking.driver!;
  const online = useIsOnline();
  const [contact, setContact] = useState<{ name: string; phone: string | null; note: string } | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const callM = useMutation({
    mutationFn: () => api.post<{ name: string; phone: string | null; masked: boolean; note: string }>(`/bookings/${booking.id}/contact`),
    onSuccess: (r) => setContact(r),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const reportM = useMutation({
    mutationFn: (note: string) => api.post<{ escalated: boolean; message: string }>(`/bookings/${booking.id}/report-unreachable`, note ? { note } : {}),
    onSuccess: (r) => {
      setUnreachable(false);
      toast(r.message, 'success');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const others = (booking.team ?? []).filter((t) => t.userId !== d.id);

  return (
    <SectionCard title="Your driver">
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Avatar src={d.photoUrl ?? undefined} alt={d.name} sx={{ width: 56, height: 56, bgcolor: 'secondary.main' }}>
          {d.name.charAt(0)}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h5" component="p">
              {d.name}
            </Typography>
            {d.verified ? <Chip size="small" color="success" icon={<VerifiedIcon />} label="Verified" /> : <Chip size="small" variant="outlined" label="Verification pending" />}
          </Stack>
          {d.truck && (
            <Typography variant="body2" color="text.secondary">
              <Box component="span" sx={{ fontWeight: 700, color: 'text.primary', letterSpacing: '0.04em' }}>
                {d.truck.registrationNumber}
              </Box>{' '}
              · {humanize(d.truck.truckType)} · {d.truck.make} {d.truck.model}
            </Typography>
          )}
          {booking.etaAt && ['ACCEPTED', 'EN_ROUTE'].includes(booking.status) && (
            <Typography variant="body2" sx={{ fontWeight: 700, mt: 0.25 }} color="primary">
              Estimated arrival {time(booking.etaAt)} ({relative(booking.etaAt)})
            </Typography>
          )}
        </Box>
      </Stack>
      {others.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="overline" color="text.secondary">
            Crew
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {others.map((t) => (
              <Chip key={t.userId} avatar={<Avatar src={t.photoUrl ?? undefined}>{t.name.charAt(0)}</Avatar>} label={`${t.name} · ${humanize(t.role)}`} variant="outlined" />
            ))}
          </Stack>
        </Box>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
        <Button variant="contained" size="large" startIcon={callM.isPending ? <CircularProgress size={18} color="inherit" /> : <PhoneIcon />} onClick={() => callM.mutate()} disabled={callM.isPending || !online}>
          Call driver
        </Button>
        <Button variant="outlined" size="large" startIcon={<PhoneDisabledIcon />} onClick={() => setUnreachable(true)} disabled={!online}>
          Can't reach driver
        </Button>
      </Stack>

      <Dialog open={!!contact} onClose={() => setContact(null)} fullWidth maxWidth="xs">
        <DialogTitle>Call {contact?.name}</DialogTitle>
        <DialogContent>
          {contact?.phone ? (
            <Typography variant="h4" component="p" sx={{ my: 1 }}>
              {contact.phone}
            </Typography>
          ) : (
            <Alert severity="warning">No phone number is available for this driver. Use “Can't reach driver” and dispatch will help.</Alert>
          )}
          <DialogContentText variant="body2">{contact?.note}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setContact(null)}>Close</Button>
          {contact?.phone && (
            <Button variant="contained" startIcon={<PhoneIcon />} href={`tel:${contact.phone}`}>
              Call now
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <ReasonDialog
        open={unreachable}
        title="Can't reach your driver?"
        body="We'll alert our dispatch team right away and they will contact you and the driver."
        label="What happened? (optional)"
        optional
        confirmLabel="Alert dispatch"
        loading={reportM.isPending}
        onClose={() => setUnreachable(false)}
        onConfirm={(n) => reportM.mutate(n)}
      />
    </SectionCard>
  );
}

/** Dialog with a free-text field; `optional` allows an empty value, otherwise `minLength` applies. */
export function ReasonDialog({ open, title, body, label, optional, minLength = 3, confirmLabel, loading, danger, onClose, onConfirm, children }: { open: boolean; title: string; body?: React.ReactNode; label: string; optional?: boolean; minLength?: number; confirmLabel: string; loading?: boolean; danger?: boolean; onClose: () => void; onConfirm: (text: string) => void; children?: React.ReactNode }) {
  const [text, setText] = useState('');
  const valid = optional || text.trim().length >= minLength;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" slotProps={{ transition: { onExited: () => setText('') } }}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {body && <DialogContentText component="div" sx={{ mb: 2 }}>{body}</DialogContentText>}
        {children}
        <TextField
          autoFocus
          label={label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          multiline
          minRows={3}
          required={!optional}
          helperText={!optional ? `At least ${minLength} characters (${text.trim().length})` : undefined}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Back</Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} disabled={!valid || loading} onClick={() => onConfirm(text.trim())} startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Codes ───────────────────────────────────────────────────────────

export function CodesCard({ booking }: { booking: BookingDetail }) {
  const towing = booking.serviceCategory.kind === 'TOWING';
  const code = (value: string) => (
    <Box component="span" sx={{ fontSize: 30, fontWeight: 800, letterSpacing: '0.3em', fontVariantNumeric: 'tabular-nums', fontFamily: 'ui-monospace, Menlo, monospace' }} aria-label={value.split('').join(' ')}>
      {value}
    </Box>
  );
  return (
    <SectionCard title="Your security codes">
      <Stack spacing={1.5} divider={<Divider flexItem />}>
        {booking.pickupOtp && (
          <Box>
            <Typography variant="overline" color="text.secondary">
              Pickup code
            </Typography>
            <Box>{code(booking.pickupOtp)}</Box>
            {booking.pickupVerifiedAt ? (
              <Typography variant="body2" color="success.main" sx={{ fontWeight: 600 }}>
                Verified with your driver at {time(booking.pickupVerifiedAt)}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Share only with your driver when they arrive, after you've checked their name and truck number above. Never share it on a call.
              </Typography>
            )}
          </Box>
        )}
        {booking.handoverOtp && towing && (
          <Box>
            <Typography variant="overline" color="text.secondary">
              Handover code
            </Typography>
            <Box>{code(booking.handoverOtp)}</Box>
            <Typography variant="body2" color="text.secondary">
              Share with the person receiving the vehicle at the destination. The driver needs it to hand over your vehicle.
            </Typography>
          </Box>
        )}
      </Stack>
    </SectionCard>
  );
}

// ─── Revised quote ───────────────────────────────────────────────────

export function RevisionCard({ booking, quote, toast }: { booking: BookingDetail; quote: Quote; toast: Toast }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const [note, setNote] = useState('');
  const approved = booking.quotes?.find((q) => q.id === booking.approvedQuoteId) ?? null;
  const m = useMutation({
    mutationFn: (approve: boolean) => api.post<{ approved: boolean }>(`/bookings/${booking.id}/quotes/${quote.id}/decision`, { approve, note: note.trim() || undefined }),
    onSuccess: (r) => {
      toast(r.approved ? 'Revised quote approved. The crew can continue.' : 'Revised quote declined. The crew will continue only with the originally approved work.', 'success');
      setNote('');
      invalidateBooking(qc, booking.id);
    },
    onError: (e) => {
      toast(errorMessage(e), 'error');
      invalidateBooking(qc, booking.id);
    },
  });

  if (quote.status === 'PENDING_INTERNAL_APPROVAL')
    return (
      <Alert severity="info">
        <AlertTitle>A revised quote is being checked</AlertTitle>
        The crew proposed a change ({quote.reason ?? 'scope change'}). Our team reviews it first; you'll be asked to approve any price increase before extra work is done.
      </Alert>
    );

  return (
    <SectionCard sx={{ borderColor: 'warning.main', borderWidth: 2 }} title={<Typography variant="h5" color="warning.main">Your approval is needed</Typography>}>
      <Typography variant="body2" sx={{ mb: 1.5 }}>
        The crew has proposed a revised quote{quote.reason ? `: “${quote.reason}”` : ''}. No extra chargeable work is done unless you approve.
      </Typography>
      <QuoteBreakdown quote={quote} compareTo={approved} />
      <TextField label="Note to the crew (optional)" value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} sx={{ mt: 2 }} slotProps={{ htmlInput: { maxLength: 500 } }} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
        <Button size="large" variant="contained" onClick={() => m.mutate(true)} disabled={m.isPending || !online} startIcon={m.isPending && m.variables === true ? <CircularProgress size={16} color="inherit" /> : undefined}>
          Approve {inr(quote.total)}
        </Button>
        <Button size="large" variant="outlined" color="error" onClick={() => m.mutate(false)} disabled={m.isPending || !online} startIcon={m.isPending && m.variables === false ? <CircularProgress size={16} color="inherit" /> : undefined}>
          Decline
        </Button>
      </Stack>
      {!online && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
          You're offline. Reconnect to approve or decline.
        </Typography>
      )}
    </SectionCard>
  );
}

// ─── Share links ─────────────────────────────────────────────────────

export function ShareCard({ booking, toast }: { booking: BookingDetail; toast: Toast }) {
  const qc = useQueryClient();
  const cfg = useConfig();
  const online = useIsOnline();
  const maxHours = cfg.data?.shareLinks.maxHours ?? 12;
  const [hours, setHours] = useState<number>(cfg.data?.shareLinks.defaultHours ?? 4);
  const [created, setCreated] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [revoke, setRevoke] = useState<string | null>(null);
  const options = [0.5, 1, 2, 4, 8, 12, 24].filter((h) => h <= maxHours);

  const createM = useMutation({
    mutationFn: () => api.post<{ id: string; url: string; expiresAt: string }>(`/bookings/${booking.id}/share-links`, { hours }),
    onSuccess: (r) => {
      setCreated(r);
      invalidateBooking(qc, booking.id);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const revokeM = useMutation({
    mutationFn: (linkId: string) => api.del(`/bookings/${booking.id}/share-links/${linkId}`),
    onSuccess: (_, linkId) => {
      if (created?.id === linkId) setCreated(null);
      setRevoke(null);
      toast('Link revoked. It no longer works.');
      invalidateBooking(qc, booking.id);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      toast('Could not copy automatically — select the link and copy it.', 'warning');
    }
  }
  async function share(url: string) {
    try {
      await navigator.share({ title: `Track my ${booking.serviceCategory.name.toLowerCase()}`, text: `Follow my TowPilot booking ${booking.code} live:`, url });
    } catch {
      /* user cancelled */
    }
  }
  const links = booking.shareLinks ?? [];

  return (
    <SectionCard title="Share live tracking">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Let family or your garage follow the driver's progress. The link shows the status, ETA, the driver's first name, truck number and live position, and your approximate pickup area — never phone numbers, codes or payment details.
      </Typography>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField select label="Link valid for" value={hours} onChange={(e) => setHours(Number(e.target.value))} sx={{ maxWidth: 180 }}>
          {options.map((h) => (
            <MenuItem key={h} value={h}>
              {h < 1 ? '30 minutes' : `${h} hour${h === 1 ? '' : 's'}`}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="outlined" onClick={() => createM.mutate()} disabled={createM.isPending || !online} sx={{ minHeight: 56, flexShrink: 0 }} startIcon={createM.isPending ? <CircularProgress size={16} /> : <ShareIcon />}>
          Create link
        </Button>
      </Stack>
      {created && (
        <Box sx={{ mt: 2 }}>
          <TextField
            label="Your tracking link"
            value={created.url}
            slotProps={{
              htmlInput: { readOnly: true, onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.target.select() },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title="Copy link">
                      <IconButton aria-label="Copy tracking link" onClick={() => copy(created.url)}>
                        <ContentCopyIcon />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              },
            }}
            helperText={`Expires ${dateTime(created.expiresAt)}. This link is shown only once — copy or share it now.`}
          />
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <Button sx={{ mt: 1 }} startIcon={<ShareIcon />} onClick={() => share(created.url)}>
              Share via…
            </Button>
          )}
        </Box>
      )}
      {links.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="overline" color="text.secondary">
            Active links
          </Typography>
          <Stack spacing={0.5}>
            {links.map((l) => (
              <Stack key={l.id} direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography variant="body2">
                  Created {time(l.createdAt)} · expires {dateTime(l.expiresAt)} · {l.viewCount} view{l.viewCount === 1 ? '' : 's'}
                </Typography>
                <Button size="small" color="error" startIcon={<LinkOffIcon />} onClick={() => setRevoke(l.id)}>
                  Revoke
                </Button>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
      <ConfirmDialog open={!!revoke} title="Revoke this link?" body="Anyone with the link will immediately lose access to your tracking." confirmLabel="Revoke" danger loading={revokeM.isPending} onClose={() => setRevoke(null)} onConfirm={() => revoke && revokeM.mutate(revoke)} />
    </SectionCard>
  );
}

// ─── Evidence ────────────────────────────────────────────────────────

const ATTACHMENT_LABELS: Record<string, string> = {
  DAMAGE_PHOTO: 'Your photo',
  DAMAGE_VIDEO: 'Your video',
  PICKUP_EVIDENCE: 'Pickup evidence',
  DELIVERY_EVIDENCE: 'Delivery evidence',
  TOLL_RECEIPT: 'Toll / parking receipt',
  INCIDENT: 'Incident',
  OTHER: 'Other',
};

export function EvidenceCard({ booking, closed, toast }: { booking: BookingDetail; closed: boolean; toast: Toast }) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const [uploading, setUploading] = useState(false);
  const atts = booking.attachments ?? [];

  async function upload(files: File[], kind: 'DAMAGE_PHOTO' | 'DAMAGE_VIDEO') {
    const tooBig = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
    const ok = files.filter((f) => f.size <= MAX_UPLOAD_BYTES).slice(0, 6);
    if (tooBig.length) toast(`${tooBig.length} file(s) are larger than 15 MB and were skipped.`, 'warning');
    if (!ok.length) return;
    const fd = new FormData();
    fd.append('kind', kind);
    ok.forEach((f) => fd.append('files', f, f.name));
    setUploading(true);
    try {
      await api.upload<Attachment[]>(`/bookings/${booking.id}/attachments`, fd);
      toast(`${ok.length} file${ok.length === 1 ? '' : 's'} uploaded`);
      invalidateBooking(qc, booking.id);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <SectionCard title="Photos & evidence">
      {atts.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No photos yet. {closed ? '' : 'You can add photos or a short video of the vehicle if it is safe to take them.'}
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 1 }}>
          {atts.map((a) => (
            <Box key={a.id} sx={{ minWidth: 0 }}>
              <Box
                component="a"
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${ATTACHMENT_LABELS[a.kind] ?? a.kind} from ${dateTime(a.createdAt)}`}
                sx={{ display: 'block', aspectRatio: '1', borderRadius: 2, overflow: 'hidden', border: 1, borderColor: 'divider', bgcolor: 'action.hover', color: 'text.secondary' }}
              >
                {a.mimeType.startsWith('image/') ? (
                  <Box component="img" src={a.url} alt={a.caption ?? ATTACHMENT_LABELS[a.kind] ?? 'Attachment'} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
                    {a.mimeType.startsWith('video/') ? <VideocamOutlinedIcon /> : <InsertDriveFileOutlinedIcon />}
                  </Stack>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3, mt: 0.25 }} noWrap>
                {ATTACHMENT_LABELS[a.kind] ?? humanize(a.kind)}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', lineHeight: 1.2 }}>
                {time(a.createdAt)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
      {!closed && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }} alignItems="center">
          <FilePickButton accept={IMAGE_ACCEPT} multiple onFiles={(f) => upload(f, 'DAMAGE_PHOTO')} variant="outlined" startIcon={<AddAPhotoOutlinedIcon />} disabled={uploading || !online}>
            Add photos
          </FilePickButton>
          <FilePickButton accept={VIDEO_ACCEPT} onFiles={(f) => upload(f, 'DAMAGE_VIDEO')} variant="outlined" startIcon={<VideocamOutlinedIcon />} disabled={uploading || !online}>
            Add video
          </FilePickButton>
          {uploading && <CircularProgress size={20} aria-label="Uploading" />}
        </Stack>
      )}
      {(booking.conditionReports?.length ?? 0) > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="overline" color="text.secondary">
            Condition reports by the crew
          </Typography>
          {booking.conditionReports!.map((r) => (
            <Box key={r.id} sx={{ py: 0.75 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {humanize(r.stage)} · {time(r.createdAt)}
                {r.odometerKm != null && ` · ${r.odometerKm} km`}
                {r.fuelLevel && ` · fuel ${humanize(r.fuelLevel)}`}
              </Typography>
              {r.damageMarks.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {r.damageMarks.map((d) => `${d.area}: ${d.description}`).join('; ')}
                </Typography>
              )}
              {r.notes && (
                <Typography variant="body2" color="text.secondary">
                  {r.notes}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
      {(booking.custody?.length ?? 0) > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="overline" color="text.secondary">
            Chain of custody
          </Typography>
          {booking.custody!.map((c, i) => (
            <Typography key={i} variant="body2" sx={{ py: 0.25 }}>
              {humanize(c.stage)} · {c.method === 'OTP' ? 'Verified with code' : 'Authorised override'}
              {c.recipientName && ` · ${c.recipientName}${c.recipientRelation ? ` (${c.recipientRelation})` : ''}`} · {dateTime(c.createdAt)}
              {c.overrideReason && (
                <Typography component="span" variant="body2" color="warning.main">
                  {' '}
                  — override: {c.overrideReason}
                </Typography>
              )}
            </Typography>
          ))}
        </Box>
      )}
    </SectionCard>
  );
}

// ─── Rating ──────────────────────────────────────────────────────────

const RATING_TAGS = ['On time', 'Professional', 'Careful with vehicle', 'Clear communication', 'Felt safe', 'Fair price'];

export function RatingCard({ booking, toast }: { booking: BookingDetail; toast: Toast }) {
  const qc = useQueryClient();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const existing = booking.ratings?.[0];
  const m = useMutation({
    mutationFn: () => api.post(`/bookings/${booking.id}/rating`, { score, comment: comment.trim() || undefined, tags }),
    onSuccess: () => {
      toast('Thanks for your feedback!');
      invalidateBooking(qc, booking.id);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (existing)
    return (
      <SectionCard title="Your rating">
        <Rating value={existing.score} readOnly aria-label={`${existing.score} out of 5 stars`} />
        <Typography variant="body2" color="text.secondary">
          {existing.score} out of 5{existing.comment ? ` — “${existing.comment}”` : ''}
        </Typography>
      </SectionCard>
    );

  return (
    <SectionCard title="How was your service?">
      <Rating value={score} onChange={(_, v) => setScore(v)} size="large" aria-label="Rate your service from 1 to 5 stars" />
      {score != null && (
        <>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            {RATING_TAGS.map((t) => {
              const on = tags.includes(t);
              return <Chip key={t} label={t} clickable color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'} onClick={() => setTags((cur) => (on ? cur.filter((x) => x !== t) : [...cur, t]))} aria-pressed={on} />;
            })}
          </Stack>
          <TextField label="Comments (optional)" value={comment} onChange={(e) => setComment(e.target.value)} multiline minRows={2} sx={{ mt: 1.5 }} slotProps={{ htmlInput: { maxLength: 1000 } }} />
          <Button variant="contained" sx={{ mt: 1.5 }} onClick={() => m.mutate()} disabled={m.isPending}>
            Submit rating
          </Button>
        </>
      )}
    </SectionCard>
  );
}

export function SupportLine() {
  const cfg = useConfig();
  const phone = cfg.data?.business.supportPhone;
  if (!phone) return null;
  return (
    <>
      Call support on{' '}
      <Box component="a" href={`tel:${phone.replace(/\s/g, '')}`} sx={{ fontWeight: 700, color: 'inherit' }}>
        {phone}
      </Box>
    </>
  );
}

export function SupportLink({ bookingId }: { bookingId: string }) {
  return (
    <Button component={RouterLink} to={`/app/support?bookingId=${bookingId}`} size="small">
      Get help with this booking
    </Button>
  );
}
