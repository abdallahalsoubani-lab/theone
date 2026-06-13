/**
 * Tier 2 — dev/test data.
 *
 * Skipped when NODE_ENV === 'production'. Idempotent via deterministic IDs:
 * re-running `pnpm db:seed` upserts every row by a stable cuid-shaped string,
 * so dev data converges to the same shape regardless of starting state.
 *
 * Passwords are hashed with bcryptjs (cost 10 — light for seeds) so Prompt 4
 * can authenticate against these accounts without re-seeding. They are dev-only:
 * see the README for the warning and the password list.
 */

import {
  type Prisma,
  type PrismaClient,
  AppointmentStatus,
  CancellationCategory,
  Comorbidity,
  Gender,
  IntakeStatus,
  IntakeType,
  LanguagePref,
  LeaveStatus,
  LeaveType,
  PainSeverity,
  PainStability,
  PainTiming,
  PhysicalActivityLevel,
  PlanStatus,
  ReferralSource,
  SymptomDuration,
  UserRole,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const PASSWORDS = {
  admin: 'Admin@123',
  doctor: 'Doctor@123',
  therapist: 'Therapist@123',
  secretary: 'Reception@123',
  patient: 'Patient@123',
} as const;

type StaffIds = {
  admin: string;
  doctor: string;
  secretary: string;
  therapists: { ahmad: string; layan: string; omar: string };
};

/**
 * Staff accounts only — for VM / staging deploys that need real logins without
 * demo patients, appointments, or clinical fixtures. Requires reference seed
 * (specialties) first.
 */
export async function seedStaffOnly(db: PrismaClient): Promise<void> {
  const specialties = await loadSpecialties(db);
  await seedStaff(db, specialties);
}

export async function seedDevData(db: PrismaClient): Promise<void> {
  const specialties = await loadSpecialties(db);
  const staff = await seedStaff(db, specialties);
  const patients = await seedPatients(db, staff);
  await seedIntakes(db, patients, staff);
  const exercises = await seedExercises(db, staff.doctor);
  const appointments = await seedAppointments(db, patients, staff);
  await seedSessionNotes(db, appointments);
  await seedTreatmentPlans(db, patients, staff);
  await seedHomeProgram(db, patients, exercises);
  await seedLeave(db, staff);
  await seedClinicalReports(db, patients, staff, appointments);
}

async function loadSpecialties(db: PrismaClient) {
  const all = await db.specialty.findMany();
  const byName = (en: string) => {
    const s = all.find((x) => x.nameEn === en);
    if (!s) throw new Error(`Specialty "${en}" missing — run reference seed first.`);
    return s;
  };
  return {
    orthopedic: byName('Orthopedic Physiotherapy'),
    sports: byName('Sports Rehabilitation'),
    pediatric: byName('Pediatric Physiotherapy'),
    neurological: byName('Neurological Physiotherapy'),
    manual: byName('Manual Therapy'),
  };
}

type Specialties = Awaited<ReturnType<typeof loadSpecialties>>;

async function seedStaff(db: PrismaClient, sp: Specialties): Promise<StaffIds> {
  const adminId = 'seed-user-admin';
  const doctorId = 'seed-user-doctor-sara';
  const secretaryId = 'seed-user-secretary';
  const ahmadId = 'seed-user-therapist-ahmad';
  const layanId = 'seed-user-therapist-layan';
  const omarId = 'seed-user-therapist-omar';

  await upsertUser(db, {
    id: adminId,
    email: 'admin@theone.pt',
    phone: '+962790000001',
    role: UserRole.ADMIN,
    fullNameEn: 'System Admin',
    fullNameAr: 'مسؤول النظام',
    password: PASSWORDS.admin,
  });
  await upsertUser(db, {
    id: doctorId,
    email: 'dr.sara@theone.pt',
    phone: '+962790000002',
    role: UserRole.DOCTOR,
    fullNameEn: 'Dr. Sara Al-Khatib',
    fullNameAr: 'د. سارة الخطيب',
    password: PASSWORDS.doctor,
  });
  await upsertUser(db, {
    id: secretaryId,
    email: 'reception@theone.pt',
    phone: '+962790000003',
    role: UserRole.SECRETARY,
    fullNameEn: 'Reception Desk',
    fullNameAr: 'مكتب الاستقبال',
    password: PASSWORDS.secretary,
  });
  await upsertUser(db, {
    id: ahmadId,
    email: 'ahmad@theone.pt',
    phone: '+962790000010',
    role: UserRole.THERAPIST,
    fullNameEn: 'Ahmad Mansour',
    fullNameAr: 'أحمد منصور',
    password: PASSWORDS.therapist,
  });
  await upsertUser(db, {
    id: layanId,
    email: 'layan@theone.pt',
    phone: '+962790000011',
    role: UserRole.THERAPIST,
    fullNameEn: 'Layan Haddad',
    fullNameAr: 'ليان حداد',
    password: PASSWORDS.therapist,
  });
  await upsertUser(db, {
    id: omarId,
    email: 'omar@theone.pt',
    phone: '+962790000012',
    role: UserRole.THERAPIST,
    fullNameEn: 'Omar Tarawneh',
    fullNameAr: 'عمر الطراونة',
    password: PASSWORDS.therapist,
  });

  await assignSpecialties(db, doctorId, [sp.orthopedic.id, sp.sports.id]);
  await assignSpecialties(db, ahmadId, [sp.orthopedic.id, sp.manual.id]);
  await assignSpecialties(db, layanId, [sp.pediatric.id]);
  await assignSpecialties(db, omarId, [sp.sports.id, sp.neurological.id]);

  return {
    admin: adminId,
    doctor: doctorId,
    secretary: secretaryId,
    therapists: { ahmad: ahmadId, layan: layanId, omar: omarId },
  };
}

async function upsertUser(
  db: PrismaClient,
  args: {
    id: string;
    email: string;
    phone: string;
    role: UserRole;
    fullNameEn: string;
    fullNameAr: string;
    password: string | null;
    languagePref?: LanguagePref;
  },
): Promise<void> {
  const passwordHash = args.password ? await bcrypt.hash(args.password, 10) : null;
  await db.user.upsert({
    where: { id: args.id },
    update: {
      email: args.email,
      phone: args.phone,
      role: args.role,
      fullNameEn: args.fullNameEn,
      fullNameAr: args.fullNameAr,
      languagePref: args.languagePref ?? LanguagePref.EN,
      passwordHash,
      mustChangePassword: false,
    },
    create: {
      id: args.id,
      email: args.email,
      phone: args.phone,
      role: args.role,
      fullNameEn: args.fullNameEn,
      fullNameAr: args.fullNameAr,
      languagePref: args.languagePref ?? LanguagePref.EN,
      passwordHash,
      mustChangePassword: false,
    },
  });
}

async function assignSpecialties(db: PrismaClient, userId: string, specialtyIds: string[]) {
  for (const specialtyId of specialtyIds) {
    await db.userSpecialty.upsert({
      where: { userId_specialtyId: { userId, specialtyId } },
      update: {},
      create: { userId, specialtyId },
    });
  }
}

type PatientDef = {
  id: string;
  email: string | null;
  phone: string;
  fullNameEn: string;
  fullNameAr: string;
  dateOfBirth: Date;
  gender: Gender;
  isPediatric: boolean;
};

const PATIENT_DEFS: ReadonlyArray<PatientDef> = [
  {
    id: 'seed-patient-01',
    email: 'sara.k@example.com',
    phone: '+962791000001',
    fullNameEn: 'Sara Khalil',
    fullNameAr: 'سارة خليل',
    dateOfBirth: new Date('1989-03-12'),
    gender: Gender.FEMALE,
    isPediatric: false,
  },
  {
    id: 'seed-patient-02',
    email: 'majd.s@example.com',
    phone: '+962791000002',
    fullNameEn: 'Majd Saleem',
    fullNameAr: 'مجد سليم',
    dateOfBirth: new Date('1975-08-04'),
    gender: Gender.MALE,
    isPediatric: false,
  },
  {
    id: 'seed-patient-03',
    email: null,
    phone: '+962791000003',
    fullNameEn: 'Nour Abu-Saif',
    fullNameAr: 'نور أبو سيف',
    dateOfBirth: new Date('1995-11-21'),
    gender: Gender.FEMALE,
    isPediatric: false,
  },
  {
    id: 'seed-patient-04',
    email: 'hisham@example.com',
    phone: '+962791000004',
    fullNameEn: 'Hisham Daoud',
    fullNameAr: 'هشام داود',
    dateOfBirth: new Date('1962-01-30'),
    gender: Gender.MALE,
    isPediatric: false,
  },
  {
    id: 'seed-patient-05',
    email: null,
    phone: '+962791000005',
    fullNameEn: 'Rima Al-Nimri',
    fullNameAr: 'ريما النمري',
    dateOfBirth: new Date('2000-06-18'),
    gender: Gender.FEMALE,
    isPediatric: false,
  },
  {
    id: 'seed-patient-06',
    email: null,
    phone: '+962791000006',
    fullNameEn: 'Yousef Hamdan',
    fullNameAr: 'يوسف حمدان',
    dateOfBirth: new Date('2015-09-09'),
    gender: Gender.MALE,
    isPediatric: true,
  },
  {
    id: 'seed-patient-07',
    email: null,
    phone: '+962791000007',
    fullNameEn: 'Lina Sweidan',
    fullNameAr: 'لينا سويدان',
    dateOfBirth: new Date('2017-02-14'),
    gender: Gender.FEMALE,
    isPediatric: true,
  },
  {
    id: 'seed-patient-08',
    email: null,
    phone: '+962791000008',
    fullNameEn: 'Ahmad Yousef',
    fullNameAr: 'أحمد يوسف',
    dateOfBirth: new Date('1983-07-25'),
    gender: Gender.MALE,
    isPediatric: false,
  },
];

async function seedPatients(db: PrismaClient, staff: StaffIds) {
  const patientPwd = await bcrypt.hash(PASSWORDS.patient, 10);
  for (const p of PATIENT_DEFS) {
    await db.user.upsert({
      where: { id: p.id },
      update: {
        email: p.email,
        phone: p.phone,
        fullNameEn: p.fullNameEn,
        fullNameAr: p.fullNameAr,
      },
      create: {
        id: p.id,
        email: p.email,
        phone: p.phone,
        role: UserRole.PATIENT,
        fullNameEn: p.fullNameEn,
        fullNameAr: p.fullNameAr,
        languagePref: LanguagePref.AR,
        passwordHash: patientPwd,
        mustChangePassword: true,
      },
    });
    await db.patientProfile.upsert({
      where: { userId: p.id },
      update: {
        dateOfBirth: p.dateOfBirth,
        gender: p.gender,
      },
      create: {
        userId: p.id,
        dateOfBirth: p.dateOfBirth,
        gender: p.gender,
        address: 'Amman, Jordan',
      },
    });

    // Care team (Prompt 14): one therapist + the doctor for everyone, plus a
    // second therapist on the first adult patient to exercise the M2M model.
    const patientIndex = PATIENT_DEFS.indexOf(p);
    const primaryTherapist = p.isPediatric
      ? staff.therapists.layan
      : [staff.therapists.ahmad, staff.therapists.omar][patientIndex % 2]!;
    const careTeam: Array<{ clinicianId: string; role: 'THERAPIST' | 'DOCTOR' }> = [
      { clinicianId: primaryTherapist, role: 'THERAPIST' },
      { clinicianId: staff.doctor, role: 'DOCTOR' },
    ];
    if (!p.isPediatric && patientIndex === 0) {
      careTeam.push({ clinicianId: staff.therapists.layan, role: 'THERAPIST' });
    }
    for (const member of careTeam) {
      await db.careTeamMember.upsert({
        where: { patientId_clinicianId: { patientId: p.id, clinicianId: member.clinicianId } },
        update: {},
        create: {
          patientId: p.id,
          clinicianId: member.clinicianId,
          role: member.role,
          assignedBy: staff.admin,
        },
      });
    }
  }
  return PATIENT_DEFS;
}

async function seedIntakes(db: PrismaClient, patients: ReadonlyArray<PatientDef>, staff: StaffIds) {
  const adults = patients.filter((p) => !p.isPediatric).slice(0, 5);
  const peds = patients.filter((p) => p.isPediatric);

  // 4 completed adult intakes
  for (let i = 0; i < 4; i++) {
    const patient = adults[i];
    if (!patient) continue;
    const intakeId = `seed-intake-adult-${patient.id}`;
    await db.intakeAssessment.upsert({
      where: { id: intakeId },
      update: {},
      create: {
        id: intakeId,
        patientId: patient.id,
        type: IntakeType.ADULT,
        status: IntakeStatus.COMPLETED,
        assessedById: staff.secretary,
      },
    });
    await db.adultIntakeData.upsert({
      where: { intakeId },
      update: {},
      create: {
        intakeId,
        physicalActivityLevel: [
          PhysicalActivityLevel.MODERATE,
          PhysicalActivityLevel.LOW,
          PhysicalActivityLevel.ACTIVE,
          PhysicalActivityLevel.VERY_ACTIVE,
        ][i]!,
        primaryComplaint: [
          'Lower-back pain after long sitting',
          'Right shoulder stiffness',
          'Knee pain when climbing stairs',
          'Neck pain radiating to right arm',
        ][i]!,
        painTiming: PainTiming.DAY,
        symptomDuration: [
          SymptomDuration.WEEKS_2_3,
          SymptomDuration.MONTHS_1_3,
          SymptomDuration.MONTHS_3_6,
          SymptomDuration.LTE_1_WEEK,
        ][i]!,
        painSeverity: [
          PainSeverity.FIVE,
          PainSeverity.SIX_SEVEN,
          PainSeverity.THREE_FOUR,
          PainSeverity.EIGHT_NINE,
        ][i]!,
        painStability: PainStability.CONSTANT,
        conditions: i === 1 ? [Comorbidity.HYPERTENSION] : [Comorbidity.NONE],
        referralSource: [
          ReferralSource.DOCTOR_REFERRAL,
          ReferralSource.GOOGLE_SEARCH,
          ReferralSource.FRIEND_FAMILY,
          ReferralSource.SOCIAL_MEDIA,
        ][i]!,
      },
    });
  }

  // 2 completed pediatric intakes
  for (let i = 0; i < peds.length; i++) {
    const child = peds[i]!;
    const intakeId = `seed-intake-ped-${child.id}`;
    await db.intakeAssessment.upsert({
      where: { id: intakeId },
      update: {},
      create: {
        id: intakeId,
        patientId: child.id,
        type: IntakeType.PEDIATRIC,
        status: IntakeStatus.COMPLETED,
        assessedById: staff.secretary,
      },
    });
    await db.pediatricIntakeData.upsert({
      where: { intakeId },
      update: {},
      create: { intakeId, numberOfSiblings: 2 + i, birthOrder: 1 + i },
    });
  }

  // 1 in-progress adult intake
  const inProgressPatient = adults[4];
  if (inProgressPatient) {
    await db.intakeAssessment.upsert({
      where: { id: `seed-intake-wip-${inProgressPatient.id}` },
      update: {},
      create: {
        id: `seed-intake-wip-${inProgressPatient.id}`,
        patientId: inProgressPatient.id,
        type: IntakeType.ADULT,
        status: IntakeStatus.IN_PROGRESS,
        assessedById: staff.secretary,
      },
    });
  }
}

async function seedExercises(db: PrismaClient, createdById: string) {
  const exercises: ReadonlyArray<Prisma.ExerciseUncheckedCreateInput> = [
    {
      id: 'seed-ex-01',
      nameEn: 'Glute bridge',
      nameAr: 'جسر الأرداف',
      descriptionEn: 'Lie supine, knees bent, lift hips.',
      descriptionAr: 'استلقاء على الظهر، رفع الحوض.',
      category: 'Strength',
      anatomicalRegion: 'Hip',
      createdById,
    },
    {
      id: 'seed-ex-02',
      nameEn: 'Cat-cow stretch',
      nameAr: 'تمدد القط والبقرة',
      descriptionEn: 'Quadruped spinal mobility flow.',
      descriptionAr: 'حركة العمود الفقري على أربع.',
      category: 'Mobility',
      anatomicalRegion: 'Spine',
      createdById,
    },
    {
      id: 'seed-ex-03',
      nameEn: 'Shoulder external rotation',
      nameAr: 'دوران الكتف الخارجي',
      descriptionEn: 'Banded shoulder ER, elbow at side.',
      descriptionAr: 'دوران الكتف بحبل المقاومة.',
      category: 'Strength',
      anatomicalRegion: 'Shoulder',
      createdById,
    },
    {
      id: 'seed-ex-04',
      nameEn: 'Wall squat',
      nameAr: 'القرفصاء على الحائط',
      descriptionEn: 'Static squat hold against wall.',
      descriptionAr: 'قرفصاء ثابتة على الحائط.',
      category: 'Strength',
      anatomicalRegion: 'Knee',
      createdById,
    },
    {
      id: 'seed-ex-05',
      nameEn: 'Single-leg balance',
      nameAr: 'توازن على ساق واحدة',
      descriptionEn: 'Eyes-open, 30 seconds per side.',
      descriptionAr: 'وقوف على ساق واحدة 30 ثانية.',
      category: 'Balance',
      anatomicalRegion: 'Ankle',
      createdById,
    },
  ];
  for (const ex of exercises) {
    await db.exercise.upsert({ where: { id: ex.id! }, update: {}, create: ex });
  }
  return exercises;
}

async function seedAppointments(
  db: PrismaClient,
  patients: ReadonlyArray<PatientDef>,
  staff: StaffIds,
) {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const room = await db.room.findFirst({ where: { name: 'Treatment Room 1' } });

  const therapistOf = (p: PatientDef): string =>
    p.isPediatric ? staff.therapists.layan : staff.therapists.ahmad;

  const definitions = [
    { offset: -3, hour: 10, status: AppointmentStatus.COMPLETED, idx: 0 },
    { offset: -2, hour: 9, status: AppointmentStatus.COMPLETED, idx: 4 },
    { offset: -1, hour: 14, status: AppointmentStatus.COMPLETED, idx: 1 },
    { offset: -1, hour: 16, status: AppointmentStatus.NO_SHOW, idx: 2 },
    { offset: 1, hour: 9, status: AppointmentStatus.SCHEDULED, idx: 3 },
    { offset: 1, hour: 11, status: AppointmentStatus.CONFIRMED, idx: 4 },
    { offset: 2, hour: 10, status: AppointmentStatus.SCHEDULED, idx: 0 },
    { offset: 3, hour: 15, status: AppointmentStatus.SCHEDULED, idx: 5 },
    { offset: 5, hour: 13, status: AppointmentStatus.SCHEDULED, idx: 6 },
    { offset: 7, hour: 10, status: AppointmentStatus.CANCELLED, idx: 7 },
  ];

  const created: {
    id: string;
    patientId: string;
    therapistId: string;
    status: AppointmentStatus;
  }[] = [];
  for (let i = 0; i < definitions.length; i++) {
    const d = definitions[i]!;
    const patient = patients[d.idx]!;
    const id = `seed-appt-${i + 1}`;
    const startsAt = new Date(now.getTime() + d.offset * dayMs);
    startsAt.setHours(d.hour, 0, 0, 0);
    const therapistId = therapistOf(patient);
    await db.appointment.upsert({
      where: { id },
      update: { startsAt, status: d.status },
      create: {
        id,
        patientId: patient.id,
        therapists: { create: [{ therapistId }] },
        roomId: room?.id ?? null,
        startsAt,
        durationMinutes: 30,
        status: d.status,
        createdById: staff.secretary,
        notes: d.status === AppointmentStatus.CANCELLED ? 'Patient called to reschedule.' : null,
        // Sample categories on cancelled rows so the Prompt 11 dashboard
        // analytics widget has realistic distribution on a fresh clone.
        cancellationCategory:
          d.status === AppointmentStatus.CANCELLED ? cancellationCategorySample(d.idx) : null,
        cancellationReason:
          d.status === AppointmentStatus.CANCELLED ? 'Cancelled via legacy flow.' : null,
      },
    });
    created.push({ id, patientId: patient.id, therapistId, status: d.status });
  }
  return created;
}

async function seedSessionNotes(
  db: PrismaClient,
  appointments: ReadonlyArray<{
    id: string;
    patientId: string;
    therapistId: string;
    status: AppointmentStatus;
  }>,
) {
  const completed = appointments
    .filter((a) => a.status === AppointmentStatus.COMPLETED)
    .slice(0, 3);
  for (let i = 0; i < completed.length; i++) {
    const a = completed[i]!;
    // Post-Prompt 9 the unique on (appointmentId) is partial (primary
    // notes only), so we upsert by deterministic id instead. The dev
    // seed still creates exactly one primary note per completed
    // appointment.
    await db.sessionNote.upsert({
      where: { id: `seed-note-${a.id}` },
      update: {},
      create: {
        id: `seed-note-${a.id}`,
        appointmentId: a.id,
        patientId: a.patientId,
        therapistId: a.therapistId,
        subjective: 'Patient reports moderate improvement since last visit.',
        objective: 'ROM improved by 10°. No swelling.',
        assessment: 'Responding well to current protocol.',
        plan: 'Continue plan; add resistance band next session.',
        painScore: 4,
      },
    });
  }
}

async function seedTreatmentPlans(
  db: PrismaClient,
  patients: ReadonlyArray<PatientDef>,
  staff: StaffIds,
) {
  const active = patients[0]!;
  const completed = patients[1]!;
  await db.treatmentPlan.upsert({
    where: { id: 'seed-plan-active' },
    update: {},
    create: {
      id: 'seed-plan-active',
      patientId: active.id,
      doctorId: staff.doctor,
      assignedTherapistId: staff.therapists.ahmad,
      diagnosisPrimary: 'Lumbar strain',
      goalsShortTerm: 'Reduce pain to ≤ 2/10 in two weeks.',
      goalsLongTerm: 'Restore full lumbar mobility within 8 weeks.',
      frequencyPerWeek: 2,
      durationWeeks: 8,
      status: PlanStatus.ACTIVE,
    },
  });
  await db.treatmentPlan.upsert({
    where: { id: 'seed-plan-completed' },
    update: {},
    create: {
      id: 'seed-plan-completed',
      patientId: completed.id,
      doctorId: staff.doctor,
      assignedTherapistId: staff.therapists.omar,
      diagnosisPrimary: 'Right rotator cuff impingement',
      goalsShortTerm: 'Restore overhead reach.',
      goalsLongTerm: 'Return to full sport.',
      frequencyPerWeek: 3,
      durationWeeks: 6,
      status: PlanStatus.COMPLETED,
    },
  });

  // A PROPOSED revision off the active plan — gives the Doctor a
  // dashboard entry to triage on a fresh clone (Prompt 9 §4.4-§4.5).
  // Targets a different patient than the active plan to avoid tripping
  // the (patientId WHERE PROPOSED) partial unique on re-seed.
  const proposalTarget = patients[2];
  if (proposalTarget) {
    await db.treatmentPlan.upsert({
      where: { id: 'seed-plan-proposed-parent' },
      update: {},
      create: {
        id: 'seed-plan-proposed-parent',
        patientId: proposalTarget.id,
        doctorId: staff.doctor,
        assignedTherapistId: staff.therapists.ahmad,
        diagnosisPrimary: 'Cervical strain, chronic',
        goalsShortTerm: 'Reduce pain to 3/10 within two weeks.',
        goalsLongTerm: 'Restore full cervical range of motion.',
        frequencyPerWeek: 2,
        durationWeeks: 6,
        status: PlanStatus.ACTIVE,
        therapistNotes: 'Avoid end-range cervical extension until weeks 3-4.',
      },
    });
    await db.treatmentPlan.upsert({
      where: { id: 'seed-plan-proposed-child' },
      update: {},
      create: {
        id: 'seed-plan-proposed-child',
        patientId: proposalTarget.id,
        doctorId: staff.doctor,
        assignedTherapistId: staff.therapists.ahmad,
        parentPlanId: 'seed-plan-proposed-parent',
        version: 2,
        diagnosisPrimary: 'Cervical strain, chronic',
        goalsShortTerm: 'Reduce pain to 3/10 within two weeks.',
        goalsLongTerm: 'Restore full cervical range of motion.',
        frequencyPerWeek: 3,
        durationWeeks: 6,
        status: PlanStatus.PROPOSED,
        therapistNotes: 'Avoid end-range cervical extension until weeks 3-4.',
        proposalReason: 'Patient tolerating sessions well — request to add a third weekly slot.',
      },
    });
  }
}

async function seedClinicalReports(
  db: PrismaClient,
  patients: ReadonlyArray<PatientDef>,
  staff: StaffIds,
  appointments: ReadonlyArray<{
    id: string;
    patientId: string;
    therapistId: string;
    status: AppointmentStatus;
  }>,
) {
  // Yesterday's day report from one of the therapists, covering the
  // session notes that touch that day. Date stored as midnight UTC to
  // match Postgres DATE semantics.
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  const therapistDayEntries = appointments
    .filter(
      (a) => a.status === AppointmentStatus.COMPLETED && a.therapistId === staff.therapists.ahmad,
    )
    .slice(0, 2)
    .map((a) => ({
      patientId: a.patientId,
      appointmentId: a.id,
      note: 'Completed session. Patient tolerated all exercises; see session note for ROM measurements.',
    }));

  if (therapistDayEntries.length > 0) {
    const existing = await db.dayReport.findUnique({
      where: { therapistId_date: { therapistId: staff.therapists.ahmad, date: yesterday } },
    });
    if (!existing) {
      await db.dayReport.create({
        data: {
          id: 'seed-day-report-yesterday',
          therapistId: staff.therapists.ahmad,
          date: yesterday,
          overallSummary:
            'Steady day — both patients progressing per plan. No adverse events. ' +
            'Recommend continuing current frequency for the lumbar patient.',
          patientEntries: therapistDayEntries,
        },
      });
    }
  }

  // A doctor review from last week, attached to whichever patient the
  // doctor day-reported on (or the first patient if no day-report rows
  // landed).
  const reviewPatient = therapistDayEntries[0]?.patientId ?? patients[0]?.id ?? null;
  if (reviewPatient) {
    const weekStarting = new Date();
    weekStarting.setUTCDate(weekStarting.getUTCDate() - 7);
    weekStarting.setUTCHours(0, 0, 0, 0);

    const existing = await db.doctorReview.findFirst({
      where: { doctorId: staff.doctor, patientId: reviewPatient, weekStarting },
    });
    if (!existing) {
      await db.doctorReview.create({
        data: {
          id: 'seed-doctor-review-1',
          doctorId: staff.doctor,
          patientId: reviewPatient,
          weekStarting,
          comment:
            'Solid week. Pain trajectory is on track; continue with current plan. ' +
            'Re-evaluate need for cervical traction at the two-week mark.',
        },
      });
    }
  }
}

async function seedHomeProgram(
  db: PrismaClient,
  patients: ReadonlyArray<PatientDef>,
  exercises: ReadonlyArray<Prisma.ExerciseUncheckedCreateInput>,
) {
  const patient = patients[0]!;
  const ex1 = exercises[0]!;
  const ex2 = exercises[1]!;
  // Daily morning routine. daysOfWeek covers the full week.
  await db.homeProgramItem.upsert({
    where: { id: 'seed-hp-01' },
    update: {},
    create: {
      id: 'seed-hp-01',
      patientId: patient.id,
      exerciseId: ex1.id!,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      scheduledTime: '08:00',
      durationMinutes: 10,
      setsReps: '3 × 10',
      therapistNote: 'Focus on slow controlled motion.',
    },
  });
  // Three-times-a-week evening exercise — Mon/Wed/Fri.
  await db.homeProgramItem.upsert({
    where: { id: 'seed-hp-02' },
    update: {},
    create: {
      id: 'seed-hp-02',
      patientId: patient.id,
      exerciseId: ex2.id!,
      daysOfWeek: [1, 3, 5],
      scheduledTime: '19:00',
      durationMinutes: 8,
      setsReps: '2 × 12',
    },
  });

  // 3 completions over the last week to give the UI a streak to render
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let offset = 1; offset <= 3; offset++) {
    const scheduledDate = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
    await db.homeProgramCompletion.upsert({
      where: { itemId_scheduledDate: { itemId: 'seed-hp-01', scheduledDate } },
      update: {},
      create: {
        itemId: 'seed-hp-01',
        scheduledDate,
        completedAt: new Date(scheduledDate.getTime() + 8 * 60 * 60 * 1000),
        painScore: 3,
      },
    });
  }
}

async function seedLeave(db: PrismaClient, staff: StaffIds) {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  await db.leave.upsert({
    where: { id: 'seed-leave-omar' },
    update: {},
    create: {
      id: 'seed-leave-omar',
      userId: staff.therapists.omar,
      startDate: start,
      endDate: end,
      leaveType: LeaveType.VACATION,
      status: LeaveStatus.APPROVED,
      reason: 'Family commitment.',
      approvedById: staff.admin,
    },
  });
}

/**
 * Deterministic category sampler for seeded CANCELLED appointments.
 * Distribution roughly matches the Prompt 7b §4.1 guidance — half
 * PATIENT_REQUEST, a quarter PATIENT_ILLNESS, an eighth
 * THERAPIST_UNAVAILABLE, remainder OTHER. Keyed on the appointment
 * index so re-runs converge to the same shape.
 */
function cancellationCategorySample(idx: number): CancellationCategory {
  const bucket = idx % 8;
  if (bucket < 4) return CancellationCategory.PATIENT_REQUEST;
  if (bucket < 6) return CancellationCategory.PATIENT_ILLNESS;
  if (bucket === 6) return CancellationCategory.THERAPIST_UNAVAILABLE;
  return CancellationCategory.OTHER;
}
