-- Prompt 19 — Booking waitlist (slot-freed notifications).
-- A booking-time waitlist distinct from the Prompt 18 arrivals/check-in list:
-- park a patient when their desired slot is taken; when it frees (cancel /
-- no-show) the matcher notifies SECRETARY + ADMIN for one-click placement.

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'FULFILLED', 'EXPIRED', 'REMOVED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_WAITLIST_SLOT_FREED';

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "desiredDate" TIMESTAMP(3) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "preferredTherapistId" TEXT,
    "note" TEXT,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "createdById" TEXT NOT NULL,
    "fulfilledById" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledAppointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_fulfilledAppointmentId_key" ON "WaitlistEntry"("fulfilledAppointmentId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_desiredDate_status_idx" ON "WaitlistEntry"("desiredDate", "status");

-- CreateIndex
CREATE INDEX "WaitlistEntry_status_idx" ON "WaitlistEntry"("status");

-- CreateIndex
CREATE INDEX "WaitlistEntry_patientId_idx" ON "WaitlistEntry"("patientId");

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_preferredTherapistId_fkey" FOREIGN KEY ("preferredTherapistId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_fulfilledById_fkey" FOREIGN KEY ("fulfilledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_fulfilledAppointmentId_fkey" FOREIGN KEY ("fulfilledAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
