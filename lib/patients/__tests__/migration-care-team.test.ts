import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guards the data-preserving care-team migration (Prompt 14). We cannot run a
 * live DB here, so we assert the SQL itself is shaped to preserve data: every
 * existing single assignment is copied into CareTeamMember BEFORE the old
 * columns are dropped. A future edit that reorders drop-before-copy — silently
 * losing every assignment — fails this test.
 */
const SQL = readFileSync(
  join(process.cwd(), 'prisma/migrations/20260610120000_care_team_m2m/migration.sql'),
  'utf8',
);

describe('care-team migration SQL', () => {
  it('creates the join table and enum', () => {
    expect(SQL).toMatch(/CREATE TYPE "CareTeamRole" AS ENUM \('THERAPIST', 'DOCTOR'\)/);
    expect(SQL).toMatch(/CREATE TABLE "CareTeamMember"/);
  });

  it('copies both therapist and doctor assignments into CareTeamMember', () => {
    expect(SQL).toMatch(/INSERT INTO "CareTeamMember"[\s\S]*"assignedTherapistId"/);
    expect(SQL).toMatch(/INSERT INTO "CareTeamMember"[\s\S]*"responsibleDoctorId"/);
    expect(SQL).toMatch(/'THERAPIST'::"CareTeamRole"/);
    expect(SQL).toMatch(/'DOCTOR'::"CareTeamRole"/);
  });

  it('copies data BEFORE dropping the old columns (no data loss)', () => {
    const firstCopy = SQL.indexOf('INSERT INTO "CareTeamMember"');
    const firstDrop = SQL.indexOf('DROP COLUMN "assignedTherapistId"');
    const dropDoctor = SQL.indexOf('DROP COLUMN "responsibleDoctorId"');
    expect(firstCopy).toBeGreaterThan(-1);
    expect(firstDrop).toBeGreaterThan(-1);
    expect(dropDoctor).toBeGreaterThan(-1);
    expect(firstCopy).toBeLessThan(firstDrop);
    expect(firstCopy).toBeLessThan(dropDoctor);
  });

  it('falls back to the clinician when no admin exists (assignedBy is never null)', () => {
    expect(SQL).toMatch(/COALESCE\([\s\S]*?ADMIN[\s\S]*?assignedTherapistId/);
    expect(SQL).toMatch(/COALESCE\([\s\S]*?ADMIN[\s\S]*?responsibleDoctorId/);
  });
});
