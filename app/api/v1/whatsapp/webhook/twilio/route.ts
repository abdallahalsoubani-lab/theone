import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { whatsapp } from '@/lib/whatsapp';
import { processWebhookEvents } from '@/lib/whatsapp/inbound/process';

/**
 * Twilio WhatsApp webhook endpoint.
 *
 * Handles both shapes Twilio posts to this single URL:
 *   - Status callbacks (MessageStatus: queued | sent | delivered | read | failed)
 *   - Inbound messages (From + Body)
 *
 * Verification: Twilio signs the request with `X-Twilio-Signature`,
 * computed over the URL + sorted form fields. Failed verification
 * responds 403 — the provider stops retrying after consistent rejects.
 *
 * Idempotency: providers retry webhooks. The inbound processor uses a
 * Redis SET with 7-day TTL to deduplicate inbound and short-circuits
 * status updates that don't move the state forward.
 *
 * Configure in Twilio Console → Messaging → Try it → WhatsApp → Sandbox
 * settings (or, in production, the WhatsApp Senders page):
 *   When a message comes in:  https://<host>/api/v1/whatsapp/webhook/twilio
 *   Status callback URL:      same
 */
export async function POST(req: Request): Promise<Response> {
  // Reject early if this route is hit while a different provider is
  // active. Returning 403 (not 404) signals "this is intentional, stop
  // sending" rather than implying the route doesn't exist.
  if (whatsapp.id !== 'twilio') {
    return new NextResponse('forbidden — wrong provider', { status: 403 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-twilio-signature') ?? '';
  // The URL Twilio used to deliver the webhook. Behind a proxy / ngrok
  // we cannot rely on req.url because it may carry the internal host.
  // The public URL is configured via NEXT_PUBLIC_APP_URL and pinned here
  // — keep it in sync with the URL configured in Twilio Console.
  const url = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '') + '/api/v1/whatsapp/webhook/twilio';

  if (!whatsapp.verifyWebhook({ rawBody, signature, url })) {
    return new NextResponse('forbidden', { status: 403 });
  }

  const events = whatsapp.parseWebhook(rawBody);
  await processWebhookEvents(events);
  return new NextResponse('ok', { status: 200 });
}
