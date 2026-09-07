import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APPROVAL_TRACKED, syncTemplateApproval } from '@/lib/whatsapp/templates/approvalSync';

import {
  CUSTOM_MESSAGE_TEMPLATES,
  CUSTOM_MESSAGE_TEMPLATE_NAME,
  applyCustomMessageTemplate,
} from '../custom-message-template';

/**
 * P60 — the custom-message frame registration (P56 pattern): UPSERT with
 * twilioApproved=false, system-actor audit rows, idempotent re-run = no-op,
 * loud SID validation; the two rows are tracked by the hourly approval sync
 * which flips twilioApproved (and audits the switch) when WhatsApp approves.
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

const AR = CUSTOM_MESSAGE_TEMPLATES[0]!;
const EN = CUSTOM_MESSAGE_TEMPLATES[1]!;

describe('applyCustomMessageTemplate', () => {
  it('creates the row (SID + shape + body + console name, twilioApproved=false), audited', async () => {
    const { client, creates, updates, audits } = fakeDb({});
    const r = await applyCustomMessageTemplate(AR, client);
    expect(r).toMatchObject({ created: true, changed: true });
    expect(updates).toHaveLength(0);
    expect(creates[0]).toMatchObject({
      name: 'clinic_custom_message',
      language: 'AR',
      category: 'APPOINTMENT',
      twilioContentSid: 'HX318759369c2b8d4c72adb0bfe9b812ff',
      twilioApproved: false,
      variablesShape: ['patientName', 'customText'],
      metaTemplateName: 'clinic_custom_message_ar',
      active: true,
    });
    expect(String(creates[0]!.contentPreview)).toContain('رسالة من المركز الأول للعلاج الطبيعي');
    expect(audits[0]).toMatchObject({
      actorId: 'system',
      entityType: 'WhatsAppTemplate',
      after: { event: 'CUSTOM_MESSAGE_TEMPLATE_CREATED', twilioContentSid: AR.expectedSid },
    });
  });

  it('converges an existing row via UPDATE without pre-approving it, audited', async () => {
    const { client, updates, creates, audits } = fakeDb({
      'clinic_custom_message/EN': {
        id: 't9',
        twilioContentSid: null,
        variablesShape: null,
        contentPreview: EN.contentPreview,
      },
    });
    const r = await applyCustomMessageTemplate(EN, client);
    expect(r).toMatchObject({ id: 't9', created: false, changed: true });
    expect(creates).toHaveLength(0);
    expect(updates[0]!.data).toMatchObject({
      twilioContentSid: 'HXa9c5ef16883cba246d296c947e2f9e98',
      twilioApproved: false,
      variablesShape: ['patientName', 'customText'],
      active: true,
    });
    expect(audits[0]).toMatchObject({ after: { event: 'CUSTOM_MESSAGE_TEMPLATE_APPLIED' } });
  });

  it('idempotent: a second --apply over a registered row is a NO-OP (no write, no audit)', async () => {
    const { client, updates, creates, audits } = fakeDb({
      'clinic_custom_message/AR': {
        id: 't1',
        twilioContentSid: AR.expectedSid,
        variablesShape: ['patientName', 'customText'],
        contentPreview: AR.contentPreview,
      },
    });
    const r = await applyCustomMessageTemplate(AR, client);
    expect(r.changed).toBe(false);
    expect(updates).toHaveLength(0);
    expect(creates).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('malformed SID in the catalog refuses loudly', async () => {
    const { client } = fakeDb({});
    await expect(
      applyCustomMessageTemplate({ ...AR, expectedSid: 'not-a-sid' }, client),
    ).rejects.toThrow(/invalid SID/);
  });
});

describe('the catalog + approval tracking', () => {
  it('exactly the two owner-created console templates with {{1}}/{{2}} bodies', () => {
    expect(CUSTOM_MESSAGE_TEMPLATES.map((e) => `${e.consoleName}/${e.language}`)).toEqual([
      'clinic_custom_message_ar/AR',
      'clinic_custom_message_en/EN',
    ]);
    for (const e of CUSTOM_MESSAGE_TEMPLATES) {
      expect(/^HX[0-9a-f]{32}$/i.test(e.expectedSid), e.consoleName).toBe(true);
      expect(e.contentPreview).toContain('{{1}}');
      expect(e.contentPreview).toContain('{{2}}');
    }
  });

  it('both rows are in APPROVAL_TRACKED with the same SIDs (the hourly sync flips them)', () => {
    const tracked = APPROVAL_TRACKED.filter((t) => t.name === CUSTOM_MESSAGE_TEMPLATE_NAME);
    expect(tracked.map((t) => `${t.language}:${t.sid}`).sort()).toEqual(
      CUSTOM_MESSAGE_TEMPLATES.map((e) => `${e.language}:${e.expectedSid}`).sort(),
    );
  });
});

// ─── approval sync flips the two rows ───────────────────────────────────────
const sync = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/env', () => ({ env: { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok' } }));
vi.mock('@/lib/db', () => ({
  db: {
    whatsAppTemplate: {
      findUnique: vi.fn(async () => ({ id: 'row', twilioApproved: false })),
      update: vi.fn(async (a: Record<string, unknown>) => {
        sync.updates.push(a);
        return {};
      }),
    },
    auditLog: {
      create: vi.fn(async (a: Record<string, unknown>) => {
        sync.audits.push(a);
        return {};
      }),
    },
  },
}));

describe('approval sync — the custom rows', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    sync.updates.length = 0;
    sync.audits.length = 0;
  });

  it('approved at WhatsApp → twilioApproved=true on both rows, switch audited', async () => {
    const fetchApproved = vi.fn(async () => ({
      ok: true,
      json: async () => ({ whatsapp: { status: 'approved' } }),
    })) as unknown as typeof fetch;
    const tracked = APPROVAL_TRACKED.filter((t) => t.name === CUSTOM_MESSAGE_TEMPLATE_NAME);
    const r = await syncTemplateApproval(tracked, fetchApproved);
    expect(r).toEqual({
      checked: 2,
      approved: 2,
      flipped: ['clinic_custom_message/AR', 'clinic_custom_message/EN'],
    });
    expect(sync.updates.map((u) => (u.data as { twilioApproved: boolean }).twilioApproved)).toEqual(
      [true, true],
    );
    expect(sync.audits).toHaveLength(2);
    expect(sync.audits[0]).toMatchObject({
      data: { after: { event: 'TEMPLATE_APPROVED_SWITCHED', template: 'clinic_custom_message' } },
    });
  });
});
