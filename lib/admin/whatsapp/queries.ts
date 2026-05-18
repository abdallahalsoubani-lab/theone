import 'server-only';

import { db } from '@/lib/db';

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
  twilioContentSid: string | null;
  twilioApproved: boolean;
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
      template: { select: { name: true, language: true } },
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
    body: r.body,
    failureReason: r.failureReason,
    providerMessageId: r.providerMessageId,
    templateName: r.template?.name ?? null,
    templateLanguage: r.template?.language ?? null,
    appointmentId: r.appointmentId,
    resendCount: r.resendCount,
  }));
}
