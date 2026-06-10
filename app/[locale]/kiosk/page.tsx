import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { KioskApp } from '@/components/kiosk/KioskApp';
import { validateArrivalsToken } from '@/lib/arrivals/tokens';

/**
 * Public check-in kiosk (Prompt 18 §1). Token-gated: an invalid or missing
 * device token 404s so the route is indistinguishable from non-existent.
 * No staff session required (the path is in PUBLIC_PATHS).
 */
export const dynamic = 'force-dynamic';

export default async function KioskPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const token = typeof sp.token === 'string' ? sp.token : undefined;

  if (!(await validateArrivalsToken('kiosk', token))) {
    notFound();
  }

  return <KioskApp token={token!} locale={locale} />;
}
