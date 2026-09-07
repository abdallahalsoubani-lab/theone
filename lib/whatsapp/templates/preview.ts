import type { LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';

import { substituteTemplateBody } from './render';

/**
 * P60 — render the exact text a template send will produce, from the
 * registry body (`contentPreview`, in the template's own language) and the
 * composed parameters. This is the SAME substitution the outbound worker
 * stores as the message body, so the appointment panel's preview and the
 * admin log agree by construction.
 *
 * Returns null when the registry has no row (a configuration error the
 * caller surfaces rather than guessing at a body).
 */
export async function renderTemplatePreview(args: {
  templateName: string;
  language: LanguagePref;
  parameters: readonly string[];
}): Promise<string | null> {
  const row = await db.whatsAppTemplate.findUnique({
    where: { name_language: { name: args.templateName, language: args.language } },
    select: { contentPreview: true },
  });
  if (!row?.contentPreview) return null;
  return substituteTemplateBody(row.contentPreview, args.parameters);
}

/** The raw frame (no substitution) — the panel re-renders the custom text
 *  live on the client with `substituteTemplateBody`. */
export async function templateFrame(
  templateName: string,
  language: LanguagePref,
): Promise<string | null> {
  const row = await db.whatsAppTemplate.findUnique({
    where: { name_language: { name: templateName, language } },
    select: { contentPreview: true },
  });
  return row?.contentPreview ?? null;
}
