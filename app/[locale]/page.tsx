import Link from 'next/link';

import { Logo } from '@/components/brand/Logo';

/**
 * Foundation landing page.
 *
 * Hardcoded English copy is intentional for Prompt 1 — next-intl wiring lands in Prompt 3.
 * Once translations exist, every string on this page moves into `messages/{en,ar}.json`.
 */
export default async function LocaleHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <Logo size={96} />
      <div className="space-y-3">
        <h1 className="text-4xl font-medium text-brand-navy">Theone.pt</h1>
        <p className="text-brand-textMuted">
          Physiotherapy clinic management — foundation build (Phase 0).
        </p>
      </div>
      <p className="rounded-md border border-brand-border bg-brand-surface px-4 py-2 text-sm text-brand-textMuted">
        Current locale segment: <code className="font-medium text-brand-navy">{locale}</code>
      </p>
      <Link
        href={`/${locale}/style-guide`}
        className="inline-flex items-center rounded-md bg-gradient-cta px-6 py-3 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
      >
        View style guide
      </Link>
    </main>
  );
}
