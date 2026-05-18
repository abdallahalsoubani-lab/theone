-- Prompt 8 — WhatsApp provider metadata, inbound intent, and Secretary inbox.
--
-- WhatsAppTemplate gains a logical `name` column (the canonical identifier
-- call sites reference via whatsapp.sendTemplate({ name, language, … }))
-- plus separate provider-specific identifiers (Meta template name, Twilio
-- ContentSid). The unique key shifts from `metaTemplateName` to
-- `(name, language)` so the same logical template can have an EN and AR
-- variant with the same name.
--
-- WhatsAppMessage gains `intent` + `appointmentId` for inbound parsing,
-- `failureReason` + `resendCount` for the Admin message log, and renames
-- `metaMessageId` → `providerMessageId` (the column is no longer Meta-
-- specific now that Twilio is wired up).
--
-- User gains three columns capturing per-recipient reachability so the
-- Secretary can triage failed deliveries from the patient profile.
--
-- InboxItem is a new table holding the Secretary's action items:
-- inbound reschedule/cancel requests, unstructured inbound replies,
-- and outbound delivery failures.

-- ─── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "WaTemplateApprovalStatus" AS ENUM (
    'NOT_SUBMITTED',
    'PENDING',
    'APPROVED',
    'REJECTED',
    'PAUSED'
);

CREATE TYPE "WaInboundIntent" AS ENUM (
    'CONFIRM',
    'RESCHEDULE_REQUEST',
    'CANCEL_REQUEST',
    'UNKNOWN'
);

CREATE TYPE "InboxItemType" AS ENUM (
    'INBOUND_RESCHEDULE_REQUEST',
    'INBOUND_CANCEL_REQUEST',
    'INBOUND_UNKNOWN',
    'OUTBOUND_DELIVERY_FAILED'
);

-- ─── WhatsAppTemplate ────────────────────────────────────────────────────────
-- Drop the old unique on metaTemplateName; the column stays (now nullable
-- so rows can exist before a Meta template is provisioned).
DROP INDEX "WhatsAppTemplate_metaTemplateName_key";

ALTER TABLE "WhatsAppTemplate" ALTER COLUMN "metaTemplateName" DROP NOT NULL;
ALTER TABLE "WhatsAppTemplate" DROP COLUMN "approvedAt";

ALTER TABLE "WhatsAppTemplate"
    ADD COLUMN "name" TEXT,
    ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "metaApprovalStatus" "WaTemplateApprovalStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    ADD COLUMN "metaApprovedAt" TIMESTAMP(3),
    ADD COLUMN "twilioContentSid" TEXT,
    ADD COLUMN "twilioApproved" BOOLEAN NOT NULL DEFAULT false;

-- Backfill `name` from `metaTemplateName` (stripping any historical `_ar`
-- suffix the seed used to generate). After backfill the column becomes
-- NOT NULL and the new unique covers (name, language).
UPDATE "WhatsAppTemplate"
SET "name" = REGEXP_REPLACE("metaTemplateName", '_ar$', '')
WHERE "name" IS NULL;

ALTER TABLE "WhatsAppTemplate" ALTER COLUMN "name" SET NOT NULL;

CREATE UNIQUE INDEX "WhatsAppTemplate_name_language_key"
    ON "WhatsAppTemplate"("name", "language");

-- ─── WhatsAppMessage ─────────────────────────────────────────────────────────
-- Rename metaMessageId → providerMessageId; the column is no longer
-- Meta-specific. Drop the old index, add it back under the new name.
DROP INDEX "WhatsAppMessage_metaMessageId_idx";

ALTER TABLE "WhatsAppMessage"
    RENAME COLUMN "metaMessageId" TO "providerMessageId";

ALTER TABLE "WhatsAppMessage"
    ADD COLUMN "failureReason" TEXT,
    ADD COLUMN "intent" "WaInboundIntent",
    ADD COLUMN "appointmentId" TEXT,
    ADD COLUMN "resendCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "WhatsAppMessage_providerMessageId_idx"
    ON "WhatsAppMessage"("providerMessageId");

CREATE INDEX "WhatsAppMessage_appointmentId_idx"
    ON "WhatsAppMessage"("appointmentId");

ALTER TABLE "WhatsAppMessage"
    ADD CONSTRAINT "WhatsAppMessage_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── User reachability ──────────────────────────────────────────────────────
ALTER TABLE "User"
    ADD COLUMN "whatsappReachable" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "whatsappLastFailureAt" TIMESTAMP(3),
    ADD COLUMN "whatsappLastFailureReason" TEXT;

-- ─── InboxItem ──────────────────────────────────────────────────────────────
CREATE TABLE "InboxItem" (
    "id" TEXT NOT NULL,
    "type" "InboxItemType" NOT NULL,
    "patientId" TEXT,
    "appointmentId" TEXT,
    "messageId" TEXT,
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InboxItem_resolvedAt_createdAt_idx"
    ON "InboxItem"("resolvedAt", "createdAt" DESC);

CREATE INDEX "InboxItem_patientId_createdAt_idx"
    ON "InboxItem"("patientId", "createdAt" DESC);

ALTER TABLE "InboxItem"
    ADD CONSTRAINT "InboxItem_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InboxItem"
    ADD CONSTRAINT "InboxItem_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InboxItem"
    ADD CONSTRAINT "InboxItem_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "WhatsAppMessage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InboxItem"
    ADD CONSTRAINT "InboxItem_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
