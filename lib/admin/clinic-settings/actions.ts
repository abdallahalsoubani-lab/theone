'use server';

import { AuditAction, type Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { fail, ok, type Result } from '@/lib/auth/result';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import {
  clinicSettingsUpdateSchema,
  type ClinicSettingsUpdateInput,
  type ClinicSettingsUpdateParsed,
} from './schemas';

const updateInner = withAudit<[ClinicSettingsUpdateParsed], { id: string }>(
  {
    entityType: 'ClinicSettings',
    action: AuditAction.UPDATE,
    extractEntityId: () => 'default',
    extractBefore: async () =>
      db.clinicSettings.findUnique({
        where: { id: 'default' },
      }),
    extractAfter: (_result) => ({ event: 'CLINIC_SETTINGS_UPDATED' }),
  },
  async function inner(input): Promise<{ id: string }> {
    const session = await auth();
    await db.clinicSettings.update({
      where: { id: 'default' },
      data: {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        phone: input.phone,
        addressEn: input.addressEn,
        addressAr: input.addressAr,
        defaultAppointmentDuration: input.defaultAppointmentDuration,
        defaultReminderOffsetMinutes: input.defaultReminderOffsetMinutes,
        reminderWindowStart: input.reminderWindowStart,
        reminderWindowEnd: input.reminderWindowEnd,
        currentDelayMinutes: input.currentDelayMinutes,
        defaultLanguage: input.defaultLanguage,
        hijriDefault: input.hijriDefault,
        patientCanViewClinicalNotes: input.patientCanViewClinicalNotes,
        businessHours: input.businessHours as unknown as Prisma.InputJsonValue,
        serviceTypes: input.serviceTypes as unknown as Prisma.InputJsonValue,
        updatedById: session?.user?.id ?? null,
      },
    });
    return { id: 'default' };
  },
);

export async function updateClinicSettingsAction(
  input: ClinicSettingsUpdateInput,
): Promise<Result<{ id: string }>> {
  await requirePermission('system_settings.update');
  const parsed = clinicSettingsUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(toLocalized(parsed.error));
  try {
    const data = await updateInner(parsed.data);
    revalidatePath('/[locale]/(admin)/admin/settings', 'page');
    return ok(data);
  } catch (err) {
    return fail(toLocalized(err));
  }
}

function toLocalized(err: unknown): LocalizedError {
  return toLocalizedError(err);
}
