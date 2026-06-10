-- Prompt 14 — Care team: multiple doctors & therapists per patient (M2M).
--
-- Data-preserving migration:
--   1. Create the CareTeamRole enum + CareTeamMember join table.
--   2. Copy every existing single assignment (PatientProfile.assignedTherapistId
--      / responsibleDoctorId) into a CareTeamMember row.
--   3. Drop the two old scalar columns (+ their FKs and indexes).
--
-- `assignedBy` on the migrated rows is set to the first ADMIN user (the system
-- actor that owned these assignments before a real audit trail existed). If no
-- ADMIN exists, we fall back to the clinician's own id so the NOT NULL column
-- is always satisfiable. Runs cleanly on a fresh DB (the copy SELECTs match
-- zero rows) and on a populated one.

-- 1. Enum -------------------------------------------------------------------
CREATE TYPE "CareTeamRole" AS ENUM ('THERAPIST', 'DOCTOR');

-- 2. Join table -------------------------------------------------------------
CREATE TABLE "CareTeamMember" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "role" "CareTeamRole" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT NOT NULL,

    CONSTRAINT "CareTeamMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CareTeamMember_patientId_clinicianId_key" ON "CareTeamMember"("patientId", "clinicianId");
CREATE INDEX "CareTeamMember_clinicianId_role_idx" ON "CareTeamMember"("clinicianId", "role");
CREATE INDEX "CareTeamMember_patientId_idx" ON "CareTeamMember"("patientId");

ALTER TABLE "CareTeamMember"
    ADD CONSTRAINT "CareTeamMember_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareTeamMember"
    ADD CONSTRAINT "CareTeamMember_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Copy existing assignments ---------------------------------------------
-- Therapists.
INSERT INTO "CareTeamMember" ("id", "patientId", "clinicianId", "role", "assignedAt", "assignedBy")
SELECT
    gen_random_uuid()::text,
    pp."userId",
    pp."assignedTherapistId",
    'THERAPIST'::"CareTeamRole",
    CURRENT_TIMESTAMP,
    COALESCE(
        (SELECT u."id" FROM "User" u WHERE u."role" = 'ADMIN' AND u."deletedAt" IS NULL ORDER BY u."createdAt" ASC LIMIT 1),
        pp."assignedTherapistId"
    )
FROM "PatientProfile" pp
WHERE pp."assignedTherapistId" IS NOT NULL;

-- Doctors.
INSERT INTO "CareTeamMember" ("id", "patientId", "clinicianId", "role", "assignedAt", "assignedBy")
SELECT
    gen_random_uuid()::text,
    pp."userId",
    pp."responsibleDoctorId",
    'DOCTOR'::"CareTeamRole",
    CURRENT_TIMESTAMP,
    COALESCE(
        (SELECT u."id" FROM "User" u WHERE u."role" = 'ADMIN' AND u."deletedAt" IS NULL ORDER BY u."createdAt" ASC LIMIT 1),
        pp."responsibleDoctorId"
    )
FROM "PatientProfile" pp
WHERE pp."responsibleDoctorId" IS NOT NULL;

-- 4. Drop the old scalar columns -------------------------------------------
ALTER TABLE "PatientProfile" DROP CONSTRAINT "PatientProfile_assignedTherapistId_fkey";
ALTER TABLE "PatientProfile" DROP CONSTRAINT "PatientProfile_responsibleDoctorId_fkey";

DROP INDEX "PatientProfile_assignedTherapistId_idx";
DROP INDEX "PatientProfile_responsibleDoctorId_idx";

ALTER TABLE "PatientProfile" DROP COLUMN "assignedTherapistId";
ALTER TABLE "PatientProfile" DROP COLUMN "responsibleDoctorId";
