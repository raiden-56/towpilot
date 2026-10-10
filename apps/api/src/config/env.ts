import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().optional(),

  APP_BASE_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: bool,

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: bool,

  SMS_PROVIDER: z.enum(['sandbox', 'msg91']).default('sandbox'),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  EXPOSE_SANDBOX_OTP: bool,

  EMAIL_PROVIDER: z.enum(['sandbox', 'smtp']).default('sandbox'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('TowPilot <no-reply@towpilot.local>'),

  PUSH_PROVIDER: z.enum(['sandbox', 'none']).default('sandbox'),

  PAYMENT_PROVIDER: z.enum(['sandbox', 'razorpay']).default('sandbox'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  SANDBOX_WEBHOOK_SECRET: z.string().default('sandbox-webhook-secret-not-for-production'),

  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  FILE_URL_SIGNING_SECRET: z.string().min(16).default('dev-file-signing-secret-change-me'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().default(15),

  MAPS_PROVIDER: z.enum(['sandbox', 'google', 'osm']).default('sandbox'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  OSM_CONTACT_EMAIL: z.string().optional(),

  RUN_WORKER: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  LOG_LEVEL: z.string().default('info'),
  RATE_LIMIT_OTP_PER_15MIN: z.coerce.number().int().positive().default(8),
  RATE_LIMIT_AUTH_PER_15MIN: z.coerce.number().int().positive().default(30),
  ERROR_REPORTING_DSN: z.string().optional(),
  ALLOW_SAMPLE_DATA: bool,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n', parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

const e = parsed.data;

if (e.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (e.FILE_URL_SIGNING_SECRET.startsWith('dev-')) problems.push('FILE_URL_SIGNING_SECRET uses the development default');
  if (e.PAYMENT_PROVIDER === 'sandbox') problems.push('PAYMENT_PROVIDER=sandbox is not allowed in production');
  if (e.SMS_PROVIDER === 'sandbox') problems.push('SMS_PROVIDER=sandbox is not allowed in production');
  if (e.PAYMENT_PROVIDER === 'razorpay' && (!e.RAZORPAY_KEY_ID || !e.RAZORPAY_KEY_SECRET || !e.RAZORPAY_WEBHOOK_SECRET))
    problems.push('Razorpay credentials are incomplete');
  if (e.ALLOW_SAMPLE_DATA) problems.push('ALLOW_SAMPLE_DATA must not be enabled in production');
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error('Refusing to start in production:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
}

export const env = {
  ...e,
  isProd: e.NODE_ENV === 'production',
  isTest: e.NODE_ENV === 'test',
  corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  /** The sandbox OTP is only ever returned in API responses outside production with the sandbox SMS adapter. */
  exposeSandboxOtp: e.NODE_ENV !== 'production' && e.SMS_PROVIDER === 'sandbox' && e.EXPOSE_SANDBOX_OTP,
};
export type Env = typeof env;
