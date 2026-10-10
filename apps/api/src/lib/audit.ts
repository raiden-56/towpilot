import type { Request } from 'express';
import { prisma, type Db } from './prisma.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

function toJson(v: unknown) {
  return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as object);
}

/** Record an administrative or financial change. Call inside the same transaction as the change. */
export async function audit(db: Db, req: Request | null, entry: AuditEntry & { actorUserId?: string | null }) {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? req?.auth?.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
      ip: req?.ip ?? null,
      requestId: (req?.id as string | undefined) ?? null,
    },
  });
}

export const auditDefault = (req: Request | null, entry: AuditEntry) => audit(prisma, req, entry);
