import type {
  SendResult,
  SendTemplateParams,
  SendTextParams,
  WebhookEvent,
  WhatsAppProvider,
} from '../provider';
import { WhatsAppNotImplementedError } from '../errors';

/**
 * Placeholder Meta Cloud API implementation — real send / verifyWebhook /
 * parseWebhook arrive in commit 3 of Prompt 8. Kept as a typed shell so
 * the factory in `../index.ts` compiles regardless of whether Meta has
 * been wired up yet. Throws if invoked.
 */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly id = 'meta' as const;

  async sendTemplate(_params: SendTemplateParams): Promise<SendResult> {
    throw new WhatsAppNotImplementedError(
      'MetaWhatsAppProvider.sendTemplate is wired in Prompt 8 commit 3.',
    );
  }

  async sendText(_params: SendTextParams): Promise<SendResult> {
    throw new WhatsAppNotImplementedError(
      'MetaWhatsAppProvider.sendText is wired in Prompt 8 commit 3.',
    );
  }

  verifyWebhook(): boolean {
    return false;
  }

  parseWebhook(): WebhookEvent[] {
    return [];
  }

  async healthCheck(): Promise<boolean> {
    return false;
  }
}
