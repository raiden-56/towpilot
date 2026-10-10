/**
 * Fair worker performance. Speed is only one component; safety compliance, customer feedback,
 * completion and assignment difficulty are weighted alongside it. Only VERIFIED complaints count,
 * and workers can challenge any record through a PERFORMANCE_CHALLENGE support ticket.
 */
export interface PerformanceInputs {
  assignmentsOffered: number;
  accepted: number;
  completed: number;
  cancelledByWorker: number;
  arrivals: number;
  onTimeArrivals: number;
  ratingsAvg: number | null;
  ratingsCount: number;
  verifiedComplaints: number;
  safetyIncidentsReported: number;
  checklistComplete: number; // jobs with full pickup + delivery evidence
  difficultJobs: number; // jobs that required manual review / heavy recovery
}

export interface PerformanceWeights {
  punctuality: number;
  completion: number;
  safety: number;
  feedback: number;
  difficulty: number;
}

export const MIN_SAMPLE = 5;

export function performanceScore(p: PerformanceInputs, w: PerformanceWeights) {
  const punctuality = p.arrivals ? p.onTimeArrivals / p.arrivals : null;
  const completion = p.accepted ? p.completed / p.accepted : null;
  // Evidence completeness rewards safe, documented work; reporting incidents is never penalised.
  const safety = p.completed ? Math.max(0, p.checklistComplete / p.completed - Math.min(0.5, (p.verifiedComplaints * 0.1))) : null;
  const feedback = p.ratingsAvg != null && p.ratingsCount > 0 ? (p.ratingsAvg - 1) / 4 : null;
  const difficulty = p.completed ? Math.min(1, p.difficultJobs / p.completed) : 0;

  const parts: [number | null, number][] = [
    [punctuality, w.punctuality],
    [completion, w.completion],
    [safety, w.safety],
    [feedback, w.feedback],
  ];
  const known = parts.filter(([v]) => v != null) as [number, number][];
  const weightSum = known.reduce((a, [, wt]) => a + wt, 0);
  const base = weightSum ? known.reduce((a, [v, wt]) => a + v * wt, 0) / weightSum : null;
  // Difficulty is a bonus so that taking hard jobs never lowers a score.
  const score = base == null ? null : Math.min(1, base + difficulty * w.difficulty);

  return {
    score: score == null ? null : Math.round(score * 100),
    sufficientData: p.completed >= MIN_SAMPLE,
    components: {
      punctuality: punctuality == null ? null : Math.round(punctuality * 100),
      completion: completion == null ? null : Math.round(completion * 100),
      safety: safety == null ? null : Math.round(safety * 100),
      feedback: feedback == null ? null : Math.round(feedback * 100),
      difficulty: Math.round(difficulty * 100),
    },
  };
}
