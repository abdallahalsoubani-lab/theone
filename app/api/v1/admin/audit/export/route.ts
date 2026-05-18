import { AuditAction } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';
import { AUDIT_CSV_HEADER, auditRowToCsv } from '@/lib/admin/audit/csv';
import { streamAuditLogs, type AuditFilters } from '@/lib/admin/audit/queries';
import { can } from '@/lib/rbac/can';

/**
 * Audit log CSV export endpoint (Prompt 11 §4.6). Streams the filtered
 * set page-by-page so even a 100k+ row export never materializes in
 * memory. The export itself is audited as READ_SENSITIVE with the
 * filter parameters + row count captured in the `after` snapshot.
 */

const recordExport = withAudit<
  [{ filters: AuditFilters; rowCount: number }],
  { event: 'AUDIT_LOG_EXPORTED'; filters: Record<string, unknown>; rowCount: number }
>(
  {
    entityType: 'AuditLog',
    action: AuditAction.READ_SENSITIVE,
    extractEntityId: () => 'export',
    extractAfter: (result) => result,
  },
  async ({ filters, rowCount }) => ({
    event: 'AUDIT_LOG_EXPORTED' as const,
    filters: serializeFilters(filters),
    rowCount,
  }),
);

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user || !can(session.user, 'audit_log.read')) {
    return new Response('Forbidden', { status: 403 });
  }
  const url = new URL(request.url);
  const filters: AuditFilters = {
    from: url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : undefined,
    to: url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : undefined,
    actorQuery: url.searchParams.get('actor') ?? undefined,
    entityType: url.searchParams.get('entityType') ?? undefined,
    actions: parseActions(url.searchParams.getAll('action')),
  };

  let rowCount = 0;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(`${AUDIT_CSV_HEADER}\n`));
      for await (const row of streamAuditLogs(filters)) {
        rowCount++;
        controller.enqueue(enc.encode(`${auditRowToCsv(row)}\n`));
      }
      controller.close();
      // Audit AFTER the stream finishes so the row count is accurate.
      await recordExport({ filters, rowCount }).catch((err: unknown) => {
        console.error('[audit.export] audit write failed', err);
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

function parseActions(raw: string[]): AuditAction[] | undefined {
  const known = new Set<string>([
    AuditAction.CREATE,
    AuditAction.UPDATE,
    AuditAction.DELETE,
    AuditAction.READ_SENSITIVE,
  ]);
  const out = raw.filter((a) => known.has(a)) as AuditAction[];
  return out.length > 0 ? out : undefined;
}

function serializeFilters(f: AuditFilters): Record<string, unknown> {
  return {
    from: f.from?.toISOString(),
    to: f.to?.toISOString(),
    actorQuery: f.actorQuery,
    entityType: f.entityType,
    actions: f.actions,
  };
}

// Keep tree-shaker honest — referenced for side effect docs only.
void db;
