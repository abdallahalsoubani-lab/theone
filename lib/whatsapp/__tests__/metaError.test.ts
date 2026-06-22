import { describe, expect, it } from 'vitest';

import { parseFailureReasonCode, parseMetaErrorCode } from '../errors';

describe('parseMetaErrorCode (QA retest #9)', () => {
  it('extracts the numeric Meta code from a delivery failureReason', () => {
    expect(parseMetaErrorCode('[131042] Business eligibility payment issue')).toBe(131042);
    expect(parseMetaErrorCode('[131026] Undeliverable no whatsapp')).toBe(131026);
  });

  it('returns null when there is no leading bracketed code', () => {
    expect(parseMetaErrorCode('TEMPLATE_NOT_APPROVED: nope')).toBeNull();
    expect(parseMetaErrorCode('')).toBeNull();
    expect(parseMetaErrorCode(null)).toBeNull();
    expect(parseMetaErrorCode(undefined)).toBeNull();
  });

  it('does not collide with WhatsAppErrorCode strings', () => {
    // A WhatsAppErrorCode-style reason yields a code via parseFailureReasonCode
    // and NO meta code, so the Admin log shows the friendly WhatsAppErrorCode.
    const reason = 'TEMPLATE_NOT_APPROVED [132001]: (#132001) Template language does not exist';
    expect(parseFailureReasonCode(reason)).toBe('TEMPLATE_NOT_APPROVED');
    expect(parseMetaErrorCode(reason)).toBeNull();
  });
});
