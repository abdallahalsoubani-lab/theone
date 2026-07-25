-- Prompt 49: WhatsApp Inbox.
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "patientId" TEXT,
    "lastReadAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "lastHumanReplyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppConversation_phone_key" ON "WhatsAppConversation"("phone");
CREATE INDEX "WhatsAppConversation_lastMessageAt_idx" ON "WhatsAppConversation"("lastMessageAt" DESC);
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual-send attribution.
ALTER TABLE "WhatsAppMessage" ADD COLUMN "sentById" TEXT;

-- Backfill conversations from the existing message log so history appears
-- in the Inbox on day one (thread key = recipientPhone as stored).
INSERT INTO "WhatsAppConversation" ("id", "phone", "patientId", "lastInboundAt", "lastMessageAt", "createdAt", "updatedAt")
SELECT
  'wac_' || md5("recipientPhone"),
  "recipientPhone",
  (SELECT "recipientId" FROM "WhatsAppMessage" m2
     WHERE m2."recipientPhone" = m."recipientPhone" AND m2."recipientId" IS NOT NULL
     ORDER BY m2."sentAt" DESC LIMIT 1),
  MAX(CASE WHEN "direction" = 'INBOUND' THEN "sentAt" END),
  MAX("sentAt"),
  MIN("sentAt"),
  CURRENT_TIMESTAMP
FROM "WhatsAppMessage" m
GROUP BY "recipientPhone";
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_sentById_fkey"
  FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
