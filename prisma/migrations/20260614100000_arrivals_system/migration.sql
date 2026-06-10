-- Prompt 18 — Arrivals system: check-in kiosk + waiting list + lobby display.

-- How a patient was checked in / marked as arrived.
CREATE TYPE "CheckInVia" AS ENUM ('KIOSK', 'STAFF');

-- Arrivals columns on Appointment. `checkedInAt` marks ARRIVED/WAITING,
-- distinct from IN_PROGRESS (in session). The waiting list is derived from
-- these + status, not a parallel queue table.
ALTER TABLE "Appointment"
  ADD COLUMN "checkedInAt" TIMESTAMP(3),
  ADD COLUMN "checkedInVia" "CheckInVia";

CREATE INDEX "Appointment_startsAt_checkedInAt_idx" ON "Appointment" ("startsAt", "checkedInAt");

-- Clinic-settings: manual "your turn in ~X minutes" + the two public-surface
-- access tokens (kiosk + lobby display, separate trust zones).
ALTER TABLE "ClinicSettings"
  ADD COLUMN "currentDelayMinutes" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "kioskToken" TEXT,
  ADD COLUMN "displayToken" TEXT;

CREATE UNIQUE INDEX "ClinicSettings_kioskToken_key" ON "ClinicSettings" ("kioskToken");
CREATE UNIQUE INDEX "ClinicSettings_displayToken_key" ON "ClinicSettings" ("displayToken");
