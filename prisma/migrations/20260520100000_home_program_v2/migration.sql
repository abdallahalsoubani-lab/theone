-- Prompt 10 — Home Program v2: schedule per weekday, exercise versioning,
-- low-compliance notification type.
--
-- HomeProgramItem.timesPerWeek + frequency are replaced with a typed
-- `daysOfWeek` integer array (0=Sun…6=Sat). A CHECK constraint enforces
-- the length + bounds + uniqueness — the schema layer can't express that
-- on its own. setsReps + reminderJobKey + active land alongside.
--
-- Exercise gains the versioning chain (replacedById self-FK + active
-- flag) so editing an exercise creates a new row while existing
-- HomeProgramItems continue to reference the version they were
-- assigned. Image / video metadata columns make the Admin message log
-- + upload validation legible.
--
-- NotificationType gains LOW_COMPLIANCE — fired by the daily compliance
-- check worker to the assigned therapist when a patient's 7-day rate
-- drops below 50% (3-day cooldown via the application layer).

-- ─── Enum extension ──────────────────────────────────────────────────────────
ALTER TYPE "NotificationType" ADD VALUE 'LOW_COMPLIANCE';

-- ─── Exercise: versioning + media metadata ───────────────────────────────────
ALTER TABLE "Exercise"
    ADD COLUMN "defaultInstructionEn" TEXT,
    ADD COLUMN "defaultInstructionAr" TEXT,
    ADD COLUMN "videoMimeType" TEXT,
    ADD COLUMN "videoSizeBytes" INTEGER,
    ADD COLUMN "imageMimeType" TEXT,
    ADD COLUMN "imageSizeBytes" INTEGER,
    ADD COLUMN "replacedById" TEXT,
    ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "Exercise_replacedById_key"
    ON "Exercise"("replacedById");

CREATE INDEX "Exercise_active_replacedById_idx"
    ON "Exercise"("active", "replacedById");

ALTER TABLE "Exercise"
    ADD CONSTRAINT "Exercise_replacedById_fkey"
    FOREIGN KEY ("replacedById") REFERENCES "Exercise"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── HomeProgramItem: daysOfWeek + setsReps + reminderJobKey ────────────────
ALTER TABLE "HomeProgramItem"
    ADD COLUMN "daysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    ADD COLUMN "setsReps" TEXT,
    ADD COLUMN "reminderJobKey" TEXT;

-- Backfill: existing rows with timesPerWeek/frequency get sane daysOfWeek
-- defaults. DAILY → [0,1,2,3,4,5,6]; WEEKLY_N with timesPerWeek=N → first
-- N days starting Monday (1..N). The seed re-writes proper values for
-- the dev rows; production rows would be backfilled by a one-off script
-- in the data team's hands.
UPDATE "HomeProgramItem"
SET "daysOfWeek" = ARRAY[0,1,2,3,4,5,6]
WHERE "frequency" = 'DAILY' AND array_length("daysOfWeek", 1) IS NULL;

UPDATE "HomeProgramItem"
SET "daysOfWeek" = (
    SELECT array_agg(d) FROM generate_series(1, LEAST(COALESCE("timesPerWeek", 3), 7)) d
)
WHERE "frequency" = 'WEEKLY_N' AND array_length("daysOfWeek", 1) IS NULL;

-- Drop the now-unused columns.
ALTER TABLE "HomeProgramItem"
    DROP COLUMN "frequency",
    DROP COLUMN "timesPerWeek";

-- Drop the now-redundant enum.
DROP TYPE IF EXISTS "HomeProgramFrequency";

-- Drop the default so future rows must specify daysOfWeek explicitly.
ALTER TABLE "HomeProgramItem"
    ALTER COLUMN "daysOfWeek" DROP DEFAULT;

-- Length 1-7, values 0-6, no duplicates. PostgreSQL rejects subqueries
-- inside CHECK constraints (SQLSTATE 0A000), so validation lives in an
-- immutable SQL function the constraint calls instead.
CREATE OR REPLACE FUNCTION home_program_days_of_week_valid(days integer[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    array_length(days, 1) BETWEEN 1 AND 7
    AND days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::integer[]
    AND array_length(days, 1) = (
      SELECT count(DISTINCT d) FROM unnest(days) AS d
    );
$$;

ALTER TABLE "HomeProgramItem"
    ADD CONSTRAINT "home_program_items_days_of_week_check"
    CHECK (home_program_days_of_week_valid("daysOfWeek"));
