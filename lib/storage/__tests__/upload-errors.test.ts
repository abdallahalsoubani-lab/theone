import { describe, expect, it } from 'vitest';

import { classifyUploadError, UploadHttpError } from '../transport';
import { isStorageUrl } from '../urls';

describe('classifyUploadError (Prompt 32 §3.3 — differentiated failures)', () => {
  it('maps 413 to too_large', () => {
    expect(classifyUploadError(new UploadHttpError(413))).toBe('too_large');
  });

  it('maps 502/503/504 to storage_unavailable', () => {
    for (const status of [502, 503, 504]) {
      expect(classifyUploadError(new UploadHttpError(status))).toBe('storage_unavailable');
    }
  });

  it('maps 401/403 to unauthorized', () => {
    expect(classifyUploadError(new UploadHttpError(401))).toBe('unauthorized');
    expect(classifyUploadError(new UploadHttpError(403))).toBe('unauthorized');
  });

  it('maps the XHR network failure to network', () => {
    expect(classifyUploadError(new Error('Upload network error'))).toBe('network');
  });

  it('everything else is unknown (single last-resort branch)', () => {
    expect(classifyUploadError(new UploadHttpError(500))).toBe('unknown');
    expect(classifyUploadError(new Error('boom'))).toBe('unknown');
    expect(classifyUploadError('weird')).toBe('unknown');
  });
});

describe('isStorageUrl', () => {
  it('accepts proxy paths and absolute http(s)', () => {
    expect(isStorageUrl('/api/v1/storage/exercises/img/u/20260722/a.jpg')).toBe(true);
    expect(isStorageUrl('http://localhost:9000/theone-uploads/x.png')).toBe(true);
    expect(isStorageUrl('https://cdn.example.com/x.png')).toBe(true);
  });

  it('rejects javascript:, bare strings, empty proxy path, protocol-relative', () => {
    expect(isStorageUrl('javascript:alert(1)')).toBe(false);
    expect(isStorageUrl('hello world')).toBe(false);
    expect(isStorageUrl('/api/v1/storage/')).toBe(false);
    expect(isStorageUrl('//evil.example.com/x.jpg')).toBe(false);
  });
});
