'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

interface Props {
  assessmentId: string;
  locale: string;
}

/** Downloads one pediatric assessment as a PDF (Prompt 21 §5). */
export function ExportPediatricAssessmentButton({ assessmentId, locale }: Props) {
  const t = useTranslations('exports');
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const res = await fetch(
        `/api/v1/exports/pediatric-assessment/${assessmentId}?locale=${locale === 'ar' ? 'ar' : 'en'}`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message_en?: string; message_ar?: string };
        };
        toast.error(
          (locale === 'ar' ? body.error?.message_ar : body.error?.message_en) ??
            t('downloadFailed'),
        );
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pediatric-assessment-${assessmentId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t('downloaded'));
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={download}>
      <Download className="size-4" />
      {pending ? t('downloading') : t('pdf')}
    </Button>
  );
}
