/**
 * Display-layer rendering for stored WhatsApp TEMPLATE messages (P52
 * follow-up incident): historical rows persist the technical preview
 * `template:name(param1, param2, …)` — the patient received the real
 * provider-composed text, but the secretary saw code. This shared renderer
 * recomposes the actual text from the registry body (`contentPreview`, in
 * the template's own language) + the stored parameters, and is used by the
 * Inbox thread, the conversation-list snippet, and the Admin message log.
 *
 * Going forward the outbound worker stores the composed text directly
 * (same substitution at send time), so this mainly serves historical rows.
 */

export type RenderedWaBody =
  | { kind: 'text'; text: string }
  | { kind: 'template'; text: string }
  | { kind: 'templateFallback'; templateName: string; params: string[] };

const RAW_TEMPLATE_RE = /^template:([\w.-]+|\?)(?:\((.*)\))?$/s;

/** Stored row parameters `{"1": v1, "2": v2, …}` → ordered array. */
export function orderedParams(parameters: unknown): string[] {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return [];
  return Object.entries(parameters as Record<string, unknown>)
    .filter(([k]) => /^\d+$/.test(k))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, v]) => String(v));
}

export function substituteTemplateBody(contentPreview: string, params: readonly string[]): string {
  return contentPreview.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => {
    const v = params[Number(n) - 1];
    return v !== undefined && v !== '' ? v : `{{${n}}}`;
  });
}

export function renderWaBody(args: {
  body: string;
  parameters?: unknown;
  templateContentPreview?: string | null;
}): RenderedWaBody {
  const raw = RAW_TEMPLATE_RE.exec(args.body);
  if (!raw) {
    // Free-form session text — or a post-fix row already storing the
    // composed template text. Untouched either way.
    return { kind: 'text', text: args.body };
  }
  const templateName = raw[1] === '?' ? '' : raw[1]!;
  const params = (() => {
    const fromRow = orderedParams(args.parameters);
    if (fromRow.length > 0) return fromRow;
    // Legacy rows without stored parameters: last-resort parse of the
    // technical string's parenthetical.
    return (raw[2] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  })();
  if (args.templateContentPreview) {
    return { kind: 'template', text: substituteTemplateBody(args.templateContentPreview, params) };
  }
  return { kind: 'templateFallback', templateName, params };
}
