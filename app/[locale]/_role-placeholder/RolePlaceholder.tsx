import { getTranslations } from 'next-intl/server';

import { Card, CardContent } from '@/components/ui/card';

/**
 * Shared placeholder used by every role's landing page until the owning
 * feature prompt replaces it. Keeps the post-login UX intact (the user lands
 * somewhere, not 404) without committing UI that future prompts will rewrite.
 */
export async function RolePlaceholder({ name, ownedBy }: { name: string; ownedBy: string }) {
  const t = await getTranslations('common');
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <Card>
        <CardContent className="space-y-3 p-8">
          <h1 className="text-2xl font-medium text-brand-navy">
            {t('appName')} · {name}
          </h1>
          <p className="text-sm text-brand-textMuted">
            This page is implemented in <strong>{ownedBy}</strong>.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
