import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PediatricFieldsManager } from '@/components/pediatric-assessment/PediatricFieldsManager';
import { listAllCustomFields } from '@/lib/pediatric-assessment/customFields/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Manage assessment custom fields (Prompt 21 §3) — DOCTOR/ADMIN. The core 65
 * fields are fixed and not shown here; only the clinic-wide custom fields are
 * editable. Removal is a soft-delete (deactivate) so history still renders.
 */
export const dynamic = 'force-dynamic';

export default async function PediatricFieldsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('pediatric_assessment.manage_fields');
  const t = await getTranslations('pediatricAssessment.fields');
  const fields = await listAllCustomFields();

  return (
    <section className="space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('subtitle')}</p>
      </header>
      <PediatricFieldsManager fields={fields} locale={locale === 'ar' ? 'ar' : 'en'} />
    </section>
  );
}
