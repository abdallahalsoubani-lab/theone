'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

interface Props {
  patientId: string;
  /** Locale to render the PDF in. Defaults to the page locale. */
  locale: string;
}

/**
 * Triggers the patient-file PDF download. Calls the export API,
 * receives the byte stream, materializes an object URL, and
 * synthesizes a download click. The server resolves the redaction
 * level — patient self-export omits clinical sections; staff
 * exports include them.
 */
export function ExportPatientFileButton({ patientId, locale }: Props) {
  const t = useTranslations('exports');
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const res = await fetch(
        `/api/v1/exports/patient-file/${patientId}?locale=${locale === 'ar' ? 'ar' : 'en'}`,
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
      a.download = `patient-${patientId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t('downloaded'));
    });
  }

  return (
    <Button type="button" variant="outline" disabled={pending} onClick={download}>
      <Download className="me-2 size-4" />
      {pending ? t('downloading') : t('downloadFile')}
    </Button>
  );
}
