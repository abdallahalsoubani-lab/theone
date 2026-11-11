import 'server-only';

import type { IntakeType } from '@prisma/client';

import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

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

export interface LinkIntakeRow {
  intakeId: string;
  patientId: string;
  type: IntakeType;
  patientNameEn: string;
  patientNameAr: string;
  receivedAt: Date;
}

/**
 * P64 #9 — intakes patients completed through their PERSONAL link. These are
 * saved straight to the file (no review — P52 decision 3), so they never sit
 * in the pending queue; the requests page lists the recent ones so the desk
 * can SEE them arrive. Identified by the SYSTEM assessor the link path uses.
 */
export async function listRecentLinkIntakes(days = 30): Promise<LinkIntakeRow[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.intakeAssessment.findMany({
    where: { assessedById: SYSTEM_USER_ID, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      patientId: true,
      type: true,
      createdAt: true,
      patient: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  return rows.map((r) => ({
    intakeId: r.id,
    patientId: r.patientId,
    type: r.type,
    patientNameEn: r.patient.fullNameEn,
    patientNameAr: r.patient.fullNameAr,
    receivedAt: r.createdAt,
  }));
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
  phone: string | null;
}

/**
 * Duplicate-by-phone lookup for the review screen. Returns EVERY existing,
 * non-deleted PATIENT whose phone matches the (already normalised) submitted
 * phone — P57: a family number may already be shared by several patients,
 * and the reviewer must pick which one to link (never the first match).
 * Oldest record first.
 */
export async function findPatientsByPhone(phone: string): Promise<PhoneMatch[]> {
  return db.user.findMany({
    where: { phone, role: 'PATIENT', deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true, phone: true },
    orderBy: { createdAt: 'asc' },
  });
}
