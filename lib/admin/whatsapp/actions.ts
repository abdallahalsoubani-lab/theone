'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { AuditAction } from '@prisma/client';
import type { LanguagePref, Prisma, WaTemplateApprovalStatus } from '@prisma/client';
import { withAudit } from '@/lib/audit/withAudit';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { requirePermission } from '@/lib/rbac/guards';

const MAX_RESENDS = 3;

interface UpdateTemplateInput {
  id: string;
  metaTemplateName: string | null;
  metaApprovalStatus: WaTemplateApprovalStatus;
  active: boolean;
}

/**
 * Update template provider metadata. Read-only fields (name, language,
 * category) stay locked; the Admin only sets the per-provider identifiers
 * and the approval flags after the corresponding provider confirms.
 *
 * Audited: actor = Admin, entity = WhatsAppTemplate, action = UPDATE.
 */
const updateTemplateInner = withAudit<[UpdateTemplateInput], { id: string }>(
  {
    entityType: 'WhatsAppTemplate',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) => db.whatsAppTemplate.findUnique({ where: { id: args[0].id } }),
    extractAfter: (result) => ({ id: result.id }),
  },
  async function inner(input): Promise<{ id: string }> {
    await db.whatsAppTemplate.update({
      where: { id: input.id },
      data: {
        metaTemplateName: input.metaTemplateName,
        metaApprovalStatus: input.metaApprovalStatus,
        metaApprovedAt: input.metaApprovalStatus === 'APPROVED' ? new Date() : null,
        active: input.active,
      },
    });
    return { id: input.id };
  },
);

export async function updateTemplateAction(
  input: UpdateTemplateInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePermission('whatsapp_templates.update');
  try {
    await updateTemplateInner(input);
    revalidatePath('/admin/whatsapp/templates');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

interface SendTestArgs {
  templateId: string;
  recipientPhone: string;
}

/**
 * Send a test message using the active provider. Test parameters are
 * deliberately obvious placeholders ("[test]") so a misfire to a real
 * patient is recognizable.
 */
export async function sendTestMessageAction(
  args: SendTestArgs,
): Promise<{ ok: true; jobId: string | null } | { ok: false; error: string }> {
  await requirePermission('whatsapp_templates.update');
  const template = await db.whatsAppTemplate.findUnique({ where: { id: args.templateId } });
  if (!template) return { ok: false, error: 'Template not found' };
  try {
    const placeholderCount = (template.contentPreview.match(/\{\{\d+\}\}/g) ?? []).length;
    const parameters = Array.from({ length: placeholderCount }, () => '[test]');
    const jobId = await enqueueWhatsappOutbound({
      kind: 'template',
      templateName: template.name,
      language: template.language as LanguagePref,
      parameters,
      recipientPhone: args.recipientPhone,
      source: 'queue',
    });
    return { ok: true, jobId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resend a previously-FAILED outbound message. Capped at MAX_RESENDS per
 * message ever to defend against feedback loops where a bad number stays
 * bad and an over-eager Admin retries it ten times.
 *
 * Audited: actor = Admin, entity = WhatsAppMessage, action = UPDATE,
 * after.event = RESENT.
 */
const resendInner = withAudit<[{ id: string }], { jobId: string | null }>(
  {
    entityType: 'WhatsAppMessage',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: () => ({ event: 'RESENT' }) as Prisma.InputJsonValue,
  },
  async function inner({ id }): Promise<{ jobId: string | null }> {
    const message = await db.whatsAppMessage.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!message) throw new Error('Message not found');
    if (message.direction !== 'OUTBOUND') throw new Error('Only outbound messages can be resent');
    if (message.status !== 'FAILED') throw new Error('Only FAILED messages can be resent');
    if (message.resendCount >= MAX_RESENDS) {
      throw new Error(`Resend cap reached (max ${MAX_RESENDS})`);
    }
    if (!message.template) throw new Error('Original template missing — cannot resend');

    const parameters = parametersToArray(message.parameters);
    const jobId = await enqueueWhatsappOutbound({
      kind: 'template',
      templateName: message.template.name,
      language: message.template.language as LanguagePref,
      parameters,
      recipientPhone: message.recipientPhone,
      recipientUserId: message.recipientId,
      appointmentId: message.appointmentId,
      source: 'resend',
      originatingMessageId: id,
    });
    await db.whatsAppMessage.update({
      where: { id },
      data: { resendCount: { increment: 1 } },
    });
    return { jobId };
  },
);

export async function resendMessageAction(
  id: string,
): Promise<{ ok: true; jobId: string | null } | { ok: false; error: string }> {
  await requirePermission('whatsapp_messages.resend');
  try {
    const result = await resendInner({ id });
    revalidatePath('/admin/whatsapp/messages');
    return { ok: true, jobId: result.jobId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function parametersToArray(input: Prisma.JsonValue): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj)
    .map((k) => Number.parseInt(k, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  return keys.map((k) => String(obj[String(k)] ?? ''));
}
