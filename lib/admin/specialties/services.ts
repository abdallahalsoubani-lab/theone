import { AuditAction, Prisma } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';

import type { SpecialtyCreateInput, SpecialtyUpdateInput } from './schemas';

export class SpecialtyAdminError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'SpecialtyAdminError';
  }
}

const duplicateName: LocalizedError = {
  code: 'SPECIALTY_DUPLICATE',
  message_en: 'A specialty with this name already exists.',
  message_ar: 'يوجد تخصص بهذا الاسم.',
};

const inUse = (count: number): LocalizedError => ({
  code: 'SPECIALTY_IN_USE',
  message_en: `Cannot delete: ${count} user(s) assigned. Deactivate instead.`,
  message_ar: `لا يمكن الحذف: ${count} مستخدم(ون) مرتبطون. يمكن التعطيل بدلاً من ذلك.`,
  details: { count },
});

function handlePrismaConstraint(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new SpecialtyAdminError(duplicateName);
  }
  throw err;
}

export const createSpecialty = withAudit<[SpecialtyCreateInput], { id: string }>(
  {
    entityType: 'Specialty',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.id,
    extractAfter: (result) => result,
  },
  async function createSpecialtyInner(input): Promise<{ id: string }> {
    try {
      const row = await db.specialty.create({
        data: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          description: input.description ?? null,
          active: input.active,
        },
      });
      return { id: row.id };
    } catch (err) {
      handlePrismaConstraint(err);
    }
  },
);

export const updateSpecialty = withAudit<[SpecialtyUpdateInput], { id: string }>(
  {
    entityType: 'Specialty',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) => db.specialty.findUnique({ where: { id: args[0].id } }),
    extractAfter: (result) => result,
  },
  async function updateSpecialtyInner(input): Promise<{ id: string }> {
    try {
      await db.specialty.update({
        where: { id: input.id },
        data: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          description: input.description ?? null,
          active: input.active,
        },
      });
      return { id: input.id };
    } catch (err) {
      handlePrismaConstraint(err);
    }
  },
);

export const deactivateSpecialty = withAudit<[string], { id: string }>(
  {
    entityType: 'Specialty',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: () => ({ event: 'SPECIALTY_DEACTIVATED' }),
  },
  async function deactivateSpecialtyInner(id): Promise<{ id: string }> {
    await db.specialty.update({ where: { id }, data: { active: false } });
    return { id };
  },
);

export const deleteSpecialty = withAudit<[string], { id: string }>(
  {
    entityType: 'Specialty',
    action: AuditAction.DELETE,
    extractEntityId: (args) => args[0],
    extractBefore: async (args) => db.specialty.findUnique({ where: { id: args[0] } }),
    extractAfter: () => ({ event: 'SPECIALTY_DELETED' }),
  },
  async function deleteSpecialtyInner(id): Promise<{ id: string }> {
    // Refuse if any UserSpecialty rows reference this specialty.
    const count = await db.userSpecialty.count({ where: { specialtyId: id } });
    if (count > 0) throw new SpecialtyAdminError(inUse(count));
    await db.specialty.delete({ where: { id } });
    return { id };
  },
);

export function specialtyToLocalized(err: unknown): LocalizedError {
  if (err instanceof SpecialtyAdminError) return err.error;
  return toLocalizedError(err);
}
