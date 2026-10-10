# TowPilot architecture

## Overview

```
┌──────────────┐   HTTPS (REST /api/v1)    ┌────────────────────────────┐      ┌──────────────┐
│ React SPA    │ ────────────────────────▶ │ Express API (Node 22, TS)  │ ───▶ │ PostgreSQL   │
│ customer /   │ ◀──── Socket.IO (wss) ─── │  • auth, RBAC, validation  │      │ (PostGIS opt)│
│ driver /     │                           │  • domain services         │      └──────────────┘
│ admin        │                           │  • job worker + schedules  │ ───▶ Redis (optional: socket fan-out)
└──────────────┘                           │  • integration adapters    │ ───▶ SMS / email / Razorpay / maps / storage
                                           └────────────────────────────┘
```

* **apps/api** — Express 5 + TypeScript, Prisma 6 on PostgreSQL. A single process serves REST, Socket.IO and (unless `RUN_WORKER=false`) the background worker.
* **apps/web** — React 19 + Vite, MUI, TanStack Query (server state), Redux Toolkit (session/UI state), React Hook Form + Zod, Recharts, Leaflet.

### Backend layout

| Path | Responsibility |
| --- | --- |
| `src/domain/*` | Pure business rules with no I/O: booking state machine, pricing engine, payment status derivation, finance metric composition, dispatch eligibility & scoring, smart recovery recommendation, maintenance reminders, fair performance scoring, permissions. Fully unit-tested. |
| `src/modules/*` | HTTP routes + services per area (auth, bookings, dispatch, field workflow, billing, memberships, support, admin/*). |
| `src/integrations/*` | Provider boundaries (SMS, email, push, payments, storage, maps), each with a clearly labelled sandbox adapter. |
| `src/jobs/*` | PostgreSQL-backed durable job queue (`FOR UPDATE SKIP LOCKED`) and recurring sweeps guarded by advisory locks (exactly one instance runs each sweep). |
| `src/realtime/socket.ts` | Authenticated Socket.IO rooms (`user:`, `ops`, `booking:`, `share:`), Redis adapter when `REDIS_URL` is set. |
| `prisma/` | Schema, migrations (incl. raw-SQL concurrency guards), seed. |

### Key design decisions

* **Money is integer paise** everywhere. Requests that accept rupees are explicitly converted at the edge (`rupeesToPaise`).
* **Database is the source of truth.** Socket events are hints that make clients refetch; clients also poll for reconciliation. Events carry ids for de-duplication.
* **Concurrency is enforced in the database**, not just in code: partial unique indexes guarantee one live assignment per booking and per driver, and one pending/approved quote per booking; bookings use optimistic versioning; dispatch takes row locks; OTP challenges, offers and refunds use conditional updates.
* **Immutable financial history.** Settled payments, invoices and evidence are never edited. Corrections are credit notes, refunds, write-offs and new versions. Rate cards are versioned; every quote stores a frozen pricing snapshot, and final invoices are computed from that snapshot.
* **Server-side authorisation on every endpoint** (`requirePermission`) plus per-resource checks (owner, assigned field team, staff permission). Booking views are projected per viewer (customer / offered driver / field team / staff) so drivers never receive OTP values and unassigned drivers never receive exact customer locations.
* **Honest integrations.** Sandbox adapters never pretend to be real: sandbox payments are flagged `isSandbox`, settle only via signed sandbox webhooks processed by the same pipeline as Razorpay's, and are labelled in the UI and PDFs.

## Booking lifecycle

```
REQUESTED → QUOTED → CONFIRMED → SEARCHING_FOR_PROVIDER → ASSIGNED → ACCEPTED → EN_ROUTE → ARRIVED
  → INSPECTING → RECOVERY_AUTHORIZED → LOADING → IN_TRANSIT → DELIVERED → COMPLETED
```

Alternate states: `REJECTED`, `REASSIGNMENT_REQUIRED`, `CANCELLED`, `FAILED`, `CUSTOMER_UNAVAILABLE`, `SAFETY_HOLD`, `DISPUTED`. On-site services go `RECOVERY_AUTHORIZED → DELIVERED`. The full transition table with allowed actor roles is in `apps/api/src/domain/bookingStateMachine.ts`. Every transition writes `booking_status_history` (actor, role, reason, override flag).

Workflow guards (field app): pickup OTP (or authorised override) before inspection; pickup condition report with photo evidence before recovery is authorised; no pending quote revision; delivery report and handover custody (OTP or override) before delivery; final invoice only from the approved quote snapshot plus disclosed actuals (waiting time, tolls/parking with receipts).

## Payment lifecycle

`UNPAID → PAYMENT_PENDING → PARTIALLY_PAID / PAID`, plus `PAYMENT_FAILED`, `REFUND_PENDING`, `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED`. The status is *derived* from ledger rows (`payments`, `refunds`, `credit_notes`, `financial_adjustments`) by `derivePaymentStatus`; cached balances on `invoices` are recomputed inside every transaction that changes the ledger.

Payments are confirmed only by verified webhooks (`payment.captured`), stored idempotently in `payment_webhook_events` (unique `provider + eventId`). Field cash is `PENDING` until finance confirms it. Overpayments are refunded automatically. Refunds are capped at `paid − refunded − pending` and use gateway idempotency keys.

## Dispatch

1. Confirmed emergency bookings (without unresolved manual review) move to `SEARCHING_FOR_PROVIDER` and enqueue `dispatch.run`.
2. Candidates are ranked by `rankCandidates`: hard eligibility (verified, active, available, zone, licence, truck type/capacity/equipment/documents, fresh location, not previously declined) then a weighted score (ETA, workload, rating).
3. An offer (`OFFERED`, expires after `offerTimeoutSec`) is made; a timeout job turns it into `TIMED_OUT`.
4. Rejection or timeout → escalation + automatic retry with the next provider; after `maxAutoAttempts` the booking goes to `REASSIGNMENT_REQUIRED`, dispatch is alerted and the customer is told the truth.
5. Sweeps raise escalations for missed ETAs, stale driver locations and long waits.

## Security model (summary)

See `docs/security-checklist.md`. Access tokens are short-lived JWTs held in memory; refresh tokens are opaque, hashed, rotated on every use, with reuse detection that revokes all sessions. OTPs are hashed, single-use, attempt-limited and rate-limited. Uploads are type- and magic-byte-checked and stored privately, served only through short-lived HMAC-signed URLs.
