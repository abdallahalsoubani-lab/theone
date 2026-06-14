import { CustomQuestionAppliesTo } from '@prisma/client';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PublicIntakeFlow } from '@/components/intake/PublicIntakeFlow';
import { listCustomQuestions } from '@/lib/admin/custom-questions/queries';

/**
 * Public self-service intake (Prompt 23 §3). Unauthenticated — the path is in
 * PUBLIC_PATHS. The page only renders the form; the submit action is write-only
 * and creates a PENDING submission for secretary review. No patient context,
 * no reads of patient data.
 */
export const dynamic = 'force-dynamic';

export default async function PublicIntakePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';

  const [t, adultQuestions, pediatricQuestions] = await Promise.all([
    getTranslations('publicIntake'),
    listCustomQuestions({ scope: CustomQuestionAppliesTo.ADULT }),
    listCustomQuestions({ scope: CustomQuestionAppliesTo.PEDIATRIC }),
  ]);

  return (
    <main className="min-h-screen bg-brand-bg">
      <header className="border-b border-brand-border bg-brand-surface">
        <div className="mx-auto max-w-3xl px-4 py-5">
          <p className="text-lg font-semibold text-brand-navy">{t('clinicName')}</p>
          <h1 className="mt-1 text-2xl font-bold text-brand-navy">{t('title')}</h1>
          <p className="mt-1 text-sm text-brand-textMuted">{t('subtitle')}</p>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-6">
        <PublicIntakeFlow
          locale={intlLocale}
          adultQuestions={adultQuestions.filter((q) => q.active)}
          pediatricQuestions={pediatricQuestions.filter((q) => q.active)}
        />
      </div>
    </main>
  );
}
