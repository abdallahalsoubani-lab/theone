import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Auto-reply inventory sweep (owner ruling, P49 follow-up incident).
 *
 * A patient who sent "شكرا" received a literal "ok" — the Twilio webhook's
 * text/plain HTTP response body, which Twilio echoes back as a reply
 * message, bypassing the queue AND the 1h human-reply suppression.
 *
 * The ruling: the ONLY automatic replies to inbound messages are the two
 * 48b acks (confirm + decline/apology), both behind the ackSuppressed
 * guard. Everything else lands unread in the WhatsApp Inbox for a human.
 *
 * These tests scan the SOURCE of the two places an auto-reply can
 * physically originate — the inbound processor and the webhook routes —
 * so any future third path fails CI, not production.
 */

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

describe('inbound processor — exactly two ack call sites, both suppression-guarded', () => {
  const source = read('lib/whatsapp/inbound/process.ts');

  it('has exactly 2 enqueueWhatsappOutbound call sites (confirm ack + decline ack)', () => {
    const calls = source.match(/enqueueWhatsappOutbound\(\{/g) ?? [];
    expect(calls).toHaveLength(2);
  });

  it('every ack call site sits behind the ackSuppressed guard', () => {
    const guards = source.match(/if \(args\.ackSuppressed\) return;/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
    // And each guard must come BEFORE its enqueue within the same handler:
    for (const handler of ['handleConfirm', 'handleCancelRequest']) {
      const start = source.indexOf(`async function ${handler}`);
      const end = source.indexOf('async function', start + 1);
      const body = source.slice(start, end === -1 ? undefined : end);
      const guardIdx = body.indexOf('if (args.ackSuppressed) return;');
      const sendIdx = body.indexOf('enqueueWhatsappOutbound({');
      expect(guardIdx, `${handler} must guard before sending`).toBeGreaterThan(-1);
      expect(sendIdx, `${handler} must contain its ack send`).toBeGreaterThan(guardIdx);
    }
  });

  it('reschedule + unknown handlers send NOTHING', () => {
    for (const handler of ['handleRescheduleRequest', 'handleUnknown']) {
      const start = source.indexOf(`async function ${handler}`);
      const end = source.indexOf('async function', start + 1);
      const body = source.slice(start, end === -1 ? undefined : end);
      expect(body).not.toContain('enqueueWhatsappOutbound');
      expect(body).not.toContain('sendText');
    }
  });
});

describe('webhook routes — HTTP response bodies can never become replies', () => {
  it('twilio route returns empty TwiML, never a text/plain body (the live "ok" bug)', () => {
    const source = read('app/api/v1/whatsapp/webhook/twilio/route.ts');
    expect(source).not.toMatch(/NextResponse\(\s*['"]ok['"]/);
    expect(source).toContain('<Response></Response>');
    expect(source).toContain("'content-type': 'text/xml'");
  });

  it('meta route returns an empty 200 body', () => {
    const source = read('app/api/v1/whatsapp/webhook/meta/route.ts');
    // The POST handler's success response must carry no body. (The GET
    // hub.challenge echo is Meta's own verification protocol — allowed.)
    const post = source.slice(source.indexOf('export async function POST'));
    // No 200 response may carry a text body (403 rejects are fine — the
    // provider treats non-2xx as failure and never echoes them).
    expect(post).not.toMatch(/NextResponse\(\s*['"][^)]*status:\s*200/);
    expect(post).toContain('NextResponse(null, { status: 200 })');
  });
});
