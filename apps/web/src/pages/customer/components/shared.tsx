import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Alert, Box, Button, Snackbar, type AlertColor, type ButtonProps } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

/**
 * Lightweight per-page toast. Usage:
 *   const { toast, toastNode } = useToast();
 *   toast('Saved'); toast('Failed', 'error');
 *   return <>{...}{toastNode}</>;
 */
export function useToast() {
  const [state, setState] = useState<{ text: string; severity: AlertColor; key: number } | null>(null);
  const toast = useCallback((text: string, severity: AlertColor = 'success') => setState({ text, severity, key: Date.now() }), []);
  const toastNode = (
    <Snackbar
      key={state?.key}
      open={!!state}
      autoHideDuration={state?.severity === 'error' ? 8000 : 4000}
      onClose={(_, reason) => reason !== 'clickaway' && setState(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ bottom: { xs: 84, sm: 24 } }}
    >
      <Alert severity={state?.severity ?? 'success'} variant="filled" onClose={() => setState(null)} sx={{ width: '100%' }} role={state?.severity === 'error' ? 'alert' : 'status'}>
        {state?.text}
      </Alert>
    </Snackbar>
  );
  return { toast, toastNode };
}

/** "← Back" link shown above page titles. */
export function BackLink({ to, label = 'Back' }: { to: string; label?: string }) {
  return (
    <Button component={RouterLink} to={to} size="small" startIcon={<ArrowBackIcon />} sx={{ ml: -1, mb: 0.5 }}>
      {label}
    </Button>
  );
}

/** Button that opens a native file chooser. Calls onFiles with the selected files (input is reset so the same file can be re-picked). */
export function FilePickButton({ accept, multiple, onFiles, children, ...btn }: { accept: string; multiple?: boolean; onFiles: (files: File[]) => void; children: ReactNode } & Omit<ButtonProps, 'onClick' | 'children'>) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button {...btn} onClick={() => ref.current?.click()}>
        {children}
      </Button>
      <Box
        component="input"
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

/** Max upload size accepted by the API (MAX_UPLOAD_MB default). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic';
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm';

/** Save any JSON value as a downloaded file. */
export function saveJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Normalises an Indian registration number the same way the API does (uppercase, no spaces/dashes). */
export const normaliseReg = (v: string) => v.trim().toUpperCase().replace(/[\s-]/g, '');
export const REG_PATTERN = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$|^\d{2}BH\d{4}[A-Z]{1,2}$/;

export const FUEL_LABELS: Record<string, string> = { PETROL: 'Petrol', DIESEL: 'Diesel', CNG: 'CNG', LPG: 'LPG', ELECTRIC: 'Electric', HYBRID: 'Hybrid', OTHER: 'Other' };
