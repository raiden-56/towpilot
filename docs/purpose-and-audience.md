# TowPilot: Purpose and Audience

As of 2026-10-23.

## Overview

TowPilot is a towing and roadside assistance platform for the Indian market. It connects vehicle owners who need emergency help with verified tow-truck drivers and recovery crews, and gives the towing business a full operations and finance back office.

It ships as one web product with three apps: a Customer app, a Driver app and an Admin app, all backed by a single API. The name is a working name; the brand is configurable in Settings.

## Who it is for

TowPilot serves three groups through three separate apps, plus the towing business that runs them.

| Audience | App | What they need from it |
| --- | --- | --- |
| Vehicle owners stranded on the road | Customer (`/app`) | Request help fast with an SOS flow, share their location, get a transparent quote, track the truck live, and pay online. |
| Fleet managers of business accounts | Customer (`/app`) | Book recoveries for company vehicles under a contract with negotiated discounts, SLA priority and monthly limits. |
| Tow-truck drivers and recovery workers | Driver (`/driver`) | Go on duty, receive and accept job offers, follow a guided 13-step recovery checklist with photo evidence, and see earnings and performance. |
| Business owners | Admin (`/admin`) | A KPI dashboard, profit and cash-flow reports, pricing control through versioned rate cards, and a full audit log. |
| Dispatchers | Admin (`/admin`) | A live dispatch centre to watch every booking, review flagged jobs, and reassign when a driver rejects or times out. |
| Finance staff | Admin (`/admin`) | Invoices, cash confirmation, refunds, expenses, reconciliation, payroll and driver payouts. |

The target market is India: amounts are in INR with GST, sign-in uses Indian mobile OTP, time is IST with an April financial year, payments go through Razorpay, and privacy features follow the DPDP Act (Digital Personal Data Protection Act).

## Why it is needed

A breakdown is an emergency, and most towing operations still run it on phone calls, guesswork and paper. TowPilot replaces that with one system where the customer, the driver and the office all see the same job.

| Problem without it | How TowPilot answers it |
| --- | --- |
| A stranded customer does not know who is coming, when, or what it will cost. | SOS request with GPS capture, an upfront quote with every line disclosed, live tracking and a shareable tracking link. |
| Prices change on site and customers feel overcharged. | Every quote freezes a pricing snapshot. Extra work needs a revised quote the customer approves. At job close, any increase beyond disclosed waiting time and pass-through actuals is rejected. |
| Disputes over vehicle condition and who handed over the keys. | Pickup and delivery condition reports with photo evidence, and OTP custody codes at pickup and handover. |
| Wrong truck or crew sent, especially for EVs, overturned or submerged vehicles. | A guided damage assessment recommends truck type, equipment and crew, and routes unsafe or unclear cases to a dispatcher for manual review. |
| Dispatch depends on whoever answers the phone. | Automatic ranking of verified, available drivers by distance, workload and rating, with offer timeouts, retries and escalation when nobody accepts. |
| Drivers are paid and rated unfairly, and have no safety backup. | Earnings per job, a performance score that counts only verified complaints and never penalises reporting incidents, and a persistent Safety button. |
| The business cannot see whether it is making money. | Invoices, cash confirmation, refunds, expenses, payroll and payouts in one ledger, with profit, margin, cash-flow and receivables reports. Financial history is immutable, so corrections are credit notes and refunds, never edits. |
| Indian compliance is an afterthought in imported tools. | GST on every invoice, INR in integer paise, April financial year, Razorpay, mobile OTP sign-in, and DPDP-aware data export and privacy controls. |

## How a job flows

One booking passes through all three apps and ends in the finance reports.

1. Customer raises an SOS request with GPS or a pinned location and answers a guided damage assessment.
2. The pricing engine produces a quote with every line disclosed. The customer approves it.
3. Dispatch ranks verified, available drivers and sends an offer. Rejection or timeout retries the next driver. Unsafe or unclear cases wait for a dispatcher's manual review.
4. The driver accepts, drives to the scene, and verifies pickup with the customer's OTP code.
5. The driver records a pickup condition report with photos, then loads and transports the vehicle while the customer tracks it live.
6. Handover is confirmed with a second OTP code and a delivery report.
7. The final invoice is computed from the frozen quote plus disclosed actuals such as waiting time and tolls. The customer pays online or in cash.
8. The job appears in revenue, cost and profit reports, and the driver's earnings and performance score update.

## How it is built

One monorepo holds a single API and a single web app that serves all three roles. The database is the source of truth; real-time socket events only tell clients to refetch.

| Layer | Technology | Notes |
| --- | --- | --- |
| Web app (`apps/web`) | React 19, Vite, MUI, TanStack Query, Redux Toolkit, React Hook Form + Zod, Recharts, Leaflet | Customer, Driver and Admin apps in one SPA, tested at desktop and 390px phone width. |
| API (`apps/api`) | Express 5, TypeScript, Prisma 6, Socket.IO | REST at `/api/v1`, Swagger at `/api/docs`, background job worker in the same process. |
| Database | PostgreSQL 14+ (PostGIS optional) | Durable job queue, concurrency guards as unique indexes, optimistic versioning on bookings. |
| Integrations | Razorpay, MSG91 OTP, SMTP, Google Maps or OSM, S3-style storage | Every provider has a labelled sandbox adapter; production refuses sandbox payments or SMS. |
| Quality | Vitest unit and integration tests, Playwright end-to-end, GitHub Actions CI | Pure business rules (pricing, state machine, finance, dispatch) are fully unit-tested. |

Still required before a commercial launch: live wiring for S3 storage, push notifications and number masking, plus legal, tax and DPDP reviews, a penetration test and payment-provider certification. See [architecture.md](architecture.md), [business-rules.md](business-rules.md) and [integrations.md](integrations.md).
