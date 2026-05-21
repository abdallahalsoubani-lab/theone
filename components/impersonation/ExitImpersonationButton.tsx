'use client';

import { LogOut } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { endImpersonationAction } from '@/lib/impersonation/actions';

/**
 * Inline button used by the ImpersonationBanner. Calls the server action
 * to clear the cookie + write the IMPERSONATION_ENDED audit row, then
 * pushes the Admin back to their dashboard and refreshes so the banner
 * disappears.
 */
export function ExitImpersonationButton({ label }: { label: string }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('impersonation');
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const r = await endImpersonationAction();
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('ended_toast'));
      router.replace(`/${locale}${r.data.redirectTo}`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-60"
    >
      <LogOut className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
