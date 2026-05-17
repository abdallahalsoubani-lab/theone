'use client';

import { KeyRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { resetPatientPasswordAction } from '@/lib/patients/actions';

interface Props {
  patientId: string;
}

/**
 * Reset-password trigger for the patient file. Lives in its own client
 * component so the wrapping patient-file page can stay a Server Component.
 */
export function ResetPasswordButton({ patientId }: Props) {
  const t = useTranslations('patients.file');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handle = () =>
    startTransition(async () => {
      const r = await resetPatientPasswordAction(patientId);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(`${t('resetToast')} — ${r.data.tempPassword}`);
      router.refresh();
    });

  return (
    <ConfirmDialog
      title={t('resetPassword')}
      description={t('confirmResetPassword')}
      onConfirm={handle}
      variant="destructive"
      trigger={
        <Button variant="outline" size="sm" disabled={pending}>
          <KeyRound className="me-2 size-4" />
          {t('resetPassword')}
        </Button>
      }
    />
  );
}
