'use client';

import { UserCog } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { startImpersonationAction } from '@/lib/impersonation/actions';

interface ActAsButtonProps {
  targetUserId: string;
  /** Localized display name for the confirm dialog title + success toast. */
  targetName: string;
  /** Render variant. `menuItem` = full-width text + icon for use inside a
   *  DropdownMenuItem; `button` = a standalone outline button suited to a
   *  profile-page header. */
  variant?: 'menuItem' | 'button';
}

/**
 * Confirm-then-act entry point for Admin Impersonation. Wraps the
 * server action so the call site (admin users table row, patient profile
 * header, etc.) doesn't reimplement the confirmation + redirect dance.
 */
export function ActAsButton({ targetUserId, targetName, variant = 'menuItem' }: ActAsButtonProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('impersonation');
  const [pending, startTransition] = useTransition();
  // ConfirmDialog manages its own open state; this controlled flag is used
  // by the menuItem trigger to render the disabled state during the
  // in-flight call to the action.
  const [busy, setBusy] = useState(false);

  function handleConfirm() {
    setBusy(true);
    startTransition(async () => {
      const r = await startImpersonationAction({ targetUserId });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        setBusy(false);
        return;
      }
      toast.success(t('started_toast', { name: targetName }));
      router.replace(`/${locale}${r.data.redirectTo}`);
      router.refresh();
    });
  }

  const trigger =
    variant === 'button' ? (
      <Button type="button" variant="outline" size="sm" disabled={pending || busy}>
        <UserCog className="h-3.5 w-3.5" />
        {t('act_as')}
      </Button>
    ) : (
      <div className="flex w-full cursor-pointer items-center gap-2 text-start text-sm">
        <UserCog className="h-3.5 w-3.5 text-brand-textMuted" />
        {t('act_as')}
      </div>
    );

  return (
    <ConfirmDialog
      title={t('confirm_title', { name: targetName })}
      description={t('confirm_description')}
      confirmLabel={t('confirm_button')}
      onConfirm={handleConfirm}
      trigger={trigger}
    />
  );
}
