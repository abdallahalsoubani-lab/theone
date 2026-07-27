import { describe, expect, it } from 'vitest';

import { V2_SWITCH, applyV2Switch } from '../switch-v2';

/**
 * P54 — the v2 switch: fields applied in one step, system-actor audit row
 * per switched template, idempotent re-run = no-op, loud SID validation.
 */

function fakeDb(rows: Record<string, Record<string, unknown>>) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
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
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  };
  return { client: client as never, updates, audits };
}

const AR_REMINDER = V2_SWITCH[0]!;

describe('applyV2Switch', () => {
  it('applies SID + 4-var shape + approved body + console name, audited with system actor', async () => {
    const { client, updates, audits } = fakeDb({
      'appointment_reminder_v2/AR': {
        id: 't1',
        twilioContentSid: 'HX00000000000000000000000000000000',
        variablesShape: ['therapistName', 'time', 'date'],
        contentPreview: 'old body',
      },
    });
    const r = await applyV2Switch(AR_REMINDER, client);
    expect(r).toMatchObject({ id: 't1', changed: true });
    expect(updates[0]!.data).toMatchObject({
      twilioContentSid: 'HX02b49c81870548566f36e7ed8098a2a7',
      twilioApproved: true,
      variablesShape: ['patientName', 'dayName', 'date', 'time'],
      metaTemplateName: 'appointment_reminder_ar_v2',
      active: true,
    });
    expect(String(updates[0]!.data.contentPreview)).toContain('نذكّركم بموعدكم يوم {{2}}');
    expect(audits[0]).toMatchObject({
      actorId: 'system',
      entityType: 'WhatsAppTemplate',
      after: { event: 'TEMPLATE_V2_SWITCH', twilioContentSid: AR_REMINDER.expectedSid },
    });
  });

  it('idempotent: an already-switched row is a NO-OP (no update, no audit)', async () => {
    const { client, updates, audits } = fakeDb({
      'appointment_reminder_v2/AR': {
        id: 't1',
        twilioContentSid: AR_REMINDER.expectedSid,
        variablesShape: ['patientName', 'dayName', 'date', 'time'],
        contentPreview: AR_REMINDER.contentPreview,
      },
    });
    const r = await applyV2Switch(AR_REMINDER, client);
    expect(r.changed).toBe(false);
    expect(updates).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('missing registry row → loud stop', async () => {
    const { client } = fakeDb({});
    await expect(applyV2Switch(AR_REMINDER, client)).rejects.toThrow(/registry row missing/);
  });

  it('malformed SID in the catalog would refuse (defense in depth)', async () => {
    const { client } = fakeDb({
      'appointment_reminder_v2/AR': { id: 't1', twilioContentSid: null, variablesShape: null },
    });
    await expect(
      applyV2Switch({ ...AR_REMINDER, expectedSid: 'not-a-sid' }, client),
    ).rejects.toThrow(/invalid SID/);
  });
});

describe('the catalog itself', () => {
  it('exactly the four owner-confirmed switches — confirmation/cancellation untouched', () => {
    expect(V2_SWITCH).toHaveLength(4);
    const names = V2_SWITCH.map((e) => `${e.logicalName}/${e.language}`);
    expect(names).toEqual([
      'appointment_reminder_v2/AR',
      'appointment_reminder_v2/EN',
      'appointment_rescheduled/AR',
      'appointment_rescheduled/EN',
    ]);
    expect(V2_SWITCH.every((e) => /^HX[0-9a-f]{32}$/i.test(e.expectedSid))).toBe(true);
    expect(V2_SWITCH.some((e) => e.logicalName.includes('confirmation'))).toBe(false);
    expect(V2_SWITCH.some((e) => e.logicalName.includes('cancelled'))).toBe(false);
  });

  it('every body uses the 4-var day-name placeholders', () => {
    for (const e of V2_SWITCH) {
      for (const n of ['{{1}}', '{{2}}', '{{3}}', '{{4}}']) {
        expect(e.contentPreview, e.consoleName).toContain(n);
      }
    }
  });
});
