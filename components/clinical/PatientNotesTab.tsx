import { FileText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import {
  sessionNoteAddendumHref,
  sessionNoteCreateHref,
  sessionNoteEditHref,
} from '@/lib/clinical/role-links';
import type {
  ReportableAppointmentRow,
  SessionNoteRow,
} from '@/lib/clinical/session-notes/queries';
import { formatDateTime } from '@/lib/format/date';

interface Props {
  notes: SessionNoteRow[];
  /** Viewer's role gates the Edit / Add addendum buttons. */
  viewerRole: 'DOCTOR' | 'THERAPIST' | 'SECRETARY' | 'ADMIN' | 'PATIENT';
  /** The current actor's user id — needed for "is author" gating. */
  actorId: string;
  locale: 'en' | 'ar';
  /** Prompt 46 row 5 — finished sessions still missing their report. The
   *  tab shows an "add report" row per entry for authoring roles;
   *  a THERAPIST viewer only sees their own assigned sessions. */
  addable?: ReportableAppointmentRow[];
}

/**
 * Patient File "Session notes" tab.
 *
 * Newest-first list of primary notes; addenda nested under their
 * primary. Each card shows SOAP + pain score + measurements +
 * therapist + timestamp. Author-only Edit button (within 24h) and
 * Add-addendum button (any therapist/doctor) live on the card.
 */
export async function PatientNotesTab({ notes, viewerRole, actorId, locale, addable = [] }: Props) {
  const t = await getTranslations('clinical.notes');
  const localeTag = locale === 'ar' ? 'ar' : 'en';
  const canAuthor = viewerRole === 'DOCTOR' || viewerRole === 'THERAPIST' || viewerRole === 'ADMIN';
  const canAddendum = canAuthor;

  // Assigned-only for a therapist viewer; doctor/admin see every missing
  // report (the doctor authors for any session — Prompt 46 row 5).
  const missingReports = canAuthor
    ? addable.filter((a) => viewerRole !== 'THERAPIST' || a.therapistIds.includes(actorId))
    : [];

  const missingSection =
    missingReports.length > 0 ? (
      <section className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
          {t('missingReportsHeading')}
        </p>
        <ul className="space-y-1">
          {missingReports.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-brand-text">
                <bdi>{formatDateTime(a.startsAt, localeTag)}</bdi>
              </span>
              <Link
                href={(sessionNoteCreateHref(viewerRole, a.id) ?? '/') as `/${string}`}
                className="inline-flex items-center gap-1 rounded-md bg-brand-cyan px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-cyan/90"
              >
                <FileText className="size-3.5" />
                {t('addReport')}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  if (notes.length === 0) {
    return (
      <div className="space-y-4">
        {missingSection}
        <div className="rounded-md border border-brand-border bg-brand-surface p-12 text-center text-sm text-brand-textMuted">
          {t('empty')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {missingSection}
      <ul className="space-y-4">
        {notes.map((note) => {
          const isAuthor = note.therapistId === actorId;
          const canEdit = isAuthor && note.isWithinEditWindow;
          const therapistName =
            locale === 'ar' ? note.therapistFullNameAr : note.therapistFullNameEn;

          return (
            <li
              key={note.id}
              className="space-y-3 rounded-md border border-brand-border bg-brand-surface p-4"
            >
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-brand-navy">{therapistName}</p>
                  <p className="text-xs text-brand-textMuted">
                    <bdi>{formatDateTime(note.createdAt, localeTag)}</bdi>
                    {note.painScore != null ? ` · ${t('painScore')} ${note.painScore}/10` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* Role-aware hrefs (Prompt 46 row 5): these used to hardcode
                    /therapist/… — a 404 for a doctor viewer. */}
                  {canEdit && sessionNoteEditHref(viewerRole, note.id) ? (
                    <Link
                      href={sessionNoteEditHref(viewerRole, note.id) as `/${string}`}
                      className="text-xs text-brand-cyan hover:underline"
                    >
                      {t('edit')}
                    </Link>
                  ) : null}
                  {canAddendum &&
                  !note.isWithinEditWindow &&
                  sessionNoteAddendumHref(viewerRole, note.id) ? (
                    <Link
                      href={sessionNoteAddendumHref(viewerRole, note.id) as `/${string}`}
                      className="text-xs text-brand-cyan hover:underline"
                    >
                      {t('addAddendum')}
                    </Link>
                  ) : null}
                </div>
              </header>

              <Soap label={t('subjective')} value={note.subjective} />
              <Soap label={t('objective')} value={note.objective} />
              <Soap label={t('assessment')} value={note.assessment} />
              <Soap label={t('planField')} value={note.plan} />
              {note.measurementsText ? (
                <Soap label={t('measurements')} value={note.measurementsText} />
              ) : null}

              {note.addenda.length > 0 ? (
                <section className="mt-3 space-y-2 rounded-md border border-dashed border-brand-border bg-brand-bg p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-textMuted">
                    {t('addendaHeading')}
                  </p>
                  {note.addenda.map((a) => {
                    const aTherapist =
                      locale === 'ar' ? a.therapistFullNameAr : a.therapistFullNameEn;
                    return (
                      <div key={a.id} className="space-y-2 border-t border-brand-border pt-2">
                        <p className="text-xs text-brand-textMuted">
                          <bdi>{aTherapist}</bdi> ·{' '}
                          <bdi>{formatDateTime(a.createdAt, localeTag)}</bdi>
                          {a.painScore != null ? ` · ${t('painScore')} ${a.painScore}/10` : ''}
                        </p>
                        <Soap label={t('subjective')} value={a.subjective} />
                        <Soap label={t('objective')} value={a.objective} />
                        <Soap label={t('assessment')} value={a.assessment} />
                        <Soap label={t('planField')} value={a.plan} />
                        {a.measurementsText ? (
                          <Soap label={t('measurements')} value={a.measurementsText} />
                        ) : null}
                      </div>
                    );
                  })}
                </section>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Soap({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-brand-textMuted">{label}</p>
      <p className="whitespace-pre-wrap text-sm text-brand-text">{value}</p>
    </div>
  );
}
