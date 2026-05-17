import type { Prisma } from '@prisma/client';

import { db } from './client';

/** Default transaction timeout — 5 seconds is plenty for any single-user workflow. */
const DEFAULT_TIMEOUT_MS = 5_000;

type Tx = Prisma.TransactionClient;

/**
 * Wrap a unit of work in a Prisma interactive transaction with a bounded timeout.
 *
 * Use this instead of `db.$transaction(...)` directly so every transaction in the
 * codebase shares the same timeout policy. Prisma errors are re-thrown as-is so
 * callers see real Prisma error codes (the `lib/db/errors.ts` mapper handles them).
 */
export function withTransaction<T>(
  work: (tx: Tx) => Promise<T>,
  options: { timeoutMs?: number; maxWaitMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxWaitMs = 2_000 } = options;
  return db.$transaction(work, { timeout: timeoutMs, maxWait: maxWaitMs });
}
