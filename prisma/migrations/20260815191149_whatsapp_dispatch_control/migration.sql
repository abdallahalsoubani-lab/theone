-- CreateEnum
CREATE TYPE "WaDispatchMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "WaDispatchType" AS ENUM ('BOOKING_CONFIRMATION', 'RESCHEDULE', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "WaDispatchStatus" AS ENUM ('PENDING', 'SCHEDULED', 'SENT', 'SUPERSEDED', 'EXCLUDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WaDispatchReason" AS ENUM ('AUTO', 'MANUAL', 'SAFETY_EXCEPTION');

-- AlterTable
ALTER TABLE "ClinicSettings" ADD COLUMN     "bookingDispatchMode" "WaDispatchMode" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "cancellationDispatchMode" "WaDispatchMode" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "cancellationMessageDelayMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rescheduleDispatchMode" "WaDispatchMode" NOT NULL DEFAULT 'AUTO';

-- CreateTable
CREATE TABLE "WhatsAppDispatch" (
    "id" TEXT NOT NULL,
    "type" "WaDispatchType" NOT NULL,
    "status" "WaDispatchStatus" NOT NULL DEFAULT 'PENDING',
    "dispatchReason" "WaDispatchReason",
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT,
    "supersededById" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppDispatch_type_status_idx" ON "WhatsAppDispatch"("type", "status");

-- CreateIndex
CREATE INDEX "WhatsAppDispatch_appointmentId_status_idx" ON "WhatsAppDispatch"("appointmentId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppDispatch_status_createdAt_idx" ON "WhatsAppDispatch"("status", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "WhatsAppDispatch" ADD CONSTRAINT "WhatsAppDispatch_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppDispatch" ADD CONSTRAINT "WhatsAppDispatch_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppDispatch" ADD CONSTRAINT "WhatsAppDispatch_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
