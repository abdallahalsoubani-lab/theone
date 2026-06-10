import { env } from '@/lib/env';

import { ConsoleWhatsAppProvider } from './providers/console';
import { MetaWhatsAppProvider } from './providers/meta';
import type { WhatsAppProvider } from './provider';

/**
 * Provider factory + singleton. Resolves the active provider once at module
 * load based on `WHATSAPP_PROVIDER` and pins the instance on globalThis
 * so Next.js hot reload doesn't keep building new SDK clients on every
 * server-component re-render.
 *
 * No call site should reach into ./providers/* directly. Importing from
 * here keeps the abstraction tight: swapping providers is a single env
 * var change with zero code edits.
 *
 * The boot-time health check is fire-and-forget. A failure logs loudly
 * with the `[whatsapp]` prefix but never crashes the process — the
 * outbound queue worker will surface real errors on first send and the
 * Admin can re-check via the templates UI.
 */

const globalForWa = globalThis as unknown as { whatsapp?: WhatsAppProvider };

function makeProvider(): WhatsAppProvider {
  switch (env.WHATSAPP_PROVIDER) {
    case 'meta':
      return new MetaWhatsAppProvider();
    case 'console':
    default:
      return ConsoleWhatsAppProvider;
  }
}

export const whatsapp: WhatsAppProvider = globalForWa.whatsapp ?? makeProvider();

if (process.env.NODE_ENV !== 'production') {
  globalForWa.whatsapp = whatsapp;
}

// One-line boot log so the wiring is obvious from the dev server's stderr.
console.warn(`[whatsapp] active provider: ${whatsapp.id}`);

// Fire-and-forget self-check. Skipped in test runs (vitest sets NODE_ENV=test)
// so unit tests don't pay the cost of pretending to reach a remote.
if (process.env.NODE_ENV !== 'test') {
  void whatsapp
    .healthCheck()
    .then((ok) => {
      console.warn(`[whatsapp] health check: ${ok ? 'ok' : 'failed'} (provider=${whatsapp.id})`);
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[whatsapp] health check threw: ${msg}`);
    });
}

export type {
  DeliveryStatusEvent,
  InboundMessage,
  SendResult,
  SendTemplateParams,
  SendTextParams,
  WebhookEvent,
  WhatsAppProvider,
} from './provider';
export { WhatsAppError, WhatsAppNotImplementedError } from './errors';
