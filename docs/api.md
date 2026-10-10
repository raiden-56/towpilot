# API guide

* Base URL: `/api/v1`. Interactive docs are at `/api/docs` (Swagger UI) and the machine-readable spec is at `/api/v1/openapi.json`. Export it with `npm run openapi -w apps/api`, which writes `docs/openapi.json` for typed-client generation, e.g. `npx openapi-typescript docs/openapi.json -o apps/web/src/api/schema.d.ts`.
* Success responses: `{ "data": …, "meta"?: { page, pageSize, total, totalPages, … } }`.
* Error responses: `{ "error": { "code", "message", "details"?, "requestId" } }`.

  | Code | Meaning |
  | --- | --- |
  | `VALIDATION_ERROR` | 400; `details` is `[{ path, message }]` |
  | `UNAUTHORIZED` | 401 |
  | `FORBIDDEN` | 403 |
  | `NOT_FOUND` | 404; also returned for resources you may not access |
  | `CONFLICT` / `INVALID_TRANSITION` | 409 |
  | `UNPROCESSABLE` | 422; business-rule violations |
  | `RATE_LIMITED` | 429 |
  | `INTERNAL_ERROR` | 500 |

* Money: integer **paise** in all responses. Request fields documented as rupees, such as payment amounts, expense amounts and rate-card fees, are converted server-side.
* Pagination: `?page=1&pageSize=20` (max 100).
* Idempotency: `POST /invoices/:id/pay` requires an `Idempotency-Key` header; `POST /bookings` accepts a `clientRequestId`.

## Authentication

| Flow | Endpoints |
| --- | --- |
| Customer / field staff | `POST /auth/otp/request {phone}` → `POST /auth/otp/verify {phone, code, fullName?, acceptTerms?}` (name and terms required for new accounts) |
| Office staff | `POST /auth/login {email, password}` |
| Session | `POST /auth/refresh` (httpOnly cookie, rotated), `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me` |

Send `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes.

## Main resources

| Area | Endpoints (selection) |
| --- | --- |
| Catalogue | `GET /catalog/config`, `GET /catalog/services?lat&lng`, `GET /catalog/zones`; `GET /locations/reverse`, `/locations/search`, `POST /locations/parse-link` |
| Customer | `/me` (profile, preferences, addresses, emergency contacts, notifications, data export, privacy requests), `/vehicles` |
| Bookings | `POST /bookings` → `QUOTED`; `POST /bookings/:id/confirm {quoteId}`; `/requote`; `GET /:id/cancellation` and `POST /:id/cancel`; `/quotes/:quoteId/decision`; `/attachments`; `/share-links`; `/contact`; `/report-unreachable`; `/rating`; `/dispute`; `/custody-report`; `/tracking` |
| Field app | `/driver/me`, `PUT /driver/availability`, `POST /driver/location` (single point or `{points: []}` batch), `/driver/offers/:id/accept\|reject`, `/driver/jobs/active`, `/driver/jobs/:id/transition\|verify-pickup\|handover\|override-request\|condition-reports\|quote-revision\|attachments\|close\|cash`, `/driver/incidents`, `/driver/expenses`, `/driver/earnings`, `/driver/performance`, `/driver/attendance` |
| Dispatch | `/dispatch/board`, `/dispatch/bookings/:id/candidates\|assign\|auto-dispatch\|reassign\|review\|transition\|team\|custody-override`, `/dispatch/quotes/:id/internal-decision`, `/dispatch/escalations`, `/dispatch/incidents`, `/dispatch/assignments/history` |
| Billing | `/invoices`, `/invoices/:id`, `/invoices/:id/pdf`, `/invoices/:id/pay`, `/invoices/:id/refund-request`, `/invoices/:id/dispute`, `/payments/history`, `/payments/:id/checkout-callback`, `/payments/:id/sandbox-complete` (sandbox only) |
| Webhooks | `POST /webhooks/payments/razorpay` (signature `X-Razorpay-Signature`, event id `X-Razorpay-Event-Id`); `POST /webhooks/payments/sandbox` |
| Memberships | `GET /memberships/plans`, `/memberships/mine`, `POST /memberships/subscribe`, `POST /memberships/:id/cancel` |
| Support | `/support/tickets`, `/support/tickets/:id/messages` |
| Field (extra) | `POST /driver/jobs/:id/equipment-check` (audited equipment and crew confirmation) |
| Admin (extra) | `POST /admin/customers/:id/anonymize` (DPDP erasure); `GET /admin/fleet-accounts/contracts`; `DELETE /admin/fleet-accounts/:id/vehicles/:vehicleId`; `GET /admin/finance/earnings` |
| Admin | `/admin/employees`, `/admin/customers`, `/admin/fleet-accounts`, `/admin/fleet`, `/admin/pricing/*`, `/admin/finance/*`, `/admin/reports/*`, `/admin/system/*` |
| Public | `GET /public/track/:token` (shared tracking), `GET /public/files/*?exp&sig` (signed private files) |

## Realtime (Socket.IO, path `/socket.io`)

Connect with `auth: { token }` (or `{ shareToken }` for a shared tracking link). Each event is `{ id, ts, type, bookingId?, data }`. Treat events as hints to refetch and de-duplicate them by `id`. Join a booking room with `emit('booking:join', bookingId, ack)`; the server re-checks authorisation on every join.

| Type | Audience |
| --- | --- |
| `booking.status`, `booking.eta`, `booking.assignment`, `booking.custody`, `booking.evidence` | booking room + ops |
| `driver.location` | booking room, share room, ops (while on a job) |
| `quote.revision`, `quote.decision` | booking room |
| `payment.status`, `invoice.updated` | customer, booking room |
| `job.offer`, `job.offerExpired`, `job.cancelled` | driver |
| `notification` | user |
| `escalation.created`, `escalation.updated`, `incident.created`, `dispatch.offered`, `driver.availability`, `booking.completed` | ops |
