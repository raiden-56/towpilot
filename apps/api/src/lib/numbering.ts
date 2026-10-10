import { Prisma, type Db } from './prisma.js';
import { financialYearLabel, localParts } from './time.js';
import { getSettings } from './settings.js';

/** Atomically increments a named counter. Safe under concurrency (single UPSERT statement). */
export async function nextCounter(db: Db, key: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>(Prisma.sql`
    INSERT INTO "counters" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "counters"."value" + 1
    RETURNING "value"`);
  return Number(rows[0]!.value);
}

/** Sequential document numbers per financial year, e.g. INV/2026-27/000042. */
export async function nextDocumentNumber(db: Db, prefix: 'INV' | 'CN' | 'RCP' | 'EXP' | 'TKT', now = new Date()) {
  const s = await getSettings();
  const fy = financialYearLabel(now, s.locale.timezone, s.locale.fyStartMonth);
  const n = await nextCounter(db, `${prefix}:${fy}`);
  const sep = prefix === 'EXP' || prefix === 'TKT' ? '-' : '/';
  return `${prefix}${sep}${fy}${sep}${String(n).padStart(6, '0')}`;
}

/** Human-friendly booking code, e.g. TP-261010-0007 (date in business timezone). */
export async function nextBookingCode(db: Db, now = new Date()) {
  const s = await getSettings();
  const p = localParts(now, s.locale.timezone);
  const day = `${String(p.year % 100).padStart(2, '0')}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  const n = await nextCounter(db, `BK:${day}`);
  return `TP-${day}-${String(n).padStart(4, '0')}`;
}
