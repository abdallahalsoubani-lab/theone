import { AuditAction, PediatricCustomFieldType, Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';

import { PedAssessmentError, PED_ERRORS } from '../errors';
import type { CustomFieldCreateParsed, CustomFieldUpdateParsed } from './schemas';

export function pedToLocalized(err: unknown): LocalizedError {
  if (err instanceof PedAssessmentError) return err.error;
  return toLocalizedError(err);
}

const SELECT_TYPES: PediatricCustomFieldType[] = [
  PediatricCustomFieldType.SINGLE_SELECT,
  PediatricCustomFieldType.MULTI_SELECT,
];

export const createCustomField = withAudit<[CustomFieldCreateParsed], { id: string }>(
  {
    entityType: 'PediatricCustomField',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.id,
    extractAfter: (result) => ({ event: 'PED_CUSTOM_FIELD_CREATED', id: result.id }),
  },
  async function createInner(input): Promise<{ id: string }> {
    const session = await auth();
    if (!session?.user?.id) throw new PedAssessmentError(PED_ERRORS.UNAUTHENTICATED);

    // Append to the end if no explicit order given.
    const max = await db.pediatricCustomField.aggregate({ _max: { order: true } });
    const order = input.order ?? (max._max.order ?? 0) + 1;

    const row = await db.pediatricCustomField.create({
      data: {
        labelEn: input.labelEn,
        labelAr: input.labelAr,
        type: input.type,
        section: input.section ?? null,
        order,
        options: SELECT_TYPES.includes(input.type)
          ? (input.options as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        createdById: session.user.id,
      },
      select: { id: true },
    });
    return row;
  },
);

export const updateCustomField = withAudit<[CustomFieldUpdateParsed], { id: string }>(
  {
    entityType: 'PediatricCustomField',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: () => ({ event: 'PED_CUSTOM_FIELD_UPDATED' }),
  },
  async function updateInner(input): Promise<{ id: string }> {
    const existing = await db.pediatricCustomField.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing) throw new PedAssessmentError(PED_ERRORS.FIELD_NOT_FOUND);

    await db.pediatricCustomField.update({
      where: { id: input.id },
      data: {
        labelEn: input.labelEn,
        labelAr: input.labelAr,
        type: input.type,
        section: input.section ?? null,
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        options: SELECT_TYPES.includes(input.type)
          ? (input.options as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
    return { id: input.id };
  },
);

/** Soft-delete (active=false) — never hard-delete, so stored values still render. */
export const deactivateCustomField = withAudit<[{ id: string }], { id: string }>(
  {
    entityType: 'PediatricCustomField',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: () => ({ event: 'PED_CUSTOM_FIELD_DEACTIVATED' }),
  },
  async function deactivateInner({ id }): Promise<{ id: string }> {
    const existing = await db.pediatricCustomField.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new PedAssessmentError(PED_ERRORS.FIELD_NOT_FOUND);
    await db.pediatricCustomField.update({ where: { id }, data: { active: false } });
    return { id };
  },
);
