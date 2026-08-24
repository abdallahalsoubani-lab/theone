-- AlterEnum
ALTER TYPE "WaDispatchStatus" ADD VALUE 'STALE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WaDispatchType" ADD VALUE 'REMINDER';
ALTER TYPE "WaDispatchType" ADD VALUE 'HOME_PROGRAM';
ALTER TYPE "WaDispatchType" ADD VALUE 'ARRIVAL';

-- AlterTable
ALTER TABLE "ClinicSettings" ADD COLUMN     "whatsappSilentMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WhatsAppDispatch" ADD COLUMN     "homeProgramItemId" TEXT,
ALTER COLUMN "appointmentId" DROP NOT NULL;
