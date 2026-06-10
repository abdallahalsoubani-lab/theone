'use server';

import { AuditAction, CheckInVia } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { auth } from '@/auth';
import { rateLimit } from '@/lib/auth/rate-limit';
import { fail, ok, type Result } from '@/lib/auth/result';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { checkInByPhone, recordCheckIn, type KioskCheckInResult } from './kiosk';
import {
  arrivalActionSchema,
  arrivalsSurfaceSchema,
  currentDelaySchema,
  kioskCheckInSchema,
  type ArrivalActionInput,
  type ArrivalsSurfaceInput,
  type CurrentDelayInput,
  type KioskCheckInInput,
} from './schemas';
import { generateAccessToken, validateArrivalsToken } from './tokens';

const FORBIDDEN: LocalizedError = {
  code: 'FORBIDDEN',
  message_en: 'You do not have permission for this action.',
  message_ar: 'ليست لديك صلاحية لهذا الإجراء.',
};

function toLocalized(err: unknown): LocalizedError {
  return toLocalizedError(err);
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}

// ─── Kiosk (public, token + rate-limit gated) ─────────────────────────────

export type KioskActionResult =
  | KioskCheckInResult
  | { kind: 'INVALID_TOKEN' }
  | { kind: 'RATE_LIMITED' };

/**
 * Public kiosk check-in (Prompt 18 §1). No staff session — gated by the kiosk
 * device token and rate-limited per device IP (10 attempts/min). Every attempt
 * is rate-counted; matches are audited inside `recordCheckIn` (actor = patient).
 * Returns a generic `NO_APPOINTMENT` for both unknown phone and no-appointment
 * so the kiosk can never be used to probe whether a number is registered.
 */
export async function kioskCheckInAction(input: KioskCheckInInput): Promise<KioskActionResult> {
  const parsed = kioskCheckInSchema.safeParse(input);
  if (!parsed.success) return { kind: 'INVALID_TOKEN' };

  if (!(await validateArrivalsToken('kiosk', parsed.data.token))) {
    return { kind: 'INVALID_TOKEN' };
  }

  const ip = await clientIp();
  const rl = await rateLimit(`kiosk:${ip}`, 10, 60);
  if (!rl.allowed) return { kind: 'RATE_LIMITED' };

  try {
    return await checkInByPhone({ phone: parsed.data.phone });
  } catch {
    // Never leak internals to the public screen — generic rejection.
    return { kind: 'NO_APPOINTMENT' };
  }
}

// ─── Staff arrivals desk (arrivals.manage) ────────────────────────────────

export async function manualCheckInAction(
  input: ArrivalActionInput,
): Promise<Result<{ appointmentId: string }>> {
  await requirePermission('arrivals.manage');
  const parsed = arrivalActionSchema.safeParse(input);
  if (!parsed.success) return fail(toLocalized(parsed.error));

  const session = await auth();
  if (!session?.user?.id) return fail(FORBIDDEN);

  try {
    await recordCheckIn({
      appointmentId: parsed.data.appointmentId,
      via: CheckInVia.STAFF,
      actorId: session.user.id,
      at: new Date(),
    });
    revalidateArrivals();
    return ok({ appointmentId: parsed.data.appointmentId });
  } catch (err) {
    return fail(toLocalized(err));
  }
}

const undoCheckInInner = withAudit<[ArrivalActionInput], { appointmentId: string }>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].appointmentId,
    extractAfter: () => ({ event: 'CHECK_IN_UNDONE' }),
  },
  async function inner({ appointmentId }): Promise<{ appointmentId: string }> {
    await db.appointment.update({
      where: { id: appointmentId },
      data: { checkedInAt: null, checkedInVia: null },
    });
    return { appointmentId };
  },
);

export async function undoCheckInAction(
  input: ArrivalActionInput,
): Promise<Result<{ appointmentId: string }>> {
  await requirePermission('arrivals.manage');
  const parsed = arrivalActionSchema.safeParse(input);
  if (!parsed.success) return fail(toLocalized(parsed.error));
  try {
    const data = await undoCheckInInner(parsed.data);
    revalidateArrivals();
    return ok(data);
  } catch (err) {
    return fail(toLocalized(err));
  }
}

const setDelayInner = withAudit<[CurrentDelayInput], { minutes: number }>(
  {
    entityType: 'ClinicSettings',
    action: AuditAction.UPDATE,
    extractEntityId: () => 'default',
    extractAfter: (result) => ({ event: 'CURRENT_DELAY_UPDATED', minutes: result.minutes }),
  },
  async function inner({ minutes }): Promise<{ minutes: number }> {
    const session = await auth();
    await db.clinicSettings.update({
      where: { id: 'default' },
      data: { currentDelayMinutes: minutes, updatedById: session?.user?.id ?? null },
    });
    return { minutes };
  },
);

export async function setCurrentDelayAction(
  input: CurrentDelayInput,
): Promise<Result<{ minutes: number }>> {
  await requirePermission('arrivals.manage');
  const parsed = currentDelaySchema.safeParse(input);
  if (!parsed.success) return fail(toLocalized(parsed.error));
  try {
    const data = await setDelayInner(parsed.data);
    revalidateArrivals();
    return ok(data);
  } catch (err) {
    return fail(toLocalized(err));
  }
}

// ─── Admin: token generation / revocation (system_settings.update) ─────────

const writeTokenInner = withAudit<
  [{ surface: 'kiosk' | 'display'; token: string | null }],
  { surface: 'kiosk' | 'display'; wasSet: boolean }
>(
  {
    entityType: 'ClinicSettings',
    action: AuditAction.UPDATE,
    extractEntityId: () => 'default',
    // Never log the token VALUE — only which surface and whether it was set.
    extractAfter: (result) => ({
      event: result.wasSet ? 'ARRIVALS_TOKEN_GENERATED' : 'ARRIVALS_TOKEN_REVOKED',
      surface: result.surface,
    }),
  },
  async function inner({
    surface,
    token,
  }): Promise<{ surface: 'kiosk' | 'display'; wasSet: boolean }> {
    const session = await auth();
    await db.clinicSettings.update({
      where: { id: 'default' },
      data:
        surface === 'kiosk'
          ? { kioskToken: token, updatedById: session?.user?.id ?? null }
          : { displayToken: token, updatedById: session?.user?.id ?? null },
    });
    return { surface, wasSet: token !== null };
  },
);

export async function generateArrivalsTokenAction(
  input: ArrivalsSurfaceInput,
): Promise<Result<{ token: string }>> {
  await requirePermission('system_settings.update');
  const parsed = arrivalsSurfaceSchema.safeParse(input);
  if (!parsed.success) return fail(toLocalized(parsed.error));
  try {
    const token = generateAccessToken();
    await writeTokenInner({ surface: parsed.data.surface, token });
    revalidatePath('/[locale]/(admin)/admin/settings', 'page');
    return ok({ token });
  } catch (err) {
    return fail(toLocalized(err));
  }
}

export async function revokeArrivalsTokenAction(
  input: ArrivalsSurfaceInput,
): Promise<Result<{ revoked: true }>> {
  await requirePermission('system_settings.update');
  const parsed = arrivalsSurfaceSchema.safeParse(input);
  if (!parsed.success) return fail(toLocalized(parsed.error));
  try {
    await writeTokenInner({ surface: parsed.data.surface, token: null });
    revalidatePath('/[locale]/(admin)/admin/settings', 'page');
    return ok({ revoked: true });
  } catch (err) {
    return fail(toLocalized(err));
  }
}

function revalidateArrivals(): void {
  revalidatePath('/[locale]/(staff)/secretary/arrivals', 'page');
}
