-- Prompt 22 — Patient file uploads (external documents).

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('XRAY', 'LAB', 'CONSULT', 'REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "PatientDocument" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "uploadedById" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientDocument_storageKey_key" ON "PatientDocument"("storageKey");

-- CreateIndex
CREATE INDEX "PatientDocument_patientId_active_status_idx" ON "PatientDocument"("patientId", "active", "status");

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
