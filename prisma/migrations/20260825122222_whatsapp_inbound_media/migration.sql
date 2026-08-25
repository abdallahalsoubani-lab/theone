-- CreateEnum
CREATE TYPE "WaAttachmentStatus" AS ENUM ('PENDING', 'STORED', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "ClinicSettings" ADD COLUMN     "whatsappMediaRetentionDays" INTEGER NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE "WhatsAppAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mediaIndex" INTEGER NOT NULL DEFAULT 0,
    "contentType" TEXT NOT NULL,
    "status" "WaAttachmentStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "filename" TEXT,
    "failureReason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppAttachment_messageId_idx" ON "WhatsAppAttachment"("messageId");

-- CreateIndex
CREATE INDEX "WhatsAppAttachment_status_receivedAt_idx" ON "WhatsAppAttachment"("status", "receivedAt");

-- AddForeignKey
ALTER TABLE "WhatsAppAttachment" ADD CONSTRAINT "WhatsAppAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WhatsAppMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
