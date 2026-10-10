import type { Request, Response } from 'express';
import { z } from 'zod';

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>, status = 200) {
  return res.status(status).json(meta ? { data, meta } : { data });
}

export const created = <T>(res: Response, data: T) => ok(res, data, undefined, 201);

export const parseBody = <S extends z.ZodType>(schema: S, req: Request): z.infer<S> => schema.parse(req.body ?? {});
export const parseQuery = <S extends z.ZodType>(schema: S, req: Request): z.infer<S> => schema.parse(req.query ?? {});

/** Query-string boolean: only "true"/"1" are true ("false" must not coerce to true). */
export const queryBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function pageArgs(q: { page: number; pageSize: number }) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function pageMeta(q: { page: number; pageSize: number }, total: number) {
  return { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

export const idParam = (req: Request, name = 'id') => {
  const v = req.params[name];
  if (typeof v !== 'string' || !v) throw new z.ZodError([{ code: 'custom', message: `Missing ${name}`, path: [name], input: v }]);
  return v;
};

/** Accepts INR amounts from clients as rupees with up to 2 decimals and converts to paise. */
export const rupeesToPaise = z.coerce
  .number()
  .nonnegative()
  .refine((v) => Math.round(v * 100) === Number((v * 100).toFixed(2)), 'At most two decimal places')
  .transform((v) => Math.round(v * 100));

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .transform((v) => (v.startsWith('+') ? v : v.length === 10 ? `+91${v}` : `+${v}`))
  .refine((v) => /^\+91[6-9]\d{9}$/.test(v), 'Enter a valid Indian mobile number');
