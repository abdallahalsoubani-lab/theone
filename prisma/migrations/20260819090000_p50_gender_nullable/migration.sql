-- P50 roster import (owner decision 19 Aug 2026): gender becomes nullable.
-- 309 of the 415 owner-reviewed roster rows carry no gender; the create form
-- keeps the field required at the Zod layer — NULL is reserved for imported
-- and legacy records the clinic completes over time.
ALTER TABLE "PatientProfile" ALTER COLUMN "gender" DROP NOT NULL;
