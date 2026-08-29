-- P57 — one-off WhatsApp broadcast (clinic number change): per-recipient
-- campaign state. Additive only — safe on fresh and populated databases.

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "campaign" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'PENDING',
    "failReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BroadcastRecipient_campaign_status_idx" ON "BroadcastRecipient"("campaign", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRecipient_campaign_phone_key" ON "BroadcastRecipient"("campaign", "phone");

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WhatsAppMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
