/** RFC 4180 CSV with formula-injection protection for spreadsheet apps. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    if (v == null) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n');
}

export const paiseToRupees = (p: number | null | undefined) => (p == null ? '' : (p / 100).toFixed(2));
