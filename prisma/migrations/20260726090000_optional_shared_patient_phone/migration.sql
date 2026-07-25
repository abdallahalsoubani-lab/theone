-- Prompt 50: real-clinic phone rules.
-- 1. Patient phone becomes optional (imported records with broken numbers
--    have none until the clinic fills them from paper files).
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;

-- 2. Phone uniqueness is removed for PATIENTS (parents share one number
--    across multiple children) but kept for staff/admin accounts. NULL is
--    always allowed. Replaces the P2 all-roles partial index.
DROP INDEX IF EXISTS "User_phone_unique_active";
CREATE UNIQUE INDEX "User_phone_unique_active_staff"
  ON "User" ("phone")
  WHERE "deletedAt" IS NULL AND "role" <> 'PATIENT' AND "phone" IS NOT NULL;
