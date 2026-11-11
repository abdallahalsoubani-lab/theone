import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * P64 #15 — home-program PDF: renders in both languages with the clinic
 * sample's structure (cover / schedule / exercise blocks), embeds JPEG + PNG
 * only, and the pure helpers behave.
 */

vi.mock('@/lib/db', () => ({ db: {}, toLocalizedError: (e: unknown) => e }));
vi.mock('@/lib/patient-documents/storage', () => ({ getObjectBytes: vi.fn() }));
vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_c: unknown, fn: unknown) => fn }));

import { renderPdfToBuffer } from '../render';
import {
  HomeProgramDocument,
  ageText,
  embeddableFormat,
  storageKeyFromUrl,
  type HomeProgramPdfModel,
} from '../homeProgram';

import { containsWordEitherDirection, extractPdfText } from './pdfText';

const png = readFileSync(path.join(process.cwd(), 'public', 'logo-source.png'));

function model(ar: boolean): HomeProgramPdfModel {
  return {
    ar,
    patientName: ar ? 'كنان' : 'Kenan',
    age: ar ? '1 سنة 2 شهر' : '1y 2m',
    diagnosis: 'Developmental delay',
    goals: ar ? ['تحسين التحكم بالرأس', 'التحضير للجلوس'] : ['Head control', 'Sitting prep'],
    parentNotes: ar ? 'يطبق البرنامج على فترات خلال اليوم' : 'Spread through the day',
    exercises: [
      {
        name: ar ? 'تمرين حركة الرأس' : 'Head lift',
        description: ar ? 'الطفل مستلقٍ على بطنه' : 'Prone on a roll',
        instruction: '',
        goal: ar ? 'تحسين التثبيت' : 'Stability',
        repetition: ar ? '5 دقائق يومياً' : '5 min daily',
        scheduleTime: ar ? '5 دقائق' : '5 min',
        images: [{ data: png, format: 'png' }],
      },
      {
        name: ar ? 'الجلوس المدعوم' : 'Supported sitting',
        description: '',
        instruction: '',
        goal: '',
        repetition: '',
        scheduleTime: ar ? '5 دقائق' : '5 min',
        images: [],
      },
    ],
    logo: { data: png, format: 'png' },
  };
}

const doc = (m: HomeProgramPdfModel) =>
  createElement(HomeProgramDocument, m) as unknown as Parameters<typeof renderPdfToBuffer>[0];

describe('HomeProgramDocument', () => {
  it('renders the Arabic program with the sample headings', async () => {
    const buf = await renderPdfToBuffer(doc(model(true)));
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    const text = extractPdfText(buf);
    // Ligature-free words only (see pdfText.ts): «التكرار:» box + the name.
    expect(containsWordEitherDirection(text, 'تكرار')).toBe(true);
    expect(containsWordEitherDirection(text, 'كنان')).toBe(true);
  }, 30_000);

  it('renders the English program', async () => {
    const buf = await renderPdfToBuffer(doc(model(false)));
    const text = extractPdfText(buf);
    expect(text).toContain('Repetition');
    expect(text).toContain('Supported sitting');
  }, 30_000);
});

describe('helpers', () => {
  it('embeddableFormat: JPEG + PNG only', () => {
    expect(embeddableFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(embeddableFormat(png)).toBe('png');
    expect(embeddableFormat(new TextEncoder().encode('RIFF....WEBP'))).toBeNull();
  });

  it('storageKeyFromUrl: same-origin keys only, no traversal', () => {
    expect(storageKeyFromUrl('/api/v1/storage/exercises/a.png')).toBe('exercises/a.png');
    expect(storageKeyFromUrl('https://cdn.example/a.png')).toBeNull();
    expect(storageKeyFromUrl('/api/v1/storage/../secret')).toBeNull();
  });

  it('ageText: years + months; unknown DOB → empty', () => {
    const now = new Date('2026-11-11T00:00:00Z');
    expect(ageText(new Date('2025-09-01T00:00:00Z'), true, now)).toBe('1 سنة 2 شهر');
    expect(ageText(new Date('2026-05-01T00:00:00Z'), false, now)).toBe('6m');
    expect(ageText(new Date('1900-01-01T00:00:00Z'), true, now)).toBe('');
  });
});
