/**
 * Financial metric definitions. These pure functions are the single source of truth for how
 * report numbers are composed; the reports module only gathers the raw sums from the database.
 *
 * Accrual view (operating results)          Cash view (cash flow)
 * ───────────────────────────────           ─────────────────────
 * Recognized revenue = taxable value of     Cash in  = confirmed online + confirmed cash receipts
 *   invoices issued in the period minus     Cash out = refunds paid + payouts paid + salaries paid
 *   taxable value of credit notes issued       + expenses paid
 * Taxes (GST) are a liability → excluded    Taxes collected are part of cash in but shown separately
 * Pass-through tolls/parking → excluded
 * Costs = accrued driver earnings + salary accruals + approved expenses + gateway fees + write-offs
 */

export interface RevenueInputs {
  /** Σ invoice.subtotal (pre-discount taxable service value) for invoices issued in period. */
  grossServiceValue: number;
  /** Σ invoice.discountTotal for invoices issued in period. */
  discounts: number;
  /** Σ invoice.taxableValue for invoices issued in period. */
  invoicedTaxableValue: number;
  /** Σ invoice.taxTotal for invoices issued in period. */
  invoicedTax: number;
  /** Σ invoice.passThroughTotal. */
  passThrough: number;
  /** Σ creditNote.taxableAmount issued in period. */
  creditNoteTaxable: number;
  /** Σ creditNote.taxAmount issued in period. */
  creditNoteTax: number;
}

export interface CostInputs {
  driverEarnings: number; // accrued job earnings + incentives − deductions (excludes reimbursements)
  salaries: number; // salary obligations accrued for periods ending in range (base + incentives − deductions)
  expensesByCategory: Record<string, number>; // approved/paid operating expenses by expense date (pre-tax amount)
  gatewayFees: number; // fees + GST on fees for successful payments in period
  writeOffs: number; // bad-debt write-offs in period
}

export interface CashInputs {
  onlineReceived: number;
  cashReceived: number;
  bankReceived: number;
  refundsPaid: number;
  payoutsPaid: number;
  salariesPaid: number;
  expensesPaid: number;
}

export function computeOperatingResults(rev: RevenueInputs, cost: CostInputs) {
  const recognizedRevenue = rev.invoicedTaxableValue - rev.creditNoteTaxable;
  const taxesCollected = rev.invoicedTax - rev.creditNoteTax;
  const expensesTotal = Object.values(cost.expensesByCategory).reduce((a, b) => a + b, 0);
  const totalCosts = cost.driverEarnings + cost.salaries + expensesTotal + cost.gatewayFees + cost.writeOffs;
  const operatingProfit = recognizedRevenue - totalCosts;
  return {
    grossServiceValue: rev.grossServiceValue,
    discounts: rev.discounts,
    creditNotes: rev.creditNoteTaxable,
    recognizedRevenue,
    taxesCollected,
    passThrough: rev.passThrough,
    driverEarnings: cost.driverEarnings,
    salaries: cost.salaries,
    expensesByCategory: cost.expensesByCategory,
    expensesTotal,
    gatewayFees: cost.gatewayFees,
    writeOffs: cost.writeOffs,
    totalCosts,
    operatingProfit,
    profitMarginPct: recognizedRevenue > 0 ? Math.round((operatingProfit / recognizedRevenue) * 10000) / 100 : null,
  };
}

export function computeCashFlow(c: CashInputs) {
  const cashIn = c.onlineReceived + c.cashReceived + c.bankReceived;
  const cashOut = c.refundsPaid + c.payoutsPaid + c.salariesPaid + c.expensesPaid;
  return { ...c, cashIn, cashOut, netCashFlow: cashIn - cashOut };
}

/** Bucket outstanding invoices by days past due date. */
export function ageingBucket(dueAt: Date, now: Date): 'current' | '1-30' | '31-60' | '61-90' | '90+' {
  const days = Math.floor((now.getTime() - dueAt.getTime()) / 86_400_000);
  if (days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export const METRIC_DEFINITIONS: Record<string, string> = {
  grossServiceValue: 'Sum of service charges on invoices issued in the period, before discounts, excluding taxes and pass-through tolls/parking.',
  discounts: 'Discounts and membership benefits applied on invoices issued in the period.',
  recognizedRevenue: 'Taxable value of invoices issued in the period (after discounts) minus taxable value of credit notes issued in the period. Excludes GST and pass-through charges.',
  taxesCollected: 'GST charged on invoices minus GST reversed by credit notes. A liability payable to the government — not revenue.',
  passThrough: 'Tolls and parking recovered from customers at actuals. Excluded from revenue and from costs.',
  onlineReceived: 'Online payments confirmed by verified gateway events in the period (cash basis).',
  cashReceived: 'Cash collections confirmed by finance in the period. Unconfirmed field collections are excluded.',
  bankReceived: 'Bank transfers recorded by finance in the period.',
  receivables: 'Outstanding balance on issued, non-void invoices at the end of the period.',
  driverEarnings: 'Job earnings, incentives and deductions accrued to drivers/partners in the period. Reimbursements are excluded (counted in expenses).',
  salaries: 'Salary obligations (base + incentives − deductions) for pay periods ending in the period. This is the accrued obligation, not cash paid.',
  expensesTotal: 'Approved or paid operating expenses dated in the period, excluding recoverable GST input tax.',
  gatewayFees: 'Payment gateway fees and GST on fees for payments that succeeded in the period.',
  writeOffs: 'Receivables written off as uncollectable in the period.',
  operatingProfit: 'Recognized revenue minus driver earnings, salaries, expenses, gateway fees and write-offs.',
  profitMarginPct: 'Operating profit as a percentage of recognized revenue.',
  revenuePerCompletedBooking: 'Recognized revenue from service invoices divided by bookings completed in the period.',
  contributionMargin: 'Per service category: recognized revenue minus direct job costs (driver earnings on those jobs, job-linked expenses, gateway fees on those invoices).',
  netCashFlow: 'Cash received minus refunds, payouts, salaries and expenses actually paid in the period.',
};
