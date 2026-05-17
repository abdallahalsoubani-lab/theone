'use server';

import { LanguagePref } from '@prisma/client';
import { z } from 'zod';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { rateLimit } from '@/lib/auth/rate-limit';
import { AUTH_ERRORS, fail, ok, type Result } from '@/lib/auth/result';

const schema = z.object({
  locale: z.enum(['en', 'ar']),
});

/**
 * Persist the locale into User.languagePref for the authenticated user.
 *
 * Called by the language toggle alongside the cookie write so the next
 * server-rendered request reflects the user's preference even from a fresh
 * device (cookie cleared) — the auth session carries it in. Rate-limited so
 * a runaway client cannot spam the DB.
 *
 * Unauthenticated callers are a silent no-op (cookie write still happened
 * client-side).
 */
export async function updateLanguagePref(input: {
  locale: 'en' | 'ar';
}): Promise<Result<{ updated: boolean }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(AUTH_ERRORS.FORBIDDEN);

  const session = await auth();
  if (!session?.user?.id) return ok({ updated: false });

  const rl = await rateLimit(`ratelimit:langpref:${session.user.id}`, 1, 10);
  if (!rl.allowed) return fail(AUTH_ERRORS.RATE_LIMITED);

  const desired = parsed.data.locale === 'ar' ? LanguagePref.AR : LanguagePref.EN;
  if (session.user.languagePref === desired) return ok({ updated: false });

  await db.user.update({
    where: { id: session.user.id },
    data: { languagePref: desired },
  });
  return ok({ updated: true });
}
