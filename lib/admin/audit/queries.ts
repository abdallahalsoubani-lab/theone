import type { AuditAction, Prisma } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * Admin Audit Log viewer queries (Prompt 11 §4.6).
 *
 * Server-side paginated — audit logs grow fast (a six-month clinic can
 * easily produce 100k+ rows). The query never returns more than
 * `pageSize` rows; CSV export streams via cursors.
 */

export interface AuditRow {
  id: string;
  createdAt: Date;
  actorId: string;
  actorFullNameEn: string;
  actorFullNameAr: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  beforeJson: string | null;
  afterJson: string | null;
}

export interface AuditFilters {
  from?: Date;
  to?: Date;
  actorQuery?: string;
  entityType?: string;
  actions?: AuditAction[];
}

export interface PaginationInput {
  page: number;
  pageSize: number;
}

function buildWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  return {
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.actions && filters.actions.length > 0 ? { action: { in: filters.actions } } : {}),
    ...(filters.actorQuery
      ? {
          actor: {
            OR: [
              { fullNameEn: { contains: filters.actorQuery, mode: 'insensitive' } },
              { fullNameAr: { contains: filters.actorQuery, mode: 'insensitive' } },
              { email: { contains: filters.actorQuery, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
  };
}

export async function listAuditLogs(
  filters: AuditFilters,
  pagination: PaginationInput,
): Promise<{ rows: AuditRow[]; total: number }> {
  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { actor: { select: { fullNameEn: true, fullNameAr: true } } },
      orderBy: { createdAt: 'desc' },
      take: pagination.pageSize,
      skip: (pagination.page - 1) * pagination.pageSize,
    }),
    db.auditLog.count({ where }),
  ]);
  return {
    rows: rows.map(toRow),
    total,
  };
}

/**
 * Async-generator stream for CSV export. Buffers a single page at a
 * time so even a 100k-row export never holds the full set in memory.
 */
export async function* streamAuditLogs(
  filters: AuditFilters,
  pageSize = 500,
): AsyncGenerator<AuditRow> {
  const where = buildWhere(filters);
  let cursor: string | undefined;
  while (true) {
    const batch = await db.auditLog.findMany({
      where,
      include: { actor: { select: { fullNameEn: true, fullNameAr: true } } },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) return;
    for (const r of batch) yield toRow(r);
    if (batch.length < pageSize) return;
    cursor = batch[batch.length - 1]!.id;
  }
}

function toRow(r: {
  id: string;
  createdAt: Date;
  actorId: string;
  actor: { fullNameEn: string; fullNameAr: string };
  entityType: string;
  entityId: string;
  action: AuditAction;
  before: unknown;
  after: unknown;
}): AuditRow {
  return {
    id: r.id,
    createdAt: r.createdAt,
    actorId: r.actorId,
    actorFullNameEn: r.actor.fullNameEn,
    actorFullNameAr: r.actor.fullNameAr,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    beforeJson: r.before ? JSON.stringify(r.before) : null,
    afterJson: r.after ? JSON.stringify(r.after) : null,
  };
}
