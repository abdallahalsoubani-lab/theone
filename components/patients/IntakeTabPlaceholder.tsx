import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

interface Props {
  patientId: string;
  basePath: string;
  canCreate: boolean;
}

/**
 * Lightweight Intake tab body for commit 3. Commit 4/5 replaces this with
 * the full list of assessments + the per-row View/Edit actions. For now we
 * show a "Add intake" CTA so Secretaries can already launch the flow.
 */
export function IntakeTabPlaceholder({ patientId, basePath, canCreate }: Props) {
  const t = useTranslations('intake');
  return (
    <Card>
      <CardContent className="space-y-3 p-8 text-center">
        <p className="text-sm text-brand-textMuted">{t('noIntakes')}</p>
        {canCreate ? (
          <Button asChild>
            <Link href={`${basePath}/${patientId}/intake/new`}>
              <Plus className="me-2 size-4" />
              {t('addIntake')}
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
