/**
 * Typed API client.
 *  - Access token kept in memory only (never localStorage).
 *  - Refresh token lives in an httpOnly cookie; a 401 triggers one silent refresh + retry.
 *  - Errors are normalised to ApiError with the server's code/message/details.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** Field-level validation messages, keyed by dotted path. */
  get fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; [k: string]: unknown };
}

const BASE = '/api/v1';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;
let onTokenRefreshed: ((token: string, user: unknown) => void) | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    accessToken = t;
  },
};

export function configureClient(opts: { onSessionExpired: () => void; onTokenRefreshed: (token: string, user: unknown) => void }) {
  onSessionExpired = opts.onSessionExpired;
  onTokenRefreshed = opts.onTokenRefreshed;
}

export async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (!r.ok) return false;
        const body = (await r.json()) as { data: { accessToken: string; user: unknown } };
        accessToken = body.data.accessToken;
        onTokenRefreshed?.(body.data.accessToken, body.data.user);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query) {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; headers?: Record<string, string>; raw?: boolean; retry?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  const isForm = opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method, headers, credentials: 'include', body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'You appear to be offline. Check your connection and try again.');
  }
  if (res.status === 401 && opts.retry !== false && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request<T>(method, path, { ...opts, retry: false });
    onSessionExpired?.();
  }
  if (opts.raw && res.ok) return res as unknown as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as { data?: T; meta?: unknown; error?: ApiErrorBody }) : {};
  if (!res.ok) {
    const e = json.error ?? { code: 'HTTP_' + res.status, message: res.statusText };
    throw new ApiError(res.status, e.code, e.message, e.details);
  }
  return ('meta' in json && json.meta ? { data: json.data, meta: json.meta } : json.data) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  page: <T>(path: string, query?: Query) => request<Paged<T>>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, { body: body ?? {}, headers }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, { body: form }),
  /** Authenticated file download (PDF/CSV) saved via a temporary object URL. */
  async download(path: string, filename: string, query?: Query) {
    const res = await request<Response>('GET', path, { query, raw: true });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};

/** Random idempotency key for payment and booking submissions. */
export const idempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
