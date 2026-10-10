import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { numericCode, randomToken, sha256, safeEqual } from '../../lib/crypto.js';
import { badRequest, forbidden, unauthorized } from '../../lib/errors.js';
import { ok, parseBody, phoneSchema } from '../../lib/http.js';
import { getSettings } from '../../lib/settings.js';
import { sms } from '../../integrations/messaging.js';
import { authLimiter, otpSendLimiter } from '../../middleware/rateLimit.js';
import { invalidatePrincipal, loadPrincipal, principal, requireAuth, signAccessToken } from '../../middleware/auth.js';
import { audit } from '../../lib/audit.js';

export const authRouter = Router();

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const REFRESH_COOKIE = 'tp_rt';
let dummyHash: string | null = null;

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

async function issueSession(req: Request, res: Response, userId: string) {
  const refresh = randomToken(48);
  await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: sha256(refresh),
      userAgent: req.headers['user-agent']?.slice(0, 300),
      ip: req.ip,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  setRefreshCookie(res, refresh);
  return { accessToken: signAccessToken(userId), expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
}

export async function meView(userId: string) {
  const p = await loadPrincipal(userId);
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      status: true,
      photoKey: true,
      createdAt: true,
      customerProfile: true,
      workerProfile: { select: { employeeCode: true, verificationStatus: true, employmentType: true } },
      driverProfile: { select: { licenceExpiry: true, canLeadTeam: true } },
    },
  });
  return { ...u, roles: p?.roles ?? [], permissions: [...(p?.permissions ?? [])] };
}

// ─── Phone OTP (customers and field staff) ───────────────────────────

authRouter.post('/otp/request', otpSendLimiter, async (req, res) => {
  const { phone } = parseBody(z.object({ phone: phoneSchema }), req);
  // Throttle per phone: max 1 OTP every 30 seconds.
  const recent = await prisma.otpChallenge.findFirst({ where: { phone, purpose: 'login', createdAt: { gt: new Date(Date.now() - 30_000) } } });
  if (recent) throw badRequest('Please wait 30 seconds before requesting another code');

  const code = numericCode(6);
  await prisma.otpChallenge.create({ data: { phone, purpose: 'login', codeHash: sha256(`${phone}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS), ip: req.ip } });
  const delivery = await sms.sendOtp(phone, code);
  if (!delivery.delivered && !delivery.sandbox) throw badRequest('We could not send the SMS right now. Please try again shortly.');

  const existing = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  ok(res, {
    expiresInSec: OTP_TTL_MS / 1000,
    isNewUser: !existing,
    sandbox: delivery.sandbox,
    // Development only: sandbox OTP is echoed so the flow can be exercised without an SMS provider.
    ...(env.exposeSandboxOtp ? { sandboxOtp: code } : {}),
  });
});

authRouter.post('/otp/verify', authLimiter, async (req, res) => {
  const body = parseBody(
    z.object({
      phone: phoneSchema,
      code: z.string().regex(/^\d{6}$/),
      fullName: z.string().trim().min(2).max(100).optional(),
      acceptTerms: z.boolean().optional(),
      locationConsent: z.boolean().optional(),
      marketingConsent: z.boolean().optional(),
    }),
    req,
  );
  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone: body.phone, purpose: 'login', usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge) throw unauthorized('Code expired. Request a new one.');
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw unauthorized('Too many attempts. Request a new code.');
  if (!safeEqual(challenge.codeHash, sha256(`${body.phone}:${body.code}`))) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    throw unauthorized('Incorrect code');
  }
  // Single-use: conditional update guards against concurrent reuse.
  const used = await prisma.otpChallenge.updateMany({ where: { id: challenge.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw unauthorized('Code already used');

  let user = await prisma.user.findUnique({ where: { phone: body.phone } });
  if (!user) {
    if (!body.fullName) throw badRequest('Full name is required to create an account', { field: 'fullName' });
    if (!body.acceptTerms) throw badRequest('Please accept the terms and privacy notice to continue', { field: 'acceptTerms' });
    const s = await getSettings();
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'customer' } });
    user = await prisma.user.create({
      data: {
        phone: body.phone,
        fullName: body.fullName,
        roles: { create: { roleId: role.id } },
        customerProfile: {
          create: {
            termsAcceptedAt: new Date(),
            privacyConsentAt: new Date(),
            consentVersion: s.privacy.consentVersion,
            locationConsent: body.locationConsent ?? false,
            marketingConsent: body.marketingConsent ?? false,
          },
        },
      },
    });
  }
  if (user.status === 'SUSPENDED') throw forbidden('Your account is suspended. Contact support.');
  if (user.status === 'DEACTIVATED' || user.deletedAt) throw forbidden('This account has been deactivated.');

  const tokens = await issueSession(req, res, user.id);
  ok(res, { ...tokens, user: await meView(user.id) });
});

// ─── Staff email + password ──────────────────────────────────────────

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password } = parseBody(z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1).max(200) }), req);
  const user = await prisma.user.findUnique({ where: { email } });
  // Always run bcrypt so response time does not reveal whether the account exists.
  dummyHash ??= await bcrypt.hash(randomToken(16), 12);
  const valid = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);
  if (!user || !user.passwordHash || !valid) throw unauthorized('Incorrect email or password');
  if (user.status !== 'ACTIVE') throw forbidden('This account is not active');
  const tokens = await issueSession(req, res, user.id);
  await audit(prisma, req, { actorUserId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id });
  ok(res, { ...tokens, user: await meView(user.id) });
});

/** Staff password reset via phone OTP (account recovery). */
authRouter.post('/password/reset', authLimiter, async (req, res) => {
  const body = parseBody(z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/), newPassword: z.string().min(10).max(200) }), req);
  const challenge = await prisma.otpChallenge.findFirst({ where: { phone: body.phone, purpose: 'login', usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!challenge || challenge.attempts >= OTP_MAX_ATTEMPTS || !safeEqual(challenge.codeHash, sha256(`${body.phone}:${body.code}`))) {
    if (challenge) await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    throw unauthorized('Invalid or expired code');
  }
  const user = await prisma.user.findUnique({ where: { phone: body.phone } });
  if (!user || !user.email) throw badRequest('No staff account is linked to this phone number');
  await prisma.$transaction([
    prisma.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 12) } }),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(prisma, req, { actorUserId: user.id, action: 'auth.password_reset', entityType: 'user', entityId: user.id });
  ok(res, { reset: true });
});

// ─── Sessions ────────────────────────────────────────────────────────

authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw unauthorized('No session');
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: sha256(token) } });
  if (!session) throw unauthorized('Session not found');
  if (session.revokedAt) {
    // Reuse of a rotated token: assume theft and revoke every session for this user.
    await prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    throw unauthorized('Session revoked. Please sign in again.');
  }
  if (session.expiresAt < new Date()) throw unauthorized('Session expired');
  const p = await loadPrincipal(session.userId);
  if (!p || p.status !== 'ACTIVE') throw unauthorized('Account not active');

  const next = randomToken(48);
  const created = await prisma.session.create({
    data: { userId: session.userId, refreshTokenHash: sha256(next), userAgent: session.userAgent, ip: req.ip, expiresAt: session.expiresAt },
  });
  const rotated = await prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date(), replacedById: created.id } });
  if (rotated.count !== 1) {
    await prisma.session.update({ where: { id: created.id }, data: { revokedAt: new Date() } });
    throw unauthorized('Session already refreshed');
  }
  setRefreshCookie(res, next);
  ok(res, { accessToken: signAccessToken(session.userId), expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, user: await meView(session.userId) });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (token) await prisma.session.updateMany({ where: { refreshTokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  ok(res, { loggedOut: true });
});

authRouter.post('/logout-all', requireAuth, async (req, res) => {
  const p = principal(req);
  await prisma.session.updateMany({ where: { userId: p.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  invalidatePrincipal(p.userId);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  ok(res, { loggedOut: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  ok(res, await meView(principal(req).userId));
});
