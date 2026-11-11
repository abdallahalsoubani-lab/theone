import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { AuditAction } from '@prisma/client';
import { Document, Image, Page, StyleSheet, View } from '@react-pdf/renderer';
import type { ReactElement } from 'react';

import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { getObjectBytes } from '@/lib/patient-documents/storage';
import { hasPlaceholderDob } from '@/lib/patients/placeholder-dob';

import { PDF_FONT_FAMILY, pdfDir } from './fonts';
import { PdfText, renderPdfToBuffer } from './render';

/**
 * Home-program PDF (P64 #15), modelled on the clinic's own hand-made sample
 * («برنامج تمارين منزلية»):
 *   1. cover — clinic name, title, patient name / age / diagnosis (active
 *      plan), the note for the parents and what the program helps with;
 *   2. the suggested daily schedule — activity × time;
 *   3. one block per exercise — description, library images + this
 *      patient's photos, then «الهدف» (item override, else the exercise
 *      default) and «التكرار» (sets/reps, else the duration).
 * Printed in the PATIENT's language. Download only — never sent.
 *
 * Images: react-pdf embeds JPEG + PNG only, so WebP / HEIC uploads are
 * skipped (never a crash). Only same-origin storage keys are read — an
 * absolute legacy URL is never fetched server-side.
 */

const STORAGE_PREFIX = '/api/v1/storage/';
const MAX_IMAGES_PER_EXERCISE = 4;

export class HomeProgramExportError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'HomeProgramExportError';
  }
}

const NOT_FOUND: LocalizedError = {
  code: 'HOME_PROGRAM_PATIENT_NOT_FOUND',
  message_en: 'Patient not found.',
  message_ar: 'لم يتم العثور على المراجع.',
};
const EMPTY: LocalizedError = {
  code: 'HOME_PROGRAM_EMPTY',
  message_en: 'This patient has no active home-program exercises.',
  message_ar: 'لا توجد تمارين منزلية فعّالة لهذا المراجع.',
};

export function homeProgramErrorToLocalized(err: unknown): LocalizedError {
  if (err instanceof HomeProgramExportError) return err.error;
  return toLocalizedError(err);
}

type PdfImage = { data: Buffer; format: 'png' | 'jpg' };

/** JPEG / PNG by magic bytes; anything else is not embeddable. */
export function embeddableFormat(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  return null;
}

/** Storage key of a same-origin media URL, or null (legacy absolute URL). */
export function storageKeyFromUrl(url: string): string | null {
  if (!url.startsWith(STORAGE_PREFIX)) return null;
  const key = decodeURIComponent(url.slice(STORAGE_PREFIX.length).split('?')[0] ?? '');
  return key && !key.includes('..') ? key : null;
}

async function loadImage(key: string): Promise<PdfImage | null> {
  try {
    const bytes = await getObjectBytes(key);
    const format = embeddableFormat(bytes);
    return format ? { data: Buffer.from(bytes), format } : null;
  } catch (err) {
    console.error('[home-program-pdf] image fetch failed', err);
    return null;
  }
}

/** Age as «1 سنة 2 شهر» / «1y 2m»; '' for an unknown (placeholder) DOB. */
export function ageText(dob: Date | null, ar: boolean, now: Date = new Date()): string {
  if (!dob || hasPlaceholderDob(dob)) return '';
  let months =
    (now.getUTCFullYear() - dob.getUTCFullYear()) * 12 + (now.getUTCMonth() - dob.getUTCMonth());
  if (now.getUTCDate() < dob.getUTCDate()) months -= 1;
  if (months < 0) return '';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (ar) return y > 0 ? `${y} سنة${m ? ` ${m} شهر` : ''}` : `${m} شهر`;
  return y > 0 ? `${y}y${m ? ` ${m}m` : ''}` : `${m}m`;
}

const NAVY = '#1B3A8C';
const GREEN = '#2F8F4E';
const MUTED = '#5A6580';

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: PDF_FONT_FAMILY, fontSize: 11, color: '#212940' },
  brandBar: { borderBottomWidth: 2, borderBottomColor: GREEN, paddingBottom: 6, marginBottom: 18 },
  brand: { fontSize: 12, fontWeight: 700, color: GREEN },
  coverLogo: { width: 110, marginBottom: 30 },
  coverClinic: { fontSize: 20, fontWeight: 700, color: NAVY, textAlign: 'center' },
  coverTitle: { fontSize: 17, fontWeight: 700, color: GREEN, textAlign: 'center', marginTop: 10 },
  coverSub: { fontSize: 14, fontWeight: 700, color: NAVY, textAlign: 'center', marginTop: 4 },
  coverFacts: { marginTop: 40 },
  fact: { flexDirection: 'row', marginBottom: 6 },
  factLabel: { fontWeight: 700, color: NAVY },
  h2: { fontSize: 13, fontWeight: 700, color: NAVY, marginTop: 18, marginBottom: 6 },
  para: { lineHeight: 1.5, marginBottom: 3 },
  noteBox: {
    borderWidth: 2,
    borderColor: NAVY,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  table: { borderWidth: 1, borderColor: '#212940' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#212940' },
  th: { flex: 1, padding: 8, fontWeight: 700, color: NAVY, textAlign: 'center' },
  tdActivity: { flex: 2, padding: 8, textAlign: 'center' },
  tdTime: { flex: 1, padding: 8, textAlign: 'center', borderColor: '#212940' },
  exTitle: { fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 6 },
  images: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginVertical: 10 },
  image: { width: 220, maxHeight: 200, objectFit: 'contain', margin: 6 },
  boxes: { flexDirection: 'row', marginTop: 10 },
  box: { flex: 1, marginHorizontal: 6 },
  boxHead: {
    backgroundColor: '#DCEFE2',
    borderRightWidth: 4,
    borderRightColor: GREEN,
    padding: 6,
    fontWeight: 700,
    color: NAVY,
  },
  boxBody: { padding: 6, textAlign: 'center', lineHeight: 1.4 },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 40,
    right: 40,
    fontSize: 8,
    color: MUTED,
    textAlign: 'center',
  },
});

export interface HomeProgramPdfExercise {
  name: string;
  description: string;
  instruction: string;
  goal: string;
  repetition: string;
  scheduleTime: string;
  images: PdfImage[];
}

export interface HomeProgramPdfModel {
  ar: boolean;
  patientName: string;
  age: string;
  diagnosis: string;
  goals: string[];
  parentNotes: string;
  exercises: HomeProgramPdfExercise[];
  logo: PdfImage | null;
}

export function HomeProgramDocument(m: HomeProgramPdfModel): ReactElement {
  const d = pdfDir(m.ar);
  const L = m.ar
    ? {
        title: 'برنامج تمارين منزلية',
        name: 'الاسم',
        age: 'العمر',
        diagnosis: 'التشخيص',
        parents: 'ملاحظة للأهل',
        helps: `هذا البرنامج يساعد ${m.patientName} على:`,
        schedule: 'الجدول اليومي المقترح:',
        activity: 'النشاط',
        time: 'الوقت',
        exercises: 'التمارين',
        description: 'الوصف:',
        goal: 'الهدف:',
        repetition: 'التكرار:',
        footer: 'برنامج منزلي — للاستخدام الشخصي للمراجع.',
      }
    : {
        title: 'Home Program',
        name: 'Name',
        age: 'Age',
        diagnosis: 'Diagnosis',
        parents: 'Note for the family',
        helps: `This program helps ${m.patientName} with:`,
        schedule: 'Suggested daily schedule:',
        activity: 'Activity',
        time: 'Time',
        exercises: 'Exercises',
        description: 'Description:',
        goal: 'Goal:',
        repetition: 'Repetition:',
        footer: 'Home program — for the patient’s personal use.',
      };
  const brand = 'The One Physical Therapy Center';
  const fact = (label: string, value: string) =>
    value ? (
      <View style={[styles.fact, d.row]}>
        <PdfText style={[styles.factLabel, d.text]}>{label}: </PdfText>
        <PdfText style={d.text}>{value}</PdfText>
      </View>
    ) : null;

  return (
    <Document title={`${L.title} — ${m.patientName}`}>
      {/* 1 — cover */}
      <Page size="A4" style={styles.page}>
        {/* react-pdf <Image> is a PDF primitive, not an HTML img — it has no alt. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        {m.logo ? <Image src={m.logo} style={styles.coverLogo} /> : null}
        <PdfText style={styles.coverClinic}>The One for Physical Therapy Center</PdfText>
        <PdfText style={styles.coverTitle}>برنامج تمارين منزلية</PdfText>
        <PdfText style={styles.coverSub}>Home Program</PdfText>
        <View style={styles.coverFacts}>
          {fact(L.name, m.patientName)}
          {fact(L.age, m.age)}
          {fact(L.diagnosis, m.diagnosis)}
        </View>
        {m.parentNotes || m.goals.length > 0 ? (
          <View>
            <PdfText style={[styles.h2, d.text]}>{L.parents}:</PdfText>
            {m.parentNotes ? (
              <PdfText style={[styles.para, d.text]}>{m.parentNotes}</PdfText>
            ) : null}
            {m.goals.length > 0 ? (
              <>
                <PdfText style={[styles.para, styles.factLabel, d.text]}>{L.helps}</PdfText>
                {m.goals.map((g, i) => (
                  <PdfText key={i} style={[styles.para, d.text]}>
                    {g}
                  </PdfText>
                ))}
              </>
            ) : null}
          </View>
        ) : null}
        <PdfText style={[styles.footer, d.center]} fixed>
          {L.footer}
        </PdfText>
      </Page>

      {/* 2 — daily schedule */}
      <Page size="A4" style={styles.page}>
        <View style={styles.brandBar}>
          <PdfText style={[styles.brand, d.text]}>{brand}</PdfText>
        </View>
        <PdfText style={[styles.h2, d.text]}>{L.schedule}</PdfText>
        <View style={styles.table}>
          <View style={[styles.tr, d.row]}>
            <PdfText style={[styles.th, { flex: 2 }]}>{L.activity}</PdfText>
            <PdfText style={styles.th}>{L.time}</PdfText>
          </View>
          {m.exercises.map((e, i) => (
            <View key={i} style={[styles.tr, d.row]} wrap={false}>
              <PdfText style={styles.tdActivity}>{e.name}</PdfText>
              <PdfText style={styles.tdTime}>{e.scheduleTime}</PdfText>
            </View>
          ))}
        </View>
        <PdfText style={[styles.footer, d.center]} fixed>
          {L.footer}
        </PdfText>
      </Page>

      {/* 3 — one block per exercise */}
      <Page size="A4" style={styles.page}>
        <View style={styles.brandBar} fixed>
          <PdfText style={[styles.brand, d.text]}>{brand}</PdfText>
        </View>
        <PdfText style={[styles.h2, d.text]}>{L.exercises}</PdfText>
        {m.exercises.map((e, i) => (
          <View key={i} break={i > 0} style={{ marginBottom: 12 }}>
            <PdfText style={[styles.exTitle, d.text]}>{`${i + 1}. ${e.name}`}</PdfText>
            {e.description || e.instruction ? (
              <>
                <PdfText style={[styles.factLabel, d.text]}>{L.description}</PdfText>
                {e.description ? (
                  <PdfText style={[styles.para, d.text]}>{e.description}</PdfText>
                ) : null}
                {e.instruction ? (
                  <PdfText style={[styles.para, d.text]}>{e.instruction}</PdfText>
                ) : null}
              </>
            ) : null}
            {e.images.length > 0 ? (
              <View style={styles.images} wrap={false}>
                {e.images.map((img, j) => (
                  // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf primitive, no alt
                  <Image key={j} src={img} style={styles.image} />
                ))}
              </View>
            ) : null}
            <View style={[styles.boxes, d.row]} wrap={false}>
              <View style={styles.box}>
                <PdfText style={[styles.boxHead, d.text]}>{L.goal}</PdfText>
                <PdfText style={styles.boxBody}>{e.goal || '—'}</PdfText>
              </View>
              <View style={styles.box}>
                <PdfText style={[styles.boxHead, d.text]}>{L.repetition}</PdfText>
                <PdfText style={styles.boxBody}>{e.repetition || '—'}</PdfText>
              </View>
            </View>
          </View>
        ))}
        <PdfText style={[styles.footer, d.center]} fixed>
          {L.footer}
        </PdfText>
      </Page>
    </Document>
  );
}

let logoCache: PdfImage | null | undefined;
async function clinicLogo(): Promise<PdfImage | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const data = await readFile(path.join(process.cwd(), 'public', 'logo-source.png'));
    logoCache = { data, format: 'png' };
  } catch {
    logoCache = null;
  }
  return logoCache;
}

/** Build the model from the DB (pure data; images fetched here). */
export async function buildHomeProgramPdfModel(patientId: string): Promise<HomeProgramPdfModel> {
  const patient = await db.user.findUnique({
    where: { id: patientId },
    select: {
      role: true,
      fullNameEn: true,
      fullNameAr: true,
      languagePref: true,
      patientProfile: { select: { dateOfBirth: true } },
      homeProgramCover: { select: { goals: true, parentNotes: true } },
    },
  });
  if (!patient || patient.role !== 'PATIENT') throw new HomeProgramExportError(NOT_FOUND);
  const ar = patient.languagePref === 'AR';

  const [plan, items] = await Promise.all([
    db.treatmentPlan.findFirst({
      where: { patientId, status: 'ACTIVE' },
      select: { diagnosisPrimary: true },
    }),
    db.homeProgramItem.findMany({
      where: { patientId, active: true },
      orderBy: [{ scheduledTime: 'asc' }, { createdAt: 'asc' }],
      select: {
        durationMinutes: true,
        setsReps: true,
        therapistNote: true,
        goal: true,
        photoDocumentIds: true,
        exercise: {
          select: {
            nameEn: true,
            nameAr: true,
            descriptionEn: true,
            descriptionAr: true,
            defaultInstructionEn: true,
            defaultInstructionAr: true,
            goalEn: true,
            goalAr: true,
            imageUrl: true,
            extraImageUrls: true,
          },
        },
      },
    }),
  ]);
  if (items.length === 0) throw new HomeProgramExportError(EMPTY);

  // This patient's photos (READY images of THIS patient only).
  const photoIds = [...new Set(items.flatMap((i) => i.photoDocumentIds))];
  const photoDocs = photoIds.length
    ? await db.patientDocument.findMany({
        where: { id: { in: photoIds }, patientId, status: 'READY', active: true },
        select: { id: true, storageKey: true },
      })
    : [];
  const photoKeyById = new Map(photoDocs.map((p) => [p.id, p.storageKey]));

  const pick = (en: string | null | undefined, arText: string | null | undefined) =>
    ((ar ? arText || en : en || arText) ?? '').trim();
  const minutes = (n: number) => (ar ? `${n} دقائق` : `${n} min`);

  const exercises: HomeProgramPdfExercise[] = [];
  for (const item of items) {
    const e = item.exercise;
    const keys = [
      ...[e.imageUrl, ...e.extraImageUrls]
        .filter((u): u is string => !!u)
        .map(storageKeyFromUrl)
        .filter((k): k is string => !!k),
      ...item.photoDocumentIds.map((id) => photoKeyById.get(id)).filter((k): k is string => !!k),
    ].slice(0, MAX_IMAGES_PER_EXERCISE);
    const images = (await Promise.all(keys.map(loadImage))).filter(
      (img): img is PdfImage => img !== null,
    );
    exercises.push({
      name: pick(e.nameEn, e.nameAr),
      description: pick(e.descriptionEn, e.descriptionAr),
      instruction: [pick(e.defaultInstructionEn, e.defaultInstructionAr), item.therapistNote ?? '']
        .filter(Boolean)
        .join('\n'),
      goal: (item.goal ?? '').trim() || pick(e.goalEn, e.goalAr),
      repetition: (item.setsReps ?? '').trim() || minutes(item.durationMinutes),
      scheduleTime: minutes(item.durationMinutes),
      images,
    });
  }

  return {
    ar,
    patientName: ar
      ? patient.fullNameAr || patient.fullNameEn
      : patient.fullNameEn || patient.fullNameAr,
    age: ageText(patient.patientProfile?.dateOfBirth ?? null, ar),
    diagnosis: plan?.diagnosisPrimary ?? '',
    goals: (patient.homeProgramCover?.goals ?? '')
      .split('\n')
      .map((g) => g.trim())
      .filter(Boolean),
    parentNotes: patient.homeProgramCover?.parentNotes ?? '',
    exercises,
    logo: await clinicLogo(),
  };
}

/** Render + audit (READ_SENSITIVE, like the other clinical exports). */
export const generateHomeProgramPdf = withAudit<[{ patientId: string }], { buffer: Buffer }>(
  {
    entityType: 'HomeProgram',
    action: AuditAction.READ_SENSITIVE,
    extractEntityId: (args) => args[0].patientId,
    extractAfter: () => ({ event: 'HOME_PROGRAM_PDF_EXPORTED' }),
  },
  async function generateHomeProgramPdfInner({ patientId }): Promise<{ buffer: Buffer }> {
    const model = await buildHomeProgramPdfModel(patientId);
    const buffer = await renderPdfToBuffer(<HomeProgramDocument {...model} />);
    return { buffer };
  },
);
