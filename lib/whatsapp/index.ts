import { ConsoleWhatsAppProvider } from './console';
import type { WhatsAppProvider } from './provider';
import { MetaWhatsAppProvider, TwilioWhatsAppProvider } from './stub';

export type { SendResult, SendTemplateParams, SendTextParams, WhatsAppProvider } from './provider';
export { WhatsAppNotImplementedError } from './provider';

/**
 * Resolve the active WhatsApp provider once at module load. Logged so the
 * boot output makes the wiring obvious. The selector mirrors the OTP sender
 * pattern in lib/auth/senders/index.ts.
 */
function resolveProvider(): WhatsAppProvider {
  const choice = process.env.WHATSAPP_PROVIDER ?? 'console';
  if (choice === 'twilio') return TwilioWhatsAppProvider;
  if (choice === 'meta') return MetaWhatsAppProvider;
  return ConsoleWhatsAppProvider;
}

export const whatsapp: WhatsAppProvider = resolveProvider();

console.warn(`[whatsapp] active provider: ${whatsapp.id}`);
