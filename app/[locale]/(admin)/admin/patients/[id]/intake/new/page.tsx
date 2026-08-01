import { CustomQuestionAppliesTo, IntakeType } from '@prisma/client';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { AdultIntakeForm } from '@/components/intake/AdultIntakeForm';
import { PediatricIntakeForm } from '@/components/intake/PediatricIntakeForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { listCustomQuestions } from '@/lib/admin/custom-questions/queries';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { getPatientFile } from '@/lib/patients/queries';
import { isPediatric } from '@/lib/patients/schemas';
import { requirePermission } from '@/lib/rbac/guards';

/** Admin intake creation (Aug 1) — the Secretary flow, admin shell. */
export default async function AdminNewIntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { locale, id } = await params;
  const { type } = await searchParams;
  setRequestLocale(locale);
  await requirePermission('intake.create');
  await ensureCanReadPatient(id);
  const patient = await getPatientFile(id);
  if (!patient) notFound();

  const t = await getTranslations('intake');

  // Type selector — shown when no `type` query param is supplied.
  if (type !== 'ADULT' && type !== 'PEDIATRIC') {
    const suggested = isPediatric(patient.dateOfBirth) ? IntakeType.PEDIATRIC : IntakeType.ADULT;
    return (
      <section className="mx-auto max-w-xl space-y-6 p-6">
        <h1 className="text-2xl font-medium text-brand-navy">{t('newTitle')}</h1>
        <Card>
          <CardContent className="space-y-3 p-6">
            <p className="text-sm text-brand-textMuted">{t('type')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button asChild variant={suggested === 'ADULT' ? 'default' : 'outline'}>
                <Link href={`/admin/patients/${id}/intake/new?type=ADULT`}>{t('typeAdult')}</Link>
              </Button>
              <Button asChild variant={suggested === 'PEDIATRIC' ? 'default' : 'outline'}>
                <Link href={`/admin/patients/${id}/intake/new?type=PEDIATRIC`}>
                  {t('typePediatric')}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  const customQuestions = await listCustomQuestions({
    scope: type === 'ADULT' ? CustomQuestionAppliesTo.ADULT : CustomQuestionAppliesTo.PEDIATRIC,
  });
  const activeQuestions = customQuestions.filter((q) => q.active);

  return (
    <section className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-medium text-brand-navy">
        {type === 'ADULT' ? t('typeAdult') : t('typePediatric')}
      </h1>
      {type === 'ADULT' ? (
        <AdultIntakeForm
          patient={patient}
          customQuestions={activeQuestions}
          basePath="/admin/patients"
        />
      ) : (
        <PediatricIntakeForm
          patient={patient}
          customQuestions={activeQuestions}
          basePath="/admin/patients"
        />
      )}
    </section>
  );
}
