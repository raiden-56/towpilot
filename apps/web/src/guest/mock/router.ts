/**
 * Tiny in-browser router for guest mode. Handlers register `METHOD /path/:param` patterns and
 * return the response body's `data` (or a `paged()` result). Throwing `fail()` produces an API error.
 */
import { ApiError, type Paged } from '@/api/client';
import type { GuestRole } from '../session';

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface Ctx {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Query;
  /** JSON body, or the FormData of an upload. */
  body: Record<string, unknown>;
  form: FormData | null;
  role: GuestRole;
  /** The signed-in guest user's id. */
  userId: string;
}

/** Marks a paginated response ({ data, meta }). */
export class PagedResult<T> {
  constructor(public value: Paged<T>) {}
}

/** Marks a raw file response (downloads). */
export class FileResult {
  constructor(
    public body: BlobPart,
    public type: string,
  ) {}
}

export type Handler = (ctx: Ctx) => unknown;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

const routes: Route[] = [];

/** Register a handler, e.g. `on('GET', '/bookings/:id', (c) => ...)`. */
export function on(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', pattern: string, handler: Handler) {
  routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
}

export function match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
  const parts = path.split('?')[0]!.split('/').filter(Boolean);
  // Prefer the most specific pattern (fewest parameters) when several match.
  let best: { handler: Handler; params: Record<string, string>; score: number } | null = null;
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    let score = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = r.parts[i]!;
      if (p.startsWith(':')) {
        params[p.slice(1)] = decodeURIComponent(parts[i]!);
        score++;
      } else if (p !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok && (!best || score < best.score)) best = { handler: r.handler, params, score };
  }
  return best && { handler: best.handler, params: best.params };
}

// ─── Helpers for handlers ──────────────────────────────────────────────

export function fail(status: number, code: string, message: string, details?: unknown): never {
  throw new ApiError(status, code, message, details);
}

export const notFound = (what = 'Resource') => fail(404, 'NOT_FOUND', `${what} not found`);

/** Paginate an array with the same meta shape as the API (`page`, `pageSize` query params). */
export function paged<T>(items: T[], query: Query, extraMeta: Record<string, unknown> = {}): PagedResult<T> {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
  const total = items.length;
  return new PagedResult({ data: items.slice((page - 1) * pageSize, page * pageSize), meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), ...extraMeta } });
}

export const str = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));
export const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

/** Case-insensitive "contains" across several fields. */
export function matchesText(q: string | undefined, ...fields: (string | null | undefined)[]) {
  if (!q) return true;
  const needle = q.toLowerCase().replace(/\s/g, '');
  return fields.some((f) => !!f && f.toLowerCase().replace(/\s/g, '').includes(needle));
}

/** Filter by a `from`/`to` date query on an ISO date field. */
export function inRange(iso: string | null | undefined, query: Query) {
  if (!iso) return !query.from && !query.to;
  const t = new Date(iso).getTime();
  if (query.from && t < new Date(String(query.from)).getTime()) return false;
  if (query.to && t >= new Date(String(query.to)).getTime() + (String(query.to).length <= 10 ? 86_400_000 : 0)) return false;
  return true;
}
