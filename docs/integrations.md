# Integrations: sandbox vs live

Every external dependency sits behind an adapter in `apps/api/src/integrations/`. Sandbox adapters exist so the whole product can be exercised without credentials. **They never pretend to be real**, and the UI shows a sandbox banner while any of them is active. Production start-up refuses sandbox payments, sandbox SMS, sample data and development secrets.

| Area | Env | Sandbox behaviour | Live provider | What you must configure |
| --- | --- | --- | --- | --- |
| OTP / SMS | `SMS_PROVIDER` | OTP written to the API log; returned in the API response only when `EXPOSE_SANDBOX_OTP=true` outside production. Notification SMS is logged and recorded as `SKIPPED`. | MSG91 OTP API (`MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`) | DLT-registered sender and templates (TRAI). Transactional SMS templates for booking updates need wiring in `messaging.ts → msg91.sendText`. |
| Email | `EMAIL_PROVIDER` | Logged only (`SKIPPED`). | Any SMTP (SES, SendGrid, Postmark) | SMTP host, credentials, verified sender domain (SPF/DKIM). |
| Push | `PUSH_PROVIDER` | Logged; in-app notifications and sockets are used. | Not wired | VAPID keys + subscription storage (web) or FCM/APNs. |
| Payments | `PAYMENT_PROVIDER` | Orders `sbx_order_*`. The customer sees a labelled sandbox checkout. Outcomes are delivered as **HMAC-signed sandbox webhooks** through the same idempotent pipeline as Razorpay. Fees simulated at 2% + GST. Refunds settle via signed sandbox webhooks. All rows have `isSandbox=true`. | Razorpay Orders + Checkout + Webhooks + Refunds REST API | `RAZORPAY_KEY_ID/SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Configure a webhook to `https://<host>/api/v1/webhooks/payments/razorpay` for `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`. Enable auto-capture. |
| Maps | `MAPS_PROVIDER` | No geocoding; distance = straight line × `roadDistanceFactor` (Settings), labelled "estimate". | `google` (Geocoding + Distance Matrix) or `osm` (Nominatim + OSRM, dev/pilot only) | `GOOGLE_MAPS_API_KEY` restricted to server IPs; web tiles via `VITE_MAP_TILE_URL`. |
| Storage | `STORAGE_PROVIDER` | Local disk (`STORAGE_LOCAL_DIR`), private, signed URLs. | S3-compatible | Install `@aws-sdk/client-s3` and implement the `s3` adapter in `storage.ts` (interface: put/get/exists). Keep the bucket private and enable encryption and versioning. |
| Error reporting | `ERROR_REPORTING_DSN` | Errors logged (pino JSON). | Sentry/Datadog etc. | Plug into `reportError()` in `lib/logger.ts`. |
| Number masking | — | Not configured. The real work number is shown only to the parties of an active job, with a note. | Exotel / Knowlarity | Replace `POST /bookings/:id/contact` with a call-bridge API. |
| Redis | `REDIS_URL` | Not required: the job queue and locks use PostgreSQL. | Redis 7 | Needed only for multi-instance Socket.IO fan-out (adapter enabled automatically). Rate limits are per instance; use a shared store if you scale horizontally. |

## Going live checklist (integrations)

1. Razorpay live keys, webhook secret, webhook URL verified with a ₹1 test; reconcile in Finance → Reconciliation.
2. MSG91 DLT templates approved; send a real OTP to a staff phone.
3. SMTP sender verified; test password reset and support replies.
4. Google Maps key restricted; check distance estimates on a few known routes.
5. Map tiles from a licensed provider (`VITE_MAP_TILE_URL`).
6. S3 adapter implemented and tested (upload, signed view, no public access).
7. `PAYMENT_PROVIDER`, `SMS_PROVIDER` ≠ sandbox and `ALLOW_SAMPLE_DATA=false` (enforced at start-up in production).
