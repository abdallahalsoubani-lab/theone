import { describe, expect, it } from 'vitest';

import { sniffMatchesDeclared, sniffMime } from '../sniff';

function bytes(...nums: number[]): Uint8Array {
  return new Uint8Array(nums);
}
function pad(head: number[], len = 16): Uint8Array {
  const out = new Uint8Array(len);
  out.set(head.slice(0, len));
  return out;
}

const PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// "RIFF" .... "WEBP"
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
// ftyp box at offset 4, brand "heic" at offset 8
const HEIC = pad([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
]);

describe('sniffMime', () => {
  it('detects PDF', () => expect(sniffMime(PDF)).toBe('application/pdf'));
  it('detects JPEG', () => expect(sniffMime(JPEG)).toBe('image/jpeg'));
  it('detects PNG', () => expect(sniffMime(PNG)).toBe('image/png'));
  it('detects WebP', () => expect(sniffMime(WEBP)).toBe('image/webp'));
  it('detects HEIC', () => expect(sniffMime(HEIC)).toBe('image/heic'));

  it('returns null for too-short input', () => {
    expect(sniffMime(bytes(0x25, 0x50))).toBeNull();
  });

  it('returns null for an unrecognized signature (e.g. a ZIP / renamed exe)', () => {
    // "PK\x03\x04" — a ZIP/docx/xlsx container, deliberately not allowed.
    expect(sniffMime(pad([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
  });

  it('returns null for an ELF executable masquerading as something else', () => {
    expect(sniffMime(pad([0x7f, 0x45, 0x4c, 0x46]))).toBeNull();
  });
});

describe('sniffMatchesDeclared', () => {
  it('passes when declared matches the real bytes', () => {
    expect(sniffMatchesDeclared('application/pdf', PDF)).toBe(true);
    expect(sniffMatchesDeclared('image/png', PNG)).toBe(true);
  });

  it('treats heic and heif as interchangeable', () => {
    expect(sniffMatchesDeclared('image/heif', HEIC)).toBe(true);
    expect(sniffMatchesDeclared('image/heic', HEIC)).toBe(true);
  });

  it('rejects a spoof — PDF declared but JPEG bytes', () => {
    expect(sniffMatchesDeclared('application/pdf', JPEG)).toBe(false);
  });

  it('rejects a renamed executable declared as a PDF', () => {
    expect(sniffMatchesDeclared('application/pdf', pad([0x4d, 0x5a, 0x90, 0x00]))).toBe(false);
  });
});
