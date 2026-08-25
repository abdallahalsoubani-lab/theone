import 'server-only';

import { db } from '@/lib/db';
import { renderWaBody } from '@/lib/whatsapp/templates/render';

export interface TemplateListRow {
  id: string;
  name: string;
  language: 'EN' | 'AR';
  category: string;
  contentPreview: string;
  active: boolean;
  metaTemplateName: string | null;
  metaApprovalStatus: string;
  metaApprovedAt: Date | null;
  /** Prompt 48b — Twilio Content SID + registry variable shape (editable). */
  twilioContentSid: string | null;
  /** P52/P53 deploy — live WhatsApp approval (synced) + last sync time. */
  twilioApproved: boolean;
  twilioApprovalCheckedAt: Date | null;
  variablesShape: string[] | null;
  updatedAt: Date;
}

export async function listTemplates(): Promise<TemplateListRow[]> {
  const rows = await db.whatsAppTemplate.findMany({
    orderBy: [{ name: 'asc' }, { language: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    language: r.language,
    category: r.category,
    contentPreview: r.contentPreview,
    active: r.active,
    metaTemplateName: r.metaTemplateName,
    metaApprovalStatus: r.metaApprovalStatus,
    metaApprovedAt: r.metaApprovedAt,
    twilioContentSid: r.twilioContentSid,
    twilioApproved: r.twilioApproved,
    twilioApprovalCheckedAt: r.twilioApprovalCheckedAt,
    variablesShape: Array.isArray(r.variablesShape) ? (r.variablesShape as string[]) : null,
    updatedAt: r.updatedAt,
  }));
}

export interface MessageListFilters {
  direction?: 'OUTBOUND' | 'INBOUND';
  status?: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  recipientPhone?: string;
  hasAppointment?: boolean;
  /** Page-size cap, defaults to 50. */
  take?: number;
}

export interface MessageListRow {
  id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  status: string;
  sentAt: Date;
  deliveredAt: Date | null;
  readAt: Date | null;
  recipientPhone: string;
  recipientId: string | null;
  recipientName: string | null;
  body: string;
  failureReason: string | null;
  providerMessageId: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  appointmentId: string | null;
  resendCount: number;
}

export async function listMessages(filters: MessageListFilters = {}): Promise<MessageListRow[]> {
  const rows = await db.whatsAppMessage.findMany({
    where: {
      direction: filters.direction,
      status: filters.status,
      recipientPhone: filters.recipientPhone ? filters.recipientPhone : undefined,
      appointmentId:
        filters.hasAppointment === true
          ? { not: null }
          : filters.hasAppointment === false
            ? null
            : undefined,
    },
    orderBy: { sentAt: 'desc' },
    take: filters.take ?? 50,
    include: {
      template: { select: { name: true, language: true, contentPreview: true } },
      recipient: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    direction: r.direction,
    status: r.status,
    sentAt: r.sentAt,
    deliveredAt: r.deliveredAt,
    readAt: r.readAt,
    recipientPhone: r.recipientPhone,
    recipientId: r.recipientId,
    recipientName: r.recipient ? `${r.recipient.fullNameEn} / ${r.recipient.fullNameAr}` : null,
    // P52 follow-up: historical template rows stored the technical
    // preview — show the composed text; the fallback keeps the template
    // name visible (the UI already shows templateName in its own column).
    body: (() => {
      const rendered = renderWaBody({
        body: r.body,
        parameters: r.parameters,
        templateContentPreview: r.template?.contentPreview ?? null,
      });
      return rendered.kind === 'templateFallback'
        ? `⧉ ${rendered.templateName} — ${rendered.params.join(', ')}`
        : rendered.text;
    })(),
    failureReason: r.failureReason,
    providerMessageId: r.providerMessageId,
    templateName: r.template?.name ?? null,
    templateLanguage: r.template?.language ?? null,
    appointmentId: r.appointmentId,
    resendCount: r.resendCount,
  }));
}
