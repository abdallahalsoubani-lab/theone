-- CreateTable: GROUP-therapy membership (July #8 part 3). Per-patient arrival.
CREATE TABLE "AppointmentPatient" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkedInVia" "CheckInVia",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppointmentPatient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentPatient_appointmentId_patientId_key" ON "AppointmentPatient"("appointmentId", "patientId");
CREATE INDEX "AppointmentPatient_patientId_idx" ON "AppointmentPatient"("patientId");
CREATE INDEX "AppointmentPatient_appointmentId_idx" ON "AppointmentPatient"("appointmentId");

-- AddForeignKey
ALTER TABLE "AppointmentPatient" ADD CONSTRAINT "AppointmentPatient_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentPatient" ADD CONSTRAINT "AppointmentPatient_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
