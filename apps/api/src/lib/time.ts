/**
 * Timezone-aware reporting periods without external date libraries.
 * All returned ranges are half-open [from, to) in UTC instants.
 */

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'this_fy'
  | 'last_fy'
  | 'custom';

export interface DateRange {
  from: Date;
  to: Date;
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(date: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: weekdayIndex[p.weekday as string] ?? 0,
  };
}

/** Offset of `tz` from UTC at the given instant, in minutes (IST = +330). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(date.getTime() / 60000) * 60000;
  return Math.round((asUtc - truncated) / 60000);
}

/** UTC instant of local midnight for the given local calendar date in `tz`. */
export function zonedMidnight(year: number, month: number, day: number, tz: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day));
  const offset = tzOffsetMinutes(guess, tz);
  const candidate = new Date(guess.getTime() - offset * 60000);
  // Re-check offset at the candidate (handles DST transitions).
  const offset2 = tzOffsetMinutes(candidate, tz);
  return offset2 === offset ? candidate : new Date(guess.getTime() - offset2 * 60000);
}

function addLocalDays(y: number, m: number, d: number, days: number) {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function startOfLocalDay(date: Date, tz: string): Date {
  const p = localParts(date, tz);
  return zonedMidnight(p.year, p.month, p.day, tz);
}

/** Financial year label, e.g. "2026-27" for an April-start FY. */
export function financialYearLabel(date: Date, tz: string, fyStartMonth: number): string {
  const p = localParts(date, tz);
  const startYear = p.month >= fyStartMonth ? p.year : p.year - 1;
  if (fyStartMonth === 1) return String(startYear);
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function resolvePeriod(
  key: PeriodKey,
  opts: { tz: string; fyStartMonth: number; now?: Date; from?: string; to?: string },
): DateRange {
  const now = opts.now ?? new Date();
  const tz = opts.tz;
  const p = localParts(now, tz);
  const mid = (y: number, m: number, d: number) => zonedMidnight(y, m, d, tz);

  switch (key) {
    case 'today': {
      const n = addLocalDays(p.year, p.month, p.day, 1);
      return { from: mid(p.year, p.month, p.day), to: mid(n.y, n.m, n.d) };
    }
    case 'yesterday': {
      const y = addLocalDays(p.year, p.month, p.day, -1);
      return { from: mid(y.y, y.m, y.d), to: mid(p.year, p.month, p.day) };
    }
    case 'this_week':
    case 'last_week': {
      // Weeks start on Monday.
      const back = (p.weekday + 6) % 7;
      const s = addLocalDays(p.year, p.month, p.day, -back - (key === 'last_week' ? 7 : 0));
      const e = addLocalDays(s.y, s.m, s.d, 7);
      return { from: mid(s.y, s.m, s.d), to: mid(e.y, e.m, e.d) };
    }
    case 'this_month': {
      const ny = p.month === 12 ? p.year + 1 : p.year;
      const nm = p.month === 12 ? 1 : p.month + 1;
      return { from: mid(p.year, p.month, 1), to: mid(ny, nm, 1) };
    }
    case 'last_month': {
      const py = p.month === 1 ? p.year - 1 : p.year;
      const pm = p.month === 1 ? 12 : p.month - 1;
      return { from: mid(py, pm, 1), to: mid(p.year, p.month, 1) };
    }
    case 'this_quarter': {
      // Quarters aligned to the financial year start.
      const offset = (p.month - opts.fyStartMonth + 12) % 12;
      const qStartOffset = offset - (offset % 3);
      const startMonthAbs = opts.fyStartMonth + qStartOffset;
      const sy = p.year - (startMonthAbs > p.month ? 1 : 0);
      const sm = ((startMonthAbs - 1) % 12) + 1;
      const endAbs = sm + 3;
      const ey = endAbs > 12 ? sy + 1 : sy;
      const em = ((endAbs - 1) % 12) + 1;
      return { from: mid(sy, sm, 1), to: mid(ey, em, 1) };
    }
    case 'this_fy':
    case 'last_fy': {
      let startYear = p.month >= opts.fyStartMonth ? p.year : p.year - 1;
      if (key === 'last_fy') startYear -= 1;
      return { from: mid(startYear, opts.fyStartMonth, 1), to: mid(startYear + 1, opts.fyStartMonth, 1) };
    }
    case 'custom': {
      if (!opts.from || !opts.to) throw new Error('custom period requires from and to (YYYY-MM-DD)');
      const [fy, fm, fd] = opts.from.split('-').map(Number);
      const [ty, tm, td] = opts.to.split('-').map(Number);
      const end = addLocalDays(ty!, tm!, td!, 1); // inclusive end date
      return { from: mid(fy!, fm!, fd!), to: mid(end.y, end.m, end.d) };
    }
  }
}

/** The equally long period immediately before `range` (for comparisons). */
export function previousRange(range: DateRange): DateRange {
  const len = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - len), to: new Date(range.from.getTime()) };
}

export const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60000;
