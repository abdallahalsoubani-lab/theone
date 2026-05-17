import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 *
 * Next.js hot-reloads server modules during `pnpm dev`. Without the global cache
 * every reload constructs a new PrismaClient and the underlying connection pool
 * leaks until Postgres rejects new connections. Holding the instance on
 * `globalThis` reuses the same client across reloads in development.
 *
 * In production the module is loaded exactly once, so the cache is unused and
 * we intentionally do NOT set the global symbol (keeps `globalThis` clean).
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
