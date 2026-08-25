import { describe, expect, it } from 'vitest';

/**
 * P52 — the new-patient booking + link regeneration are staff-only. The
 * permission MATRIX is pinned in lib/rbac/__tests__/can.test.ts; here we
 * pin that the action layer actually gates on BOTH permissions the flow
 * exercises (patients.create + appointments.create), and that the intake
 * regenerate action gates on patients.create.
 */
const read = async (rel: string) => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  return readFileSync(join(process.cwd(), rel), 'utf8');
};

describe('new-patient booking action RBAC', () => {
  it('createNewPatientBookingAction requires patients.create AND appointments.create', async () => {
    const src = await read('lib/appointments/actions.ts');
    const fn = src.slice(src.indexOf('export async function createNewPatientBookingAction'));
    expect(fn).toContain("await requirePermission('patients.create')");
    expect(fn).toContain("await requirePermission('appointments.create')");
  });

  it('regenerateIntakeLinkAction requires patients.create', async () => {
    const src = await read('lib/intake-links/actions.ts');
    expect(src).toContain("await requirePermission('patients.create')");
  });

  it('the public token submit action is UNAUTHENTICATED but rate-limited (no requirePermission)', async () => {
    const src = await read('lib/intake-links/publicActions.ts');
    expect(src).not.toContain('requirePermission');
    expect(src).toContain('rateLimit(');
  });

  it('tokens are never logged in full — only the redacted form is used', async () => {
    const submit = await read('lib/intake-links/submit.ts');
    expect(submit).toContain('redactToken(');
    // The token only ever reaches a log via redactToken — never raw.
    expect(submit).not.toMatch(/token=\$\{data\.token\}/);
    expect(submit).toContain('redactToken(data.token)');
  });
});
