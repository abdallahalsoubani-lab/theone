import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { ClinicSettingsForm } from '@/components/admin/ClinicSettingsForm';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

export default async function ClinicSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('system_settings.read');
  const t = await getTranslations('admin.settings');
  const settings = await db.clinicSettings.findUnique({ where: { id: 'default' } });
  if (!settings) notFound();

  return (
    <section className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="text-sm text-brand-textMuted">{t('subtitle')}</p>
      </header>
      <ClinicSettingsForm
        initial={{
          nameEn: settings.nameEn,
          nameAr: settings.nameAr,
          phone: settings.phone,
          addressEn: settings.addressEn,
          addressAr: settings.addressAr,
          defaultAppointmentDuration: settings.defaultAppointmentDuration,
          defaultReminderOffsetMinutes: settings.defaultReminderOffsetMinutes,
          reminderWindowStart: settings.reminderWindowStart,
          reminderWindowEnd: settings.reminderWindowEnd,
          defaultLanguage: settings.defaultLanguage,
          hijriDefault: settings.hijriDefault,
          patientCanViewClinicalNotes: settings.patientCanViewClinicalNotes,
          businessHours: settings.businessHours as unknown as Record<
            'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat',
            { open: string; close: string; closed: boolean }
          >,
          serviceTypes: settings.serviceTypes as unknown as Array<{
            id: string;
            nameEn: string;
            nameAr: string;
            defaultDurationMinutes: number;
            active: boolean;
          }>,
        }}
      />
    </section>
  );
}
