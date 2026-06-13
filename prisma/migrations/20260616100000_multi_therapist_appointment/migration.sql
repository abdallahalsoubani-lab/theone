-- Prompt 20 — Multiple therapists on a single appointment.
-- Move Appointment.therapistId (single FK) to a many-to-many join table.
-- Data-preserving: every existing appointment keeps its therapist as exactly
-- one AppointmentTherapist row, then the old column is dropped.

-- CreateTable
CREATE TABLE "AppointmentTherapist" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentTherapist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentTherapist_appointmentId_therapistId_key" ON "AppointmentTherapist"("appointmentId", "therapistId");

-- CreateIndex
CREATE INDEX "AppointmentTherapist_therapistId_idx" ON "AppointmentTherapist"("therapistId");

-- CreateIndex
CREATE INDEX "AppointmentTherapist_appointmentId_idx" ON "AppointmentTherapist"("appointmentId");

-- AddForeignKey
ALTER TABLE "AppointmentTherapist" ADD CONSTRAINT "AppointmentTherapist_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentTherapist" ADD CONSTRAINT "AppointmentTherapist_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one join row per existing appointment, preserving its therapist.
-- gen_random_uuid() is built-in on PostgreSQL 13+. Runs to zero rows on a
-- fresh DB, exactly one row per appointment on a populated DB.
INSERT INTO "AppointmentTherapist" ("id", "appointmentId", "therapistId", "createdAt")
SELECT gen_random_uuid()::text, "id", "therapistId", CURRENT_TIMESTAMP
FROM "Appointment";

-- Drop the old single-therapist column (auto-drops its FK + the
-- (therapistId, startsAt) index).
ALTER TABLE "Appointment" DROP COLUMN "therapistId";
