import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { hmacSha256, randomToken, safeEqual } from '../lib/crypto.js';

/**
 * Private object storage boundary. Files are never public: they are served only through
 * short-lived signed URLs issued after an authorization check.
 *  - local: files under STORAGE_LOCAL_DIR (development / single-node pilots)
 *  - s3:    any S3-compatible store; requires installing @aws-sdk/client-s3 (see docs/deployment.md)
 */
export interface StorageProvider {
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
}

const root = path.resolve(env.STORAGE_LOCAL_DIR);

function safePath(key: string) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
  return path.join(root, key);
}

const local: StorageProvider = {
  async put(key, data) {
    const p = safePath(key);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, data, { flag: 'wx' }); // never overwrite evidence
  },
  async get(key) {
    return fs.createReadStream(safePath(key));
  },
  async exists(key) {
    try {
      await fsp.access(safePath(key));
      return true;
    } catch {
      return false;
    }
  },
};

const s3: StorageProvider = {
  async put() {
    throw new Error('S3 storage selected but not wired: install @aws-sdk/client-s3 and implement the adapter (docs/deployment.md)');
  },
  async get() {
    throw new Error('S3 storage not configured');
  },
  async exists() {
    return false;
  },
};

export const storage: StorageProvider = env.STORAGE_PROVIDER === 's3' ? s3 : local;

export function newStorageKey(prefix: string, originalName: string) {
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8);
  const d = new Date();
  return `${prefix}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomToken(16)}${ext}`;
}

/** Signed, expiring URL for a private object. Caller MUST have authorized access first. */
export function signedFileUrl(key: string, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmacSha256(env.FILE_URL_SIGNING_SECRET, `${key}:${exp}`);
  return `/api/v1/public/files/${key}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSignature(key: string, exp: string, sig: string): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000) return false;
  return safeEqual(hmacSha256(env.FILE_URL_SIGNING_SECRET, `${key}:${e}`), sig);
}

export const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
  document: ['application/pdf', 'image/jpeg', 'image/png'],
};

/** Verify file magic bytes match the declared type (defence against renamed executables). */
export function sniffMatches(buf: Buffer, mime: string): boolean {
  const hex = buf.subarray(0, 12).toString('hex');
  switch (mime) {
    case 'image/jpeg':
      return hex.startsWith('ffd8ff');
    case 'image/png':
      return hex.startsWith('89504e47');
    case 'image/webp':
      return hex.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP';
    case 'application/pdf':
      return buf.subarray(0, 5).toString() === '%PDF-';
    case 'video/mp4':
    case 'video/quicktime':
    case 'image/heic':
      return buf.subarray(4, 8).toString() === 'ftyp';
    case 'video/webm':
      return hex.startsWith('1a45dfa3');
    default:
      return false;
  }
}
