import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TemplatesTable } from '@/components/admin/whatsapp/TemplatesTable';
import { listTemplates } from '@/lib/admin/whatsapp/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Admin WhatsApp templates (Prompt 8 §4.9).
 *
 * Lists every WhatsAppTemplate row with the provider identifiers
 * (Meta template name + approval status, Twilio ContentSid + approved
 * flag, active toggle). Admin manages provider metadata manually after
 * confirming approval in Meta Business Manager / Twilio Console.
 *
 * The list is read-mostly; in-place edits and the "Send test" action use
 * server actions wired through the table component.
 */
export default async function AdminTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('whatsapp_templates.read');
  const t = await getTranslations('admin.whatsapp');
  const rows = await listTemplates();

  return (
    <section className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('templatesTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('templatesSubtitle')}</p>
      </header>
      <TemplatesTable rows={rows} />
    </section>
  );
}
