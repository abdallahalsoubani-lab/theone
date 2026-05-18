import type {
  SendResult,
  SendTemplateParams,
  SendTextParams,
  WebhookEvent,
  WhatsAppProvider,
} from '../provider';
import { WhatsAppNotImplementedError } from '../errors';

/**
 * Placeholder Twilio implementation — real send / verifyWebhook /
 * parseWebhook arrive in commit 2 of Prompt 8. Kept as a typed shell so
 * the factory in `../index.ts` compiles regardless of whether the SDK
 * has been wired up yet. Throws if invoked.
 */
export class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly id = 'twilio' as const;

  async sendTemplate(_params: SendTemplateParams): Promise<SendResult> {
    throw new WhatsAppNotImplementedError(
      'TwilioWhatsAppProvider.sendTemplate is wired in Prompt 8 commit 2.',
    );
  }

  async sendText(_params: SendTextParams): Promise<SendResult> {
    throw new WhatsAppNotImplementedError(
      'TwilioWhatsAppProvider.sendText is wired in Prompt 8 commit 2.',
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
