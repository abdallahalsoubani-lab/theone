'use client';

import { FileDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { saveHomeProgramCoverAction } from '@/lib/clinical/home-program/actions';

/**
 * P64 #15 — the home-program PDF cover copy (goals, one per line + a note
 * for the parents / patient) and the PDF download. Diagnosis comes from the
 * active treatment plan; the PDF prints in the patient's language.
 */
export function HomeProgramCoverEditor({
  patientId,
  initialGoals,
  initialParentNotes,
}: {
  patientId: string;
  initialGoals: string;
  initialParentNotes: string;
}) {
  const t = useTranslations('clinical.homeProgram.pdf');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [goals, setGoals] = useState(initialGoals);
  const [parentNotes, setParentNotes] = useState(initialParentNotes);

  const save = () =>
    startTransition(async () => {
      const r = await saveHomeProgramCoverAction({ patientId, goals, parentNotes });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('savedToast'));
      router.refresh();
    });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-medium text-brand-navy">{t('heading')}</h2>
            <p className="text-xs text-brand-textMuted">{t('subtitle')}</p>
          </div>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/v1/exports/home-program/${patientId}`} target="_blank" rel="noreferrer">
              <FileDown className="me-1 size-4" />
              {t('download')}
            </a>
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="hp-goals">{t('goals')}</Label>
            <textarea
              id="hp-goals"
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              rows={4}
              placeholder={t('goalsPlaceholder')}
              className="block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hp-notes">{t('parentNotes')}</Label>
            <textarea
              id="hp-notes"
              value={parentNotes}
              onChange={(e) => setParentNotes(e.target.value)}
              rows={4}
              placeholder={t('parentNotesPlaceholder')}
              className="block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {t('save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
