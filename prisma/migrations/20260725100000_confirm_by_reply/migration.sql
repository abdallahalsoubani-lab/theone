-- Prompt 48b: confirm-by-reply machinery.
-- 1. Registry-driven template variable shapes (zero-deploy SID switch).
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "variablesShape" JSONB;
-- 2. Decline notification for SECRETARY+ADMIN (no auto-cancel anywhere).
ALTER TYPE "NotificationType" ADD VALUE 'PATIENT_DECLINED_APPOINTMENT';
