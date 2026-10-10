import crypto from 'node:crypto';

export const sha256 = (input: string | Buffer) => crypto.createHash('sha256').update(input).digest('hex');

export const hmacSha256 = (secret: string, input: string | Buffer) => crypto.createHmac('sha256', secret).update(input).digest('hex');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Cryptographically random numeric code, e.g. for OTPs. */
export function numericCode(digits: number): string {
  let out = '';
  for (let i = 0; i < digits; i++) out += crypto.randomInt(0, 10).toString();
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Show only the last `visible` characters of an identifier (licence numbers, accounts). */
export function mask(value: string, visible = 4): string {
  const clean = value.replace(/\s+/g, '');
  if (clean.length <= visible) return '*'.repeat(clean.length);
  return '*'.repeat(clean.length - visible) + clean.slice(-visible);
}

export function maskPhone(phone: string): string {
  return phone.length > 4 ? phone.slice(0, 3) + '*****' + phone.slice(-2) : '****';
}
