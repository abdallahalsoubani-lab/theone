-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PATIENT', 'SECRETARY', 'DOCTOR', 'THERAPIST', 'ADMIN');

-- CreateEnum
CREATE TYPE "LanguagePref" AS ENUM ('EN', 'AR');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CancellationCategory" AS ENUM ('PATIENT_REQUEST', 'THERAPIST_UNAVAILABLE', 'CLINIC_CLOSURE', 'OTHER');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('SICK', 'VACATION', 'PERSONAL');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WaTemplateCategory" AS ENUM ('APPOINTMENT', 'HOME_PROGRAM', 'OTP', 'CREDENTIALS', 'GENERAL');

-- CreateEnum
CREATE TYPE "WaMessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "WaMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'READ_SENSITIVE');

-- CreateEnum
CREATE TYPE "IntakeType" AS ENUM ('ADULT', 'PEDIATRIC');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "PhysicalActivityLevel" AS ENUM ('VERY_ACTIVE', 'ACTIVE', 'MODERATE', 'LOW', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PainTiming" AS ENUM ('DAY', 'NIGHT', 'ALL_TIME', 'DURING_SLEEP');

-- CreateEnum
CREATE TYPE "SymptomDuration" AS ENUM ('LTE_1_WEEK', 'WEEKS_2_3', 'MONTHS_1_3', 'MONTHS_3_6', 'GT_6_MONTHS');

-- CreateEnum
CREATE TYPE "PainSeverity" AS ENUM ('ZERO', 'ONE_TWO', 'THREE_FOUR', 'FIVE', 'SIX_SEVEN', 'EIGHT_NINE', 'TEN');

-- CreateEnum
CREATE TYPE "PainStability" AS ENUM ('WORSENING', 'CONSTANT', 'IMPROVING', 'VARIABLE');

-- CreateEnum
CREATE TYPE "Comorbidity" AS ENUM ('HYPERTENSION', 'DIABETES', 'THYROID', 'OSTEOPOROSIS', 'ARTHRITIS', 'CANCER', 'CEREBRAL_CLOT', 'CARDIO_PULMONARY_CLOT', 'LIMB_CLOT', 'NONE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReferralSource" AS ENUM ('FRIEND_FAMILY', 'SOCIAL_MEDIA', 'DOCTOR_REFERRAL', 'GOOGLE_SEARCH', 'WALK_BY', 'EVENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomQuestionType" AS ENUM ('TEXT', 'TEXTAREA', 'SINGLE_SELECT', 'MULTI_SELECT', 'NUMBER', 'DATE');

-- CreateEnum
CREATE TYPE "CustomQuestionAppliesTo" AS ENUM ('ADULT', 'PEDIATRIC', 'BOTH');

-- CreateEnum
CREATE TYPE "HomeProgramFrequency" AS ENUM ('DAILY', 'WEEKLY_N');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "fullNameEn" TEXT NOT NULL,
    "fullNameAr" TEXT NOT NULL,
    "languagePref" "LanguagePref" NOT NULL DEFAULT 'EN',
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordChangedAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientProfile" (
    "userId" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" "Gender" NOT NULL,
    "nationalId" TEXT,
    "address" TEXT,
    "occupation" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "medicalHistorySummary" TEXT,
    "allergies" TEXT,
    "currentMedications" TEXT,
    "hijriCalendarPref" BOOLEAN NOT NULL DEFAULT false,
    "assignedTherapistId" TEXT,
    "responsibleDoctorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Specialty" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Specialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSpecialty" (
    "userId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSpecialty_pkey" PRIMARY KEY ("userId","specialtyId")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "roomId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "cancellationReason" TEXT,
    "cancellationCategory" "CancellationCategory",
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentPlan" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "assignedTherapistId" TEXT NOT NULL,
    "diagnosisPrimary" TEXT NOT NULL,
    "diagnosisSecondary" TEXT,
    "goalsShortTerm" TEXT NOT NULL,
    "goalsLongTerm" TEXT NOT NULL,
    "frequencyPerWeek" INTEGER NOT NULL,
    "durationWeeks" INTEGER NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentPlanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanExercise" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "sets" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "customNotes" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "PlanExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "descriptionAr" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "anatomicalRegion" TEXT NOT NULL,
    "contraindications" TEXT,
    "videoUrl" TEXT,
    "imageUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionNote" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "subjective" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "assessment" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "painScore" INTEGER,
    "measurements" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeProgramItem" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "frequency" "HomeProgramFrequency" NOT NULL,
    "timesPerWeek" INTEGER,
    "scheduledTime" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "therapistNote" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeProgramItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeProgramCompletion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "completedAt" TIMESTAMP(3),
    "painScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeProgramCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Leave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Leave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "metaTemplateName" TEXT NOT NULL,
    "language" "LanguagePref" NOT NULL,
    "category" "WaTemplateCategory" NOT NULL,
    "contentPreview" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "recipientId" TEXT,
    "recipientPhone" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "direction" "WaMessageDirection" NOT NULL,
    "status" "WaMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "metaMessageId" TEXT,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeAssessment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" "IntakeType" NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assessedById" TEXT NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "reviewedByClinicianId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdultIntakeData" (
    "intakeId" TEXT NOT NULL,
    "physicalActivityLevel" "PhysicalActivityLevel" NOT NULL,
    "medicalDiagnosis" TEXT,
    "primaryComplaint" TEXT NOT NULL,
    "painTiming" "PainTiming" NOT NULL,
    "symptomDuration" "SymptomDuration" NOT NULL,
    "painSeverity" "PainSeverity" NOT NULL,
    "painAggravatingFactors" TEXT,
    "painRelievingFactors" TEXT,
    "painStability" "PainStability" NOT NULL,
    "currentMedicationsForProblem" TEXT,
    "otherMedications" TEXT,
    "conditions" "Comorbidity"[],
    "otherConditions" TEXT,
    "previousFractures" TEXT,
    "previousSurgeries" TEXT,
    "previousPtExperience" TEXT,
    "referralSource" "ReferralSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdultIntakeData_pkey" PRIMARY KEY ("intakeId")
);

-- CreateTable
CREATE TABLE "PediatricIntakeData" (
    "intakeId" TEXT NOT NULL,
    "numberOfSiblings" INTEGER NOT NULL,
    "birthOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PediatricIntakeData_pkey" PRIMARY KEY ("intakeId")
);

-- CreateTable
CREATE TABLE "IntakeCustomQuestion" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "type" "CustomQuestionType" NOT NULL,
    "options" JSONB,
    "appliesTo" "CustomQuestionAppliesTo" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeCustomQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeCustomAnswer" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" TEXT,
    "valueOptions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeCustomAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "PatientProfile_assignedTherapistId_idx" ON "PatientProfile"("assignedTherapistId");

-- CreateIndex
CREATE INDEX "PatientProfile_responsibleDoctorId_idx" ON "PatientProfile"("responsibleDoctorId");

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_nameEn_key" ON "Specialty"("nameEn");

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_nameAr_key" ON "Specialty"("nameAr");

-- CreateIndex
CREATE INDEX "UserSpecialty_specialtyId_idx" ON "UserSpecialty"("specialtyId");

-- CreateIndex
CREATE INDEX "Appointment_therapistId_startsAt_idx" ON "Appointment"("therapistId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_patientId_startsAt_idx" ON "Appointment"("patientId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "TreatmentPlan_patientId_status_idx" ON "TreatmentPlan"("patientId", "status");

-- CreateIndex
CREATE INDEX "TreatmentPlan_assignedTherapistId_idx" ON "TreatmentPlan"("assignedTherapistId");

-- CreateIndex
CREATE INDEX "TreatmentPlan_doctorId_idx" ON "TreatmentPlan"("doctorId");

-- CreateIndex
CREATE INDEX "PlanExercise_planId_order_idx" ON "PlanExercise"("planId", "order");

-- CreateIndex
CREATE INDEX "Exercise_category_idx" ON "Exercise"("category");

-- CreateIndex
CREATE INDEX "Exercise_anatomicalRegion_idx" ON "Exercise"("anatomicalRegion");

-- CreateIndex
CREATE UNIQUE INDEX "SessionNote_appointmentId_key" ON "SessionNote"("appointmentId");

-- CreateIndex
CREATE INDEX "SessionNote_patientId_createdAt_idx" ON "SessionNote"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionNote_therapistId_createdAt_idx" ON "SessionNote"("therapistId", "createdAt");

-- CreateIndex
CREATE INDEX "HomeProgramItem_patientId_active_idx" ON "HomeProgramItem"("patientId", "active");

-- CreateIndex
CREATE INDEX "HomeProgramItem_exerciseId_idx" ON "HomeProgramItem"("exerciseId");

-- CreateIndex
CREATE INDEX "HomeProgramCompletion_itemId_scheduledDate_idx" ON "HomeProgramCompletion"("itemId", "scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "HomeProgramCompletion_itemId_scheduledDate_key" ON "HomeProgramCompletion"("itemId", "scheduledDate");

-- CreateIndex
CREATE INDEX "Leave_userId_startDate_idx" ON "Leave"("userId", "startDate");

-- CreateIndex
CREATE INDEX "Leave_status_idx" ON "Leave"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_metaTemplateName_key" ON "WhatsAppTemplate"("metaTemplateName");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_recipientPhone_sentAt_idx" ON "WhatsAppMessage"("recipientPhone", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "WhatsAppMessage_status_idx" ON "WhatsAppMessage"("status");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_metaMessageId_idx" ON "WhatsAppMessage"("metaMessageId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "IntakeAssessment_patientId_assessedAt_idx" ON "IntakeAssessment"("patientId", "assessedAt" DESC);

-- CreateIndex
CREATE INDEX "IntakeAssessment_status_idx" ON "IntakeAssessment"("status");

-- CreateIndex
CREATE INDEX "IntakeAssessment_type_idx" ON "IntakeAssessment"("type");

-- CreateIndex
CREATE INDEX "IntakeCustomQuestion_appliesTo_active_displayOrder_idx" ON "IntakeCustomQuestion"("appliesTo", "active", "displayOrder");

-- CreateIndex
CREATE INDEX "IntakeCustomAnswer_questionId_idx" ON "IntakeCustomAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeCustomAnswer_intakeId_questionId_key" ON "IntakeCustomAnswer"("intakeId", "questionId");

-- AddForeignKey
ALTER TABLE "PatientProfile" ADD CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProfile" ADD CONSTRAINT "PatientProfile_assignedTherapistId_fkey" FOREIGN KEY ("assignedTherapistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProfile" ADD CONSTRAINT "PatientProfile_responsibleDoctorId_fkey" FOREIGN KEY ("responsibleDoctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSpecialty" ADD CONSTRAINT "UserSpecialty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSpecialty" ADD CONSTRAINT "UserSpecialty_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_assignedTherapistId_fkey" FOREIGN KEY ("assignedTherapistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_parentPlanId_fkey" FOREIGN KEY ("parentPlanId") REFERENCES "TreatmentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExercise" ADD CONSTRAINT "PlanExercise_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TreatmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExercise" ADD CONSTRAINT "PlanExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeProgramItem" ADD CONSTRAINT "HomeProgramItem_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeProgramItem" ADD CONSTRAINT "HomeProgramItem_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeProgramCompletion" ADD CONSTRAINT "HomeProgramCompletion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "HomeProgramItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeAssessment" ADD CONSTRAINT "IntakeAssessment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeAssessment" ADD CONSTRAINT "IntakeAssessment_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeAssessment" ADD CONSTRAINT "IntakeAssessment_reviewedByClinicianId_fkey" FOREIGN KEY ("reviewedByClinicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdultIntakeData" ADD CONSTRAINT "AdultIntakeData_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "IntakeAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PediatricIntakeData" ADD CONSTRAINT "PediatricIntakeData_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "IntakeAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeCustomQuestion" ADD CONSTRAINT "IntakeCustomQuestion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeCustomAnswer" ADD CONSTRAINT "IntakeCustomAnswer_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "IntakeAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeCustomAnswer" ADD CONSTRAINT "IntakeCustomAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "IntakeCustomQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
--  Partial unique indexes that Prisma's schema language cannot express.
--  Owned by the same `init` migration so they apply in lock-step with the
--  rest of the schema — a future `prisma migrate reset` will recreate them.
-- ════════════════════════════════════════════════════════════════════════════

-- One ACTIVE treatment plan per patient. Paused / completed / discontinued plans
-- may coexist — only ACTIVE is restricted.
CREATE UNIQUE INDEX "treatment_plans_active_per_patient"
  ON "TreatmentPlan" ("patientId")
  WHERE "status" = 'ACTIVE';

-- Phone uniqueness scoped to non-deleted rows. A soft-deleted user freeing their
-- phone number lets a new patient re-register with the same E.164 string.
DROP INDEX IF EXISTS "User_phone_key";
CREATE UNIQUE INDEX "User_phone_unique_active"
  ON "User" ("phone")
  WHERE "deletedAt" IS NULL;

-- Email uniqueness scoped to non-deleted rows AND non-null emails (patients on
-- OTP-only login have NULL email; multiple such rows must coexist).
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX "User_email_unique_active"
  ON "User" ("email")
  WHERE "deletedAt" IS NULL AND "email" IS NOT NULL;
