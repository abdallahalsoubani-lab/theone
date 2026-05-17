import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getCustomQuestionById } from '@/lib/admin/custom-questions/queries';
import { requirePermission } from '@/lib/rbac/guards';

import { QuestionForm } from '../../_components/QuestionForm';

export default async function EditQuestionPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('users.update');
  const t = await getTranslations('admin.customQuestions');
  const q = await getCustomQuestionById(id);
  if (!q) notFound();
  return (
    <section className="space-y-6 p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('editQuestion')}</h1>
      <QuestionForm
        mode="edit"
        initial={{
          id: q.id,
          nameEn: q.nameEn,
          nameAr: q.nameAr,
          type: q.type,
          appliesTo: q.appliesTo,
          required: q.required,
          active: q.active,
          options: q.options,
        }}
      />
    </section>
  );
}
