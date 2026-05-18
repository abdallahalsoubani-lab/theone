import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Verifies the WHATSAPP_PROVIDER env switch resolves to the expected
 * implementation. The factory holds a singleton on globalThis to survive
 * hot reload, so each test isolates by stashing + restoring that slot and
 * by re-importing the module after the env mock changes.
 */

const globalForWa = globalThis as unknown as { whatsapp?: { id: string } };

describe('lib/whatsapp factory selection by WHATSAPP_PROVIDER', () => {
  let restoreWhatsapp: { id: string } | undefined;
  let restoreNodeEnv: string | undefined;

  beforeEach(() => {
    restoreWhatsapp = globalForWa.whatsapp;
    globalForWa.whatsapp = undefined;
    restoreNodeEnv = process.env.NODE_ENV;
    // Force test env so the health-check fire-and-forget is suppressed.
    (process.env as Record<string, string>).NODE_ENV = 'test';
    vi.resetModules();
  });

  afterEach(() => {
    globalForWa.whatsapp = restoreWhatsapp;
    (process.env as Record<string, string>).NODE_ENV = restoreNodeEnv ?? 'test';
    vi.resetModules();
    vi.doUnmock('@/lib/env');
  });

  it('selects console by default', async () => {
    vi.doMock('@/lib/env', () => ({ env: { WHATSAPP_PROVIDER: 'console' } }));
    const mod = await import('../index');
    expect(mod.whatsapp.id).toBe('console');
  });

  it('selects twilio when WHATSAPP_PROVIDER=twilio', async () => {
    vi.doMock('@/lib/env', () => ({
      env: { WHATSAPP_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '' },
    }));
    const mod = await import('../index');
    expect(mod.whatsapp.id).toBe('twilio');
  });

  it('selects meta when WHATSAPP_PROVIDER=meta', async () => {
    vi.doMock('@/lib/env', () => ({
      env: { WHATSAPP_PROVIDER: 'meta', META_WHATSAPP_PHONE_ID: '', META_WHATSAPP_TOKEN: '' },
    }));
    const mod = await import('../index');
    expect(mod.whatsapp.id).toBe('meta');
  });

  it('falls back to console for an unrecognized value', async () => {
    vi.doMock('@/lib/env', () => ({ env: { WHATSAPP_PROVIDER: 'unknown' } }));
    const mod = await import('../index');
    expect(mod.whatsapp.id).toBe('console');
  });
});
