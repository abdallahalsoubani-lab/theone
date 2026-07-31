import { describe, expect, it } from 'vitest';

import { ARRIVAL_TEMPLATES, applyArrivalTemplate } from '../arrival-templates';

/**
 * July 31 item 3 — the arrival-template registration: UPSERT semantics
 * (production has no row yet), system-actor audit rows, idempotent re-run =
 * no-op, loud SID validation. Mirrors the P54 switch-v2 test harness.
 */

function fakeDb(rows: Record<string, Record<string, unknown>>) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const creates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const client = {
    whatsAppTemplate: {
      findUnique: async ({
        where,
      }: {
        where: { name_language: { name: string; language: string } };
      }) => rows[`${where.name_language.name}/${where.name_language.language}`] ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        return data;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        creates.push(data);
        return { id: 'new-1', ...data };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  };
  return { client: client as never, updates, creates, audits };
}

const AR = ARRIVAL_TEMPLATES[0]!;
const EN = ARRIVAL_TEMPLATES[1]!;

describe('applyArrivalTemplate', () => {
  it('creates the row when production has none (SID + shape + body + console name), audited', async () => {
    const { client, creates, updates, audits } = fakeDb({});
    const r = await applyArrivalTemplate(AR, client);
    expect(r).toMatchObject({ created: true, changed: true });
    expect(updates).toHaveLength(0);
    expect(creates[0]).toMatchObject({
      name: 'arrival_confirmation',
      language: 'AR',
      category: 'APPOINTMENT',
      twilioContentSid: 'HX46afd71b051d70eba25b858cb18fda96',
      twilioApproved: true,
      variablesShape: ['patientName'],
      metaTemplateName: 'arrival_confirmation_ar',
      active: true,
    });
    expect(String(creates[0]!.contentPreview)).toContain('تم تسجيل وصولك');
    expect(audits[0]).toMatchObject({
      actorId: 'system',
      entityType: 'WhatsAppTemplate',
      after: { event: 'ARRIVAL_TEMPLATE_CREATED', twilioContentSid: AR.expectedSid },
    });
  });

  it('converges an existing (e.g. dev-seeded, SID-less) row via UPDATE, audited', async () => {
    const { client, updates, creates, audits } = fakeDb({
      'arrival_confirmation/EN': {
        id: 't9',
        twilioContentSid: null,
        variablesShape: ['patientName'],
        contentPreview: EN.contentPreview,
      },
    });
    const r = await applyArrivalTemplate(EN, client);
    expect(r).toMatchObject({ id: 't9', created: false, changed: true });
    expect(creates).toHaveLength(0);
    expect(updates[0]!.data).toMatchObject({
      twilioContentSid: 'HXc886a2ffcb7a711a63623cf91decacf9',
      twilioApproved: true,
      active: true,
    });
    expect(audits[0]).toMatchObject({ after: { event: 'ARRIVAL_TEMPLATE_APPLIED' } });
  });

  it('idempotent: an already-registered row is a NO-OP (no write, no audit)', async () => {
    const { client, updates, creates, audits } = fakeDb({
      'arrival_confirmation/AR': {
        id: 't1',
        twilioContentSid: AR.expectedSid,
        variablesShape: ['patientName'],
        contentPreview: AR.contentPreview,
      },
    });
    const r = await applyArrivalTemplate(AR, client);
    expect(r.changed).toBe(false);
    expect(updates).toHaveLength(0);
    expect(creates).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('malformed SID in the catalog refuses loudly', async () => {
    const { client } = fakeDb({});
    await expect(applyArrivalTemplate({ ...AR, expectedSid: 'not-a-sid' }, client)).rejects.toThrow(
      /invalid SID/,
    );
  });
});

describe('the catalog itself', () => {
  it('exactly the two owner-created console templates, {{1}}-only bodies, valid SIDs', () => {
    expect(ARRIVAL_TEMPLATES).toHaveLength(2);
    expect(ARRIVAL_TEMPLATES.map((e) => `${e.consoleName}/${e.language}`)).toEqual([
      'arrival_confirmation_ar/AR',
      'arrival_confirmation_en/EN',
    ]);
    for (const e of ARRIVAL_TEMPLATES) {
      expect(/^HX[0-9a-f]{32}$/i.test(e.expectedSid), e.consoleName).toBe(true);
      expect(e.contentPreview).toContain('{{1}}');
      expect(e.contentPreview).not.toContain('{{2}}');
    }
  });
});
