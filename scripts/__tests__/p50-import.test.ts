import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P50 (revised) §7 — roster import tests.
 *
 * The single most important assertion in this prompt: the import is
 * COMPLETELY SILENT — the WhatsApp layer, the outbound queue, and the
 * notification module are never invoked (spies stay at zero calls).
 */

// The script imports `db` at module level; keep it inert — every DB access in
// these tests goes through the explicitly injected mock client instead.
vi.mock('@/lib/db', () => ({ db: {} }));

// assignment.ts pulls withAudit → @/auth → next-auth, which cannot load in the
// vitest node environment. The audited exports are unused by the import script
// (it uses addCareTeamMemberTx only), so a pass-through stub is faithful.
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (_cfg: unknown, fn: (...args: never[]) => unknown) => fn,
}));

// Silence tripwires — the import script must never even import these. If a
// future edit wires them in, these spies catch the regression.
const whatsappSpy = vi.fn();
const outboundSpy = vi.fn();
const notificationSpy = vi.fn();
vi.mock('@/lib/whatsapp', () => ({
  whatsapp: { sendTemplate: whatsappSpy, sendText: whatsappSpy },
}));
vi.mock('@/lib/queue/jobs/whatsappOutbound', () => ({
  enqueueWhatsappOutbound: outboundSpy,
}));
vi.mock('@/lib/notifications/actions', () => ({
  createNotification: notificationSpy,
}));

import { IMPORT_QUESTIONS } from '@/lib/intake/import-mapping';

import {
  matchTherapist,
  prepareRows,
  resolvePhone,
  runImport,
  UNKNOWN_DOB_SENTINEL,
} from '../p50-import-patients';
import { readXlsx } from '../xlsx-lite';

const FIXTURE = join(__dirname, 'fixtures', 'p50-sample.xlsx');

// ─── Mock Prisma client ────────────────────────────────────────────────────

function makePrisma() {
  const created = {
    users: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
    intakes: [] as Array<Record<string, unknown>>,
    answers: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
    careTeam: [] as Array<Record<string, unknown>>,
  };
  const existingIds = new Set<string>();
  let intakeSeq = 0;

  const tx = {
    user: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.users.push(data);
        return data;
      }),
    },
    patientProfile: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.profiles.push(data);
        return data;
      }),
    },
    intakeAssessment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.intakes.push(data);
        return { id: `intake-${++intakeSeq}` };
      }),
    },
    intakeCustomAnswer: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.answers.push(data);
        return data;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.audits.push(data);
        return data;
      }),
    },
    careTeamMember: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        created.careTeam.push(create);
        return create;
      }),
    },
  };

  const prisma = {
    intakeCustomQuestion: {
      findMany: vi.fn(async () =>
        IMPORT_QUESTIONS.map((q, i) => ({ id: `q-${i}`, nameAr: q.nameAr })),
      ),
    },
    user: {
      findMany: vi.fn(async ({ where }: { where?: { id?: { in: string[] }; role?: string } }) => {
        if (where?.role === 'THERAPIST') return []; // matching covered separately
        return [...existingIds].filter((id) => where?.id?.in.includes(id)).map((id) => ({ id }));
      }),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.audits.push(data);
        return data;
      }),
    },
  };
  return { prisma, created, existingIds };
}

// ─── Unit: phone rules (owner ruling #5) ───────────────────────────────────

describe('resolvePhone — the nine broken numbers null out, nothing gets fabricated', () => {
  it('keeps a valid Jordan number and a valid international number', () => {
    expect(resolvePhone('+962791234567', '0791234567')).toEqual({
      phone: '+962791234567',
      broken: false,
    });
    expect(resolvePhone('+97433991799', '+97433991799')).toEqual({
      phone: '+97433991799',
      broken: false,
    });
  });

  it('nulls non-E.164 values (date leak, truncated numbers)', () => {
    expect(resolvePhone('+29', '29/1/2024').phone).toBeNull();
    expect(resolvePhone('+6919077', '6919077').broken).toBe(true);
    expect(resolvePhone('+5059403', '5059403').broken).toBe(true);
  });

  it('nulls a +7 number whose source had no country code (broken Jordanian entry)', () => {
    expect(resolvePhone('+7987524466', '7987524466')).toEqual({ phone: null, broken: true });
  });

  it('keeps a genuine +7 number when the source itself carried the country code', () => {
    expect(resolvePhone('+79875244660', '+7 987 524 46 60').broken).toBe(false);
  });

  it('empty stays empty without counting as broken', () => {
    expect(resolvePhone('', '')).toEqual({ phone: null, broken: false });
  });
});

// ─── Fixture: parser + preparation ─────────────────────────────────────────

describe('xlsx-lite + prepareRows on the fixture workbook', () => {
  const sheets = readXlsx(FIXTURE);

  it('reads sheets and Arabic cell content', () => {
    expect([...sheets.keys()]).toContain('سجلات الاستيراد');
    const rows = sheets.get('سجلات الاستيراد')!;
    expect(rows).toHaveLength(7); // header + 6
    expect(rows[1]![3]).toBe('سارة خليل');
  });

  it('prepares rows honouring SKIP and MERGE, with correct field mapping', () => {
    const prep = prepareRows(sheets.get('سجلات الاستيراد')!);
    expect(prep.rejections).toHaveLength(0);
    expect(prep.skipped).toEqual(['AD-3']);
    expect(prep.merged).toEqual([{ key: 'OLD-1', into: 'AD-1' }]);
    // 6 rows − 1 SKIP − 1 MERGE = 4 written
    expect(prep.prepared.map((r) => r.key)).toEqual(['AD-1', 'PED-1', 'AD-2', 'PED-2']);

    const ad1 = prep.prepared[0]!;
    expect(ad1.id).toBe('p50-ad-1');
    expect(ad1.fullNameAr).toBe('سارة خليل');
    // Owner ruling #4: THYROID_DISORDER→THYROID, STROKE→CEREBRAL_CLOT — in
    // the archive note (the NOT NULL detail tables are never fabricated).
    expect(ad1.archiveNote).toContain('THYROID');
    expect(ad1.archiveNote).toContain('CEREBRAL_CLOT');
    expect(ad1.archiveNote).not.toContain('THYROID_DISORDER');
    // The MERGE row's notes folded into the target's archive note.
    expect(ad1.archiveNote).toContain('مدموج من OLD-1');
    expect(ad1.archiveNote).toContain('سجل قديم مدموج');

    const ped1 = prep.prepared[1]!;
    // Proposed Arabic name used when the original is empty.
    expect(ped1.fullNameAr).toBe('ليان أحمد');
    expect(ped1.gender).toBeNull();
    // Unknown DOB → sentinel; the age string archived, never parsed.
    expect(ped1.dateOfBirth).toBe(UNKNOWN_DOB_SENTINEL);
    expect(ped1.archiveNote).toContain('٣ سنوات');
    // VISION maps to the configured option; SENSORY stays free text.
    expect(ped1.problemsOptions).toEqual(['opt-2', 'opt-0']);
    expect(ped1.archiveNote).toContain('SENSORY');

    const ad2 = prep.prepared[2]!;
    expect(ad2.phone).toBeNull();
    expect(prep.brokenPhones).toEqual([{ key: 'AD-2', raw: '7987524466' }]);
    expect(ad2.archiveNote).toContain('7987524466');

    // Shared family number persists on both siblings' rows.
    expect(prep.prepared[1]!.phone).toBe('+962795550001');
    expect(prep.prepared[3]!.phone).toBe('+962795550001');
  });

  it('rejects a fabricated-looking DOB instead of importing it', () => {
    const rows = sheets.get('سجلات الاستيراد')!.map((r) => [...r]);
    const dobCol = rows[0]!.findIndex((h) => h.trim() === 'تاريخ الميلاد النهائي');
    rows[1]![dobCol] = '31/12/1990'; // not ISO — never silently parsed
    const prep = prepareRows(rows);
    expect(prep.rejections).toEqual([
      { key: 'AD-1', reason: expect.stringContaining('تاريخ الميلاد النهائي') },
    ]);
  });

  it('refuses when a decision cell is empty', () => {
    const rows = sheets.get('سجلات الاستيراد')!.map((r) => [...r]);
    const decCol = rows[0]!.findIndex((h) => h.trim() === 'القرار');
    rows[2]![decCol] = '';
    expect(() => prepareRows(rows)).toThrow(/القرار/);
  });
});

// ─── runImport: silence, counts, idempotency ───────────────────────────────

describe('runImport (fixture, mocked prisma)', () => {
  beforeEach(() => {
    whatsappSpy.mockClear();
    outboundSpy.mockClear();
    notificationSpy.mockClear();
  });

  it('APPLY writes 4 patients + IN_PROGRESS intakes and stays COMPLETELY SILENT', async () => {
    const { prisma, created } = makePrisma();
    const counters = await runImport({ file: FIXTURE, apply: true }, prisma as never);

    expect(counters.read).toBe(6);
    expect(counters.toWrite).toBe(4);
    expect(counters.written).toBe(4);
    expect(counters.skippedDecision).toBe(1);
    expect(counters.merged).toBe(1);
    expect(counters.failures).toHaveLength(0);

    // No portal login, no credentials, Arabic default.
    for (const u of created.users) {
      expect(u.passwordHash).toBeNull();
      expect(u.email).toBeNull();
      expect(u.languagePref).toBe('AR');
      expect(u.role).toBe('PATIENT');
    }
    // Every intake is IN_PROGRESS with the system assessor (imported marker).
    expect(created.intakes).toHaveLength(4);
    for (const i of created.intakes) {
      expect(i.status).toBe('IN_PROGRESS');
      expect(i.assessedById).toBe('system');
    }
    // 4 archive answers + 1 problems answer (PED-1).
    expect(created.answers).toHaveLength(5);
    // One audit row per patient + one summary row.
    expect(created.audits).toHaveLength(5);
    const summaryRow = created.audits.at(-1) as { after: Record<string, unknown> };
    expect(summaryRow.after.event).toBe('P50_ROSTER_IMPORT_SUMMARY');

    // THE assertion: total silence.
    expect(whatsappSpy).not.toHaveBeenCalled();
    expect(outboundSpy).not.toHaveBeenCalled();
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('is idempotent — a second run writes nothing', async () => {
    const { prisma, created, existingIds } = makePrisma();
    for (const id of ['p50-ad-1', 'p50-ped-1', 'p50-ad-2', 'p50-ped-2']) existingIds.add(id);
    const counters = await runImport({ file: FIXTURE, apply: true }, prisma as never);
    expect(counters.skippedExisting).toBe(4);
    expect(counters.written).toBe(0);
    expect(created.users).toHaveLength(0);
  });

  it('dry-run reads and counts but writes nothing at all', async () => {
    const { prisma, created } = makePrisma();
    const counters = await runImport({ file: FIXTURE, apply: false }, prisma as never);
    expect(counters.toWrite).toBe(4);
    expect(created.users).toHaveLength(0);
    expect(created.audits).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─── Therapist matching ────────────────────────────────────────────────────

describe('matchTherapist', () => {
  const staff = [
    { id: 't1', fullNameEn: 'Rana Yousef', fullNameAr: 'رنا يوسف' },
    { id: 't2', fullNameEn: 'Lina Odeh', fullNameAr: 'لينا عودة' },
    { id: 't3', fullNameEn: 'Lina Awad', fullNameAr: 'لينا عوض' },
  ];

  it('matches an exact Arabic name', () => {
    expect(matchTherapist('رنا يوسف', staff)).toBe('t1');
  });

  it('refuses an ambiguous partial (two Linas) — no arbitrary link', () => {
    expect(matchTherapist('لينا', staff)).toBeNull();
  });

  it('returns null for an unknown name', () => {
    expect(matchTherapist('غادة سمير', staff)).toBeNull();
  });
});
