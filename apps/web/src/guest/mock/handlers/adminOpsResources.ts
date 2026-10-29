/**
 * Guest-mode handlers: employees, fleet, customers and business accounts
 * (apps/api/src/modules/admin/{employees,performance,fleet,customers}.ts).
 */
import type { Role } from '@/api/types';
import type { CustomerRow, FleetAccountDetail, FleetAccountRow, FleetContract, InvoiceRow, PaymentRow, SubscriptionRow, VehicleRow } from '@/pages/admin/biz/types';
import type { Employee, EmployeeDetail, MaintenanceRecord, Performance, Reminder, Truck, TruckDetailData, TruckExpense } from '@/pages/admin/ops/types';
import type { GFleetAccount, GInvoice, GPayment, GSubscription, GTruck, GUser, GVehicle } from '../model';
import { bookingById, DAY, db, newId, nowIso, pushNotification, truckById, truckForDriver, userById, zoneById } from '../db';
import { TERMINAL_STATUSES } from '../bookingOps';
import { csvFile, pdfFile } from '../files';
import { fail, matchesText, notFound, num, on, paged, str, type Ctx } from '../router';
import { appendAudit, canDo, requirePerm, settings } from './adminOpsShared';

const STAFF_ROLES = ['driver', 'worker', 'dispatcher', 'finance', 'admin'];
const toIso = (v: unknown) => (v === undefined ? undefined : v === null || v === '' ? null : new Date(String(v)).toISOString());
const rupees = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Math.round(Number(v) * 100));
const maskTail = (v: string) => `${'*'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`;
const zoneRefs = (ids: string[]) => ids.map((id) => ({ id, name: zoneById(id)?.name ?? id }));
const validation = (path: string, message: string): never => fail(400, 'VALIDATION_ERROR', message, [{ path, message }]);

// ─── Employees ───────────────────────────────────────────────────────

export function employeeView(u: GUser, showComp: boolean): Employee {
  const wp = u.workerProfile;
  const t = truckForDriver(u.id);
  return {
    id: u.id,
    fullName: u.fullName,
    phone: u.phone,
    email: u.email,
    status: u.status,
    isSample: u.isSample,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    roles: u.roles,
    photoUrl: u.photoUrl,
    workerProfile: wp && {
      id: wp.id,
      employeeCode: wp.employeeCode,
      partnerCompany: wp.partnerCompany,
      employmentType: wp.employmentType,
      payFrequency: wp.payFrequency,
      ...(showComp ? { baseSalary: wp.baseSalary, commissionBps: wp.commissionBps, perJobAmount: wp.perJobAmount, payoutDetailsMasked: wp.payoutDetailsMasked } : {}),
      verificationStatus: wp.verificationStatus,
      verificationNote: wp.verificationNote,
      verifiedAt: wp.verifiedAt,
      skills: wp.skills,
      trainingNotes: wp.trainingNotes,
      emergencyContactName: wp.emergencyContactName,
      emergencyContactPhone: wp.emergencyContactPhone,
      payoutMethod: wp.payoutMethod,
      joinedAt: wp.joinedAt,
      isSample: true,
      zones: zoneRefs(wp.zoneIds),
    },
    driverProfile: u.driverProfile,
    availability: u.availability && { status: u.availability.status, zoneId: u.availability.zoneId, lastLat: u.availability.lastLat, lastLng: u.availability.lastLng, lastLocationAt: u.availability.lastLocationAt, locationSharing: u.availability.locationSharing, statusSince: u.availability.statusSince },
    assignedTruck: t ? { id: t.id, registrationNumber: t.registrationNumber, truckType: t.truckType, status: t.status } : null,
  };
}

const showComp = (c: Ctx) => canDo(c, 'employee:manage') || canDo(c, 'payroll:manage');
const employeeOr404 = (id: string) => {
  const u = userById(id);
  return u?.workerProfile ? u : notFound('Employee');
};

function setAvailability(u: GUser, status: 'AVAILABLE' | 'ON_JOB' | 'OFF_DUTY') {
  if (!u.availability || u.availability.status === status) return;
  const now = nowIso();
  for (const l of db.availabilityLogs) if (l.userId === u.id && !l.endedAt) l.endedAt = now;
  db.availabilityLogs.push({ id: newId('att'), userId: u.id, status, zoneId: u.availability.zoneId, startedAt: now, endedAt: null });
  u.availability = { ...u.availability, status, statusSince: now, locationSharing: status !== 'OFF_DUTY' };
}

/** Fair performance score (apps/api/src/admin/performance.ts + domain/performance.ts). */
function performanceFor(userId: string, days = 90): Performance {
  const since = Date.now() - days * DAY;
  const w = (settings.performance as { weights: Record<string, number> }).weights;
  const assignments = db.bookings.flatMap((b) => b.assignments.filter((a) => a.driverUserId === userId && new Date(a.offeredAt).getTime() >= since));
  const jobs = db.bookings.filter((b) => b.teamMembers.some((t) => t.userId === userId && new Date(t.createdAt).getTime() >= since));
  const completed = jobs.filter((b) => b.status === 'COMPLETED' || b.status === 'DELIVERED');
  const arrivals = jobs.filter((b) => b.arrivedAt && b.etaAt);
  const grace = 10 * 60_000;
  const onTime = arrivals.filter((b) => new Date(b.arrivedAt!).getTime() <= new Date(b.etaAt!).getTime() + grace);
  const checklist = completed.filter((b) => {
    const kind = db.categories.find((c) => c.id === b.serviceCategoryId)?.kind;
    const stages = new Set(b.conditionReports.map((r) => r.stage));
    return (kind === 'TOWING' ? stages.has('PICKUP') && stages.has('DELIVERY') : true) && b.custody.some((x) => x.stage === 'HANDOVER');
  });
  const ratings = db.ratings.filter((r) => r.rateeUserId === userId && new Date(r.createdAt).getTime() >= since);
  const complaints = db.tickets.filter((t) => t.category === 'COMPLAINT' && t.verified && new Date(t.createdAt).getTime() >= since && (t.subjectUserId === userId || (t.bookingId && bookingById(t.bookingId)?.teamMembers.some((m) => m.userId === userId && m.role === 'TEAM_LEADER')))).length;
  const inputs = {
    assignmentsOffered: assignments.length,
    accepted: assignments.filter((a) => ['ACCEPTED', 'COMPLETED', 'RELEASED', 'CANCELLED'].includes(a.status)).length,
    completed: completed.length,
    cancelledByWorker: assignments.filter((a) => a.status === 'RELEASED').length,
    arrivals: arrivals.length,
    onTimeArrivals: onTime.length,
    ratingsAvg: ratings.length ? Math.round((ratings.reduce((a, r) => a + r.score, 0) / ratings.length) * 100) / 100 : null,
    ratingsCount: ratings.length,
    verifiedComplaints: complaints,
    safetyIncidentsReported: db.incidents.filter((i) => i.reportedById === userId && new Date(i.createdAt).getTime() >= since).length,
    checklistComplete: checklist.length,
    difficultJobs: completed.filter((b) => b.requiresManualReview || b.safetyFlags.length > 0).length,
  };
  const punctuality = inputs.arrivals ? inputs.onTimeArrivals / inputs.arrivals : null;
  const completion = inputs.accepted ? inputs.completed / inputs.accepted : null;
  const safety = inputs.completed ? Math.max(0, inputs.checklistComplete / inputs.completed - Math.min(0.5, inputs.verifiedComplaints * 0.1)) : null;
  const feedback = inputs.ratingsAvg != null && inputs.ratingsCount > 0 ? (inputs.ratingsAvg - 1) / 4 : null;
  const difficulty = inputs.completed ? Math.min(1, inputs.difficultJobs / inputs.completed) : 0;
  const known = ([[punctuality, w.punctuality!], [completion, w.completion!], [safety, w.safety!], [feedback, w.feedback!]] as [number | null, number][]).filter(([v]) => v != null) as [number, number][];
  const wsum = known.reduce((a, [, x]) => a + x, 0);
  const base = wsum ? known.reduce((a, [v, x]) => a + v * x, 0) / wsum : null;
  const score = base == null ? null : Math.min(1, base + difficulty * w.difficulty!);
  const pct = (v: number | null) => (v == null ? null : Math.round(v * 100));
  return {
    windowDays: days,
    inputs,
    score: pct(score),
    sufficientData: inputs.completed >= 5,
    components: { punctuality: pct(punctuality), completion: pct(completion), safety: pct(safety), feedback: pct(feedback), difficulty: Math.round(difficulty * 100) } as Record<string, number>,
    weights: w,
    explanation:
      'Score combines punctuality, completion, safety/evidence compliance and verified customer feedback. Difficult jobs add a bonus and never lower your score. Reporting incidents is never penalised. Disagree with a record? Raise a "Performance challenge" ticket.',
  };
}

on('GET', '/admin/employees', (c) => {
  requirePerm(c, 'employee:read');
  const q = c.query;
  const roles = str(q.role) ? [str(q.role)!] : STAFF_ROLES;
  const rows = db.users
    .filter((u) => !u.deletedAt && u.roles.some((r) => roles.includes(r)))
    .filter((u) => (!q.status || u.status === q.status) && (!q.verification || u.workerProfile?.verificationStatus === q.verification) && (!q.zoneId || u.workerProfile?.zoneIds.includes(String(q.zoneId))) && (!q.availability || u.availability?.status === q.availability))
    .filter((u) => matchesText(str(q.q), u.fullName, u.phone, u.email, u.workerProfile?.employeeCode))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((u) => employeeView(u, showComp(c)));
  return paged(rows, q);
});

on('GET', '/admin/employees/export.csv', (c) => {
  requirePerm(c, 'employee:manage');
  appendAudit(c.userId, 'employee.export', 'employee', null);
  const rows = db.users.filter((u) => u.workerProfile && !u.deletedAt).sort((a, b) => a.fullName.localeCompare(b.fullName));
  return csvFile(
    ['employeeCode', 'name', 'phone', 'roles', 'status', 'verification', 'employmentType', 'zones', 'licenceExpiry', 'truck'],
    rows.map((u) => [u.workerProfile!.employeeCode, u.fullName, u.phone, u.roles.join('|'), u.status, u.workerProfile!.verificationStatus, u.workerProfile!.employmentType, zoneRefs(u.workerProfile!.zoneIds).map((z) => z.name).join('|'), u.driverProfile?.licenceExpiry.slice(0, 10), truckForDriver(u.id)?.registrationNumber]),
  );
});

on('GET', '/admin/employees/compliance/expiring', (c) => {
  requirePerm(c, 'employee:read');
  const until = Date.now() + (num(c.query.days) ?? 30) * DAY;
  const licences = db.users
    .filter((u) => u.driverProfile && new Date(u.driverProfile.licenceExpiry).getTime() < until)
    .sort((a, b) => a.driverProfile!.licenceExpiry.localeCompare(b.driverProfile!.licenceExpiry))
    .map((u) => ({ id: `dp_${u.id}`, userId: u.id, licenceClass: u.driverProfile!.licenceClass, licenceExpiry: u.driverProfile!.licenceExpiry, user: { id: u.id, fullName: u.fullName, status: u.status } }));
  const documents = db.documents
    .filter((d) => d.expiresAt && d.status === 'APPROVED' && new Date(d.expiresAt).getTime() < until)
    .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!))
    .map((d) => ({ id: d.id, userId: d.userId, type: d.type, numberMasked: d.numberMasked, expiresAt: d.expiresAt!, user: { id: d.userId, fullName: userById(d.userId)?.fullName ?? 'Unknown' } }));
  return { licences, documents };
});

on('POST', '/admin/employees', (c) => {
  requirePerm(c, 'employee:manage');
  const b = c.body;
  const roles = (Array.isArray(b.roles) ? b.roles : []) as Role[];
  if (!roles.length) validation('roles', 'Choose at least one role');
  const fullName = String(b.fullName ?? '').trim();
  if (fullName.length < 2) validation('fullName', 'Enter the full name');
  const phone = String(b.phone ?? '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) validation('phone', 'Enter a 10-digit Indian mobile number');
  if (db.users.some((u) => u.phone === `+91${phone}`)) fail(409, 'CONFLICT', 'A user with this phone number already exists');
  if (roles.includes('admin') && !userById(c.userId)?.roles.includes('admin')) fail(403, 'FORBIDDEN', 'Only administrators can create administrators');
  if (roles.some((r) => ['admin', 'dispatcher', 'finance'].includes(r)) && (!b.email || !b.password)) fail(400, 'BAD_REQUEST', 'Office staff need an email and password to sign in');
  if (roles.includes('driver') && (!b.licenceNumber || !b.licenceExpiry || !b.licenceClass)) fail(400, 'BAD_REQUEST', 'Driving licence details are required for drivers');
  const field = roles.includes('driver') || roles.includes('worker');
  const now = nowIso();
  const count = db.users.filter((u) => u.workerProfile).length;
  const id = newId('u_emp');
  const u: GUser = {
    id,
    fullName,
    phone: `+91${phone}`,
    email: str(b.email)?.toLowerCase() ?? null,
    status: 'ACTIVE',
    roles,
    photoUrl: null,
    isSample: false,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    customerProfile: null,
    workerProfile: {
      id: newId('wp'),
      employeeCode: `EMP${String(count + 1).padStart(4, '0')}`,
      partnerCompany: str(b.partnerCompany) ?? null,
      employmentType: (b.employmentType as 'SALARIED') ?? 'SALARIED',
      payFrequency: (b.payFrequency as 'MONTHLY') ?? null,
      baseSalary: rupees(b.baseSalary) ?? null,
      commissionBps: b.commissionPct != null && b.commissionPct !== '' ? Math.round(Number(b.commissionPct) * 100) : null,
      perJobAmount: rupees(b.perJobAmount) ?? null,
      verificationStatus: field ? 'PENDING' : 'APPROVED',
      verificationNote: null,
      verifiedById: null,
      verifiedAt: null,
      skills: (b.skills as string[]) ?? [],
      trainingNotes: null,
      emergencyContactName: str(b.emergencyContactName) ?? null,
      emergencyContactPhone: str(b.emergencyContactPhone) ?? null,
      payoutMethod: (b.payoutMethod as 'UPI') ?? null,
      payoutDetailsMasked: str(b.payoutDetails) ? maskTail(String(b.payoutDetails)) : null,
      joinedAt: now,
      zoneIds: (b.zoneIds as string[]) ?? [],
    },
    driverProfile: roles.includes('driver') ? { licenceNumberMask: maskTail(String(b.licenceNumber)), licenceClass: String(b.licenceClass), licenceExpiry: toIso(b.licenceExpiry)!, canLeadTeam: true, heavyVehicleCert: !!b.heavyVehicleCert } : null,
    availability: field ? { status: 'OFF_DUTY', zoneId: ((b.zoneIds as string[]) ?? [])[0] ?? null, lastLat: null, lastLng: null, lastAccuracyM: null, lastLocationAt: null, locationSharing: false, statusSince: now } : null,
  };
  db.users.push(u);
  appendAudit(c.userId, 'employee.created', 'user', id, { ...b, password: undefined, payoutDetails: undefined, licenceNumber: undefined });
  return employeeView(u, true);
});

on('GET', '/admin/employees/:id', (c) => {
  requirePerm(c, 'employee:read');
  const u = employeeOr404(c.params.id!);
  const assignments = db.bookings
    .flatMap((b) => b.assignments.filter((a) => a.driverUserId === u.id).map((a) => ({ ...a, bookingId: b.id, booking: { code: b.code, status: b.status } })))
    .sort((x, y) => y.offeredAt.localeCompare(x.offeredAt))
    .slice(0, 50);
  const detail: EmployeeDetail = {
    ...employeeView(u, showComp(c)),
    assignments,
    incidents: db.incidents.filter((i) => i.reportedById === u.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 20).map((i) => ({ ...i, booking: i.bookingId ? { code: bookingById(i.bookingId)?.code ?? '—' } : null })),
    documents: canDo(c, 'employee:documents') ? db.documents.filter((d) => d.userId === u.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt)) : null,
    attendance: db.availabilityLogs.filter((l) => l.userId === u.id).sort((x, y) => y.startedAt.localeCompare(x.startedAt)).slice(0, 60),
    performance: performanceFor(u.id),
  };
  return detail;
});

on('PATCH', '/admin/employees/:id', (c) => {
  requirePerm(c, 'employee:manage');
  const u = employeeOr404(c.params.id!);
  const before = employeeView(u, true);
  const b = c.body;
  const wp = u.workerProfile!;
  if (b.fullName !== undefined) u.fullName = String(b.fullName).trim();
  if (b.phone) u.phone = `+91${String(b.phone).replace(/\D/g, '').slice(-10)}`;
  if (b.email !== undefined) u.email = str(b.email)?.toLowerCase() ?? null;
  if (b.employmentType) wp.employmentType = b.employmentType as typeof wp.employmentType;
  if (b.payFrequency !== undefined) wp.payFrequency = (b.payFrequency as typeof wp.payFrequency) ?? null;
  if (b.baseSalary !== undefined) wp.baseSalary = rupees(b.baseSalary) ?? null;
  if (b.commissionPct !== undefined) wp.commissionBps = b.commissionPct === null || b.commissionPct === '' ? null : Math.round(Number(b.commissionPct) * 100);
  if (b.perJobAmount !== undefined) wp.perJobAmount = rupees(b.perJobAmount) ?? null;
  if (b.partnerCompany !== undefined) wp.partnerCompany = str(b.partnerCompany) ?? null;
  if (Array.isArray(b.skills)) wp.skills = b.skills as string[];
  if (b.emergencyContactName !== undefined) wp.emergencyContactName = str(b.emergencyContactName) ?? null;
  if (b.emergencyContactPhone !== undefined) wp.emergencyContactPhone = str(b.emergencyContactPhone) ?? null;
  if (b.payoutMethod !== undefined) wp.payoutMethod = (b.payoutMethod as typeof wp.payoutMethod) ?? null;
  if (str(b.payoutDetails)) wp.payoutDetailsMasked = maskTail(String(b.payoutDetails));
  if (Array.isArray(b.zoneIds)) wp.zoneIds = b.zoneIds as string[];
  if (u.driverProfile) {
    if (b.licenceExpiry) u.driverProfile.licenceExpiry = toIso(b.licenceExpiry)!;
    if (b.licenceClass) u.driverProfile.licenceClass = String(b.licenceClass);
    if (str(b.licenceNumber)) u.driverProfile.licenceNumberMask = maskTail(String(b.licenceNumber));
    if (b.heavyVehicleCert != null) u.driverProfile.heavyVehicleCert = !!b.heavyVehicleCert;
    if (b.canLeadTeam != null) u.driverProfile.canLeadTeam = !!b.canLeadTeam;
  }
  u.updatedAt = nowIso();
  appendAudit(c.userId, 'employee.updated', 'user', u.id, { ...b, payoutDetails: b.payoutDetails ? '[masked]' : undefined, licenceNumber: undefined }, before);
  return employeeView(u, true);
});

on('POST', '/admin/employees/:id/verification', (c) => {
  requirePerm(c, 'employee:verify');
  const u = employeeOr404(c.params.id!);
  const decision = String(c.body.decision) as 'APPROVED' | 'REJECTED' | 'DOCUMENTS_REQUESTED' | 'SUSPENDED';
  const note = String(c.body.note ?? '').trim();
  if (note.length < 3) validation('note', 'Add a note for the employee');
  if (decision === 'APPROVED') {
    const ok = new Set(db.documents.filter((d) => d.userId === u.id && d.status === 'APPROVED' && (!d.expiresAt || new Date(d.expiresAt).getTime() > Date.now())).map((d) => d.type));
    const missing = ['ID_PROOF', 'PHOTO', ...(u.driverProfile ? ['DRIVING_LICENCE'] : [])].filter((t) => !ok.has(t as never));
    if (missing.length) fail(400, 'BAD_REQUEST', `Approve these documents first: ${missing.join(', ').toLowerCase().replace(/_/g, ' ')}`);
    if (u.driverProfile && new Date(u.driverProfile.licenceExpiry).getTime() < Date.now()) fail(400, 'BAD_REQUEST', 'Driving licence has expired');
  }
  const before = u.workerProfile!.verificationStatus;
  Object.assign(u.workerProfile!, { verificationStatus: decision, verificationNote: note, verifiedById: c.userId, verifiedAt: nowIso() });
  if (decision === 'APPROVED' && u.status === 'PENDING') u.status = 'ACTIVE';
  if (decision !== 'APPROVED') setAvailability(u, 'OFF_DUTY');
  pushNotification(u.id, 'verification', `Verification ${decision.replace('_', ' ').toLowerCase()}`, note);
  appendAudit(c.userId, `employee.verification.${decision.toLowerCase()}`, 'user', u.id, c.body, { status: before });
  return { verificationStatus: decision };
});

on('POST', '/admin/employees/:id/status', (c) => {
  requirePerm(c, 'employee:manage');
  const status = String(c.body.status) as 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  if (c.params.id === c.userId) fail(403, 'FORBIDDEN', 'You cannot change your own account status');
  const u = employeeOr404(c.params.id!);
  const live = db.bookings.some((b) => b.assignments.some((a) => a.driverUserId === u.id && (a.status === 'OFFERED' || a.status === 'ACCEPTED')));
  if (live && status !== 'ACTIVE') fail(409, 'CONFLICT', 'Reassign this employee’s active job first');
  const before = u.status;
  u.status = status;
  if (status !== 'ACTIVE' && u.availability) u.availability = { ...u.availability, status: 'OFF_DUTY', locationSharing: false, statusSince: nowIso() };
  appendAudit(c.userId, `employee.status.${status.toLowerCase()}`, 'user', u.id, c.body, { status: before });
  return { status };
});

on('PUT', '/admin/employees/:id/roles', (c) => {
  requirePerm(c, 'roles:manage');
  const roles = (Array.isArray(c.body.roles) ? c.body.roles : []) as Role[];
  if (!roles.length) validation('roles', 'Choose at least one role');
  if (c.params.id === c.userId && !roles.includes('admin')) fail(403, 'FORBIDDEN', 'You cannot remove your own administrator role');
  const u = employeeOr404(c.params.id!);
  const before = [...u.roles];
  u.roles = [...new Set([...u.roles.filter((r) => r === 'customer'), ...roles])];
  appendAudit(c.userId, 'employee.roles', 'user', u.id, roles, before);
  return { roles, available: ['customer', 'driver', 'worker', 'dispatcher', 'finance', 'admin'] };
});

on('PUT', '/admin/employees/:id/truck', (c) => {
  requirePerm(c, 'fleet:manage');
  const u = userById(c.params.id!);
  if (!u?.driverProfile) notFound('Driver');
  if (db.bookings.some((b) => b.assignments.some((a) => a.driverUserId === u!.id && a.status === 'ACCEPTED'))) fail(409, 'CONFLICT', 'Driver is on a job');
  const truckId = (c.body.truckId as string | null) ?? null;
  if (truckId) {
    const t = truckById(truckId) ?? notFound('Truck');
    if (t.status === 'IN_USE') fail(409, 'CONFLICT', 'Truck is on a job');
  }
  for (const t of db.trucks) if (t.assignedDriverUserId === u!.id) t.assignedDriverUserId = null;
  if (truckId) truckById(truckId)!.assignedDriverUserId = u!.id;
  appendAudit(c.userId, 'driver.truck_assigned', 'user', u!.id, { truckId });
  return { truckId };
});

on('POST', '/admin/employees/:id/documents', (c) => {
  requirePerm(c, 'employee:documents');
  const u = employeeOr404(c.params.id!);
  const file = c.form?.get('file');
  const type = String(c.body.type ?? 'OTHER') as (typeof db.documents)[number]['type'];
  const doc = { id: newId('doc'), userId: u.id, type, numberMasked: str(c.body.number) ? maskTail(String(c.body.number)) : null, mimeType: file instanceof File ? file.type || 'application/pdf' : 'application/pdf', expiresAt: toIso(c.body.expiresAt) ?? null, status: 'PENDING' as const, reviewedById: null, reviewNote: null, reviewedAt: null, createdAt: nowIso() };
  db.documents.push(doc);
  appendAudit(c.userId, 'employee.document.uploaded', 'employee_document', doc.id, { type });
  return doc;
});

on('POST', '/admin/employees/:id/documents/:docId/review', (c) => {
  requirePerm(c, 'employee:verify');
  const doc = db.documents.find((d) => d.id === c.params.docId && d.userId === c.params.id) ?? notFound('Document');
  doc.status = c.body.status === 'REJECTED' ? 'REJECTED' : 'APPROVED';
  doc.reviewNote = str(c.body.note) ?? null;
  doc.reviewedById = c.userId;
  doc.reviewedAt = nowIso();
  appendAudit(c.userId, `employee.document.${doc.status.toLowerCase()}`, 'employee_document', doc.id, c.body);
  return doc;
});

on('GET', '/admin/employees/:id/documents/:docId/url', (c) => {
  requirePerm(c, 'employee:documents');
  const doc = db.documents.find((d) => d.id === c.params.docId && d.userId === c.params.id) ?? notFound('Document');
  const u = userById(doc.userId);
  appendAudit(c.userId, 'employee.document.viewed', 'employee_document', doc.id);
  // A same-origin blob URL opens in the new tab; it is a labelled placeholder, not a real document.
  const pdf = pdfFile(`${doc.type.replace(/_/g, ' ')} - ${u?.fullName ?? ''}`, [`Number: ${doc.numberMasked ?? '-'}`, `Status: ${doc.status}`, `Expires: ${doc.expiresAt?.slice(0, 10) ?? '-'}`]);
  return { url: URL.createObjectURL(new Blob([pdf.body], { type: pdf.type })) };
});

// ─── Fleet ───────────────────────────────────────────────────────────

function avgKmPerDay(truckId: string) {
  const recs = db.maintenance.filter((m) => m.truckId === truckId && m.odometerKm != null).sort((a, b) => a.performedAt.localeCompare(b.performedAt));
  if (recs.length < 2) return null;
  const a = recs[0]!;
  const b = recs[recs.length - 1]!;
  const days = (new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime()) / DAY;
  return days >= 14 ? (b.odometerKm! - a.odometerKm!) / days : null;
}

/** Rule-based reminders (apps/api/src/domain/maintenance.ts). */
export function remindersFor(t: GTruck, avg: number | null = null, soonDays = 30): Reminder[] {
  const out: Reminder[] = [];
  const now = Date.now();
  const kmSince = t.odometerKm - (t.lastServiceOdometerKm ?? 0);
  if (kmSince >= t.serviceIntervalKm) out.push({ kind: 'SERVICE_KM', severity: 'OVERDUE', message: `Service overdue: ${kmSince} km since last service (interval ${t.serviceIntervalKm} km)`, basis: 'RULE_BASED' });
  else if (kmSince >= t.serviceIntervalKm * 0.9) out.push({ kind: 'SERVICE_KM', severity: 'DUE_SOON', message: `Service due in ${t.serviceIntervalKm - kmSince} km`, basis: 'RULE_BASED' });
  else if (avg && avg > 0) {
    const daysLeft = (t.serviceIntervalKm - kmSince) / avg;
    if (daysLeft <= soonDays) out.push({ kind: 'SERVICE_KM', severity: 'DUE_SOON', message: `At ~${Math.round(avg)} km/day, service interval reached in about ${Math.ceil(daysLeft)} days`, dueAt: new Date(now + daysLeft * DAY).toISOString(), basis: 'RULE_BASED_PROJECTION' });
  }
  if (t.lastServiceAt) {
    const due = new Date(t.lastServiceAt).getTime() + t.serviceIntervalDays * DAY;
    const days = (due - now) / DAY;
    if (days < 0) out.push({ kind: 'SERVICE_DAYS', severity: 'OVERDUE', message: `Time-based service overdue by ${Math.ceil(-days)} days`, dueAt: new Date(due).toISOString(), basis: 'RULE_BASED' });
    else if (days <= soonDays) out.push({ kind: 'SERVICE_DAYS', severity: 'DUE_SOON', message: `Time-based service due in ${Math.ceil(days)} days`, dueAt: new Date(due).toISOString(), basis: 'RULE_BASED' });
  } else out.push({ kind: 'SERVICE_DAYS', severity: 'DUE_SOON', message: 'No service history recorded', basis: 'RULE_BASED' });
  for (const [label, d] of [['Insurance', t.insuranceExpiry], ['Fitness certificate', t.fitnessExpiry], ['Permit', t.permitExpiry], ['PUC certificate', t.pucExpiry]] as const) {
    if (!d) continue;
    const days = (new Date(d).getTime() - now) / DAY;
    if (days < 0) out.push({ kind: 'DOCUMENT', severity: 'OVERDUE', message: `${label} expired`, dueAt: d, basis: 'RULE_BASED' });
    else if (days <= soonDays) out.push({ kind: 'DOCUMENT', severity: 'DUE_SOON', message: `${label} expires in ${Math.ceil(days)} days`, dueAt: d, basis: 'RULE_BASED' });
  }
  if (t.nextInspectionDue) {
    const days = (new Date(t.nextInspectionDue).getTime() - now) / DAY;
    if (days < 0) out.push({ kind: 'INSPECTION', severity: 'OVERDUE', message: 'Inspection overdue', dueAt: t.nextInspectionDue, basis: 'RULE_BASED' });
    else if (days <= 7) out.push({ kind: 'INSPECTION', severity: 'DUE_SOON', message: `Inspection due in ${Math.ceil(days)} days`, dueAt: t.nextInspectionDue, basis: 'RULE_BASED' });
  }
  return out;
}

export function truckView(t: GTruck): Truck {
  const z = zoneById(t.zoneId);
  const d = userById(t.assignedDriverUserId);
  const { equipment, ...rest } = t;
  return { ...rest, equipment: equipment.map((e) => ({ id: e.id, type: e.type, status: e.status, notes: e.notes, updatedAt: e.updatedAt })), zone: z ? { id: z.id, name: z.name, city: z.city } : null, assignedDriver: d ? { id: d.id, fullName: d.fullName, phone: d.phone } : null, reminders: remindersFor(t) };
}

const EQUIPMENT = ['WINCH', 'DOLLIES', 'GO_JACKS', 'WHEEL_SKATES', 'WHEEL_LIFT', 'FLATBED_DECK', 'JUMP_STARTER', 'TYRE_KIT', 'FUEL_CAN', 'LOCKOUT_KIT', 'EV_SAFE_KIT', 'RECOVERY_STRAPS', 'SAFETY_CONES'];

function applyTruckInput(t: GTruck, b: Record<string, unknown>) {
  if (b.registrationNumber) t.registrationNumber = String(b.registrationNumber).toUpperCase().replace(/[\s-]/g, '');
  for (const k of ['truckType', 'make', 'model', 'maxVehicleClass', 'notes'] as const) if (b[k] !== undefined) (t as unknown as Record<string, unknown>)[k] = b[k];
  for (const k of ['maxLoadKg', 'odometerKm', 'serviceIntervalKm', 'serviceIntervalDays', 'lastServiceOdometerKm'] as const) if (b[k] !== undefined) (t as unknown as Record<string, unknown>)[k] = b[k] === null || b[k] === '' ? null : Number(b[k]);
  for (const k of ['lastServiceAt', 'insuranceExpiry', 'fitnessExpiry', 'permitExpiry', 'pucExpiry', 'nextInspectionDue'] as const) if (b[k] !== undefined) t[k] = toIso(b[k]) ?? null;
  if (b.zoneId !== undefined) t.zoneId = (b.zoneId as string | null) || null;
  if (Array.isArray(b.equipment)) {
    const want = (b.equipment as string[]).filter((e) => EQUIPMENT.includes(e));
    t.equipment = [...t.equipment.filter((e) => want.includes(e.type)), ...want.filter((type) => !t.equipment.some((e) => e.type === type)).map((type) => ({ id: newId('eq'), truckId: t.id, type, status: 'OK' as const, notes: null, updatedAt: nowIso() }))];
  }
  t.updatedAt = nowIso();
}

on('GET', '/admin/fleet/trucks', (c) => {
  requirePerm(c, 'fleet:read');
  const q = c.query;
  const rows = db.trucks
    .filter((t) => (q.status ? t.status === q.status : t.status !== 'RETIRED') && (!q.zoneId || t.zoneId === q.zoneId) && (!q.truckType || t.truckType === q.truckType) && (!q.q || t.registrationNumber.includes(String(q.q).toUpperCase().replace(/\s/g, ''))))
    .sort((a, b) => a.registrationNumber.localeCompare(b.registrationNumber))
    .map(truckView);
  return paged(rows, q);
});

on('GET', '/admin/fleet/trucks.csv', (c) => {
  requirePerm(c, 'fleet:read');
  return csvFile(
    ['registration', 'type', 'status', 'zone', 'driver', 'odometerKm', 'insuranceExpiry', 'fitnessExpiry', 'lastService', 'sample'],
    db.trucks.map((t) => [t.registrationNumber, t.truckType, t.status, zoneById(t.zoneId)?.name, userById(t.assignedDriverUserId)?.fullName, t.odometerKm, t.insuranceExpiry?.slice(0, 10), t.fitnessExpiry?.slice(0, 10), t.lastServiceAt?.slice(0, 10), t.isSample]),
  );
});

on('GET', '/admin/fleet/reminders', (c) => {
  requirePerm(c, 'fleet:read');
  const items = db.trucks
    .filter((t) => t.status !== 'RETIRED')
    .map((t) => ({ truck: { id: t.id, registrationNumber: t.registrationNumber, truckType: t.truckType, status: t.status }, reminders: remindersFor(t, avgKmPerDay(t.id)) }))
    .filter((x) => x.reminders.length);
  return { items, basis: 'RULE_BASED' };
});

on('POST', '/admin/fleet/trucks', (c) => {
  requirePerm(c, 'fleet:manage');
  const reg = String(c.body.registrationNumber ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (reg.length < 6) validation('registrationNumber', 'Enter a valid registration number');
  if (db.trucks.some((t) => t.registrationNumber === reg)) fail(409, 'CONFLICT', 'A truck with this registration already exists');
  const now = nowIso();
  const t: GTruck = { id: newId('trk'), registrationNumber: reg, truckType: 'FLATBED', make: '', model: '', maxLoadKg: 3500, maxVehicleClass: 'SUV', status: 'AVAILABLE', zoneId: null, assignedDriverUserId: null, odometerKm: 0, lastServiceAt: null, lastServiceOdometerKm: null, serviceIntervalKm: 10000, serviceIntervalDays: 180, insuranceExpiry: null, fitnessExpiry: null, permitExpiry: null, pucExpiry: null, nextInspectionDue: null, notes: null, isSample: false, createdAt: now, updatedAt: now, equipment: [] };
  applyTruckInput(t, c.body);
  db.trucks.push(t);
  appendAudit(c.userId, 'truck.created', 'tow_truck', t.id, c.body);
  return truckView(t);
});

on('GET', '/admin/fleet/trucks/:id', (c) => {
  requirePerm(c, 'fleet:read');
  const t = truckById(c.params.id) ?? notFound('Truck');
  const since = Date.now() - 30 * DAY;
  const exp = db.expenses.filter((e) => e.truckId === t.id);
  const approved = exp.filter((e) => e.status === 'APPROVED' || e.status === 'PAID');
  const maintenance: MaintenanceRecord[] = db.maintenance.filter((m) => m.truckId === t.id).sort((a, b) => b.performedAt.localeCompare(a.performedAt)).slice(0, 50);
  const expenses: TruckExpense[] = exp
    .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate))
    .slice(0, 50)
    .map((e) => ({ id: e.id, number: e.number, category: e.category, status: e.status, description: e.description, vendorName: e.vendorName, amount: e.amount, taxAmount: e.taxAmount, expenseDate: e.expenseDate, fuelLitres: e.fuelLitres, odometerKm: e.odometerKm }));
  const detail: TruckDetailData = {
    ...truckView(t),
    reminders: remindersFor(t, avgKmPerDay(t.id)),
    maintenance,
    expenses,
    remindersBasis: 'Rule-based: configured service intervals, document expiry dates and a linear projection of recorded odometer readings. Not a predictive model.',
    utilisation: { completedJobsLast30Days: db.bookings.reduce((n, b) => n + b.assignments.filter((a) => a.truckId === t.id && a.status === 'COMPLETED' && new Date(a.offeredAt).getTime() >= since).length, 0) },
    costs: {
      fuel: approved.filter((e) => e.category === 'FUEL').reduce((a, e) => a + e.amount, 0),
      fuelLitres: approved.filter((e) => e.category === 'FUEL').reduce((a, e) => a + (e.fuelLitres ?? 0), 0),
      maintenanceAndRepairs: approved.filter((e) => e.category === 'MAINTENANCE' || e.category === 'REPAIR').reduce((a, e) => a + e.amount, 0) + maintenance.filter((m) => !m.expenseId).reduce((a, m) => a + m.cost, 0),
    },
    breakdowns: maintenance.filter((m) => m.type === 'BREAKDOWN').length,
  };
  return detail;
});

on('PATCH', '/admin/fleet/trucks/:id', (c) => {
  requirePerm(c, 'fleet:manage');
  const t = truckById(c.params.id) ?? notFound('Truck');
  const before = truckView(t);
  if (c.body.status && t.status === 'IN_USE') fail(409, 'CONFLICT', 'Truck is on a job. Change status after the job ends.');
  applyTruckInput(t, c.body);
  if (c.body.status) t.status = c.body.status as GTruck['status'];
  appendAudit(c.userId, 'truck.updated', 'tow_truck', t.id, c.body, { status: before.status });
  return truckView(t);
});

on('PATCH', '/admin/fleet/trucks/:id/equipment/:type', (c) => {
  requirePerm(c, 'fleet:manage');
  const t = truckById(c.params.id) ?? notFound('Truck');
  const type = c.params.type!;
  if (!EQUIPMENT.includes(type)) notFound('Equipment type');
  let e = t.equipment.find((x) => x.type === type);
  if (!e) {
    e = { id: newId('eq'), truckId: t.id, type, status: 'OK', notes: null, updatedAt: nowIso() };
    t.equipment.push(e);
  }
  e.status = (c.body.status as typeof e.status) ?? e.status;
  e.notes = str(c.body.notes) ?? null;
  e.updatedAt = nowIso();
  appendAudit(c.userId, 'truck.equipment', 'tow_truck', t.id, { type, ...c.body });
  return e;
});

on('POST', '/admin/fleet/trucks/:id/maintenance', (c) => {
  requirePerm(c, 'fleet:manage');
  const t = truckById(c.params.id) ?? notFound('Truck');
  const b = c.body;
  const type = String(b.type ?? 'SERVICE') as 'SERVICE' | 'REPAIR' | 'INSPECTION' | 'BREAKDOWN';
  const cost = rupees(b.cost) ?? 0;
  const performedAt = toIso(b.performedAt) ?? nowIso();
  const odo = num(b.odometerKm);
  let expenseId: string | null = null;
  if (cost > 0) {
    const n = db.expenses.length + 1;
    const e = { id: newId('exp'), number: `EXP-G${String(n).padStart(5, '0')}`, category: type === 'SERVICE' || type === 'INSPECTION' ? ('MAINTENANCE' as const) : ('REPAIR' as const), source: b.vendorName ? ('VENDOR_BILL' as const) : ('DIRECT' as const), status: 'APPROVED' as const, description: `${t.registrationNumber}: ${String(b.description ?? '')}`, vendorName: str(b.vendorName) ?? null, vendorBillRef: null, amount: cost, taxAmount: 0, expenseDate: performedAt, fuelLitres: null, odometerKm: odo ?? null, truckId: t.id, bookingId: null, zoneId: t.zoneId, claimantUserId: null, reimbursable: false, hasAttachment: false, submittedById: c.userId, approvedById: c.userId, approvedAt: nowIso(), rejectionReason: null, paidAt: null, paymentRef: null, isSample: false, createdAt: nowIso(), updatedAt: nowIso() };
    db.expenses.push(e);
    expenseId = e.id;
  }
  const rec = { id: newId('mnt'), truckId: t.id, type, description: String(b.description ?? ''), odometerKm: odo ?? null, cost, performedAt, nextDueAt: toIso(b.nextDueAt) ?? null, expenseId, createdById: c.userId, createdAt: nowIso() };
  db.maintenance.push(rec);
  if (type === 'SERVICE') Object.assign(t, { lastServiceAt: performedAt, lastServiceOdometerKm: odo ?? t.odometerKm });
  if (type === 'INSPECTION' && rec.nextDueAt) t.nextInspectionDue = rec.nextDueAt;
  if (odo && odo > t.odometerKm) t.odometerKm = odo;
  if (b.setStatus && t.status !== 'IN_USE') t.status = b.setStatus as GTruck['status'];
  t.updatedAt = nowIso();
  appendAudit(c.userId, 'truck.maintenance', 'tow_truck', t.id, b);
  return rec;
});

// ─── Customers ───────────────────────────────────────────────────────

const isCustomer = (u: GUser) => u.roles.includes('customer');
const fleetMembershipsOf = (userId: string) => db.fleetAccounts.flatMap((a) => a.members.filter((m) => m.userId === userId).map((m) => ({ isManager: m.isManager, fleetAccount: { id: a.id, name: a.name } })));
const vehicleRow = (v: GVehicle): VehicleRow => ({ id: v.id, ownerUserId: v.ownerUserId, fleetAccountId: v.fleetAccountId, vehicleClass: v.vehicleClass, registrationNumber: v.registrationNumber, make: v.make, model: v.model, fuelType: v.fuelType, color: v.color, year: v.year, isSample: v.isSample });
export const invoiceRow = (i: GInvoice): InvoiceRow => {
  const { items: _items, currency: _c, subscriptionId: _s, approvedQuoteId: _q, createdAt: _ca, updatedAt: _ua, ...rest } = i;
  void [_items, _c, _s, _q, _ca, _ua];
  const b = i.bookingId ? bookingById(i.bookingId) : undefined;
  return { ...rest, booking: b ? { id: b.id, code: b.code } : null };
};
const paymentRow = (p: GPayment): PaymentRow => ({ id: p.id, invoiceId: p.invoiceId, method: p.method, provider: p.provider, status: p.status, amount: p.amount, providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId, gatewayFee: p.gatewayFee, gatewayTax: p.gatewayTax, receiptNumber: p.receiptNumber, collectedById: p.collectedById, confirmedById: p.confirmedById, failureReason: p.failureReason, isSandbox: p.isSandbox, notes: p.notes, createdAt: p.createdAt, succeededAt: p.succeededAt });
const subscriptionRow = (s: GSubscription): SubscriptionRow => {
  const m = db.memberships.find((x) => x.id === s.membershipId)!;
  const u = userById(s.userId);
  const fa = db.fleetAccounts.find((a) => a.id === s.fleetAccountId);
  const inv = db.invoices.find((i) => i.subscriptionId === s.id);
  return { id: s.id, membershipId: s.membershipId, status: s.status, startsAt: s.startsAt, endsAt: s.endsAt, servicesUsed: s.servicesUsed, planSnapshot: { includedServices: m.includedServices, name: m.name, price: m.price }, cancelledAt: s.cancelledAt, createdAt: s.createdAt, membership: { name: m.name }, user: u ? { fullName: u.fullName, phone: u.phone } : null, fleetAccount: fa ? { name: fa.name } : null, invoice: inv ? { number: inv.number, paymentStatus: inv.paymentStatus } : null };
};

on('GET', '/admin/customers', (c) => {
  requirePerm(c, 'customer:read');
  const q = c.query;
  const rows: CustomerRow[] = db.users
    .filter((u) => isCustomer(u) && !u.deletedAt)
    .filter((u) => (!q.status || u.status === q.status) && (!q.fleetAccountId || fleetMembershipsOf(u.id).some((m) => m.fleetAccount.id === q.fleetAccountId)))
    .filter((u) => !q.q || matchesText(str(q.q), u.fullName, u.phone, u.email, ...db.vehicles.filter((v) => v.ownerUserId === u.id).map((v) => v.registrationNumber)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((u) => ({ id: u.id, fullName: u.fullName, phone: u.phone, email: u.email, status: u.status, createdAt: u.createdAt, isSample: u.isSample, _count: { bookings: db.bookings.filter((b) => b.customerUserId === u.id).length, vehicles: db.vehicles.filter((v) => v.ownerUserId === u.id && !v.deletedAt).length }, fleetMemberships: fleetMembershipsOf(u.id).map((m) => ({ fleetAccount: m.fleetAccount })) }));
  return paged(rows, q);
});

on('GET', '/admin/customers/:id', (c) => {
  requirePerm(c, 'customer:read');
  const u = userById(c.params.id);
  if (!u || !isCustomer(u)) notFound('Customer');
  const finance = canDo(c, 'finance:read');
  const invs = db.invoices.filter((i) => i.customerUserId === u!.id);
  return {
    id: u!.id,
    fullName: u!.fullName,
    phone: u!.phone,
    email: u!.email,
    status: u!.status,
    createdAt: u!.createdAt,
    lastLoginAt: u!.lastLoginAt,
    isSample: u!.isSample,
    customerProfile: u!.customerProfile,
    vehicles: db.vehicles.filter((v) => v.ownerUserId === u!.id && !v.deletedAt).map(vehicleRow),
    savedAddresses: db.savedAddresses.filter((a) => a.userId === u!.id),
    emergencyContacts: db.emergencyContacts.filter((e) => e.userId === u!.id),
    bookings: db.bookings
      .filter((b) => b.customerUserId === u!.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map((b) => {
        const inv = invs.find((i) => i.bookingId === b.id && i.type !== 'MEMBERSHIP');
        return { id: b.id, code: b.code, status: b.status, createdAt: b.createdAt, serviceCategory: { name: db.categories.find((x) => x.id === b.serviceCategoryId)!.name }, invoice: inv ? { total: inv.total, paymentStatus: inv.paymentStatus } : null };
      }),
    tickets: db.tickets.filter((t) => t.userId === u!.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => ({ id: t.id, number: t.number, category: t.category, status: t.status, subject: t.subject, createdAt: t.createdAt })),
    subscriptions: db.subscriptions.filter((s) => s.userId === u!.id).map(subscriptionRow),
    fleetMemberships: fleetMembershipsOf(u!.id),
    invoices: finance ? invs.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).slice(0, 50).map(invoiceRow) : null,
    payments: finance ? db.payments.filter((p) => invs.some((i) => i.id === p.invoiceId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map(paymentRow) : null,
    communicationHistory: db.notifications.filter((n) => n.userId === u!.id).slice(0, 50).map((n) => ({ id: n.id, channel: n.channel, type: n.type, title: n.title, status: 'SENT', createdAt: n.createdAt })),
  };
});

on('POST', '/admin/customers/:id/status', (c) => {
  requirePerm(c, 'customer:manage');
  const u = userById(c.params.id);
  if (!u || !isCustomer(u)) notFound('Customer');
  if (u!.roles.some((r) => r !== 'customer')) fail(403, 'FORBIDDEN', 'Use employee management for staff accounts');
  const status = String(c.body.status) as GUser['status'];
  const before = u!.status;
  u!.status = status;
  appendAudit(c.userId, `customer.status.${status.toLowerCase()}`, 'user', u!.id, c.body, { status: before });
  return { status };
});

on('POST', '/admin/customers/:id/anonymize', (c) => {
  requirePerm(c, 'customer:manage');
  const u = userById(c.params.id);
  if (!u || !isCustomer(u)) notFound('Customer');
  if (u!.roles.some((r) => r !== 'customer')) fail(403, 'FORBIDDEN', 'Staff accounts must be offboarded through employee management');
  if (db.bookings.some((b) => b.customerUserId === u!.id && !TERMINAL_STATUSES.includes(b.status))) fail(409, 'CONFLICT', 'The customer has an active booking. Complete or cancel it first.');
  for (const b of db.bookings.filter((x) => x.customerUserId === u!.id)) {
    b.contactName = 'Erased customer';
    b.contactPhone = '';
    b.instructions = null;
    b.shareLinks = [];
    for (const l of b.locations) Object.assign(l, { address: null, landmark: null, accessNotes: null, gateNumber: null, floor: null, parkingLevel: null, lat: Math.round(l.lat * 100) / 100, lng: Math.round(l.lng * 100) / 100 });
  }
  const drop = <T extends { userId: string }>(xs: T[]) => xs.splice(0, xs.length, ...xs.filter((x) => x.userId !== u!.id));
  drop(db.savedAddresses);
  drop(db.emergencyContacts);
  drop(db.notifications);
  for (const v of db.vehicles.filter((x) => x.ownerUserId === u!.id)) Object.assign(v, { photoUrls: [], deletedAt: nowIso() });
  if (u!.customerProfile) Object.assign(u!.customerProfile, { marketingConsent: false, locationConsent: false, notifySms: false, notifyEmail: false, notifyPush: false });
  Object.assign(u!, { fullName: 'Erased customer', phone: null, email: null, photoUrl: null, status: 'DEACTIVATED', deletedAt: nowIso() });
  const ticketId = str(c.body.ticketId);
  if (ticketId) {
    const t = db.tickets.find((x) => x.id === ticketId && x.userId === u!.id && x.category === 'PRIVACY_REQUEST');
    if (t) Object.assign(t, { status: 'RESOLVED', resolution: `Personal data erased. ${String(c.body.reason ?? '')}`, resolvedAt: nowIso() });
  }
  appendAudit(c.userId, 'customer.anonymized', 'user', u!.id, { reason: c.body.reason, ticketId });
  return { anonymized: true, retained: 'Invoices, payments and their billing snapshots are retained as required by tax law.' };
});

// ─── Business (fleet) accounts ───────────────────────────────────────

const contractView = (a: GFleetAccount, k: GFleetAccount['contracts'][number]): FleetContract => ({ id: k.id, fleetAccountId: a.id, name: k.name, startsAt: k.startsAt, endsAt: k.endsAt, active: k.active, discountBps: k.discountBps, slaResponseMinutes: k.slaResponseMinutes, monthlyServiceLimit: k.monthlyServiceLimit, notes: k.notes, rateCards: [] });
const accountOr404 = (id: string) => db.fleetAccounts.find((a) => a.id === id) ?? notFound('Business account');
const accountBase = (a: GFleetAccount) => ({ id: a.id, name: a.name, gstin: a.gstin, billingEmail: a.billingEmail, billingPhone: a.billingPhone, billingAddress: a.billingAddress, creditLimit: a.creditLimit, paymentTermsDays: a.paymentTermsDays, status: (a.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE') as 'ACTIVE' | 'SUSPENDED', isSample: a.isSample, createdAt: a.createdAt });

function applyAccountInput(a: GFleetAccount, b: Record<string, unknown>) {
  if (b.name !== undefined) a.name = String(b.name).trim();
  if (b.gstin !== undefined) a.gstin = str(b.gstin)?.toUpperCase() ?? null;
  if (b.billingEmail !== undefined) a.billingEmail = String(b.billingEmail);
  if (b.billingPhone !== undefined) a.billingPhone = str(b.billingPhone) ? `+91${String(b.billingPhone).replace(/\D/g, '').slice(-10)}` : null;
  if (b.billingAddress !== undefined) a.billingAddress = str(b.billingAddress) ?? null;
  if (b.creditLimit !== undefined) a.creditLimit = rupees(b.creditLimit) ?? 0;
  if (b.paymentTermsDays !== undefined) a.paymentTermsDays = Number(b.paymentTermsDays);
  if (b.status) a.status = b.status as GFleetAccount['status'];
  a.updatedAt = nowIso();
}

on('GET', '/admin/fleet-accounts', (c) => {
  requirePerm(c, 'customer:read');
  const rows: FleetAccountRow[] = db.fleetAccounts
    .filter((a) => matchesText(str(c.query.q), a.name))
    .sort((x, y) => x.name.localeCompare(y.name))
    .map((a) => ({
      ...accountBase(a),
      _count: { members: a.members.length, vehicles: db.vehicles.filter((v) => v.fleetAccountId === a.id && !v.deletedAt).length, bookings: db.bookings.filter((b) => b.fleetAccountId === a.id).length },
      contracts: a.contracts.filter((k) => k.active).map((k) => contractView(a, k)),
      outstanding: db.invoices.filter((i) => i.fleetAccountId === a.id && i.status === 'ISSUED').reduce((s, i) => s + i.outstanding, 0),
    }));
  return paged(rows, c.query);
});

on('POST', '/admin/fleet-accounts', (c) => {
  requirePerm(c, 'customer:manage');
  if (String(c.body.name ?? '').trim().length < 2) validation('name', 'Enter the business name');
  if (!str(c.body.billingEmail)) validation('billingEmail', 'Enter a billing email');
  const now = nowIso();
  const a: GFleetAccount = { id: newId('fa'), name: '', gstin: null, billingEmail: '', billingPhone: null, billingAddress: null, creditLimit: 0, paymentTermsDays: 30, status: 'ACTIVE', isSample: false, createdAt: now, updatedAt: now, members: [], contracts: [] };
  applyAccountInput(a, c.body);
  db.fleetAccounts.push(a);
  appendAudit(c.userId, 'fleet_account.created', 'fleet_account', a.id, c.body);
  return accountBase(a);
});

on('GET', '/admin/fleet-accounts/contracts', (c) => {
  requirePerm(c, 'customer:read', 'pricing:read');
  return db.fleetAccounts
    .flatMap((a) => a.contracts.map((k) => ({ ...contractView(a, k), createdAt: k.createdAt, updatedAt: k.updatedAt, fleetAccount: { id: a.id, name: a.name } })))
    .sort((x, y) => Number(y.active) - Number(x.active) || y.startsAt.localeCompare(x.startsAt));
});

on('GET', '/admin/fleet-accounts/:id', (c) => {
  requirePerm(c, 'customer:read');
  const a = accountOr404(c.params.id!);
  const invs = db.invoices.filter((i) => i.fleetAccountId === a.id).sort((x, y) => y.issuedAt.localeCompare(x.issuedAt)).slice(0, 100);
  const ageing = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const i of invs)
    if (i.status === 'ISSUED' && i.outstanding > 0) {
      const days = Math.floor((Date.now() - new Date(i.dueAt ?? i.issuedAt).getTime()) / DAY);
      const k = days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      ageing[k] += i.outstanding;
    }
  const ist = new Date(Date.now() + 5.5 * 3_600_000);
  const monthStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3_600_000;
  const detail: FleetAccountDetail = {
    ...accountBase(a),
    members: a.members.map((m) => {
      const u = userById(m.userId);
      return { fleetAccountId: a.id, userId: m.userId, isManager: m.isManager, createdAt: m.createdAt, user: { id: m.userId, fullName: u?.fullName ?? 'Unknown', phone: u?.phone ?? null } };
    }),
    contracts: [...a.contracts].sort((x, y) => y.startsAt.localeCompare(x.startsAt)).map((k) => contractView(a, k)),
    vehicles: db.vehicles.filter((v) => v.fleetAccountId === a.id && !v.deletedAt).map(vehicleRow),
    subscriptions: db.subscriptions.filter((s) => s.fleetAccountId === a.id).map(subscriptionRow),
    invoices: invs.map(invoiceRow),
    ageing,
    usageThisMonth: db.bookings.filter((b) => b.fleetAccountId === a.id && new Date(b.createdAt).getTime() >= monthStart && !['CANCELLED', 'REQUESTED', 'QUOTED'].includes(b.status)).length,
  };
  return detail;
});

on('PATCH', '/admin/fleet-accounts/:id', (c) => {
  requirePerm(c, 'customer:manage');
  const a = accountOr404(c.params.id!);
  const before = accountBase(a);
  if (c.body.status && c.body.status !== a.status && !str(c.body.reason)) fail(400, 'BAD_REQUEST', 'A reason is required to change the account status');
  const { reason: _r, ...rest } = c.body;
  void _r;
  applyAccountInput(a, rest);
  appendAudit(c.userId, c.body.status && c.body.status !== before.status ? `fleet_account.${String(c.body.status).toLowerCase()}` : 'fleet_account.updated', 'fleet_account', a.id, c.body, before);
  return accountBase(a);
});

on('POST', '/admin/fleet-accounts/:id/members', (c) => {
  requirePerm(c, 'customer:manage');
  const a = accountOr404(c.params.id!);
  const phone = `+91${String(c.body.phone ?? '').replace(/\D/g, '').slice(-10)}`;
  const u = db.users.find((x) => x.phone === phone) ?? notFound('No customer account with this phone. Ask them to sign up first.');
  const isManager = !!c.body.isManager;
  const m = a.members.find((x) => x.userId === u.id);
  if (m) m.isManager = isManager;
  else a.members.push({ userId: u.id, isManager, createdAt: nowIso() });
  appendAudit(c.userId, 'fleet_account.member', 'fleet_account', a.id, { userId: u.id, isManager });
  return { fleetAccountId: a.id, userId: u.id, isManager, createdAt: nowIso() };
});

on('DELETE', '/admin/fleet-accounts/:id/members/:userId', (c) => {
  requirePerm(c, 'customer:manage');
  const a = accountOr404(c.params.id!);
  if (!a.members.some((m) => m.userId === c.params.userId)) notFound('Member');
  a.members = a.members.filter((m) => m.userId !== c.params.userId);
  appendAudit(c.userId, 'fleet_account.member_removed', 'fleet_account', a.id, { userId: c.params.userId });
  return { removed: true };
});

on('DELETE', '/admin/fleet-accounts/:id/vehicles/:vehicleId', (c) => {
  requirePerm(c, 'customer:manage');
  const v = db.vehicles.find((x) => x.id === c.params.vehicleId && x.fleetAccountId === c.params.id) ?? notFound('Vehicle');
  v.fleetAccountId = null;
  appendAudit(c.userId, 'fleet_account.vehicle_detached', 'fleet_account', c.params.id!, { vehicleId: v.id });
  return { detached: true };
});

on('POST', '/admin/fleet-accounts/:id/vehicles', (c) => {
  requirePerm(c, 'customer:manage');
  const a = accountOr404(c.params.id!);
  const v = db.vehicles.find((x) => x.id === c.body.vehicleId) ?? notFound('Vehicle');
  if (!a.members.some((m) => m.userId === v.ownerUserId)) fail(409, 'CONFLICT', 'The vehicle owner must be a member of this business account');
  v.fleetAccountId = a.id;
  v.updatedAt = nowIso();
  appendAudit(c.userId, 'fleet_account.vehicle_attached', 'fleet_account', a.id, { vehicleId: v.id });
  return vehicleRow(v);
});

function contractInput(k: GFleetAccount['contracts'][number], b: Record<string, unknown>) {
  if (b.name !== undefined) k.name = String(b.name).trim();
  if (b.startsAt !== undefined) k.startsAt = toIso(b.startsAt)!;
  if (b.endsAt !== undefined) k.endsAt = toIso(b.endsAt)!;
  if (b.discountPct !== undefined && b.discountPct !== null && b.discountPct !== '') k.discountBps = Math.round(Number(b.discountPct) * 100);
  if (b.slaResponseMinutes !== undefined) k.slaResponseMinutes = num(b.slaResponseMinutes) ?? null;
  if (b.monthlyServiceLimit !== undefined) k.monthlyServiceLimit = num(b.monthlyServiceLimit) ?? null;
  if (b.notes !== undefined) k.notes = str(b.notes) ?? null;
  if (b.active !== undefined) k.active = !!b.active;
  if (new Date(k.endsAt) <= new Date(k.startsAt)) fail(409, 'CONFLICT', 'Contract end must be after start');
  k.updatedAt = nowIso();
}

on('POST', '/admin/fleet-accounts/:id/contracts', (c) => {
  requirePerm(c, 'membership:manage');
  const a = accountOr404(c.params.id!);
  const now = nowIso();
  const k = { id: newId('fc'), name: '', startsAt: now, endsAt: new Date(Date.now() + 365 * DAY).toISOString(), active: true, discountBps: 0, slaResponseMinutes: null, monthlyServiceLimit: null, notes: null, createdAt: now, updatedAt: now };
  contractInput(k, c.body);
  a.contracts.push(k);
  appendAudit(c.userId, 'fleet_contract.created', 'fleet_contract', k.id, k);
  return contractView(a, k);
});

on('PATCH', '/admin/fleet-accounts/:id/contracts/:contractId', (c) => {
  requirePerm(c, 'membership:manage');
  const a = accountOr404(c.params.id!);
  const k = a.contracts.find((x) => x.id === c.params.contractId) ?? notFound('Contract');
  const before = contractView(a, k);
  contractInput(k, c.body);
  appendAudit(c.userId, 'fleet_contract.updated', 'fleet_contract', k.id, contractView(a, k), before);
  return contractView(a, k);
});

export { setAvailability };
