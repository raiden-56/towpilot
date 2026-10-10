import multer from 'multer';
import type { Request } from 'express';
import { env } from '../config/env.js';
import { badRequest } from './errors.js';
import { sha256 } from './crypto.js';
import { ALLOWED_UPLOAD_TYPES, newStorageKey, sniffMatches, storage } from '../integrations/storage.js';

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 6 },
});

export interface StoredFile {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  originalName: string;
}

/** Validates type (declared + magic bytes) and writes each file to private storage. */
export async function storeUploads(req: Request, prefix: string, kinds: (keyof typeof ALLOWED_UPLOAD_TYPES)[]): Promise<StoredFile[]> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? (req.file ? [req.file] : []);
  if (!files.length) throw badRequest('No file uploaded');
  const allowed = new Set(kinds.flatMap((k) => ALLOWED_UPLOAD_TYPES[k]!));
  const out: StoredFile[] = [];
  for (const f of files) {
    if (!allowed.has(f.mimetype)) throw badRequest(`File type ${f.mimetype} is not allowed`);
    if (!sniffMatches(f.buffer, f.mimetype)) throw badRequest(`${f.originalname} does not look like a valid ${f.mimetype} file`);
    const key = newStorageKey(prefix, f.originalname);
    await storage.put(key, f.buffer, f.mimetype);
    out.push({ storageKey: key, mimeType: f.mimetype, sizeBytes: f.size, sha256: sha256(f.buffer), originalName: f.originalname });
  }
  return out;
}
