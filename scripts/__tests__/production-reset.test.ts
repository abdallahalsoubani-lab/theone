import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runProductionReset } from '../production-reset';

/**
 * P50 §3.2 — the wipe script's seatbelts, tested against a fake Prisma
 * client (the repo's test idiom is mocked units, not a fixture DB — the
 * live dry-run on the VM is the owner's fixture).
 */

type Call = { table: string; where?: unknown };

function fakeDb(opts?: { adminRole?: string; adminFound?: boolean }) {
  const deletes: Call[] = [];
  const admin =
    opts?.adminFound === false
      ? null
      : { id: 'admin-1', email: 'owner@theone.pt', role: opts?.adminRole ?? 'ADMIN' };
  const model = (table: string) => ({
    count: async () => 7,
    deleteMany: async (args?: { where?: unknown }) => {
      deletes.push({ table, where: args?.where });
      return { count: 7 };
    },
  });
  const client: Record<string, unknown> = {
    user: {
      findMany: async () => (admin ? [admin] : []),
      count: async () => 7,
      deleteMany: async (args?: { where?: unknown }) => {
        deletes.push({ table: 'user', where: args?.where });
        return { count: 7 };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(client),
  };
  for (const m of [
    'intakeCustomAnswer',
    'adultIntakeData',
    'pediatricIntakeData',
    'intakeAssessment',
    'intakeSubmission',
    'pediatricAssessment',
    'patientDocument',
    'homeProgramCompletion',
    'homeProgramApproval',
    'homeProgramItem',
    'planExercise',
    'sessionNote',
    'treatmentPlan',
    'dayReport',
    'doctorReview',
    'waitlistEntry',
    'appointmentPatient',
    'appointmentTherapist',
    'appointment',
    'whatsAppMessage',
    'whatsAppConversation',
    'inboxItem',
    'notification',
    'leave',
    'careTeamMember',
    'patientProfile',
    'auditLog',
    'userSpecialty',
    // Survivor tables — counted for the report, must NEVER be deleted.
    'clinicSettings',
    'whatsAppTemplate',
    'exercise',
    'specialty',
    'room',
    'intakeCustomQuestion',
    'pediatricCustomField',
  ]) {
    client[m] = client[m] ?? model(m);
  }
  return { client: client as never, deletes };
}

function backupFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p50-reset-'));
  const p = join(dir, 'backup.sql');
  writeFileSync(p, 'not-empty');
  return p;
}

const KEEP = { keepAdminEmails: ['owner@theone.pt'], backupPath: null };

describe('production-reset', () => {
  it('dry-run deletes NOTHING', async () => {
    const { client, deletes } = fakeDb();
    await runProductionReset({ apply: false, ...KEEP }, client);
    expect(deletes).toHaveLength(0);
  });

  it('apply without --backup-confirmed refuses', async () => {
    const { client, deletes } = fakeDb();
    await expect(
      runProductionReset({ apply: true, ...KEEP, backupPath: null }, client),
    ).rejects.toThrow(/backup-confirmed/);
    expect(deletes).toHaveLength(0);
  });

  it('apply with a missing backup file refuses', async () => {
    const { client, deletes } = fakeDb();
    await expect(
      runProductionReset({ apply: true, ...KEEP, backupPath: '/nope/backup.sql' }, client),
    ).rejects.toThrow(/not found/);
    expect(deletes).toHaveLength(0);
  });

  it('refuses when keep-admin is missing or not an ADMIN', async () => {
    const missing = fakeDb({ adminFound: false });
    await expect(runProductionReset({ apply: false, ...KEEP }, missing.client)).rejects.toThrow(
      /not found/,
    );
    const notAdmin = fakeDb({ adminRole: 'SECRETARY' });
    await expect(runProductionReset({ apply: false, ...KEEP }, notAdmin.client)).rejects.toThrow(
      /not an ADMIN/,
    );
  });

  it('apply wipes the wipe-list and the User delete EXCLUDES keep-admins + the system actor', async () => {
    const { client, deletes } = fakeDb();
    const result = await runProductionReset(
      { apply: true, ...KEEP, backupPath: backupFile() },
      client,
    );
    const userDelete = deletes.find((d) => d.table === 'user');
    expect(userDelete?.where).toEqual({ id: { notIn: ['admin-1', 'system'] } });
    expect(result.keptUserIds).toEqual(['admin-1', 'system']);
    // Owner-signed keep list: none of these tables may EVER be deleted.
    const touched = new Set(deletes.map((d) => d.table));
    for (const survivor of [
      'clinicSettings',
      'whatsAppTemplate',
      'exercise',
      'specialty',
      'room',
      'intakeCustomQuestion',
      'pediatricCustomField',
    ]) {
      expect(touched.has(survivor), `${survivor} must survive`).toBe(false);
    }
    // And the wipe list IS wiped (spot-check the big ones).
    for (const wiped of ['appointment', 'whatsAppMessage', 'auditLog', 'patientProfile']) {
      expect(touched.has(wiped), `${wiped} must be wiped`).toBe(true);
    }
  });
});
