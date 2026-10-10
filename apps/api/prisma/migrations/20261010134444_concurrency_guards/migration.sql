-- Database-level guarantees that application code cannot accidentally violate,
-- even under concurrent requests from multiple API instances.

-- A booking can have at most one live (offered or accepted) assignment.
CREATE UNIQUE INDEX "booking_assignments_one_live_per_booking"
  ON "booking_assignments" ("bookingId")
  WHERE "status" IN ('OFFERED', 'ACCEPTED');

-- A driver can hold at most one live assignment at a time.
CREATE UNIQUE INDEX "booking_assignments_one_live_per_driver"
  ON "booking_assignments" ("driverUserId")
  WHERE "status" IN ('OFFERED', 'ACCEPTED');

-- Only one quote per booking may be awaiting a decision at any moment.
CREATE UNIQUE INDEX "booking_quotes_one_pending_per_booking"
  ON "booking_quotes" ("bookingId")
  WHERE "status" IN ('PENDING_INTERNAL_APPROVAL', 'PENDING_CUSTOMER_APPROVAL');

-- Only one approved, non-superseded quote per booking.
CREATE UNIQUE INDEX "booking_quotes_one_approved_per_booking"
  ON "booking_quotes" ("bookingId")
  WHERE "status" = 'APPROVED';

-- Money columns can never be negative.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_non_negative" CHECK ("total" >= 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_score_range" CHECK ("score" BETWEEN 1 AND 5);

