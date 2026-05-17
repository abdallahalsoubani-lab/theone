import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { mapPrismaError, toLocalizedError } from './errors';

/**
 * Constructor signature for Prisma 6.x: (message, { code, clientVersion, meta? }).
 */
function knownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('test error', {
    code,
    clientVersion: 'test',
    meta,
  });
}

describe('mapPrismaError', () => {
  it('maps P2002 unique-constraint violations with the target field', () => {
    const result = mapPrismaError(knownError('P2002', { target: ['email'] }));
    expect(result?.code).toBe('UNIQUE_VIOLATION');
    expect(result?.message_en).toMatch(/email/);
    expect(result?.message_ar).toBeTruthy();
  });

  it('maps P2025 not-found errors', () => {
    const result = mapPrismaError(knownError('P2025'));
    expect(result?.code).toBe('NOT_FOUND');
  });

  it('maps P2003 foreign-key violations and surfaces the field name', () => {
    const result = mapPrismaError(knownError('P2003', { field_name: 'patientId' }));
    expect(result?.code).toBe('FOREIGN_KEY_VIOLATION');
    expect(result?.message_en).toMatch(/patientId/);
  });

  it('maps P2024 connection timeouts', () => {
    const result = mapPrismaError(knownError('P2024'));
    expect(result?.code).toBe('DB_TIMEOUT');
  });

  it('falls back to PRISMA_<code> for unmapped known errors', () => {
    const result = mapPrismaError(knownError('P9999'));
    expect(result?.code).toBe('PRISMA_P9999');
  });

  it('returns null for non-Prisma errors so callers can keep typed catches', () => {
    expect(mapPrismaError(new Error('something else'))).toBeNull();
    expect(mapPrismaError(undefined)).toBeNull();
    expect(mapPrismaError('boom')).toBeNull();
  });

  it('handles validation errors with a localized DB_VALIDATION code', () => {
    const validation = new Prisma.PrismaClientValidationError('invalid', { clientVersion: 't' });
    const result = mapPrismaError(validation);
    expect(result?.code).toBe('DB_VALIDATION');
    expect(result?.message_en).toBeTruthy();
    expect(result?.message_ar).toBeTruthy();
  });
});

describe('toLocalizedError', () => {
  it('returns DB_ERROR for unknown error types', () => {
    const result = toLocalizedError(new Error('totally unexpected'));
    expect(result.code).toBe('DB_ERROR');
    expect(result.message_en).toBeTruthy();
    expect(result.message_ar).toBeTruthy();
  });

  it('delegates to mapPrismaError for known Prisma errors', () => {
    const result = toLocalizedError(knownError('P2025'));
    expect(result.code).toBe('NOT_FOUND');
  });
});
