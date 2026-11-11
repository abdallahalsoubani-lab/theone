-- P64 #15 — home-program PDF: library images + default goal on Exercise,
-- per-patient goal + photos on HomeProgramItem, and the per-patient cover.

-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN "extraImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "goalAr" TEXT,
ADD COLUMN "goalEn" TEXT;

-- AlterTable
ALTER TABLE "HomeProgramItem" ADD COLUMN "goal" TEXT,
ADD COLUMN "photoDocumentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "HomeProgramCover" (
    "patientId" TEXT NOT NULL,
    "goals" TEXT NOT NULL DEFAULT '',
    "parentNotes" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeProgramCover_pkey" PRIMARY KEY ("patientId")
);

-- AddForeignKey
ALTER TABLE "HomeProgramCover" ADD CONSTRAINT "HomeProgramCover_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
