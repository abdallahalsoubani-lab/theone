-- P64 #8 — the fixed adult/pediatric intake fields become optional: new
-- intakes ask only the admin-managed custom questions. Existing rows keep
-- their values (no data change).
ALTER TABLE "AdultIntakeData"
  ALTER COLUMN "physicalActivityLevel" DROP NOT NULL,
  ALTER COLUMN "primaryComplaint" DROP NOT NULL,
  ALTER COLUMN "painTiming" DROP NOT NULL,
  ALTER COLUMN "symptomDuration" DROP NOT NULL,
  ALTER COLUMN "painSeverity" DROP NOT NULL,
  ALTER COLUMN "painStability" DROP NOT NULL,
  ALTER COLUMN "referralSource" DROP NOT NULL;

ALTER TABLE "PediatricIntakeData"
  ALTER COLUMN "numberOfSiblings" DROP NOT NULL,
  ALTER COLUMN "birthOrder" DROP NOT NULL;
