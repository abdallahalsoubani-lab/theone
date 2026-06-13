import { type PediatricCustomFieldType } from '@prisma/client';

import { db } from '@/lib/db';

import type { CustomFieldOption } from './schemas';

export interface CustomFieldRow {
  id: string;
  labelEn: string;
  labelAr: string;
  type: PediatricCustomFieldType;
  options: CustomFieldOption[];
  section: string | null;
  order: number;
  active: boolean;
}

function toRow(r: {
  id: string;
  labelEn: string;
  labelAr: string;
  type: PediatricCustomFieldType;
  options: unknown;
  section: string | null;
  order: number;
  active: boolean;
}): CustomFieldRow {
  return {
    id: r.id,
    labelEn: r.labelEn,
    labelAr: r.labelAr,
    type: r.type,
    options: Array.isArray(r.options) ? (r.options as CustomFieldOption[]) : [],
    section: r.section,
    order: r.order,
    active: r.active,
  };
}

const SELECT = {
  id: true,
  labelEn: true,
  labelAr: true,
  type: true,
  options: true,
  section: true,
  order: true,
  active: true,
} as const;

/** All custom fields (for the management surface), ordered. */
export async function listAllCustomFields(): Promise<CustomFieldRow[]> {
  const rows = await db.pediatricCustomField.findMany({
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: SELECT,
  });
  return rows.map(toRow);
}

/** Active custom fields only (for new/edit assessment forms), ordered. */
export async function listActiveCustomFields(): Promise<CustomFieldRow[]> {
  const rows = await db.pediatricCustomField.findMany({
    where: { active: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: SELECT,
  });
  return rows.map(toRow);
}

/**
 * Fields needed to render a stored assessment: active fields PLUS any inactive
 * field that the assessment still has a value for (so deactivated fields keep
 * rendering in read/PDF — Prompt 21 §2).
 */
export async function listFieldsForAssessment(
  customData: Record<string, unknown>,
): Promise<CustomFieldRow[]> {
  const valuedIds = Object.keys(customData ?? {});
  const rows = await db.pediatricCustomField.findMany({
    where: { OR: [{ active: true }, { id: { in: valuedIds } }] },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: SELECT,
  });
  return rows.map(toRow);
}
