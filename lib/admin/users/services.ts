import { AuditAction, UserRole } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { hashPassword } from '@/lib/auth/password';
import { AUTH_ERRORS } from '@/lib/auth/result';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';

import { generateTempPassword } from '../temp-password';
import { countActiveAdmins } from './queries';
import type { UserCreateInput, UserUpdateInput } from './schemas';

export class UserAdminError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'UserAdminError';
  }
}

const cannotArchiveSelf: LocalizedError = {
  code: 'CANNOT_ARCHIVE_SELF',
  message_en: 'You cannot archive your own account.',
  message_ar: 'لا يمكنك أرشفة حسابك الخاص.',
};

const cannotArchiveLastAdmin: LocalizedError = {
  code: 'CANNOT_ARCHIVE_LAST_ADMIN',
  message_en: 'Cannot archive the last active admin.',
  message_ar: 'لا يمكن أرشفة آخر مسؤول نشط.',
};

const cannotDemoteLastAdmin: LocalizedError = {
  code: 'CANNOT_DEMOTE_LAST_ADMIN',
  message_en: 'Cannot remove the last active admin.',
  message_ar: 'لا يمكن إزالة آخر مسؤول نشط.',
};

const duplicateIdentifier: LocalizedError = {
  code: 'DUPLICATE_IDENTIFIER',
  message_en: 'Email or phone already in use.',
  message_ar: 'البريد الإلكتروني أو الهاتف مستخدم مسبقاً.',
};

interface CreateUserResult {
  userId: string;
  tempPassword: string;
}

export const createUser = withAudit<[UserCreateInput], CreateUserResult>(
  {
    entityType: 'User',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.userId,
    extractAfter: (result) => ({ userId: result.userId, event: 'USER_CREATED' }),
  },
  async function createUserInner(input: UserCreateInput): Promise<CreateUserResult> {
    const email = input.email.toLowerCase();
    const conflict = await db.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email }, { phone: input.phone }],
      },
      select: { id: true },
    });
    if (conflict) throw new UserAdminError(duplicateIdentifier);

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          phone: input.phone,
          role: input.role,
          fullNameEn: input.fullNameEn,
          fullNameAr: input.fullNameAr,
          languagePref: input.languagePref,
          passwordHash,
          mustChangePassword: input.mustChangePassword,
        },
      });
      if (input.specialtyIds.length > 0) {
        await tx.userSpecialty.createMany({
          data: input.specialtyIds.map((specialtyId) => ({
            userId: created.id,
            specialtyId,
          })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    return { userId: user.id, tempPassword };
  },
);

export const updateUser = withAudit<[UserUpdateInput], { userId: string }>(
  {
    entityType: 'User',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) => {
      const u = await db.user.findUnique({
        where: { id: args[0].id },
        select: { role: true, fullNameEn: true, fullNameAr: true, email: true, phone: true },
      });
      return u;
    },
    extractAfter: (result) => result,
  },
  async function updateUserInner(input: UserUpdateInput): Promise<{ userId: string }> {
    const existing = await db.user.findUnique({
      where: { id: input.id },
      select: { role: true, deletedAt: true },
    });
    if (!existing) throw new UserAdminError(AUTH_ERRORS.UNAUTHENTICATED);

    if (existing.role === UserRole.ADMIN && input.role !== UserRole.ADMIN) {
      const activeAdmins = await countActiveAdmins();
      if (activeAdmins <= 1) throw new UserAdminError(cannotDemoteLastAdmin);
    }

    const email = input.email.toLowerCase();
    const conflict = await db.user.findFirst({
      where: {
        id: { not: input.id },
        deletedAt: null,
        OR: [{ email }, { phone: input.phone }],
      },
      select: { id: true },
    });
    if (conflict) throw new UserAdminError(duplicateIdentifier);

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: input.id },
        data: {
          email,
          phone: input.phone,
          role: input.role,
          fullNameEn: input.fullNameEn,
          fullNameAr: input.fullNameAr,
          languagePref: input.languagePref,
          mustChangePassword: input.mustChangePassword,
        },
      });
      await tx.userSpecialty.deleteMany({ where: { userId: input.id } });
      if (input.specialtyIds.length > 0) {
        await tx.userSpecialty.createMany({
          data: input.specialtyIds.map((specialtyId) => ({
            userId: input.id,
            specialtyId,
          })),
          skipDuplicates: true,
        });
      }
    });
    return { userId: input.id };
  },
);

export const archiveUser = withAudit<[string], { userId: string }>(
  {
    entityType: 'User',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: () => ({ event: 'USER_ARCHIVED' }),
  },
  async function archiveUserInner(id: string): Promise<{ userId: string }> {
    const session = await auth();
    if (session?.user?.id === id) throw new UserAdminError(cannotArchiveSelf);

    const target = await db.user.findUnique({
      where: { id },
      select: { role: true, deletedAt: true },
    });
    if (!target || target.deletedAt) throw new UserAdminError(AUTH_ERRORS.UNAUTHENTICATED);

    if (target.role === UserRole.ADMIN) {
      const activeAdmins = await countActiveAdmins();
      if (activeAdmins <= 1) throw new UserAdminError(cannotArchiveLastAdmin);
    }

    await db.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { userId: id };
  },
);

export const restoreUser = withAudit<[string], { userId: string }>(
  {
    entityType: 'User',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: () => ({ event: 'USER_RESTORED' }),
  },
  async function restoreUserInner(id: string): Promise<{ userId: string }> {
    await db.user.update({
      where: { id },
      data: { deletedAt: null, failedLoginAttempts: 0, lockedUntil: null },
    });
    return { userId: id };
  },
);

interface ForceResetResult {
  userId: string;
  tempPassword: string;
}

export const forceResetPassword = withAudit<[string], ForceResetResult>(
  {
    entityType: 'User',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: () => ({ event: 'PASSWORD_FORCE_RESET' }),
  },
  async function forceResetInner(id: string): Promise<ForceResetResult> {
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    await db.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    return { userId: id, tempPassword };
  },
);

/** Friendly error toLocalizedError for the action facade. */
export function adminToLocalized(err: unknown): LocalizedError {
  if (err instanceof UserAdminError) return err.error;
  return toLocalizedError(err);
}
