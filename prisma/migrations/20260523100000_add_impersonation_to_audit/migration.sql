-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "AuditAction" ADD VALUE 'IMPERSONATION_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'IMPERSONATION_ENDED';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "impersonatedUserId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_impersonatedUserId_createdAt_idx" ON "AuditLog"("impersonatedUserId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_impersonatedUserId_fkey" FOREIGN KEY ("impersonatedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
