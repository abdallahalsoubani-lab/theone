'use client';

import type { UserRole, WaMessageStatus } from '@prisma/client';
import { Check, CheckCheck, Clock, Link2, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { AttachmentBlock } from '@/components/whatsapp-inbox/AttachmentBlock';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchableSelect, type PickerOption } from '@/components/ui/searchable-select';
import { formatDateTime, formatTime } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';
import { patientDisplayName } from '@/lib/format/patientName';
import { patientProfileHref } from '@/lib/patients/links';
import {
  linkConversationToPatientAction,
  markConversationReadAction,
  sendInboxReplyAction,
} from '@/lib/whatsapp/inbox/actions';
import type { ThreadMessage, ThreadView } from '@/lib/whatsapp/inbox/queries';
import { renderWaBody } from '@/lib/whatsapp/templates/render';
import { patientPickerOption } from '@/lib/patients/picker';

export interface LinkablePatient {
  id: string;
  fullNameEn: string;
  fullNameAr: string | null;
  phone: string | null;
}

/** Real stored delivery state only — a SENT message shows one tick, never two
 *  (Prompt 49 §3.2 honesty rule). */
function DeliveryTicks({ status }: { status: WaMessageStatus }) {
  if (status === 'FAILED') return <X className="size-3.5 text-red-500" aria-label="failed" />;
  if (status === 'READ')
    return <CheckCheck className="size-3.5 text-brand-cyan" aria-label="read" />;
  if (status === 'DELIVERED')
    return <CheckCheck className="size-3.5 text-brand-textMuted" aria-label="delivered" />;
  if (status === 'SENT')
    return <Check className="size-3.5 text-brand-textMuted" aria-label="sent" />;
  return <Clock className="size-3.5 text-brand-textMuted" aria-label="queued" />;
}

export function ThreadPane({
  thread,
  viewerRole,
  patients,
}: {
  thread: ThreadView;
  viewerRole: UserRole;
  patients: LinkablePatient[];
}) {
  const t = useTranslations('waInbox');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const router = useRouter();
  const c = thread.conversation;

  const [body, setBody] = useState('');
  const [sending, startSend] = useTransition();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkPatientId, setLinkPatientId] = useState('');
  const [linking, startLink] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Opening a thread marks it read for EVERYONE (shared state, §1.3).
  useEffect(() => {
    void markConversationReadAction(c.id);
  }, [c.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread.messages.length, c.id]);

  const windowOpen = c.windowClosesAt !== null && c.windowClosesAt.getTime() > Date.now();

  // P50: shared family numbers — every registered patient on this phone.
  const knownPatients = thread.patients;

  // P52 follow-up: historical template rows stored `template:name(…)` —
  // recompose the real text (registry body + stored params); a friendly
  // label when the registry row is gone.
  const displayBody = (m: ThreadMessage): string => {
    if (!m.isTemplate) return m.body;
    const rendered = renderWaBody({
      body: m.body,
      parameters: m.parameters,
      templateContentPreview: m.templateContentPreview,
    });
    if (rendered.kind === 'templateFallback') {
      return t('templateFallbackBody', {
        name: templateLabel(rendered.templateName || m.templateName || ''),
        params: rendered.params.join('، '),
      });
    }
    return rendered.text;
  };

  const templateLabel = (name: string): string => {
    const known = [
      'appointment_confirmation_v2',
      'appointment_reminder_v2',
      'appointment_cancelled_v2',
      'appointment_rescheduled',
      'home_exercise_reminder_v2',
      'patient_account_credentials',
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return known.includes(name) ? t(`tpl_${name}` as any) : name || t('templateGeneric');
  };

  const buttonTapLabel = (m: ThreadMessage): string | null => {
    if (m.direction !== 'INBOUND' || !m.buttonPayload) return null;
    if (m.buttonPayload === 'confirm') return t('buttonTapConfirm');
    if (m.buttonPayload === 'decline') return t('buttonTapDecline');
    return m.body || m.buttonPayload;
  };

  const send = () => {
    const text = body.trim();
    if (!text || sending) return;
    startSend(async () => {
      const res = await sendInboxReplyAction({ conversationId: c.id, body: text });
      if (res.ok) {
        setBody('');
        router.refresh();
      } else {
        toast.error(locale === 'ar' ? res.error.message_ar : res.error.message_en);
      }
    });
  };

  const linkOptions: PickerOption[] = patients.map((p) =>
    patientPickerOption({ ...p, fullNameAr: p.fullNameAr ?? '' }, locale),
  );
  const linkTarget = patients.find((p) => p.id === linkPatientId) ?? null;

  const confirmLink = () => {
    if (!linkTarget || linking) return;
    startLink(async () => {
      const res = await linkConversationToPatientAction({
        conversationId: c.id,
        patientId: linkTarget.id,
      });
      if (res.ok) {
        toast.success(t('linkDone'));
        setLinkOpen(false);
        router.refresh();
      } else {
        toast.error(locale === 'ar' ? res.error.message_ar : res.error.message_en);
      }
    });
  };

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-border px-4 py-2.5">
        <div className="min-w-0">
          {knownPatients.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {knownPatients.length > 1 ? (
                <span className="text-xs text-brand-textMuted">{t('patientsOnNumber')}:</span>
              ) : null}
              {knownPatients.map((p) => (
                <Link
                  key={p.id}
                  href={`/${locale}${patientProfileHref(viewerRole, p.id)}`}
                  className="rounded-full bg-brand-cyan/10 px-2 py-0.5 text-sm font-semibold text-brand-navy hover:bg-brand-cyan/20 hover:text-brand-cyan"
                >
                  {patientDisplayName(p.fullNameEn, p.fullNameAr, locale)}
                </Link>
              ))}
            </span>
          ) : (
            <span className="text-sm font-semibold text-brand-navy">{t('unknownNumber')}</span>
          )}
          <p className="font-mono text-xs text-brand-textMuted" dir="ltr">
            &lrm;{formatPhone(c.phone)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {windowOpen && c.windowClosesAt ? (
            <Badge variant="outline" className="text-[10px] font-normal text-brand-textMuted">
              {t('windowOpenUntil', { time: formatTime(c.windowClosesAt, intlLocale) })}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] font-normal text-brand-textMuted">
              {t('windowClosed')}
            </Badge>
          )}
          {knownPatients.length === 0 ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
              <Link2 className="me-1 size-3.5" aria-hidden />
              {t('linkToPatient')}
            </Button>
          ) : null}
        </div>
      </header>

      {thread.nextAppointment ? (
        <p className="border-b border-brand-border bg-brand-bg px-4 py-1.5 text-xs text-brand-textMuted">
          {t('nextAppointment', {
            when: formatDateTime(thread.nextAppointment.startsAt, intlLocale),
            therapist:
              locale === 'ar'
                ? thread.nextAppointment.therapistNameAr || thread.nextAppointment.therapistNameEn
                : thread.nextAppointment.therapistNameEn,
          })}
        </p>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {thread.messages.map((m) => {
          const tap = buttonTapLabel(m);
          const inbound = m.direction === 'INBOUND';
          return (
            <div key={m.id} className={inbound ? 'flex justify-start' : 'flex justify-end'}>
              <div
                className={
                  inbound
                    ? 'max-w-[75%] rounded-lg rounded-ss-none border border-brand-border bg-brand-bg px-3 py-2'
                    : 'max-w-[75%] rounded-lg rounded-se-none bg-brand-cyan/10 px-3 py-2'
                }
              >
                {m.attachments.length > 0 ? <AttachmentBlock attachments={m.attachments} /> : null}
                {tap ? (
                  <p className="text-sm font-medium text-brand-navy">{tap}</p>
                ) : displayBody(m) ? (
                  <p className="whitespace-pre-wrap break-words text-sm text-brand-text" dir="auto">
                    {displayBody(m)}
                  </p>
                ) : null}
                <span className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-brand-textMuted">
                  {m.isTemplate ? (
                    <Badge variant="outline" className="px-1 py-0 text-[9px] font-normal">
                      {t('templateTag')}
                    </Badge>
                  ) : null}
                  {!inbound && m.sentByName ? <span>{m.sentByName}</span> : null}
                  <span className="tabular-nums">{formatDateTime(m.sentAt, intlLocale)}</span>
                  {!inbound ? <DeliveryTicks status={m.status} /> : null}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="border-t border-brand-border p-3">
        {windowOpen ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder={t('composerPlaceholder')}
              dir="auto"
              className="min-h-[2.5rem] w-full resize-y rounded-md border border-brand-border bg-brand-bg px-3 py-2 text-sm outline-none focus:border-brand-cyan"
            />
            <Button type="submit" size="sm" disabled={sending || !body.trim()}>
              <Send className="me-1 size-3.5 rtl:-scale-x-100" aria-hidden />
              {t('send')}
            </Button>
          </form>
        ) : (
          <p className="rounded-md bg-brand-bg px-3 py-2 text-center text-xs text-brand-textMuted">
            {t('windowClosedExplain')}
          </p>
        )}
      </footer>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('linkToPatient')}</DialogTitle>
            <DialogDescription>{t('linkDialogDescription')}</DialogDescription>
          </DialogHeader>
          <SearchableSelect
            value={linkPatientId}
            onChange={setLinkPatientId}
            options={linkOptions}
            emptyValueLabel={t('linkPickPatient')}
            clearable={false}
          />
          {linkTarget ? (
            <p className="text-xs text-brand-textMuted">
              {t('linkConfirmText', {
                name: patientDisplayName(linkTarget.fullNameEn, linkTarget.fullNameAr, locale),
                phone: formatPhone(c.phone),
              })}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLinkOpen(false)}
              disabled={linking}
            >
              {t('cancel')}
            </Button>
            <Button type="button" onClick={confirmLink} disabled={!linkTarget || linking}>
              {t('linkConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
