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

import {
  checkInByName,
  listTodaysArrivablePatients,
  recordCheckIn,
  type KioskCheckInResult,
  type KioskPatientCard,
} from './kiosk';
import {
  arrivalActionSchema,
  arrivalsSurfaceSchema,
  currentDelaySchema,
  kioskCheckInByNameSchema,
  kioskTodaySchema,
  type ArrivalActionInput,
  type ArrivalsSurfaceInput,
  type CurrentDelayInput,
  type KioskCheckInByNameInput,
  type KioskTodayInput,
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

export type KioskTodayResult =
  | { kind: 'PATIENTS'; patients: KioskPatientCard[] }
  | { kind: 'INVALID_TOKEN' }
  | { kind: 'RATE_LIMITED' };

/**
 * Public kiosk TODAY'S CARDS (Prompt 46 — replaces the typed name search per
 * the owner's privacy reversal; see lib/arrivals/kiosk.ts). Token-gated +
 * rate-limited per device IP (the grid refreshes ~1/min, so 30/min is ample
 * headroom without inviting scraping bursts). Any error → empty list.
 */
export async function kioskTodayAction(input: KioskTodayInput): Promise<KioskTodayResult> {
  const parsed = kioskTodaySchema.safeParse(input);
  if (!parsed.success) return { kind: 'INVALID_TOKEN' };

  if (!(await validateArrivalsToken('kiosk', parsed.data.token))) {
    return { kind: 'INVALID_TOKEN' };
  }

  const ip = await clientIp();
  const rl = await rateLimit(`kiosk-today:${ip}`, 30, 60);
  if (!rl.allowed) return { kind: 'RATE_LIMITED' };

  try {
    return { kind: 'PATIENTS', patients: await listTodaysArrivablePatients() };
  } catch {
    return { kind: 'PATIENTS', patients: [] };
  }
}

/**
 * Public kiosk CHECK-IN COMMIT (July #1 confirm → #3 grouping). Called only
 * after the patient selects their name and taps Confirm. Token-gated +
 * rate-limited (10/min). Matches are audited inside `recordCheckIn`
 * (actor = patient); a back-to-back run is one arrival. Generic
 * `NO_APPOINTMENT` on any miss so the screen reveals nothing.
 */
export async function kioskCheckInByNameAction(
  input: KioskCheckInByNameInput,
): Promise<KioskActionResult> {
  const parsed = kioskCheckInByNameSchema.safeParse(input);
  if (!parsed.success) return { kind: 'INVALID_TOKEN' };

  if (!(await validateArrivalsToken('kiosk', parsed.data.token))) {
    return { kind: 'INVALID_TOKEN' };
  }

  const ip = await clientIp();
  const rl = await rateLimit(`kiosk:${ip}`, 10, 60);
  if (!rl.allowed) return { kind: 'RATE_LIMITED' };

  try {
    return await checkInByName({ patientId: parsed.data.patientId });
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
