# Business rules and metric definitions

All amounts are stored in paise. GST rate, fees and surcharges are configured per rate card.

## Pricing (quote engine — `apps/api/src/domain/pricing.ts`)

| Line | Rule |
| --- | --- |
| Base | `baseFee` of the selected rate card (most specific wins: fleet contract > zone + vehicle class > zone > vehicle class > default). |
| Towing km | `max(0, towKm − includedKm − membershipExtraKm) × perKm`, rounded to 0.1 km. Estimated at quote time. |
| Pickup km | `max(0, pickupKm − pickupFreeKm) × pickupPerKm`, from the nearest available verified provider. If no provider location is known, pickup travel is not charged. |
| Equipment | Surcharge per recommended equipment type present in `equipmentSurcharges` (deduplicated). |
| Crew | `max(0, crew − includedCrew) × crewChargePerWorker`, where crew = max(requested, recommended). |
| Waiting | Only on the final invoice: `ceil(max(0, waited − waitingFreeMinutes) / 15) × waitingPer15Min`. Waiting = arrival → pickup verification. Disclosed in the quote. |
| Scheduled fee | Flat fee for scheduled bookings. |
| Night / holiday | The **higher** of the two percentages applies — they never stack. Night window wraps midnight. Holidays come from Settings → Pricing. |
| Minimum charge | Tops the service subtotal up to `minimumCharge`. |
| Discounts | Applied in order on the remaining value and never below zero: membership base-fee waiver (if covered services remain) → contract % → membership % → promo % (capped). |
| GST | `taxRateBps` on the discounted taxable value. |
| Tolls/parking | Pass-through at actuals with receipts; not taxed and not revenue. |

The full rules, inputs and breakdown are frozen into `booking_quotes.pricingSnapshot`. Final invoices are recomputed from that snapshot, so later rate-card edits (which always create a new version) can never change a confirmed job's price.

### Price-difference protection

* Any extra chargeable work requires a **revised quote** with a reason per item, approved by the customer before it is charged. Price reductions or overrides require internal approval (`pricing:approve_override`).
* At job close, the final charges are compared with the approved quote. Increases other than disclosed waiting time, time-based surcharges and pass-through actuals are rejected.
* The invoice page shows every difference with its reason.

### Cancellation

Disclosed in every quote: free until a driver accepts; `acceptedFee` after acceptance/en route; `arrivedFee` once the driver has arrived. Customers must explicitly accept a fee; operations can waive it with a reason. Fees produce a `CANCELLATION` invoice.

## Smart recovery recommendation (`domain/recommendation.ts`)

Uses vehicle class, EV/hybrid, wheel/steering/brake state, stuck/overturned/submerged, traffic blocking, damage, access restrictions and passengers to recommend truck types, equipment and crew, set priority and safety flags, and list **manual-review reasons**. Bookings with manual-review reasons are never auto-dispatched; a dispatcher must review and may override crew/truck/equipment with notes (audited). "Not sure" answers are treated cautiously.

## Fair worker performance (`domain/performance.ts`)

Score = weighted average of punctuality (arrived ≤ ETA + grace), completion, safety/evidence compliance (complete custody & condition evidence; minus verified complaints) and customer feedback, plus a bonus for difficult jobs. Unknown components are excluded rather than penalised; reporting incidents is never penalised; only **verified** complaints count. Workers can challenge records through a `PERFORMANCE_CHALLENGE` ticket.

## Maintenance reminders

Rule-based only: service interval by km and days, document expiry (insurance, fitness, permit, PUC), inspection due dates, plus a linear projection from recorded odometer readings when at least two readings 14+ days apart exist. Labelled `RULE_BASED` / `RULE_BASED_PROJECTION` everywhere. This is not a predictive model.

## Financial metrics (`domain/finance.ts`, `modules/admin/reports.ts`)

| Metric | Definition |
| --- | --- |
| Gross service value | Σ invoice subtotal (pre-discount taxable service lines) for invoices issued in the period. |
| Discounts | Σ invoice discounts for invoices issued in the period. |
| Recognized revenue | Σ invoice taxable value issued in the period − Σ credit-note taxable value issued in the period. Excludes GST and pass-through. |
| Taxes collected | Σ invoice GST − Σ credit-note GST. A liability, not revenue. |
| Pass-through | Tolls/parking recovered at actuals. Excluded from revenue and costs. |
| Driver & partner earnings | Job earnings + incentives − deductions accrued in the period. Reimbursements are excluded (they are expenses). |
| Salaries | Salary obligations (base + incentives − deductions) for pay periods ending in the period — the accrued obligation, not cash paid. |
| Expenses | Approved or paid expenses dated in the period, pre-GST, by category (fuel, maintenance, repair, equipment, rental, marketing, insurance, tolls/parking (non-recoverable), office, software, other). |
| Gateway fees | Fee (incl. GST on fee) for payments that succeeded in the period. |
| Write-offs | Receivables written off in the period. |
| Operating profit | Recognized revenue − (earnings + salaries + expenses + gateway fees + write-offs). |
| Profit margin | Operating profit ÷ recognized revenue. |
| Cash in | Confirmed online payments + finance-confirmed cash + bank transfers received in the period. Outstanding invoices are **not** cash. |
| Cash out | Refunds paid + payouts paid (excluding reimbursements, counted once as paid expenses) + salaries paid + expenses paid (incl. GST). |
| Receivables | Outstanding on issued, non-void invoices issued before period end. |
| Revenue per completed booking | Recognized revenue from service invoices ÷ bookings completed in the period. |
| Contribution margin (per service) | Service-invoice revenue − direct job costs (earnings on those jobs, job-linked expenses, gateway fees on those invoices). |

Reporting timezone and financial-year start (default Asia/Kolkata, April) are configurable in Settings → Locale. Reports can exclude sample/sandbox data. A qualified accountant should confirm the treatments (e.g. GST input credit, revenue recognition for memberships) before statutory use.
