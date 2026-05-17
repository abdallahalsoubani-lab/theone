import { CustomQuestionAppliesTo } from '@prisma/client';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { listCustomQuestions } from '@/lib/admin/custom-questions/queries';
import { requirePermission } from '@/lib/rbac/guards';

import { QuestionsBoard } from './_components/QuestionsBoard';

export default async function CustomQuestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('users.read');
  const t = await getTranslations('admin.customQuestions');
  const sp = await searchParams;

  const scope =
    sp.scope === 'PEDIATRIC' ? CustomQuestionAppliesTo.PEDIATRIC : CustomQuestionAppliesTo.ADULT;

  const [adult, pediatric] = await Promise.all([
    listCustomQuestions({ scope: CustomQuestionAppliesTo.ADULT }),
    listCustomQuestions({ scope: CustomQuestionAppliesTo.PEDIATRIC }),
  ]);

  return (
    <section className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <Button asChild>
          <Link href="/admin/intake-questions/new">{t('newQuestion')}</Link>
        </Button>
      </header>
      <QuestionsBoard initialScope={scope} adult={adult} pediatric={pediatric} />
    </section>
  );
}
