/** Money helpers. All amounts are integer paise. */

/** Apply basis points (1/100th of a percent) with half-up rounding. 1800 bps = 18%. */
export function applyBps(amountPaise: number, bps: number): number {
  return roundHalfUp((amountPaise * bps) / 10000);
}

export function roundHalfUp(n: number): number {
  return n >= 0 ? Math.floor(n + 0.5) : -Math.floor(-n + 0.5);
}

export function rupees(paise: number): number {
  return paise / 100;
}

export function paise(rupeesValue: number): number {
  return roundHalfUp(rupeesValue * 100);
}

export function formatInr(amountPaise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amountPaise / 100);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
