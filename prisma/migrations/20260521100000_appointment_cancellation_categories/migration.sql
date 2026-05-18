-- Prompt 7b — Appointment workflow polish.
--
-- CancellationCategory expands from 4 → 9 values. CLINIC_CLOSURE is
-- renamed to CLINIC_RESCHEDULING (existing rows carry their value
-- through the rename automatically). The 5 new values (PATIENT_NO_SHOW,
-- PATIENT_ILLNESS, PATIENT_TRAVEL, WEATHER, INSURANCE_ISSUE) are
-- appended so existing rows referencing the old values stay valid.
--
-- Appointment gains a free-form `cancellationNotes` column to carry
-- unstructured context alongside the structured category — the
-- category drives Prompt 11 analytics; the notes are for the
-- Secretary's own memory.
--
-- NotificationType gains APPOINTMENT_THERAPIST_ASSIGNED and
-- APPOINTMENT_THERAPIST_REMOVED for the change-therapist flow
-- (commit 3). Added now so the schema is in one place and the
-- migration sequence is clean.

-- ─── CancellationCategory: rename + extensions ──────────────────────────────
ALTER TYPE "CancellationCategory" RENAME VALUE 'CLINIC_CLOSURE' TO 'CLINIC_RESCHEDULING';
ALTER TYPE "CancellationCategory" ADD VALUE 'PATIENT_NO_SHOW';
ALTER TYPE "CancellationCategory" ADD VALUE 'PATIENT_ILLNESS';
ALTER TYPE "CancellationCategory" ADD VALUE 'PATIENT_TRAVEL';
ALTER TYPE "CancellationCategory" ADD VALUE 'WEATHER';
ALTER TYPE "CancellationCategory" ADD VALUE 'INSURANCE_ISSUE';

-- ─── NotificationType: change-therapist additions ───────────────────────────
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_THERAPIST_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_THERAPIST_REMOVED';

-- ─── Appointment.cancellationNotes ──────────────────────────────────────────
ALTER TABLE "Appointment" ADD COLUMN "cancellationNotes" TEXT;
