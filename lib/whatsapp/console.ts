import type { SendResult, SendTemplateParams, SendTextParams, WhatsAppProvider } from './provider';

/**
 * Development WhatsApp provider — writes a structured payload to stderr.
 * Active when WHATSAPP_PROVIDER=console (the default in dev / CI). QA can
 * grep the dev log for `[DEV WHATSAPP]` to see exactly what would have been
 * sent to a real handset.
 */

export const ConsoleWhatsAppProvider: WhatsAppProvider = {
  id: 'console',
  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    const body =
      `[DEV WHATSAPP] template=${params.name} to=${params.recipientPhone} lang=${params.language}` +
      params.parameters.map((p, i) => `\n  param[${i + 1}]=${p}`).join('');
    console.warn(body);
    return {
      providerMessageId: `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'SENT',
    };
  },
  async sendText(params: SendTextParams): Promise<SendResult> {
    console.warn(`[DEV WHATSAPP TEXT] to=${params.recipientPhone}\n  ${params.body}`);
    return {
      providerMessageId: `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'SENT',
    };
  },
};
