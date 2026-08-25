import { describe, expect, it } from 'vitest';

import { PERMISSIONS, ROLE_PERMISSIONS } from '@/lib/rbac/permissions';
import { canSeeWhatsappAttachments } from '@/lib/whatsapp/inbox/queries';

/**
 * P56 — WhatsApp attachments are SECRETARY + ADMIN only (owner decision 2),
 * enforced at the serving route AND kept out of therapist/doctor payloads.
 * Mirrors the P15 phone-privacy assertion style.
 */
describe('WhatsApp attachment visibility (RBAC)', () => {
  it('only SECRETARY and ADMIN can see attachments', () => {
    expect(canSeeWhatsappAttachments('SECRETARY')).toBe(true);
    expect(canSeeWhatsappAttachments('ADMIN')).toBe(true);
    expect(canSeeWhatsappAttachments('DOCTOR')).toBe(false);
    expect(canSeeWhatsappAttachments('THERAPIST')).toBe(false);
    expect(canSeeWhatsappAttachments('PATIENT')).toBe(false);
  });

  it('the whatsapp_attachments.read permission is granted to SECRETARY + ADMIN only', () => {
    const holders = (['SECRETARY', 'ADMIN', 'DOCTOR', 'THERAPIST', 'PATIENT'] as const).filter(
      (role) => ROLE_PERMISSIONS[role].has(PERMISSIONS.WHATSAPP_ATTACHMENTS_READ),
    );
    expect(holders.sort()).toEqual(['ADMIN', 'SECRETARY']);
  });

  it('the serving route enforces the permission at the route (not just the UI)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'app/api/v1/whatsapp/attachments/[id]/route.ts'),
      'utf8',
    );
    expect(src).toContain("requirePermission('whatsapp_attachments.read')");
    // Range support present for video streaming.
    expect(src).toContain("req.headers.get('range')");
    expect(src).toContain('206');
  });
});
