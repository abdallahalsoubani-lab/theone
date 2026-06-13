-- Prompt 21 — Pediatric physiotherapy assessment (fixed core + custom fields).

-- CreateEnum
CREATE TYPE "PediatricCustomFieldType" AS ENUM ('SINGLE_SELECT', 'MULTI_SELECT', 'TEXT', 'LONG_TEXT', 'SCORE_0_3', 'NUMBER', 'BOOLEAN');

-- CreateTable
CREATE TABLE "PediatricAssessment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "coreData" JSONB NOT NULL,
    "customData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PediatricAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PediatricCustomField" (
    "id" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "type" "PediatricCustomFieldType" NOT NULL,
    "options" JSONB,
    "section" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PediatricCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PediatricAssessment_patientId_createdAt_idx" ON "PediatricAssessment"("patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PediatricCustomField_active_order_idx" ON "PediatricCustomField"("active", "order");

-- AddForeignKey
ALTER TABLE "PediatricAssessment" ADD CONSTRAINT "PediatricAssessment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PediatricAssessment" ADD CONSTRAINT "PediatricAssessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PediatricAssessment" ADD CONSTRAINT "PediatricAssessment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PediatricCustomField" ADD CONSTRAINT "PediatricCustomField_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
