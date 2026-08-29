import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P58 item 3 — the phone backfill: recoverable malformed numbers normalise
 * via the SAME chain the entry points use; unrecoverable ones are listed
 * for manual correction, never guessed (a wrong normalisation could message
 * a stranger — P50 owner ruling #5). Dry-run is the default and writes
 * nothing.
 */

vi.mock('@/lib/db', () => ({ db: {} }));

import { runPhoneFix, type PhoneFixDb } from '../fix-international-phones';

interface FakeUser {
  id: string;
  phone: string | null;
  fullNameEn: string;
  role: string;
}

function makeDb(users: FakeUser[]) {
  const updates: Array<{ id: string; phone: string }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const db: PhoneFixDb = {
    user: {
      findMany: async () => users,
      update: async ({ where, data }) => {
        updates.push({ id: where.id, phone: data.phone });
        const u = users.find((x) => x.id === where.id);
        if (u) u.phone = data.phone;
        return {};
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data);
        return {};
      },
    },
  };
  return { db, updates, audits };
}

const USERS = (): FakeUser[] => [
  { id: 'u1', phone: '+962790123456', fullNameEn: 'Clean JO', role: 'PATIENT' },
  { id: 'u2', phone: '+97433991799', fullNameEn: 'Clean Intl', role: 'PATIENT' },
  // The real production case: quick-add stored the pasted text verbatim.
  { id: 'u3', phone: '+972 52-505-4631', fullNameEn: 'Saed', role: 'PATIENT' },
  // Recoverable via the Jordanian branch.
  { id: 'u4', phone: '0790000111', fullNameEn: 'Local Shape', role: 'PATIENT' },
  // Unrecoverable: national format with no country code.
  { id: 'u5', phone: '052-505-4631', fullNameEn: 'No Country Code', role: 'PATIENT' },
];

const silent = { log: () => undefined };

beforeEach(() => vi.clearAllMocks());

describe('runPhoneFix', () => {
  it('dry-run identifies fixes + unrecoverables and writes NOTHING', async () => {
    const { db, updates, audits } = makeDb(USERS());
    const r = await runPhoneFix({ db, ...silent }, { apply: false });

    expect(r.scanned).toBe(5);
    expect(r.malformed).toBe(3);
    expect(r.fixed).toEqual([
      { id: 'u3', role: 'PATIENT', from: '+972 52-505-4631', to: '+972525054631' },
      { id: 'u4', role: 'PATIENT', from: '0790000111', to: '+962790000111' },
    ]);
    expect(r.unrecoverable).toEqual([
      { id: 'u5', role: 'PATIENT', name: 'No Country Code', raw: '052-505-4631' },
    ]);
    expect(updates).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('--apply writes the recoverable fixes with one audit row each + a summary row', async () => {
    const users = USERS();
    const { db, updates, audits } = makeDb(users);
    const r = await runPhoneFix({ db, ...silent }, { apply: true });

    expect(r.fixed).toHaveLength(2);
    expect(updates).toEqual([
      { id: 'u3', phone: '+972525054631' },
      { id: 'u4', phone: '+962790000111' },
    ]);
    // Unrecoverable row untouched.
    expect(users.find((u) => u.id === 'u5')!.phone).toBe('052-505-4631');
    // Per-fix audits + the summary.
    const events = audits.map((a) => (a.after as { event: string }).event);
    expect(events.filter((e) => e === 'PHONE_BACKFILL_NORMALIZED')).toHaveLength(2);
    expect(events).toContain('PHONE_BACKFILL_COMPLETED');
    expect(audits.every((a) => a.actorId === 'system')).toBe(true);
  });

  it('a second apply run is a no-op (idempotent — everything already canonical)', async () => {
    const users = USERS();
    const { db } = makeDb(users);
    await runPhoneFix({ db, ...silent }, { apply: true });

    const second = makeDb(users);
    const r = await runPhoneFix({ db: second.db, ...silent }, { apply: true });
    expect(r.fixed).toHaveLength(0);
    expect(second.updates).toHaveLength(0);
    // Only the still-unrecoverable row remains flagged.
    expect(r.malformed).toBe(1);
    expect(r.unrecoverable).toHaveLength(1);
  });

  it('masks phones in its own console output (last 3 digits only)', async () => {
    const lines: string[] = [];
    const { db } = makeDb(USERS());
    await runPhoneFix({ db, log: (m) => lines.push(m) }, { apply: false });
    const joined = lines.join('\n');
    expect(joined).not.toContain('+972 52-505-4631');
    expect(joined).not.toContain('+972525054631');
    expect(joined).toContain('631'); // last-3 masks present
  });
});
