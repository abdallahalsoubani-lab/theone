import type { AuditRow } from './queries';

/**
 * Serialize an AuditRow to a single CSV line. Escapes per RFC 4180:
 * a field containing commas, quotes, or newlines is wrapped in double
 * quotes; inner quotes are doubled.
 */
export function auditRowToCsv(row: AuditRow): string {
  return [
    row.createdAt.toISOString(),
    row.actorFullNameEn,
    row.impersonatedFullNameEn ?? '',
    row.entityType,
    row.entityId,
    row.action,
    row.beforeJson ?? '',
    row.afterJson ?? '',
  ]
    .map(csvField)
    .join(',');
}

export const AUDIT_CSV_HEADER =
  'createdAt,actor,impersonatedAs,entityType,entityId,action,before,after';

function csvField(v: string): string {
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
