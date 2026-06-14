import { describe, expect, it } from 'vitest';

import {
  PATIENT_DOC_MAX_BYTES,
  buildDocumentKey,
  extensionFor,
  isAllowedMime,
  validatePatientDocInput,
} from '../policy';

describe('isAllowedMime', () => {
  it('accepts PDF and the allowed image types', () => {
    expect(isAllowedMime('application/pdf')).toBe(true);
    expect(isAllowedMime('image/jpeg')).toBe(true);
    expect(isAllowedMime('image/heic')).toBe(true);
  });
  it('rejects docx / zip / arbitrary types', () => {
    expect(
      isAllowedMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe(false);
    expect(isAllowedMime('application/zip')).toBe(false);
    expect(isAllowedMime('application/octet-stream')).toBe(false);
  });
});

describe('validatePatientDocInput', () => {
  it('passes a valid PDF under the cap', () => {
    expect(validatePatientDocInput({ contentType: 'application/pdf', sizeBytes: 1024 })).toBeNull();
  });
  it('rejects an unsupported type', () => {
    expect(validatePatientDocInput({ contentType: 'application/zip', sizeBytes: 1024 })?.code).toBe(
      'UNSUPPORTED_TYPE',
    );
  });
  it('rejects an oversized file', () => {
    expect(
      validatePatientDocInput({
        contentType: 'application/pdf',
        sizeBytes: PATIENT_DOC_MAX_BYTES + 1,
      })?.code,
    ).toBe('TOO_LARGE');
  });
  it('rejects a zero / negative size', () => {
    expect(validatePatientDocInput({ contentType: 'image/png', sizeBytes: 0 })?.code).toBe(
      'TOO_LARGE',
    );
  });
});

describe('buildDocumentKey', () => {
  it('builds an opaque patient-scoped key with the right extension', () => {
    expect(buildDocumentKey('pat1', 'application/pdf', 'doc1')).toBe(
      'patients/pat1/documents/doc1.pdf',
    );
    expect(buildDocumentKey('pat1', 'image/jpeg', 'doc2')).toBe('patients/pat1/documents/doc2.jpg');
  });
  it('never embeds the original filename', () => {
    const key = buildDocumentKey('pat1', 'application/pdf', 'doc1');
    expect(key).not.toContain('xray');
  });
});

describe('extensionFor', () => {
  it('maps heif to heic', () => expect(extensionFor('image/heif')).toBe('heic'));
  it('falls back to bin for unknown', () => expect(extensionFor('application/zip')).toBe('bin'));
});
