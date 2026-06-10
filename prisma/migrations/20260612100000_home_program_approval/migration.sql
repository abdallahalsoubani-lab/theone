-- Prompt 16 — Home-program approval workflow.
--
-- Adds the per-patient HomeProgramApproval state machine
-- (DRAFT → PENDING_APPROVAL → APPROVED, plus CHANGES_REQUESTED) + a
-- remindersEnabled delivery preference + an approved-content JSON snapshot.

CREATE TYPE "HomeProgramStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CHANGES_REQUESTED');

-- Notification types for the approval workflow (in-app bell).
ALTER TYPE "NotificationType" ADD VALUE 'HOME_PROGRAM_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'HOME_PROGRAM_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'HOME_PROGRAM_CHANGES_REQUESTED';

CREATE TABLE "HomeProgramApproval" (
    "patientId" TEXT NOT NULL,
    "status" "HomeProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "changesComment" TEXT,
    "approvedSnapshot" JSONB,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeProgramApproval_pkey" PRIMARY KEY ("patientId")
);

CREATE INDEX "HomeProgramApproval_status_idx" ON "HomeProgramApproval"("status");

ALTER TABLE "HomeProgramApproval"
    ADD CONSTRAINT "HomeProgramApproval_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeProgramApproval"
    ADD CONSTRAINT "HomeProgramApproval_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HomeProgramApproval"
    ADD CONSTRAINT "HomeProgramApproval_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every patient who already has a home-program item is currently
-- live + reminded. Preserve that by marking them APPROVED. APPROVED reads the
-- live items (not the snapshot), so no snapshot is needed for these rows.
INSERT INTO "HomeProgramApproval" ("patientId", "status", "remindersEnabled", "approvedAt", "updatedAt")
SELECT DISTINCT "patientId", 'APPROVED'::"HomeProgramStatus", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "HomeProgramItem";
