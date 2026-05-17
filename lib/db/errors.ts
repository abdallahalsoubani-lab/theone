import { Prisma } from '@prisma/client';

/**
 * Localized error shape — Prompt 0 §5 rule 7.
 *
 * Every error surfaced to the UI must carry both an English and Arabic message
 * plus a stable machine-readable code that the client can branch on without
 * parsing free-text.
 */
export interface LocalizedError {
  code: string;
  message_en: string;
  message_ar: string;
  details?: Record<string, unknown>;
}

/**
 * Convert a thrown Prisma error into the localized shape. Returns `null` if the
 * input is not a Prisma error so callers can keep their own typed catches above.
 */
export function mapPrismaError(error: unknown): LocalizedError | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return mapKnownError(error);
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return {
      code: 'DB_VALIDATION',
      message_en: 'The data sent to the database was invalid.',
      message_ar: 'البيانات المرسلة إلى قاعدة البيانات غير صالحة.',
    };
  }
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return {
      code: 'DB_UNAVAILABLE',
      message_en: 'The database is temporarily unavailable. Please try again.',
      message_ar: 'قاعدة البيانات غير متاحة مؤقتًا. يرجى المحاولة مرة أخرى.',
    };
  }
  return null;
}

/**
 * Same as `mapPrismaError` but always returns a `LocalizedError` — falls back to a
 * generic DB_ERROR for anything unrecognised. Use this at the outer error boundary
 * (server action wrapper, API route handler) where you must always return *some*
 * structured response.
 */
export function toLocalizedError(error: unknown): LocalizedError {
  return (
    mapPrismaError(error) ?? {
      code: 'DB_ERROR',
      message_en: 'An unexpected database error occurred.',
      message_ar: 'حدث خطأ غير متوقع في قاعدة البيانات.',
      details: process.env.NODE_ENV === 'development' ? { raw: String(error) } : undefined,
    }
  );
}

function mapKnownError(error: Prisma.PrismaClientKnownRequestError): LocalizedError {
  switch (error.code) {
    case 'P2002': {
      const target = extractTargets(error.meta);
      return {
        code: 'UNIQUE_VIOLATION',
        message_en: `A record with this ${target} already exists.`,
        message_ar: `يوجد سجل بنفس ${target} مسبقاً.`,
        details: { target },
      };
    }
    case 'P2025':
      return {
        code: 'NOT_FOUND',
        message_en: 'The requested record was not found.',
        message_ar: 'السجل المطلوب غير موجود.',
        details: error.meta,
      };
    case 'P2003': {
      const field =
        typeof error.meta?.field_name === 'string' ? error.meta.field_name : 'reference';
      return {
        code: 'FOREIGN_KEY_VIOLATION',
        message_en: `Related record (${field}) does not exist or cannot be modified.`,
        message_ar: `السجل المرتبط (${field}) غير موجود أو لا يمكن تعديله.`,
        details: { field },
      };
    }
    case 'P2024':
      return {
        code: 'DB_TIMEOUT',
        message_en: 'The database is busy. Please retry in a moment.',
        message_ar: 'قاعدة البيانات مشغولة. يرجى إعادة المحاولة بعد لحظات.',
      };
    case 'P2014':
      return {
        code: 'RELATION_VIOLATION',
        message_en: 'The change would break a required relationship between records.',
        message_ar: 'هذا التعديل يخالف علاقة مطلوبة بين السجلات.',
        details: error.meta,
      };
    case 'P2016':
    case 'P2018':
      return {
        code: 'RELATION_NOT_FOUND',
        message_en: 'A referenced record was not found.',
        message_ar: 'لم يتم العثور على سجل مشار إليه.',
        details: error.meta,
      };
    default:
      return {
        code: `PRISMA_${error.code}`,
        message_en: 'A database error occurred.',
        message_ar: 'حدث خطأ في قاعدة البيانات.',
        details: process.env.NODE_ENV === 'development' ? { meta: error.meta } : undefined,
      };
  }
}

function extractTargets(meta: Prisma.PrismaClientKnownRequestError['meta']): string {
  const target = meta && typeof meta === 'object' && 'target' in meta ? meta.target : undefined;
  if (Array.isArray(target)) return target.join(', ');
  if (typeof target === 'string') return target;
  return 'field';
}
