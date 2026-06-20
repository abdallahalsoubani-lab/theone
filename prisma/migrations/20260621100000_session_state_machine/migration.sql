-- Session lifecycle grace windows (Fix Prompt 2).
-- Start-Session gate and overdue auto-complete thresholds, both configurable.
ALTER TABLE "ClinicSettings"
  ADD COLUMN "sessionStartGraceMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "sessionAutoCompleteGraceMinutes" INTEGER NOT NULL DEFAULT 15;

-- Reserved "system" user — the audit actor for background-worker mutations
-- (overdue-session auto-complete). AuditLog.actorId is a required FK, so this
-- row must exist in every environment, not just dev seeds. No password hash →
-- it can never log in. Idempotent so re-applying / re-seeding is safe.
INSERT INTO "User" ("id", "email", "phone", "role", "fullNameEn", "fullNameAr", "updatedAt")
VALUES ('system', 'system@theone.internal', 'system', 'ADMIN', 'System', 'النظام', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
