import type { UserRole, WaInboundIntent, WaMessageStatus } from '@prisma/client';

import { db } from '@/lib/db';
import { renderWaBody } from '@/lib/whatsapp/templates/render';
import { mediaKind } from '@/lib/whatsapp/media/policy';

/**
 * WhatsApp Inbox reads (Prompt 49). Threads DERIVE from WhatsAppMessage
 * grouped by phone; WhatsAppConversation adds only the shared read state,
 * the patient link, the 24h-window anchor, and the suppression stamp.
 */

/** The Meta free-text session window, measured from the last INBOUND. */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Manual reply suppresses intent acks for this long (Prompt 49 §1.2). */
export const HUMAN_REPLY_SUPPRESSION_MS = 60 * 60 * 1000;

/** SECRETARY + ADMIN only (owner decision §1.1) — enforced at the DATA
 *  layer so no route/API can leak threads to other roles. */
export function canAccessInbox(role: UserRole): boolean {
  return role === 'SECRETARY' || role === 'ADMIN';
}

/** P56 — WhatsApp media attachments are SECRETARY + ADMIN only (owner
 *  decision 2). Therapist/Doctor never see attachment metadata, and the
 *  serving route enforces the same (P15 data-layer precedent). */
export function canSeeWhatsappAttachments(role: UserRole): boolean {
  return role === 'SECRETARY' || role === 'ADMIN';
}

export type InboxFilter = 'all' | 'unread' | 'unknown';

export interface ConversationListRow {
  id: string;
  phone: string;
  patientId: string | null;
  patientFullNameEn: string | null;
  patientFullNameAr: string | null;
  lastMessageAt: Date;
  lastInboundAt: Date | null;
  unread: boolean;
  lastSnippet: string;
  /** Set when the last message is a template that can no longer be
   *  recomposed (registry row gone) — the client shows a friendly label. */
  lastSnippetFallbackTemplate: string | null;
  lastDirection: 'INBOUND' | 'OUTBOUND' | null;
  /** Delivery state of OUR last outbound (real stored status — never faked). */
  lastOutboundStatus: WaMessageStatus | null;
}

export function isUnread(c: { lastInboundAt: Date | null; lastReadAt: Date | null }): boolean {
  if (!c.lastInboundAt) return false;
  return c.lastReadAt === null || c.lastInboundAt.getTime() > c.lastReadAt.getTime();
}

export async function listConversations(
  filter: InboxFilter = 'all',
  search = '',
): Promise<ConversationListRow[]> {
  const conversations = await db.whatsAppConversation.findMany({
    orderBy: { lastMessageAt: 'desc' },
    take: 200,
    include: {
      patient: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });

  const phones = conversations.map((c) => c.phone);
  // Last message + last outbound status per phone, one query each.
  const lastMessages = await db.whatsAppMessage.findMany({
    where: { recipientPhone: { in: phones } },
    orderBy: { sentAt: 'desc' },
    select: {
      recipientPhone: true,
      body: true,
      direction: true,
      status: true,
      sentAt: true,
      parameters: true,
      template: { select: { name: true, contentPreview: true } },
    },
  });
  const snippetByPhone = new Map<
    string,
    { body: string; fallbackTemplate: string | null; direction: 'INBOUND' | 'OUTBOUND' }
  >();
  const outboundStatusByPhone = new Map<string, WaMessageStatus>();
  for (const m of lastMessages) {
    if (!snippetByPhone.has(m.recipientPhone)) {
      // P52 follow-up: historical template rows stored the technical
      // preview — recompose the real text for the list snippet.
      const rendered = renderWaBody({
        body: m.body,
        parameters: m.parameters,
        templateContentPreview: m.template?.contentPreview ?? null,
      });
      snippetByPhone.set(m.recipientPhone, {
        body: rendered.kind === 'templateFallback' ? '' : rendered.text,
        fallbackTemplate:
          rendered.kind === 'templateFallback'
            ? rendered.templateName || (m.template?.name ?? '')
            : null,
        direction: m.direction,
      });
    }
    if (m.direction === 'OUTBOUND' && !outboundStatusByPhone.has(m.recipientPhone)) {
      outboundStatusByPhone.set(m.recipientPhone, m.status);
    }
  }

  const q = search.trim().toLowerCase();
  return conversations
    .map((c) => ({
      id: c.id,
      phone: c.phone,
      patientId: c.patientId,
      patientFullNameEn: c.patient?.fullNameEn ?? null,
      patientFullNameAr: c.patient?.fullNameAr ?? null,
      lastMessageAt: c.lastMessageAt,
      lastInboundAt: c.lastInboundAt,
      unread: isUnread(c),
      lastSnippet: snippetByPhone.get(c.phone)?.body.slice(0, 80) ?? '',
      lastSnippetFallbackTemplate: snippetByPhone.get(c.phone)?.fallbackTemplate ?? null,
      lastDirection: snippetByPhone.get(c.phone)?.direction ?? null,
      lastOutboundStatus: outboundStatusByPhone.get(c.phone) ?? null,
    }))
    .filter((c) => {
      if (filter === 'unread' && !c.unread) return false;
      if (filter === 'unknown' && c.patientId !== null) return false;
      if (!q) return true;
      return (
        (c.patientFullNameEn ?? '').toLowerCase().includes(q) ||
        (c.patientFullNameAr ?? '').includes(search.trim()) ||
        c.phone.includes(q)
      );
    });
}

export interface ThreadMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  body: string;
  sentAt: Date;
  status: WaMessageStatus;
  deliveredAt: Date | null;
  readAt: Date | null;
  /** Templated send vs free-text session message (subtle "قالب" tag). */
  isTemplate: boolean;
  /** Render inputs for historical technical-preview rows (P52 follow-up). */
  templateName: string | null;
  templateContentPreview: string | null;
  parameters: unknown;
  /** 48b button tap — render as "ضغط: {label}" not bare text. */
  buttonPayload: string | null;
  intent: WaInboundIntent | null;
  sentByName: string | null;
  /** P56 — inbound media (SECRETARY/ADMIN only; empty for others). */
  attachments: ThreadAttachment[];
}

export interface ThreadAttachment {
  id: string;
  /** Coarse class for the UI: image / video / audio / document. */
  kind: 'image' | 'video' | 'audio' | 'document';
  contentType: string;
  sizeBytes: number | null;
  filename: string | null;
  /** PENDING (downloading) | STORED (viewable) | FAILED | EXPIRED. */
  status: 'PENDING' | 'STORED' | 'FAILED' | 'EXPIRED';
}

export interface ThreadPatient {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

export interface ThreadView {
  conversation: {
    id: string;
    phone: string;
    patientId: string | null;
    patientFullNameEn: string | null;
    patientFullNameAr: string | null;
    lastInboundAt: Date | null;
    /** Free-text send allowed until this instant (null = never opened). */
    windowClosesAt: Date | null;
  };
  /** P50: a shared family number maps to SEVERAL patients — the header
   *  shows every registered patient on this phone as a chip/link. */
  patients: ThreadPatient[];
  messages: ThreadMessage[];
  /** Context strip: the patient's next upcoming appointment (cheap query). */
  nextAppointment: { startsAt: Date; therapistNameEn: string; therapistNameAr: string } | null;
}

export function windowClosesAt(lastInboundAt: Date | null): Date | null {
  return lastInboundAt ? new Date(lastInboundAt.getTime() + SESSION_WINDOW_MS) : null;
}

export function canSendFreeText(lastInboundAt: Date | null, now: Date = new Date()): boolean {
  const closes = windowClosesAt(lastInboundAt);
  return closes !== null && now.getTime() < closes.getTime();
}

export async function getThread(
  conversationId: string,
  viewerRole?: UserRole,
): Promise<ThreadView | null> {
  const c = await db.whatsAppConversation.findUnique({
    where: { id: conversationId },
    include: { patient: { select: { fullNameEn: true, fullNameAr: true } } },
  });
  if (!c) return null;

  const patients = await db.user.findMany({
    where: { phone: c.phone, role: 'PATIENT', deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true },
    orderBy: { createdAt: 'asc' },
  });

  const rows = await db.whatsAppMessage.findMany({
    where: { recipientPhone: c.phone },
    orderBy: { sentAt: 'asc' },
    take: 500,
    select: {
      id: true,
      direction: true,
      body: true,
      sentAt: true,
      status: true,
      deliveredAt: true,
      readAt: true,
      templateId: true,
      parameters: true,
      intent: true,
      template: { select: { name: true, contentPreview: true } },
      sentBy: { select: { fullNameEn: true } },
      attachments: {
        orderBy: { mediaIndex: 'asc' },
        select: {
          id: true,
          contentType: true,
          sizeBytes: true,
          filename: true,
          status: true,
        },
      },
    },
  });
  const showAttachments = viewerRole ? canSeeWhatsappAttachments(viewerRole) : false;

  let nextAppointment: ThreadView['nextAppointment'] = null;
  if (c.patientId) {
    const appt = await db.appointment.findFirst({
      where: {
        patientId: c.patientId,
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startsAt: { gte: new Date() },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        startsAt: true,
        therapists: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
        },
      },
    });
    if (appt) {
      nextAppointment = {
        startsAt: appt.startsAt,
        therapistNameEn: appt.therapists[0]?.therapist.fullNameEn ?? '',
        therapistNameAr: appt.therapists[0]?.therapist.fullNameAr ?? '',
      };
    }
  }

  return {
    conversation: {
      id: c.id,
      phone: c.phone,
      patientId: c.patientId,
      patientFullNameEn: c.patient?.fullNameEn ?? null,
      patientFullNameAr: c.patient?.fullNameAr ?? null,
      lastInboundAt: c.lastInboundAt,
      windowClosesAt: windowClosesAt(c.lastInboundAt),
    },
    patients,
    messages: rows.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      sentAt: m.sentAt,
      status: m.status,
      deliveredAt: m.deliveredAt,
      readAt: m.readAt,
      isTemplate: m.templateId !== null,
      templateName: m.template?.name ?? null,
      templateContentPreview: m.template?.contentPreview ?? null,
      parameters: m.parameters,
      buttonPayload:
        typeof (m.parameters as Record<string, unknown>)?.buttonPayload === 'string'
          ? ((m.parameters as Record<string, string>).buttonPayload ?? null)
          : null,
      intent: m.intent,
      sentByName: m.sentBy?.fullNameEn ?? null,
      attachments: showAttachments
        ? m.attachments.map((a) => ({
            id: a.id,
            kind: mediaKind(a.contentType),
            contentType: a.contentType,
            sizeBytes: a.sizeBytes,
            filename: a.filename,
            status: a.status,
          }))
        : [],
    })),
    nextAppointment,
  };
}

/** Sidebar badge: UNREAD CONVERSATIONS (not messages) — shared state. */
export async function countUnreadConversations(): Promise<number> {
  const rows = await db.whatsAppConversation.findMany({
    where: { lastInboundAt: { not: null } },
    select: { lastInboundAt: true, lastReadAt: true },
  });
  return rows.filter(isUnread).length;
}
