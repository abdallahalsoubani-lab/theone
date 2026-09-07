-- P60 — manual "Send a message" from the appointment panel.

-- AlterEnum: a dispatch row closed by a human send of the same type.
ALTER TYPE "WaDispatchStatus" ADD VALUE 'SUPERSEDED_BY_MANUAL';

-- CreateEnum: persisted origin of an outbound message row.
CREATE TYPE "WaMessageSource" AS ENUM ('QUEUE', 'RESEND', 'INBOUND_ACK', 'INBOX', 'MANUAL_PANEL');

-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN "source" "WaMessageSource" NOT NULL DEFAULT 'QUEUE';
