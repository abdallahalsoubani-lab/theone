-- CreateEnum
CREATE TYPE "IntakeSubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "IntakeSubmission" (
    "id" TEXT NOT NULL,
    "type" "IntakeType" NOT NULL,
    "answers" JSONB NOT NULL,
    "profile" JSONB NOT NULL,
    "submittedName" TEXT NOT NULL,
    "submittedPhone" TEXT NOT NULL,
    "status" "IntakeSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "linkedPatientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntakeSubmission_status_createdAt_idx" ON "IntakeSubmission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeSubmission_submittedPhone_idx" ON "IntakeSubmission"("submittedPhone");

-- AddForeignKey
ALTER TABLE "IntakeSubmission" ADD CONSTRAINT "IntakeSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSubmission" ADD CONSTRAINT "IntakeSubmission_linkedPatientId_fkey" FOREIGN KEY ("linkedPatientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
