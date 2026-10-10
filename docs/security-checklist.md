# Production security & privacy checklist

Items marked ✅ are implemented in code; ☐ items are deployment or organisational tasks you must complete before launch.

## Identity & sessions
- ✅ Phone OTP: 6 digits, hashed, 5-minute expiry, single use (conditional update), 5 attempts max, 30-second resend throttle, IP rate limits on send and verify.
- ✅ Staff passwords: bcrypt (cost 12). Login response timing is equalised for unknown accounts.
- ✅ Access JWT (15 min, issuer/audience checked) held in memory only. Refresh token is opaque, SHA-256 hashed in the database, rotated on every refresh, with reuse detection that revokes all of the user's sessions. Cookie is `HttpOnly`, `SameSite=Strict`, `Secure` (set `COOKIE_SECURE=true`) and path-scoped.
- ✅ Suspension or deactivation takes effect on the next request: the principal cache is invalidated and all sessions are revoked.
- ✅ First admin only via `bootstrap-admin` CLI, which refuses if an admin exists. No hard-coded production accounts. Sample accounts exist only when `ALLOW_SAMPLE_DATA=true` outside production.
- ☐ Enforce MFA for administrators (e.g. TOTP) before scaling the staff count.

## Authorisation
- ✅ Every protected route uses `requireAuth` + `requirePermission`. Role and permission definitions live in code (`domain/permissions.ts`).
- ✅ Resource checks: customers see only their own bookings, invoices and vehicles (unauthorised access returns 404 so existence isn't revealed). Field staff see only jobs they hold. Offered drivers see only a coarse location and no contact details. OTP values are never sent to drivers or staff. Compensation fields are hidden without `employee:manage` or `payroll:manage`. Private documents require `employee:documents`, and each view is audited.
- ✅ Socket rooms are re-authorised on every join. Share links are scoped, expiring, revocable and show limited data.
- ✅ Integration tests cover cross-customer access, role boundaries, concurrent assignment and payment idempotency (`apps/api/test/integration`).

## Input, output & files
- ✅ Zod validation on all inputs, with structured errors. Prisma parameterises all queries. The few raw SQL fragments use tagged templates; identifiers are constants, and the timezone is validated in settings.
- ✅ Uploads: size limits, MIME allow-list, magic-byte sniffing, random keys, never overwritten, private storage, HMAC-signed URLs (5 minutes for evidence, 2 minutes for documents), `nosniff` and inline disposition.
- ✅ CSV exports neutralise spreadsheet formula injection.
- ✅ Helmet headers. nginx adds a CSP, frame denial and a permissions policy.

## Payments
- ✅ No card data touches the platform (gateway checkout only).
- ✅ Payments are confirmed only by webhook. HMAC signatures are verified with a timing-safe compare. Events are unique per provider and event id (idempotent). Amounts are cross-checked. Overpayment triggers an automatic refund.
- ✅ Refunds are capped by the refundable amount, use idempotency keys, and need approval with a reason. Credit notes keep tax correct.
- ☐ Restrict the Razorpay dashboard to finance staff with 2FA, and rotate the webhook secret periodically.

## Audit & monitoring
- ✅ `audit_logs` records administrative and financial changes (actor, before and after, IP, request id): employees, verification, roles, settings, pricing versions, refunds, cash confirmation, credit notes, write-offs, payouts, overrides and document views.
- ✅ Logs redact authorization headers, cookies, OTPs, passwords and booking OTPs.
- ☐ Ship logs to a tamper-evident store and set up alerts (see `docs/deployment.md`).

## Privacy (DPDP Act 2023 — get legal review for your launch)
- ✅ Consent captured at sign-up (terms and privacy notice, versioned), separate location and marketing consents, and per-channel notification preferences.
- ✅ Location: requested only on user action. Driver GPS is shared only while on duty, with a visible indicator. Tracking history is limited to active jobs and purged after `retention.trackingDays`.
- ✅ Data-subject rights: self-service data export, plus privacy requests (erasure, correction, consent withdrawal, grievance) as tracked tickets. Financial records are retained as required by law.
- ✅ Data minimisation: masked licence and payout numbers, coarse locations for share links and offers.
- ☐ Publish a privacy notice (set `privacy.noticeUrl`), appoint a grievance officer and contact, and define breach notification procedures.
- ☐ Sign data processing agreements with providers (SMS, email, maps, payments, hosting). Keep data in India where required.
- ✅ Erasure workflow: `POST /admin/customers/:id/anonymize` scrubs name, phone, email, photos, saved places, contacts, booking contact details, addresses and precise coordinates, tracking history and notifications. It retains invoices and payments (tax law), resolves the linked privacy ticket and is audited.

## Infrastructure
- ☐ TLS everywhere (HSTS at the load balancer). Database and Redis on private networks only.
- ☐ Secrets in a secret manager. Rotate `JWT_ACCESS_SECRET` (this invalidates access tokens) and `FILE_URL_SIGNING_SECRET`.
- ☐ Encrypted, access-restricted backups with quarterly restore tests.
- ☐ Dependency scanning (`npm audit`, Dependabot) and container image scanning in CI.
- ☐ Penetration test before commercial launch.
