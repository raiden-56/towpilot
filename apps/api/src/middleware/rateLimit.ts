import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const json = (message: string) => ({ error: { code: 'RATE_LIMITED', message } });
const skip = () => env.isTest;

/** General API ceiling per IP. */
export const apiLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false, skip, message: json('Too many requests. Slow down.') });

/** OTP send: strict, to prevent SMS pumping. */
export const otpSendLimiter = rateLimit({ windowMs: 15 * 60_000, limit: env.RATE_LIMIT_OTP_PER_15MIN, standardHeaders: 'draft-8', legacyHeaders: false, skip, message: json('Too many OTP requests. Try again in a few minutes.') });

/** Login / OTP verify attempts. */
export const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: env.RATE_LIMIT_AUTH_PER_15MIN, standardHeaders: 'draft-8', legacyHeaders: false, skip, message: json('Too many sign-in attempts. Try again later.') });

/** Public share-link and webhook endpoints. */
export const publicLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, skip, message: json('Too many requests.') });
