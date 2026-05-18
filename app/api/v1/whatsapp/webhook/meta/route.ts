import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { whatsapp } from '@/lib/whatsapp';
import { processWebhookEvents } from '@/lib/whatsapp/inbound/process';

/**
 * Meta WhatsApp Cloud API webhook endpoint.
 *
 * Two routes hang off the same path:
 *   GET  — Meta's verification challenge. Meta sends `hub.mode=subscribe`,
 *          `hub.verify_token=<expected>`, and `hub.challenge=<random>`.
 *          We respond with the challenge string when the token matches.
 *   POST — actual events. Meta signs each request with
 *          `X-Hub-Signature-256: sha256=<hmac>` over the raw body using
 *          the WhatsApp Business App's app secret.
 *
 * Configure in Meta App Dashboard → WhatsApp → Configuration → Webhook:
 *   Callback URL: https://<host>/api/v1/whatsapp/webhook/meta
 *   Verify token: <value of META_WHATSAPP_VERIFY_TOKEN>
 * Then subscribe the WhatsApp Business Account to the `messages` field
 * so inbound + status events flow.
 */

export async function GET(req: Request): Promise<Response> {
  if (whatsapp.id !== 'meta') {
    return new NextResponse('forbidden — wrong provider', { status: 403 });
  }
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = env.META_WHATSAPP_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }
  return new NextResponse('forbidden', { status: 403 });
}

export async function POST(req: Request): Promise<Response> {
  if (whatsapp.id !== 'meta') {
    return new NextResponse('forbidden — wrong provider', { status: 403 });
  }
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256') ?? '';
  if (!whatsapp.verifyWebhook({ rawBody, signature, url: '' })) {
    return new NextResponse('forbidden', { status: 403 });
  }
  const events = whatsapp.parseWebhook(rawBody);
  await processWebhookEvents(events);
  return new NextResponse('ok', { status: 200 });
}
