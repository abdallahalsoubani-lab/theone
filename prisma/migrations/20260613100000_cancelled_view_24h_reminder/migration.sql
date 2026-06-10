-- Prompt 17 — cancelled-appointments view + 24h reminder window.

-- Item 1: record who cancelled + when (surfaced in the cancelled view).
ALTER TABLE "Appointment" ADD COLUMN "cancelledById" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Appointment"
    ADD CONSTRAINT "Appointment_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Appointment_status_cancelledAt_idx" ON "Appointment"("status", "cancelledAt");

-- Item 2: reminder window settings + switch the 30-min default to 24h (1440).
ALTER TABLE "ClinicSettings" ADD COLUMN "reminderWindowStart" TEXT NOT NULL DEFAULT '08:00';
ALTER TABLE "ClinicSettings" ADD COLUMN "reminderWindowEnd" TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE "ClinicSettings" ALTER COLUMN "defaultReminderOffsetMinutes" SET DEFAULT 1440;

-- Move the existing clinic from the old 30-minute reminder to the new 24-hour
-- window (only when still on the old default — never clobber a custom value).
UPDATE "ClinicSettings" SET "defaultReminderOffsetMinutes" = 1440 WHERE "defaultReminderOffsetMinutes" = 30;
