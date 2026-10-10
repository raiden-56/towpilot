import { prisma } from '../../lib/prisma.js';
import { getSettings } from '../../lib/settings.js';
import { performanceScore } from '../../domain/performance.js';

/** Builds the fair-performance inputs for a worker over the last N days from real records. */
export async function workerPerformance(userId: string, days = 90) {
  const s = await getSettings();
  const since = new Date(Date.now() - days * 86_400_000);
  const [assignments, teamJobs, ratings, complaints, incidents] = await Promise.all([
    prisma.bookingAssignment.findMany({ where: { driverUserId: userId, offeredAt: { gte: since } }, select: { status: true, bookingId: true, etaMinutes: true, respondedAt: true } }),
    prisma.bookingTeamMember.findMany({
      where: { userId, createdAt: { gte: since } },
      select: {
        booking: {
          select: {
            id: true,
            status: true,
            etaAt: true,
            arrivedAt: true,
            requiresManualReview: true,
            safetyFlags: true,
            serviceCategory: { select: { kind: true } },
            conditionReports: { select: { stage: true } },
            custody: { select: { stage: true } },
          },
        },
      },
    }),
    prisma.rating.aggregate({ where: { rateeUserId: userId, createdAt: { gte: since } }, _avg: { score: true }, _count: true }),
    prisma.supportTicket.count({ where: { category: 'COMPLAINT', verified: true, createdAt: { gte: since }, OR: [{ subjectUserId: userId }, { booking: { teamMembers: { some: { userId, role: 'TEAM_LEADER' } } } }] } }),
    prisma.incident.count({ where: { reportedById: userId, createdAt: { gte: since } } }),
  ]);

  const jobs = teamJobs.map((t) => t.booking);
  const completed = jobs.filter((b) => b.status === 'COMPLETED' || b.status === 'DELIVERED');
  const arrivals = jobs.filter((b) => b.arrivedAt && b.etaAt);
  // On time = arrived no later than ETA + configured grace.
  const grace = s.dispatch.missedEtaGraceMinutes * 60_000;
  const onTime = arrivals.filter((b) => b.arrivedAt!.getTime() <= b.etaAt!.getTime() + grace);
  const checklistComplete = completed.filter((b) => {
    const stages = new Set(b.conditionReports.map((r) => r.stage));
    const custody = new Set(b.custody.map((c) => c.stage));
    const evidence = b.serviceCategory.kind === 'TOWING' ? stages.has('PICKUP') && stages.has('DELIVERY') : true;
    return evidence && custody.has('HANDOVER');
  });

  const inputs = {
    assignmentsOffered: assignments.length,
    accepted: assignments.filter((a) => ['ACCEPTED', 'COMPLETED', 'RELEASED', 'CANCELLED'].includes(a.status)).length,
    completed: completed.length,
    cancelledByWorker: assignments.filter((a) => a.status === 'RELEASED').length,
    arrivals: arrivals.length,
    onTimeArrivals: onTime.length,
    ratingsAvg: ratings._avg.score,
    ratingsCount: ratings._count,
    verifiedComplaints: complaints,
    safetyIncidentsReported: incidents,
    checklistComplete: checklistComplete.length,
    difficultJobs: completed.filter((b) => b.requiresManualReview || b.safetyFlags.length > 0).length,
  };
  return {
    windowDays: days,
    inputs,
    ...performanceScore(inputs, s.performance.weights),
    weights: s.performance.weights,
    explanation:
      'Score combines punctuality, completion, safety/evidence compliance and verified customer feedback. Difficult jobs add a bonus and never lower your score. Reporting incidents is never penalised. Disagree with a record? Raise a "Performance challenge" ticket.',
  };
}
