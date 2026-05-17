/**
 * Public surface for application database access.
 *
 * Application code imports `db`, the transaction helper, the error mapper, and the
 * specific types it needs from here — NOT from `@prisma/client` directly. Keeping
 * a single ingress point makes future migrations (encryption layer, read replicas,
 * mocked client in tests) tractable.
 *
 * Type re-exports are deliberate. Adding "everything from @prisma/client" would
 * leak internals like `Prisma.Args`/`Prisma.GetPayload` into modules that should
 * not use them. Add to the list below as new modules need new model types.
 */

export { db } from './client';
export { withTransaction } from './transaction';
export { mapPrismaError, toLocalizedError, type LocalizedError } from './errors';

export type {
  // Core users + profile
  User,
  PatientProfile,
  Specialty,
  UserSpecialty,
  Room,

  // Scheduling
  Appointment,
  TreatmentPlan,
  PlanExercise,
  Exercise,
  SessionNote,

  // Home program
  HomeProgramItem,
  HomeProgramCompletion,

  // Operations
  Leave,
  WhatsAppTemplate,
  WhatsAppMessage,
  AuditLog,

  // Intake + custom questions
  IntakeAssessment,
  AdultIntakeData,
  PediatricIntakeData,
  IntakeCustomQuestion,
  IntakeCustomAnswer,
} from '@prisma/client';

export {
  UserRole,
  LanguagePref,
  Gender,
  AppointmentStatus,
  CancellationCategory,
  PlanStatus,
  LeaveType,
  LeaveStatus,
  WaTemplateCategory,
  WaMessageDirection,
  WaMessageStatus,
  AuditAction,
  IntakeType,
  IntakeStatus,
  PhysicalActivityLevel,
  PainTiming,
  SymptomDuration,
  PainSeverity,
  PainStability,
  Comorbidity,
  ReferralSource,
  CustomQuestionType,
  CustomQuestionAppliesTo,
  HomeProgramFrequency,
} from '@prisma/client';
