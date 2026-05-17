/**
 * Tier 3 — deterministic test fixtures.
 *
 * Imported by Vitest setup files via `loadFixtures(prisma)`. Produces a minimal,
 * fully-deterministic dataset: a single admin, doctor, therapist, secretary, and
 * patient, with one scheduled appointment between them. Suitable for unit tests
 * that need just enough graph to exercise FK constraints; *not* a substitute for
 * the full dev seed.
 *
 * Tests that need more shape should add scoped data on top of this baseline.
 */

import { type PrismaClient, LanguagePref, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

export interface FixtureIds {
  admin: string;
  doctor: string;
  therapist: string;
  secretary: string;
  patient: string;
  appointment: string;
}

export async function loadFixtures(db: PrismaClient): Promise<FixtureIds> {
  const ids: FixtureIds = {
    admin: 'fixture-admin',
    doctor: 'fixture-doctor',
    therapist: 'fixture-therapist',
    secretary: 'fixture-secretary',
    patient: 'fixture-patient',
    appointment: 'fixture-appointment',
  };

  const passwordHash = await bcrypt.hash('Test@1234', 4);

  const users: Array<{
    id: string;
    email: string;
    phone: string;
    role: UserRole;
    en: string;
    ar: string;
  }> = [
    {
      id: ids.admin,
      email: 'fixture-admin@test.local',
      phone: '+962700000001',
      role: UserRole.ADMIN,
      en: 'Fixture Admin',
      ar: 'مدير الاختبار',
    },
    {
      id: ids.doctor,
      email: 'fixture-doctor@test.local',
      phone: '+962700000002',
      role: UserRole.DOCTOR,
      en: 'Fixture Doctor',
      ar: 'طبيب الاختبار',
    },
    {
      id: ids.therapist,
      email: 'fixture-therapist@test.local',
      phone: '+962700000003',
      role: UserRole.THERAPIST,
      en: 'Fixture Therapist',
      ar: 'معالج الاختبار',
    },
    {
      id: ids.secretary,
      email: 'fixture-secretary@test.local',
      phone: '+962700000004',
      role: UserRole.SECRETARY,
      en: 'Fixture Secretary',
      ar: 'سكرتير الاختبار',
    },
    {
      id: ids.patient,
      email: null as unknown as string,
      phone: '+962700000005',
      role: UserRole.PATIENT,
      en: 'Fixture Patient',
      ar: 'مريض الاختبار',
    },
  ];

  for (const u of users) {
    await db.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        email: u.role === UserRole.PATIENT ? null : u.email,
        phone: u.phone,
        role: u.role,
        fullNameEn: u.en,
        fullNameAr: u.ar,
        languagePref: LanguagePref.EN,
        passwordHash,
      },
    });
  }

  await db.patientProfile.upsert({
    where: { userId: ids.patient },
    update: {},
    create: {
      userId: ids.patient,
      dateOfBirth: new Date('1990-01-01'),
      gender: 'FEMALE',
      assignedTherapistId: ids.therapist,
      responsibleDoctorId: ids.doctor,
    },
  });

  await db.appointment.upsert({
    where: { id: ids.appointment },
    update: {},
    create: {
      id: ids.appointment,
      patientId: ids.patient,
      therapistId: ids.therapist,
      startsAt: new Date('2099-01-01T10:00:00Z'),
      durationMinutes: 30,
      createdById: ids.secretary,
    },
  });

  return ids;
}
