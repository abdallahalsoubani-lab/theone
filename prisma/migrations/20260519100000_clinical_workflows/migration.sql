-- Prompt 9 — Clinical workflows: treatment-plan proposals, session-note
-- addenda, day reports, doctor reviews, in-app notifications.
--
-- Five logical blocks:
--   1. PlanStatus enum gains PROPOSED, REJECTED, SUPERSEDED + new
--      NotificationType enum.
--   2. TreatmentPlan gains proposal lifecycle fields + therapistNotes; a
--      second partial unique index enforces "at most one PROPOSED plan
--      per patient".
--   3. SessionNote schema relax — drop the strict unique on appointmentId,
--      replace with a partial unique covering only primary notes
--      (parentNoteId IS NULL). Adds parentNoteId self-FK for addenda.
--   4. ClinicSettings gains patientCanViewClinicalNotes flag (default OFF).
--   5. Three new tables: Notification, DayReport, DoctorReview.
--   6. GIN full-text indexes on SessionNote + TreatmentPlan for the
--      patient timeline search (Prompt 9 §4.11).

-- ─── Enum extensions ────────────────────────────────────────────────────────
ALTER TYPE "PlanStatus" ADD VALUE 'PROPOSED';
ALTER TYPE "PlanStatus" ADD VALUE 'REJECTED';
ALTER TYPE "PlanStatus" ADD VALUE 'SUPERSEDED';

CREATE TYPE "NotificationType" AS ENUM (
    'PLAN_ASSIGNED',
    'PLAN_PROPOSAL_RECEIVED',
    'PLAN_PROPOSAL_APPROVED',
    'PLAN_PROPOSAL_REJECTED',
    'PLAN_PAUSED',
    'PLAN_DISCONTINUED',
    'DAY_REPORT_SUBMITTED',
    'DOCTOR_REVIEW_ADDED',
    'APPOINTMENT_RESCHEDULE_REQUEST'
);

-- ─── TreatmentPlan additions ────────────────────────────────────────────────
ALTER TABLE "TreatmentPlan"
    ADD COLUMN "therapistNotes" TEXT,
    ADD COLUMN "proposalReason" TEXT,
    ADD COLUMN "rejectedReason" TEXT,
    ADD COLUMN "approvedAt" TIMESTAMP(3),
    ADD COLUMN "approvedById" TEXT;

CREATE INDEX "TreatmentPlan_approvedById_idx"
    ON "TreatmentPlan"("approvedById");

ALTER TABLE "TreatmentPlan"
    ADD CONSTRAINT "TreatmentPlan_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Only one PROPOSED plan per patient at a time. ACTIVE is already
-- enforced by a separate partial unique index in the init migration.
CREATE UNIQUE INDEX "treatment_plans_one_proposed_per_patient"
    ON "TreatmentPlan"("patientId")
    WHERE "status" = 'PROPOSED';

-- ─── SessionNote relax ──────────────────────────────────────────────────────
-- Drop the strict appointmentId unique constraint (Prisma created it as
-- a unique INDEX backed by a unique CONSTRAINT name). Postgres requires
-- dropping the constraint by its actual name; the init migration named
-- it `SessionNote_appointmentId_key`.
ALTER TABLE "SessionNote" DROP CONSTRAINT IF EXISTS "SessionNote_appointmentId_key";
DROP INDEX IF EXISTS "SessionNote_appointmentId_key";

ALTER TABLE "SessionNote"
    ADD COLUMN "parentNoteId" TEXT;

CREATE INDEX "SessionNote_appointmentId_idx"
    ON "SessionNote"("appointmentId");

CREATE INDEX "SessionNote_parentNoteId_idx"
    ON "SessionNote"("parentNoteId");

-- Partial unique: at most one primary note per appointment. Addenda
-- (parentNoteId IS NOT NULL) chain off it and are not bound by the
-- unique.
CREATE UNIQUE INDEX "session_notes_one_primary_per_appointment"
    ON "SessionNote"("appointmentId")
    WHERE "parentNoteId" IS NULL;

ALTER TABLE "SessionNote"
    ADD CONSTRAINT "SessionNote_parentNoteId_fkey"
    FOREIGN KEY ("parentNoteId") REFERENCES "SessionNote"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ClinicSettings flag ────────────────────────────────────────────────────
ALTER TABLE "ClinicSettings"
    ADD COLUMN "patientCanViewClinicalNotes" BOOLEAN NOT NULL DEFAULT false;

-- ─── Notification table ─────────────────────────────────────────────────────
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "titleKey" TEXT NOT NULL,
    "bodyKey" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "linkPath" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_recipientId_readAt_createdAt_idx"
    ON "Notification"("recipientId", "readAt", "createdAt" DESC);

ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── DayReport table ────────────────────────────────────────────────────────
CREATE TABLE "DayReport" (
    "id" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "overallSummary" TEXT NOT NULL,
    "patientEntries" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DayReport_therapistId_date_key"
    ON "DayReport"("therapistId", "date");

CREATE INDEX "DayReport_date_idx" ON "DayReport"("date");

ALTER TABLE "DayReport"
    ADD CONSTRAINT "DayReport_therapistId_fkey"
    FOREIGN KEY ("therapistId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── DoctorReview table ─────────────────────────────────────────────────────
CREATE TABLE "DoctorReview" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "weekStarting" DATE NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DoctorReview_patientId_createdAt_idx"
    ON "DoctorReview"("patientId", "createdAt" DESC);

CREATE INDEX "DoctorReview_doctorId_weekStarting_idx"
    ON "DoctorReview"("doctorId", "weekStarting");

ALTER TABLE "DoctorReview"
    ADD CONSTRAINT "DoctorReview_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DoctorReview"
    ADD CONSTRAINT "DoctorReview_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Full-text search indexes ───────────────────────────────────────────────
-- GIN indexes backing the patient-timeline search (Prompt 9 §4.11.1).
-- The `simple` config keeps the indexes language-agnostic — Arabic + English
-- session notes both index reasonably without per-language stemming. If
-- we need stemming later, build a coalesced expression index per locale.

CREATE INDEX "session_notes_fts"
    ON "SessionNote"
    USING GIN (to_tsvector('simple',
        coalesce("subjective", '') || ' ' ||
        coalesce("objective",  '') || ' ' ||
        coalesce("assessment", '') || ' ' ||
        coalesce("plan",       '')
    ));

CREATE INDEX "treatment_plans_fts"
    ON "TreatmentPlan"
    USING GIN (to_tsvector('simple',
        coalesce("diagnosisPrimary",  '') || ' ' ||
        coalesce("diagnosisSecondary",'') || ' ' ||
        coalesce("goalsShortTerm",    '') || ' ' ||
        coalesce("goalsLongTerm",     '') || ' ' ||
        coalesce("therapistNotes",    '')
    ));
