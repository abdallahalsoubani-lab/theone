import type { SendResult, SendTemplateParams, SendTextParams, WhatsAppProvider } from './provider';
import { WhatsAppNotImplementedError } from './provider';

/**
 * Production-shaped stubs. These throw — Prompt 8 replaces them with the
 * real Meta Cloud / Twilio implementations. Kept so the codebase compiles
 * cleanly with WHATSAPP_PROVIDER=twilio|meta in CI/staging without a real
 * tenant; tests that exercise the abstraction can replace `whatsapp` with
 * a memory recorder.
 */

export const TwilioWhatsAppProvider: WhatsAppProvider = {
  id: 'twilio',
  async sendTemplate(_params: SendTemplateParams): Promise<SendResult> {
    throw new WhatsAppNotImplementedError(
      'TwilioWhatsAppProvider.sendTemplate is implemented in Prompt 8. ' +
        'In dev set WHATSAPP_PROVIDER=console.',
    );
  },
  async sendText(_params: SendTextParams): Promise<SendResult> {
    throw new WhatsAppNotImplementedError(
      'TwilioWhatsAppProvider.sendText is implemented in Prompt 8.',
    );
  },
};

export const MetaWhatsAppProvider: WhatsAppProvider = {
  id: 'meta',
  async sendTemplate(_params: SendTemplateParams): Promise<SendResult> {
    throw new WhatsAppNotImplementedError(
      'MetaWhatsAppProvider.sendTemplate is implemented in Prompt 8.',
    );
  },
  async sendText(_params: SendTextParams): Promise<SendResult> {
    throw new WhatsAppNotImplementedError(
      'MetaWhatsAppProvider.sendText is implemented in Prompt 8.',
    );
  },
};
