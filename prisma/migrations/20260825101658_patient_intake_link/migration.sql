-- CreateTable
CREATE TABLE "PatientIntakeLink" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "formType" "IntakeType" NOT NULL,
    "createdById" TEXT NOT NULL,
    "appointmentId" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientIntakeLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientIntakeLink_token_key" ON "PatientIntakeLink"("token");

-- CreateIndex
CREATE INDEX "PatientIntakeLink_patientId_createdAt_idx" ON "PatientIntakeLink"("patientId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "PatientIntakeLink" ADD CONSTRAINT "PatientIntakeLink_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientIntakeLink" ADD CONSTRAINT "PatientIntakeLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientIntakeLink" ADD CONSTRAINT "PatientIntakeLink_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
