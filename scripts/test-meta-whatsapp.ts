/**
 * Dev-only: send one freeform WhatsApp text via the Meta Cloud API provider
 * and print the full raw Meta response (success or error in detail).
 *
 * Meta is in Development mode, so the recipient MUST be registered as a test
 * recipient in Business Manager. +962787075008 is registered.
 *
 *   pnpm test:meta
 *   # or: pnpm dotenv -e .env.local -- tsx scripts/test-meta-whatsapp.ts [+phone]
 *
 * Reads META_WHATSAPP_PHONE_NUMBER_ID + META_WHATSAPP_ACCESS_TOKEN from
 * .env.local (loaded by the dotenv prefix in the package.json script).
 */

import { MetaWhatsAppProvider, type FetchLike } from '@/lib/whatsapp/providers/meta';
import { WhatsAppError } from '@/lib/whatsapp/errors';
import { env } from '@/lib/env';

const DEFAULT_RECIPIENT = '+962787075008';

/**
 * Wrap global fetch so we can print Meta's full HTTP response body before the
 * provider normalizes it into a SendResult / WhatsAppError. We buffer the body
 * as text once, then hand the provider json()/text() impls that re-read it
 * (the underlying stream can only be consumed a single time).
 */
const loggingFetch: FetchLike = async (input, init) => {
  const res = await fetch(input, init as RequestInit);
  const raw = await res.text();

  console.log('\n─── Raw Meta HTTP response ───────────────────────────────────');
  console.log('status :', res.status, res.ok ? '(ok)' : '(error)');
  try {
    console.log('body   :', JSON.stringify(JSON.parse(raw), null, 2));
  } catch {
    console.log('body   :', raw);
  }
  console.log('──────────────────────────────────────────────────────────────\n');

  return {
    ok: res.ok,
    status: res.status,
    headers: { get: (name: string) => res.headers.get(name) },
    json: async () => (raw ? JSON.parse(raw) : {}),
    text: async () => raw,
  };
};

async function main() {
  const recipient = process.argv[2] ?? DEFAULT_RECIPIENT;

  console.log('[test:meta] provider     :', env.WHATSAPP_PROVIDER);
  console.log('[test:meta] phoneNumberId:', env.META_WHATSAPP_PHONE_NUMBER_ID || '(missing)');
  console.log(
    '[test:meta] accessToken  :',
    env.META_WHATSAPP_ACCESS_TOKEN
      ? `set (${env.META_WHATSAPP_ACCESS_TOKEN.slice(0, 8)}…)`
      : '(missing)',
  );
  console.log('[test:meta] recipient    :', recipient);

  if (!env.META_WHATSAPP_PHONE_NUMBER_ID || !env.META_WHATSAPP_ACCESS_TOKEN) {
    throw new Error(
      'META_WHATSAPP_PHONE_NUMBER_ID and META_WHATSAPP_ACCESS_TOKEN must be set in .env.local',
    );
  }
  if (env.META_WHATSAPP_ACCESS_TOKEN === 'PASTE_YOUR_TOKEN_HERE') {
    throw new Error('META_WHATSAPP_ACCESS_TOKEN is still the placeholder — paste a real token.');
  }

  const provider = new MetaWhatsAppProvider({ fetchImpl: loggingFetch });

  const body = `Theone.pt Meta test ✅ — ${new Date().toISOString()}`;
  console.log('[test:meta] sending text :', body);

  try {
    const result = await provider.sendText({ recipientPhone: recipient, body });
    console.log('[test:meta] SUCCESS — normalized SendResult:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof WhatsAppError) {
      console.error('[test:meta] FAILED — WhatsAppError:');
      console.error(
        JSON.stringify(
          {
            code: err.code,
            message: err.message,
            providerCode: err.providerCode,
            retryable: err.retryable,
            provider: err.provider,
          },
          null,
          2,
        ),
      );
    } else {
      console.error('[test:meta] FAILED — unexpected error:', err);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('[test:meta] fatal:', err);
    process.exit(1);
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 300).unref();
  });
