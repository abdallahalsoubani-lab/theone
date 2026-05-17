-- CreateTable
CREATE TABLE "ClinicSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "addressEn" TEXT NOT NULL,
    "addressAr" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Amman',
    "defaultAppointmentDuration" INTEGER NOT NULL DEFAULT 30,
    "defaultReminderOffsetMinutes" INTEGER NOT NULL DEFAULT 30,
    "businessHours" JSONB NOT NULL,
    "defaultLanguage" "LanguagePref" NOT NULL DEFAULT 'AR',
    "serviceTypes" JSONB NOT NULL,
    "hijriDefault" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ClinicSettings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ClinicSettings" ADD CONSTRAINT "ClinicSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
