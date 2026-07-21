-- AlterTable: EVENT bookings have no patient — patientId becomes nullable.
ALTER TABLE "Appointment" ALTER COLUMN "patientId" DROP NOT NULL;

-- AlterTable: free-text title for patient-less EVENTs (null for other rows).
ALTER TABLE "Appointment" ADD COLUMN "title" TEXT;
