-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "seriesId" TEXT;

-- CreateIndex
CREATE INDEX "Appointment_seriesId_idx" ON "Appointment"("seriesId");

-- ════════════════════════════════════════════════════════════════════════════
--  Partial indexes for the hot-path conflict-detection query.
--
--  The conflict engine in lib/appointments/conflicts.ts looks up overlapping
--  appointments for a given therapist or patient, excluding terminal statuses
--  (COMPLETED, CANCELLED, NO_SHOW). Filtering by status in a partial index
--  keeps the index small (most clinic data eventually becomes COMPLETED) and
--  speeds the conflict query by an order of magnitude as history accumulates.
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX "appointments_active_by_therapist"
  ON "Appointment" ("therapistId", "startsAt")
  WHERE "status" IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS');

CREATE INDEX "appointments_active_by_patient"
  ON "Appointment" ("patientId", "startsAt")
  WHERE "status" IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS');
