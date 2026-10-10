# TowPilot — towing & roadside assistance platform

TowPilot is a working name; the brand is configurable in Settings. It connects vehicle owners who need emergency help with verified tow-truck drivers and recovery crews, and gives the business a full operations and finance back office. It is built for the Indian market: INR and GST, Indian mobile OTP, IST and an April financial year, Razorpay, and DPDP-aware privacy features.

| App | Who | Highlights |
| --- | --- | --- |
| Customer (`/app`) | Vehicle owners, fleet managers | SOS request flow, GPS and pin location capture, guided damage assessment, transparent quotes, live tracking, OTP custody codes, share-tracking links, invoices and payments, memberships, support, data export |
| Driver (`/driver`) | Drivers, recovery workers | Availability and on-duty GPS sharing, job offers with accept/reject, a 13-step guided recovery checklist with evidence, quote revisions, handover, job close, earnings, performance, persistent Safety button |
| Admin (`/admin`) | Owners, dispatchers, finance | KPI dashboard, live dispatch centre, bookings, employees and verification, fleet and maintenance, customers and business accounts, pricing (versioned rate cards), memberships, finance (invoices, cash, refunds, expenses, reconciliation), payroll and payouts, profit and cash-flow reports, settings, audit log |

## Repository

```
apps/api     Express 5 + TypeScript + Prisma (PostgreSQL) + Socket.IO + job worker
apps/web     React 19 + Vite + MUI + TanStack Query + Redux Toolkit + RHF/Zod + Recharts + Leaflet
docs/        architecture, business rules & metric definitions, API guide, integrations,
             deployment / backup & recovery, security & privacy checklist, openapi.json
docker-compose.yml, .github/workflows/ci.yml
```

## Quick start (development)

Prerequisites: Node.js 20.11+ (22 recommended). PostgreSQL is optional: the repository can start a real, project-local PostgreSQL for you.

```bash
npm install

# 1. Database. Either start a project-local PostgreSQL on 127.0.0.1:5455 (keep this terminal open)…
npm run db:local
#    …or point apps/api/.env DATABASE_URL at your own PostgreSQL 14+ (UTF-8).

# 2. Configure the API
cp apps/api/.env.example apps/api/.env      # set JWT_ACCESS_SECRET to a random 48-byte string

# 3. Schema + reference data + labelled sample data (development only)
npm run db:deploy -w apps/api
npm run db:seed -w apps/api

# 4. Run (two terminals)
npm run dev:api        # http://localhost:4000  (Swagger at /api/docs)
npm run dev:web        # http://localhost:5173
```

### Sample accounts (only created when `ALLOW_SAMPLE_DATA=true` outside production)

| Role | Sign in |
| --- | --- |
| Admin | `admin@towpilot.local` / `Sample@12345` (Staff sign-in tab) |
| Dispatcher | `dispatch@towpilot.local` / `Sample@12345` |
| Finance | `finance@towpilot.local` / `Sample@12345` |
| Driver | mobile `9000000011` (to `…17`), OTP. With the sandbox SMS adapter the code is shown on screen. |
| Recovery worker | `9000000021` |
| Customer | `9000000101` (Priya), `9000000102` (Arjun, EV), `9000000104` (fleet manager, business account) |

All sample records are flagged `isSample` and named "Sample …". Reports can exclude them.

To try the full flow end to end:
1. Sign in as driver `9000000011` and go **Available** (allow location; in a desktop browser, use DevTools → Sensors to place yourself in Bengaluru, near 12.97, 77.59).
2. In another browser profile, sign in as customer `9000000101` and request a car tow near MG Road. Approve the quote.
3. Accept the offer as the driver and work through the checklist. The customer's pickup and handover codes are shown on their booking page.
4. Pay the invoice as the customer using the clearly labelled sandbox checkout.
5. Open Admin → Reports to see the job in revenue, cost and profit.

### Sandbox integrations

With the default `.env`, SMS, email, payments, maps and storage use **sandbox adapters**. Nothing real is sent or charged, and the UI shows a sandbox banner. See [docs/integrations.md](docs/integrations.md) for live configuration. Production start-up refuses sandbox payments or SMS and sample data.

## Tests

```bash
npm run test -w apps/api      # unit (pricing, state machine, finance, dispatch, …) + integration against a real PostgreSQL test DB
npm run test -w apps/web      # component and formatting tests
npm run typecheck
npm run build
```

Browser end-to-end tests (Playwright, using the installed Microsoft Edge; start `dev:api` and `dev:web` first):

```bash
npm run e2e -w apps/web       # every route for every role at desktop and 390px phone width, plus the full
                              # customer → dispatch → driver → sandbox payment → reports journey
```

API integration tests use the `towpilot_test` database (created by `npm run db:local`, or set `TEST_DATABASE_URL`). They refuse to run against any database whose name doesn't contain `_test`.

## Known limitations / next steps

* Live provider adapters are implemented for Razorpay, MSG91 OTP, SMTP, Google Maps and OSM. S3 storage, push notifications, number masking and MSG91 transactional templates are boundaries that you must wire up for launch (see docs/integrations.md).
* Rate limits are in-memory per instance. Use a gateway, WAF or Redis store when you scale out.
* Nearby-driver search runs in the application. Move it to PostGIS (`ST_DWithin`) beyond a few hundred drivers per city.
* Prepaid credit wallets for fleet accounts aren't implemented. Contracts support discounts, SLA priority, monthly service limits and credit limits.
* Shift *scheduling* isn't implemented. Attendance is tracked from availability changes.
* Legal, tax-treatment and DPDP reviews, a penetration test and payment-provider certification are still required before a commercial launch.

## Production

See [docs/deployment.md](docs/deployment.md) (Docker, first-admin bootstrap, monitoring, scaling, backup and recovery) and [docs/security-checklist.md](docs/security-checklist.md). Create the first administrator with the bootstrap CLI. No production admin account is hard-coded.

## Documentation

* [Architecture](docs/architecture.md)
* [Business rules & metric definitions](docs/business-rules.md)
* [API guide](docs/api.md) — plus Swagger at `/api/docs`
* [Integrations: sandbox vs live](docs/integrations.md)
* [Deployment, backup & recovery](docs/deployment.md)
* [Security & privacy checklist](docs/security-checklist.md)
