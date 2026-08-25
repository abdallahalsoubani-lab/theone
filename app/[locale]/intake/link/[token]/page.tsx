import { CustomQuestionAppliesTo } from '@prisma/client';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PublicIntakeFlow } from '@/components/intake/PublicIntakeFlow';
import { listCustomQuestions } from '@/lib/admin/custom-questions/queries';
import { patientDisplayName } from '@/lib/format/patientName';
import { resolveIntakeLink } from '@/lib/intake-links/queries';

/**
 * P52 — the personal, tokenized intake page. Unauthenticated (covered by the
 * '/intake' PUBLIC_PATHS prefix). Resolves the token → renders the SAME
 * intake form for the link's form type, chooser skipped, name + phone
 * prefilled and locked. Saves straight to the patient file, single-use.
 *
 * Invalid / used / unknown token → one neutral message; it never reveals
 * whether a token existed or shows any patient data beyond the locked
 * name/phone of a VALID unused link.
 */
export const dynamic = 'force-dynamic';

export default async function IntakeLinkPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const t = await getTranslations('publicIntake');

  const link = await resolveIntakeLink(token);

  // Neutral screen for unknown, used, or malformed tokens — identical text,
  // no data, no "existed"/"expired" distinction.
  if (!link || link.usedAt) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-bg px-4">
        <div className="max-w-md rounded-lg border border-brand-border bg-brand-surface p-8 text-center">
          <h1 className="text-xl font-semibold text-brand-navy">{t('linkInvalidTitle')}</h1>
          <p className="mt-2 text-sm text-brand-textMuted">{t('linkInvalidBody')}</p>
        </div>
      </main>
    );
  }

  const scope =
    link.formType === 'ADULT' ? CustomQuestionAppliesTo.ADULT : CustomQuestionAppliesTo.PEDIATRIC;
  const questions = await listCustomQuestions({ scope });
  const active = questions.filter((q) => q.active);

  return (
    <main className="min-h-screen bg-brand-bg">
      <header className="border-b border-brand-border bg-brand-surface">
        <div className="mx-auto max-w-3xl px-4 py-5">
          <p className="text-lg font-semibold text-brand-navy">{t('clinicName')}</p>
          <h1 className="mt-1 text-2xl font-bold text-brand-navy">{t('title')}</h1>
          <p className="mt-1 text-sm text-brand-textMuted">{t('personalSubtitle')}</p>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-6">
        <PublicIntakeFlow
          locale={intlLocale}
          adultQuestions={link.formType === 'ADULT' ? active : []}
          pediatricQuestions={link.formType === 'PEDIATRIC' ? active : []}
          linkMode={{
            token,
            forcedType: link.formType,
            lockedProfile: {
              fullNameEn:
                patientDisplayName(link.patientFullNameEn, link.patientFullNameAr, intlLocale) ||
                link.patientFullNameEn,
              phone: link.patientPhone ?? '',
            },
          }}
        />
      </div>
    </main>
  );
}
