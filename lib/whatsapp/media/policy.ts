/**
 * P56 — inbound WhatsApp media allowlist + size caps. Never trust the
 * provider-declared content type alone for RENDERING (the UI still treats
 * a stored file as opaque until served), but we DO use it to accept/reject
 * at download time, aligned with WhatsApp's own limits.
 */

export interface MediaTypeRule {
  /** Max bytes accepted for this class (WhatsApp's own ceilings). */
  maxBytes: number;
  /** File extension for the stored object key. */
  ext: string;
  /** Coarse class for UI rendering. */
  kind: 'image' | 'video' | 'audio' | 'document';
}

const MB = 1024 * 1024;

/** Allowlisted content types → their rule. Anything not here is rejected. */
export const MEDIA_RULES: Record<string, MediaTypeRule> = {
  'image/jpeg': { maxBytes: 5 * MB, ext: 'jpg', kind: 'image' },
  'image/png': { maxBytes: 5 * MB, ext: 'png', kind: 'image' },
  'image/webp': { maxBytes: 5 * MB, ext: 'webp', kind: 'image' },
  'video/mp4': { maxBytes: 16 * MB, ext: 'mp4', kind: 'video' },
  'video/3gpp': { maxBytes: 16 * MB, ext: '3gp', kind: 'video' },
  'audio/ogg': { maxBytes: 16 * MB, ext: 'ogg', kind: 'audio' },
  'audio/mpeg': { maxBytes: 16 * MB, ext: 'mp3', kind: 'audio' },
  'audio/amr': { maxBytes: 16 * MB, ext: 'amr', kind: 'audio' },
  'application/pdf': { maxBytes: 16 * MB, ext: 'pdf', kind: 'document' },
};

/** Normalize a provider content type ("video/mp4; codecs=…") to its base. */
export function baseContentType(raw: string | null | undefined): string {
  return (raw ?? '').split(';')[0]!.trim().toLowerCase();
}

export function ruleForContentType(raw: string | null | undefined): MediaTypeRule | null {
  return MEDIA_RULES[baseContentType(raw)] ?? null;
}

/** The coarse class for the UI, or 'document' as a safe fallback. */
export function mediaKind(raw: string | null | undefined): MediaTypeRule['kind'] {
  return ruleForContentType(raw)?.kind ?? 'document';
}
