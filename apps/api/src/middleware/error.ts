import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { AppError } from '../lib/errors.js';
import { reportError } from '../lib/logger.js';
import { TransitionError } from '../domain/bookingStateMachine.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.id as string | undefined;
  const send = (status: number, code: string, message: string, details?: unknown) =>
    res.status(status).json({ error: { code, message, details, requestId } });

  if (err instanceof AppError) return send(err.status, err.code, err.message, err.details);
  if (err instanceof ZodError)
    return send(400, 'VALIDATION_ERROR', 'Some fields are invalid', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  if (err instanceof TransitionError) return send(409, 'INVALID_TRANSITION', err.message, { from: err.from, to: err.to });
  if (err instanceof MulterError) return send(400, 'UPLOAD_ERROR', err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message);
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return send(409, 'CONFLICT', 'A record with these details already exists', { target: err.meta?.target });
    if (err.code === 'P2025') return send(404, 'NOT_FOUND', 'Record not found');
    if (err.code === 'P2003') return send(409, 'CONFLICT', 'Related record constraint failed');
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed')
    return send(400, 'BAD_JSON', 'Malformed JSON body');

  reportError(err, { requestId, path: req.path, method: req.method });
  return send(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}
