import { describe, expect, it } from 'vitest';

import { isUrgentDispatch, URGENT_WINDOW_MS } from '../urgency';

/**
 * P50 (series 45+) item 1.3 — the outbox "urgent" badge is a pure, visual
 * threshold: starts within the next 24h. It informs; it never sends.
 */
const NOW = new Date('2030-03-10T10:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const H = 60 * 60 * 1000;

describe('isUrgentDispatch', () => {
  it('flags an appointment starting in 2h', () => {
    expect(isUrgentDispatch(at(2 * H), NOW)).toBe(true);
  });

  it('flags 23h59m but not exactly 24h (boundary excluded, same as the old exception)', () => {
    expect(isUrgentDispatch(at(URGENT_WINDOW_MS - 60_000), NOW)).toBe(true);
    expect(isUrgentDispatch(at(URGENT_WINDOW_MS), NOW)).toBe(false);
    expect(isUrgentDispatch(at(48 * H), NOW)).toBe(false);
  });

  it('never flags a slot that already started (nothing to beat) nor a missing appointment', () => {
    expect(isUrgentDispatch(at(-1), NOW)).toBe(false);
    expect(isUrgentDispatch(NOW, NOW)).toBe(false);
    expect(isUrgentDispatch(null, NOW)).toBe(false);
  });

  it('is pure — the module sends nothing and touches no queue or scheduler', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'lib/whatsapp/dispatch/urgency.ts'), 'utf8');
    expect(src).not.toMatch(/import\s/); // no imports at all
    expect(src).not.toContain('scheduleLifecycleMessage');
    expect(src).not.toContain('reminderQueue');
  });
});
