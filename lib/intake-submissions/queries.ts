import 'server-only';

import type { IntakeType } from '@prisma/client';

import { db } from '@/lib/db';

export interface SubmissionListRow {
  id: string;
  type: IntakeType;
  submittedName: string;
  submittedPhone: string;
  createdAt: Date;
}

/** Pending review queue, newest first. */
export async function listPendingSubmissions(): Promise<SubmissionListRow[]> {
  return db.intakeSubmission.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      submittedName: true,
      submittedPhone: true,
      createdAt: true,
    },
  });
}

export async function countPendingSubmissions(): Promise<number> {
  return db.intakeSubmission.count({ where: { status: 'PENDING' } });
}

export interface SubmissionDetail {
  id: string;
  type: IntakeType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedName: string;
  submittedPhone: string;
  profile: Record<string, unknown>;
  answers: Record<string, unknown>;
  createdAt: Date;
  linkedPatientId: string | null;
}

export async function getSubmissionById(id: string): Promise<SubmissionDetail | null> {
  const r = await db.intakeSubmission.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      status: true,
      submittedName: true,
      submittedPhone: true,
      profile: true,
      answers: true,
      createdAt: true,
      linkedPatientId: true,
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    submittedName: r.submittedName,
    submittedPhone: r.submittedPhone,
    profile: (r.profile ?? {}) as Record<string, unknown>,
    answers: (r.answers ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt,
    linkedPatientId: r.linkedPatientId,
  };
}

export interface PhoneMatch {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  phone: string;
}

/**
 * Duplicate-by-phone lookup for the review screen. Returns an existing,
 * non-deleted PATIENT whose phone matches the (already normalised) submitted
 * phone, or null. Drives the "link to existing patient" path.
 */
export async function findPatientByPhone(phone: string): Promise<PhoneMatch | null> {
  const r = await db.user.findFirst({
    where: { phone, role: 'PATIENT', deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true, phone: true },
  });
  return r;
}
