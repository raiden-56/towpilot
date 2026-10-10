import os from 'node:os';
import { Prisma, prisma, type Db } from '../lib/prisma.js';
import { logger, reportError } from '../lib/logger.js';

/**
 * Durable background job queue on PostgreSQL (FOR UPDATE SKIP LOCKED). Works across multiple
 * API instances without Redis. Jobs are retried with exponential backoff and moved to DEAD after
 * maxAttempts so they can be inspected.
 */
type Handler = (payload: any) => Promise<void>;
const handlers = new Map<string, Handler>();
const workerId = `${os.hostname()}:${process.pid}`;

export function registerJob<T>(type: string, handler: (payload: T) => Promise<void>) {
  handlers.set(type, handler as Handler);
}

export async function enqueue(db: Db, type: string, payload: object, opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {}) {
  if (opts.dedupeKey) {
    // Idempotent enqueue: silently ignore duplicates.
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "background_jobs" ("id","type","payload","status","runAt","attempts","maxAttempts","dedupeKey","createdAt")
      VALUES (${`job_${crypto.randomUUID()}`}, ${type}, ${JSON.stringify(payload)}::jsonb, 'PENDING', ${opts.runAt ?? new Date()}, 0, ${opts.maxAttempts ?? 5}, ${opts.dedupeKey}, now())
      ON CONFLICT ("dedupeKey") DO NOTHING`);
    return;
  }
  await db.backgroundJob.create({ data: { type, payload: payload as Prisma.InputJsonValue, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 } });
}

interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

async function claim(limit: number): Promise<ClaimedJob[]> {
  return prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
    UPDATE "background_jobs" SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "background_jobs"
      WHERE "status" = 'PENDING' AND "runAt" <= now()
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "type", "payload", "attempts", "maxAttempts"`);
}

async function runJob(job: ClaimedJob) {
  const h = handlers.get(job.type);
  try {
    if (!h) throw new Error(`No handler for job type ${job.type}`);
    await h(job.payload);
    await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: 'DONE', completedAt: new Date(), lockedAt: null, lastError: null } });
  } catch (err) {
    const dead = job.attempts >= job.maxAttempts;
    const backoffSec = Math.min(600, 2 ** job.attempts * 5);
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: dead ? 'DEAD' : 'PENDING', lastError: String((err as Error).message ?? err).slice(0, 2000), lockedAt: null, runAt: new Date(Date.now() + backoffSec * 1000) },
    });
    if (dead) reportError(err, { jobId: job.id, type: job.type });
    else logger.warn({ jobId: job.id, type: job.type, err: (err as Error).message }, 'job failed; will retry');
  }
}

let timer: NodeJS.Timeout | null = null;
let busy = false;
const recurring: NodeJS.Timeout[] = [];

export async function drainOnce(limit = 20) {
  if (busy) return 0;
  busy = true;
  try {
    const jobs = await claim(limit);
    for (const j of jobs) await runJob(j);
    return jobs.length;
  } finally {
    busy = false;
  }
}

/** Run a periodic task on exactly one instance at a time (PostgreSQL advisory lock). */
export function every(name: string, ms: number, fn: () => Promise<void>) {
  const lockId = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  const tick = async () => {
    try {
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ locked: boolean }[]>(Prisma.sql`SELECT pg_try_advisory_xact_lock(${lockId}) AS locked`);
        if (rows[0]?.locked) await fn();
      }, { timeout: Math.max(30_000, ms) });
    } catch (err) {
      logger.warn({ task: name, err: (err as Error).message }, 'recurring task failed');
    }
  };
  recurring.push(setInterval(tick, ms));
}

export function startWorker(pollMs = 1000) {
  // Recover jobs left RUNNING by a crashed instance.
  void prisma.backgroundJob.updateMany({ where: { status: 'RUNNING', lockedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, data: { status: 'PENDING', lockedAt: null } });
  timer = setInterval(() => void drainOnce().catch((e) => reportError(e)), pollMs);
  logger.info({ workerId }, 'Background worker started');
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  recurring.forEach(clearInterval);
  recurring.length = 0;
}
