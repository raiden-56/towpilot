/** Generated downloads for guest mode (CSV exports, simple PDFs, placeholder images). */
import { FileResult } from './router';

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csvFile(header: string[], rows: unknown[][]) {
  return new FileResult([header, ...rows].map((r) => r.map(cell).join(',')).join('\n'), 'text/csv');
}

/** Minimal multi-line PDF, clearly labelled as guest-mode sample output. */
export function pdfFile(title: string, lines: string[]) {
  const esc = (s: string) => s.replace(/[()\\]/g, '').replace(/[^\x20-\x7e]/g, '');
  const body = [title, 'GUEST MODE - SAMPLE DOCUMENT, NOT A REAL RECORD', '', ...lines]
    .slice(0, 48)
    .map((l, i) => `BT /F1 ${i === 0 ? 16 : 10} Tf 50 ${790 - i * 15} Td (${esc(l)}) Tj ET`)
    .join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new FileResult(out, 'application/pdf');
}

/** Inline SVG placeholder used as the "uploaded" image URL for attachments and photos. */
export function placeholderImage(label: string, color = '#64748b') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="${color}"/><text x="320" y="230" font-family="sans-serif" font-size="28" fill="#fff" text-anchor="middle">${label.replace(/[<&>]/g, '')}</text><text x="320" y="275" font-family="sans-serif" font-size="18" fill="#e2e8f0" text-anchor="middle">Guest mode sample image</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
