import { AuditAction, UserRole } from '@prisma/client';

import { generateTempPassword } from '@/lib/admin/temp-password';
import { withAudit } from '@/lib/audit/withAudit';
import { hashPassword } from '@/lib/auth/password';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { sendPatientCredentials } from '@/lib/whatsapp/templates/sendCredentials';

import type { PatientCreateInput, PatientSelfEditInput, PatientUpdateInput } from './schemas';

export class PatientAdminError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'PatientAdminError';
  }
}

const duplicatePhone: LocalizedError = {
  code: 'PATIENT_DUPLICATE_PHONE',
  message_en: 'A patient with this phone number already exists.',
  message_ar: 'يوجد مراجع بنفس رقم الهاتف.',
};

const duplicateEmail: LocalizedError = {
  code: 'PATIENT_DUPLICATE_EMAIL',
  message_en: 'A patient with this email already exists.',
  message_ar: 'يوجد مراجع بنفس البريد الإلكتروني.',
};

const notFound: LocalizedError = {
  code: 'PATIENT_NOT_FOUND',
  message_en: 'Patient not found.',
  message_ar: 'لم يتم العثور على المراجع.',
};

interface CreatePatientResult {
  patientId: string;
  tempPassword: string;
  /** WhatsApp delivery status. Yellow banner on the UI if not 'SENT'. */
  whatsappStatus: 'SENT' | 'FAILED';
  whatsappError?: string;
}

export const createPatient = withAudit<[PatientCreateInput], CreatePatientResult>(
  {
    entityType: 'User',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.patientId,
    extractAfter: (result) => ({
      patientId: result.patientId,
      event: 'PATIENT_CREATED',
      whatsappStatus: result.whatsappStatus,
    }),
  },
  async function createPatientInner(input: PatientCreateInput): Promise<CreatePatientResult> {
    // Pre-check identifier uniqueness scoped to non-deleted rows for friendly errors.
    const conflicts = await db.user.findMany({
      where: {
        deletedAt: null,
        OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])],
      },
      select: { phone: true, email: true },
    });
    for (const c of conflicts) {
      if (c.phone === input.phone) throw new PatientAdminError(duplicatePhone);
      if (input.email && c.email === input.email) {
        throw new PatientAdminError(duplicateEmail);
      }
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const patient = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          phone: input.phone,
          role: UserRole.PATIENT,
          fullNameEn: input.fullNameEn,
          fullNameAr: input.fullNameAr,
          languagePref: input.languagePref,
          passwordHash,
          mustChangePassword: true,
        },
      });
      await tx.patientProfile.create({
        data: {
          userId: user.id,
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          nationalId: input.nationalId || null,
          address: input.address,
          occupation: input.occupation || null,
          emergencyContactName: input.emergencyContactName || null,
          emergencyContactPhone: input.emergencyContactPhone || null,
          medicalHistorySummary: input.medicalHistorySummary || null,
          allergies: input.allergies || null,
          currentMedications: input.currentMedications || null,
          hijriCalendarPref: input.hijriCalendarPref,
        },
      });
      return user;
    });

    // Outside the transaction so DB commit isn't blocked on network IO.
    let whatsappStatus: 'SENT' | 'FAILED' = 'SENT';
    let whatsappError: string | undefined;
    try {
      const result = await sendPatientCredentials({
        recipientUserId: patient.id,
        recipientPhone: patient.phone,
        recipientName: input.languagePref === 'AR' ? input.fullNameAr : input.fullNameEn,
        username: patient.phone,
        tempPassword,
        portalUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/${input.languagePref === 'AR' ? 'ar' : 'en'}/login`,
        language: input.languagePref,
      });
      if (result.status === 'FAILED') {
        whatsappStatus = 'FAILED';
        whatsappError = result.failureReason ?? 'unknown';
      }
    } catch (err) {
      whatsappStatus = 'FAILED';
      whatsappError = err instanceof Error ? err.message : String(err);
      console.error('[patients] WhatsApp credential delivery failed', err);
    }

    return { patientId: patient.id, tempPassword, whatsappStatus, whatsappError };
  },
);

export const updatePatient = withAudit<[PatientUpdateInput], { patientId: string }>(
  {
    entityType: 'PatientProfile',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) =>
      db.user.findUnique({
        where: { id: args[0].id },
        include: { patientProfile: true },
      }),
    extractAfter: (result) => result,
  },
  async function updatePatientInner(input: PatientUpdateInput): Promise<{ patientId: string }> {
    const target = await db.user.findFirst({
      where: { id: input.id, role: UserRole.PATIENT, deletedAt: null },
      select: { id: true, phone: true, email: true },
    });
    if (!target) throw new PatientAdminError(notFound);

    // Re-validate uniqueness on phone/email if either changed.
    if (target.phone !== input.phone || target.email !== input.email) {
      const conflict = await db.user.findFirst({
        where: {
          id: { not: input.id },
          deletedAt: null,
          OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])],
        },
        select: { phone: true, email: true },
      });
      if (conflict) {
        if (conflict.phone === input.phone) throw new PatientAdminError(duplicatePhone);
        if (input.email && conflict.email === input.email) {
          throw new PatientAdminError(duplicateEmail);
        }
      }
    }

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: input.id },
        data: {
          fullNameEn: input.fullNameEn,
          fullNameAr: input.fullNameAr,
          email: input.email,
          phone: input.phone,
          languagePref: input.languagePref,
        },
      });
      await tx.patientProfile.update({
        where: { userId: input.id },
        data: {
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          nationalId: input.nationalId || null,
          address: input.address,
          occupation: input.occupation || null,
          emergencyContactName: input.emergencyContactName || null,
          emergencyContactPhone: input.emergencyContactPhone || null,
          medicalHistorySummary: input.medicalHistorySummary || null,
          allergies: input.allergies || null,
          currentMedications: input.currentMedications || null,
          hijriCalendarPref: input.hijriCalendarPref,
        },
      });
    });
    // TODO(Prompt 8): when phone changes, send a WhatsApp notification to the
    // patient with the new login username.
    return { patientId: input.id };
  },
);

export const updateOwnPatientProfile = withAudit<
  [string, PatientSelfEditInput],
  { patientId: string }
>(
  {
    entityType: 'PatientProfile',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: () => ({ event: 'PATIENT_SELF_EDIT' }),
  },
  async function updateOwnInner(userId, input): Promise<{ patientId: string }> {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: input.email,
          languagePref: input.languagePref,
        },
      });
      await tx.patientProfile.update({
        where: { userId },
        data: {
          address: input.address,
          emergencyContactName: input.emergencyContactName || null,
          emergencyContactPhone: input.emergencyContactPhone || null,
          hijriCalendarPref: input.hijriCalendarPref,
        },
      });
    });
    return { patientId: userId };
  },
);

interface ResetPasswordResult {
  patientId: string;
  tempPassword: string;
  whatsappStatus: 'SENT' | 'FAILED';
}

export const resetPatientPassword = withAudit<[string], ResetPasswordResult>(
  {
    entityType: 'User',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: (result) => ({
      event: 'PATIENT_PASSWORD_RESET',
      whatsappStatus: result.whatsappStatus,
    }),
  },
  async function resetPatientPasswordInner(id): Promise<ResetPasswordResult> {
    const patient = await db.user.findFirst({
      where: { id, role: UserRole.PATIENT, deletedAt: null },
      select: { id: true, phone: true, fullNameEn: true, fullNameAr: true, languagePref: true },
    });
    if (!patient) throw new PatientAdminError(notFound);

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

    let whatsappStatus: 'SENT' | 'FAILED' = 'SENT';
    try {
      const result = await sendPatientCredentials({
        recipientUserId: patient.id,
        recipientPhone: patient.phone,
        recipientName: patient.languagePref === 'AR' ? patient.fullNameAr : patient.fullNameEn,
        username: patient.phone,
        tempPassword,
        portalUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/${patient.languagePref === 'AR' ? 'ar' : 'en'}/login`,
        language: patient.languagePref,
      });
      if (result.status === 'FAILED') whatsappStatus = 'FAILED';
    } catch (err) {
      whatsappStatus = 'FAILED';
      console.error('[patients] WhatsApp reset-credentials delivery failed', err);
    }

    return { patientId: id, tempPassword, whatsappStatus };
  },
);

export function patientToLocalized(err: unknown): LocalizedError {
  if (err instanceof PatientAdminError) return err.error;
  return toLocalizedError(err);
}
