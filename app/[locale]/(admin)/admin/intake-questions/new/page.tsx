import { getTranslations, setRequestLocale } from 'next-intl/server';

import { requirePermission } from '@/lib/rbac/guards';

import { QuestionForm } from '../_components/QuestionForm';

export default async function NewQuestionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('users.update');
  const t = await getTranslations('admin.customQuestions');
  return (
    <section className="space-y-6 p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('newQuestion')}</h1>
      <QuestionForm mode="create" />
    </section>
  );
}
