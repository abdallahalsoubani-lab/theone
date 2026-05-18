import type {
  SendResult,
  SendTemplateParams,
  SendTextParams,
  WebhookEvent,
  WhatsAppProvider,
} from '../provider';

/**
 * Development WhatsApp provider — writes a structured payload to stderr.
 * Active when WHATSAPP_PROVIDER=console (the default in dev / CI). QA can
 * grep the dev log for `[DEV WHATSAPP]` to see exactly what would have
 * been sent to a real handset.
 *
 * Webhook hooks return permissive defaults: signature verification always
 * passes (there's no signature surface), parse returns no events, health
 * check is always true. Inbound testing in dev happens by inserting rows
 * directly via the dev seed or the inbox test fixtures.
 */

let counter = 0;
function fakeId(): string {
  counter += 1;
  return `console-${Date.now()}-${counter.toString(36)}`;
}

export const ConsoleWhatsAppProvider: WhatsAppProvider = {
  id: 'console',
  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    const body =
      `[DEV WHATSAPP] template=${params.name} to=${params.recipientPhone} lang=${params.language}` +
      params.parameters.map((p, i) => `\n  param[${i + 1}]=${p}`).join('');
    console.warn(body);
    return { providerMessageId: fakeId(), status: 'SENT' };
  },
  async sendText(params: SendTextParams): Promise<SendResult> {
    console.warn(`[DEV WHATSAPP TEXT] to=${params.recipientPhone}\n  ${params.body}`);
    return { providerMessageId: fakeId(), status: 'SENT' };
  },
  verifyWebhook(): boolean {
    return true;
  },
  parseWebhook(): WebhookEvent[] {
    return [];
  },
  async healthCheck(): Promise<boolean> {
    return true;
  },
};
