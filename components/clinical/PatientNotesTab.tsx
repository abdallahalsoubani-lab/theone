import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import type { SessionNoteRow } from '@/lib/clinical/session-notes/queries';

interface Props {
  notes: SessionNoteRow[];
  /** Viewer's role gates the Edit / Add addendum buttons. */
  viewerRole: 'DOCTOR' | 'THERAPIST' | 'SECRETARY' | 'ADMIN' | 'PATIENT';
  /** The current actor's user id — needed for "is author" gating. */
  actorId: string;
  locale: 'en' | 'ar';
}

/**
 * Patient File "Session notes" tab.
 *
 * Newest-first list of primary notes; addenda nested under their
 * primary. Each card shows SOAP + pain score + measurements +
 * therapist + timestamp. Author-only Edit button (within 24h) and
 * Add-addendum button (any therapist/doctor) live on the card.
 */
export async function PatientNotesTab({ notes, viewerRole, actorId, locale }: Props) {
  const t = await getTranslations('clinical.notes');
  const localeTag = locale === 'ar' ? 'ar' : 'en';
  const canAddendum =
    viewerRole === 'DOCTOR' || viewerRole === 'THERAPIST' || viewerRole === 'ADMIN';

  if (notes.length === 0) {
    return (
      <div className="rounded-md border border-brand-border bg-brand-surface p-12 text-center text-sm text-brand-textMuted">
        {t('empty')}
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {notes.map((note) => {
        const isAuthor = note.therapistId === actorId;
        const canEdit = isAuthor && note.isWithinEditWindow;
        const therapistName = locale === 'ar' ? note.therapistFullNameAr : note.therapistFullNameEn;

        return (
          <li
            key={note.id}
            className="space-y-3 rounded-md border border-brand-border bg-brand-surface p-4"
          >
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-brand-navy">{therapistName}</p>
                <p className="text-xs text-brand-textMuted">
                  {note.createdAt.toLocaleString(localeTag)}
                  {note.painScore != null ? ` · ${t('painScore')} ${note.painScore}/10` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canEdit ? (
                  <Link
                    href={`/therapist/sessions/notes/${note.id}/edit` as `/${string}`}
                    className="text-xs text-brand-cyan hover:underline"
                  >
                    {t('edit')}
                  </Link>
                ) : null}
                {canAddendum && !note.isWithinEditWindow ? (
                  <Link
                    href={`/therapist/sessions/notes/${note.id}/addendum` as `/${string}`}
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
                        {aTherapist} · {a.createdAt.toLocaleString(localeTag)}
                      </p>
                      <Soap label={t('subjective')} value={a.subjective} />
                      <Soap label={t('objective')} value={a.objective} />
                      <Soap label={t('assessment')} value={a.assessment} />
                      <Soap label={t('planField')} value={a.plan} />
                    </div>
                  );
                })}
              </section>
            ) : null}
          </li>
        );
      })}
    </ul>
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
