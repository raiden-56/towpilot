# Deployment, operations, backup and recovery

## Topology (pilot)

* 1–2 API containers (`apps/api/Dockerfile`) behind a TLS-terminating load balancer with WebSocket support and sticky sessions (recommended for Socket.IO long-polling fallback).
* Web container (`apps/web/Dockerfile`): nginx serving the SPA and proxying `/api` and `/socket.io`.
* Managed PostgreSQL 16+ (PostGIS optional), automated backups and point-in-time recovery enabled.
* Redis 7, needed only when running more than one API instance (Socket.IO adapter).
* Private object storage (S3-compatible) for evidence, documents and invoices.

`docker-compose.yml` brings up the whole stack on one host for staging or small pilots.

## First deployment

```bash
cp .env.docker.example .env.docker            # fill in real secrets & providers
docker compose --env-file .env.docker up -d --build
# create the first administrator (refuses if one already exists)
docker compose exec -e BOOTSTRAP_ADMIN_PASSWORD='a-long-unique-password' api \
  node dist/cli/bootstrap-admin.js --email owner@company.in --phone 98xxxxxxxx --name "Owner Name"
```

Then sign in at `/login` → Staff sign-in, and configure, in this order:

1. Settings: business identity, GSTIN, support contacts, timezone and FY, dispatch parameters.
2. Services & pricing: zones (with enabled services), rate cards and cancellation fees.
3. Fleet: trucks, equipment, document expiry dates.
4. Employees: drivers and workers, their documents, verification and truck assignment.

The API container runs `prisma migrate deploy` on start. With several replicas, run migrations as a one-off job (`npx prisma migrate deploy`) before rolling out, and set the replicas' command to `node dist/server.js`.

## Environment

All configuration is environment variables. See `apps/api/.env.example`, `.env.docker.example` and `apps/web/.env.example`. In production the API refuses to start with sandbox payments or SMS, sample data, or a development file-signing secret. Secrets belong in your platform's secret manager, never in the image or repository.

## Health and monitoring

* `GET /health` — liveness (process up).
* `GET /ready` — readiness (database reachable). The Docker HEALTHCHECK uses it.
* Logs: structured JSON (pino) with request ids (`x-request-id`) and redaction of tokens, OTPs and passwords. Ship stdout to your log platform.
* Alert on: 5xx rate, `/ready` failures, `background_jobs` rows in `DEAD`, `payment_webhook_events` with `FAILED` / invalid signatures, open escalations older than 15 minutes, refunds stuck in `PROCESSING` for more than 24 h (Finance → Reconciliation lists these), and disk usage on storage.
* Error reporting: wire `ERROR_REPORTING_DSN` in `reportError()`.

## Scaling notes

* The job queue (`background_jobs`) uses `FOR UPDATE SKIP LOCKED`, so any number of workers can run. Recurring sweeps use advisory locks (one runner at a time). You can run dedicated worker containers with `RUN_WORKER=true` and API containers with `RUN_WORKER=false`.
* Set `REDIS_URL` when running more than one API instance, so socket events reach every client.
* Rate limits are in-memory per instance. Front the API with a gateway or WAF limit, or switch `express-rate-limit` to a Redis store.
* Nearby-driver search computes haversine distances in the application, which is fine for hundreds of drivers per city. Beyond that, enable PostGIS and move candidate filtering into SQL (`ST_DWithin` on a geography column).

## Backups

| What | How | Frequency / retention |
| --- | --- | --- |
| PostgreSQL | Managed PITR plus a daily logical dump: `pg_dump --format=custom --no-owner "$DATABASE_URL" > towpilot-$(date +%F).dump` | PITR 7–35 days; dailies kept 35 days; monthlies kept 12 months (financial records must also meet statutory retention, typically 8 years in India). |
| Object storage | Bucket versioning + cross-region replication, or nightly sync to a backup bucket | Same as above for invoices; evidence per your retention policy. |
| Configuration | Secrets in a secret manager; infrastructure as code | Versioned. |

Encrypt backups at rest and restrict who can read them. They contain personal data.

## Recovery procedure

1. **Declare an incident** and freeze deploys.
2. **Database:** restore PITR to a new instance at the timestamp just before the fault, or `pg_restore --clean --no-owner -d "$NEW_DATABASE_URL" towpilot-YYYY-MM-DD.dump`.
3. Run `npx prisma migrate deploy` against the restored database to confirm the migration history is consistent.
4. Point `DATABASE_URL` at the restored instance and restart the API. `/ready` must return `ready`.
5. **Payments reconciliation:** gateway events received after the restore point are re-delivered by Razorpay retries, or you can replay them from the Razorpay dashboard. They are processed idempotently. Compare Finance → Reconciliation totals with the gateway dashboard for the affected window.
6. **Storage:** restore the bucket version or prefix. Database rows reference objects by key, and SHA-256 hashes in `booking_attachments` let you verify evidence integrity.
7. Verify: sign in as each role, open an active booking, generate an invoice PDF, and run the financial report for the affected period.
8. Write the post-incident review.

Test the restore procedure at least quarterly on a staging copy.

## Data retention jobs

`retention-purge` runs every 6 hours. It deletes tracking events older than `retention.trackingDays` (default 90), used OTP challenges older than `otpDays`, notifications older than `notificationDays`, expired sessions and completed jobs. Financial records are never purged automatically.
