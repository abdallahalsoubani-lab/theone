import type { PatientDocMime } from './policy';

/**
 * Magic-byte content sniff (Prompt 22 §3 storage safety). Detects the REAL
 * type of an uploaded object from its leading bytes — so a `.exe` renamed
 * `.pdf` (or any declared-type spoof) is rejected. Pure + unit-tested; the
 * caller fetches the object's first bytes from S3 and passes them here.
 */

function ascii(bytes: Uint8Array, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i] ?? 0);
  return s;
}

const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
  'heif',
]);

/** Detect the canonical MIME from magic bytes, or null if unrecognized. */
export function sniffMime(bytes: Uint8Array): PatientDocMime | null {
  if (bytes.length < 12) return null;
  // PDF — "%PDF"
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'application/pdf';
  }
  // JPEG — FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // PNG — 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  // WebP — "RIFF"...."WEBP"
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  // HEIC/HEIF — "ftyp" box at offset 4 with a HEIF brand at offset 8
  if (ascii(bytes, 4, 4) === 'ftyp' && HEIF_BRANDS.has(ascii(bytes, 8, 4))) return 'image/heic';
  return null;
}

/**
 * True when the object's real bytes match the declared content-type. HEIC and
 * HEIF share a container, so they're treated as interchangeable.
 */
export function sniffMatchesDeclared(declared: string, bytes: Uint8Array): boolean {
  const detected = sniffMime(bytes);
  if (!detected) return false;
  if (declared === detected) return true;
  if ((declared === 'image/heic' || declared === 'image/heif') && detected === 'image/heic') {
    return true;
  }
  return false;
}
