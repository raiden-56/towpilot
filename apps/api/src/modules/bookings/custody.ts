import PDFDocument from 'pdfkit';
import { prisma } from '../../lib/prisma.js';
import { getSettings } from '../../lib/settings.js';
import { STATUS_LABELS } from '../../domain/bookingStateMachine.js';

/**
 * Vehicle custody report: who held the vehicle, when, in what condition, and how each
 * handover was confirmed. Evidence files are referenced by their SHA-256 so originals
 * can be proven unchanged.
 */
export async function renderCustodyReport(bookingId: string): Promise<Buffer> {
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: {
      vehicle: true,
      serviceCategory: true,
      locations: true,
      conditionReports: { orderBy: { createdAt: 'asc' } },
      custody: { orderBy: { createdAt: 'asc' } },
      attachments: { orderBy: { createdAt: 'asc' } },
      statusHistory: { orderBy: { createdAt: 'asc' } },
      teamMembers: { include: { user: { select: { fullName: true } } } },
      assignments: { where: { status: { in: ['ACCEPTED', 'COMPLETED'] } }, include: { truck: true } },
    },
  });
  const s = await getSettings();
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...b.custody.map((c) => c.confirmedById), ...b.custody.map((c) => c.overrideApprovedById ?? ''), ...b.conditionReports.map((r) => r.reportedById)] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const fmt = (d: Date) => d.toLocaleString('en-IN', { timeZone: s.locale.timezone });

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))));

  doc.fontSize(18).text(`${s.business.brandName} — Vehicle custody report`);
  doc.fontSize(10).fillColor('#475569').text(`Booking ${b.code} · ${b.serviceCategory.name} · Generated ${fmt(new Date())}`);
  if (b.isSample) doc.fillColor('#b45309').text('SAMPLE DATA — not a real job');
  doc.moveDown().fillColor('#0f172a');
  if (b.vehicle) doc.text(`Vehicle: ${b.vehicle.registrationNumber} — ${b.vehicle.make} ${b.vehicle.model} (${b.vehicle.vehicleClass}, ${b.vehicle.fuelType})`);
  const pickup = b.locations.find((l) => l.kind === 'PICKUP');
  const drop = b.locations.find((l) => l.kind === 'DROPOFF');
  if (pickup) doc.text(`Pickup: ${pickup.address ?? `${pickup.lat.toFixed(5)}, ${pickup.lng.toFixed(5)}`}`);
  if (drop) doc.text(`Destination: ${drop.placeName ? drop.placeName + ', ' : ''}${drop.address ?? `${drop.lat.toFixed(5)}, ${drop.lng.toFixed(5)}`}`);
  const truck = b.assignments[0]?.truck;
  if (truck) doc.text(`Truck: ${truck.registrationNumber} (${truck.truckType})`);
  doc.text(`Team: ${b.teamMembers.map((t) => `${t.user.fullName} (${t.role.replace('_', ' ').toLowerCase()})`).join(', ') || '—'}`);

  doc.moveDown().fontSize(12).text('Custody confirmations');
  doc.fontSize(9);
  if (!b.custody.length) doc.text('None recorded.');
  for (const c of b.custody) {
    doc.text(`${fmt(c.createdAt)} — ${c.stage}: ${c.method === 'OTP' ? 'verified by one-time code' : `AUTHORISED OVERRIDE by ${users.get(c.overrideApprovedById ?? '') ?? 'staff'} — ${c.overrideReason}`}; recipient ${c.recipientName ?? '—'}${c.recipientRelation ? ` (${c.recipientRelation})` : ''}; recorded by ${users.get(c.confirmedById) ?? c.confirmedById}`);
  }

  doc.moveDown().fontSize(12).text('Condition reports');
  doc.fontSize(9);
  for (const r of b.conditionReports) {
    const marks = (r.damageMarks as { area: string; description: string }[]) ?? [];
    doc.text(`${fmt(r.createdAt)} — ${r.stage} by ${users.get(r.reportedById) ?? r.reportedById}${r.supersedesId ? ' (correction of earlier report)' : ''}`);
    doc.text(`   Odometer: ${r.odometerKm ?? '—'} km · Fuel: ${r.fuelLevel ?? '—'} · Items: ${r.itemsInVehicle ?? '—'}`);
    doc.text(`   Damage: ${marks.length ? marks.map((m) => `${m.area}: ${m.description}`).join('; ') : 'none noted'}`);
    if (r.notes) doc.text(`   Notes: ${r.notes}`);
  }

  doc.moveDown().fontSize(12).text('Evidence files (original, unmodified)');
  doc.fontSize(8);
  for (const a of b.attachments) doc.text(`${fmt(a.createdAt)} ${a.kind} ${a.mimeType} ${(a.sizeBytes / 1024).toFixed(0)} KB sha256:${a.sha256}`);

  doc.moveDown().fontSize(12).text('Timeline');
  doc.fontSize(9);
  for (const h of b.statusHistory) doc.text(`${fmt(h.createdAt)} — ${STATUS_LABELS[h.toStatus]} (${h.actorRole}${h.isOverride ? ', override' : ''})${h.reason ? `: ${h.reason}` : ''}`);
  doc.end();
  return done;
}
