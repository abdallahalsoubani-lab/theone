import { describe, expect, it } from 'vitest';

import { isSenderSideFailure, parseFailureReasonCode, parseMetaErrorCode } from '../errors';

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

  // P59 — sender-side classification: these failures are OUR channel's
  // limits/config and must never flip a patient's whatsappReachable flag.
  it('classifies sender-side failures (63018/63049 + provider/template codes)', () => {
    expect(isSenderSideFailure('[63018]')).toBe(true);
    expect(isSenderSideFailure('[63018] daily messaging limit reached')).toBe(true);
    expect(isSenderSideFailure('[63049]')).toBe(true);
    expect(isSenderSideFailure('PROVIDER_RATE_LIMIT [63018]: limit')).toBe(true);
    expect(isSenderSideFailure('TEMPLATE_SID_INVALID: bad ContentSid')).toBe(true);
    expect(isSenderSideFailure('PROVIDER_5XX: upstream down')).toBe(true);
  });

  it('keeps recipient-side failures recipient-side', () => {
    expect(isSenderSideFailure('[63024]')).toBe(false);
    expect(isSenderSideFailure('[63024] recipient not on whatsapp')).toBe(false);
    expect(isSenderSideFailure("INVALID_RECIPIENT [21211]: The 'To' number is invalid")).toBe(
      false,
    );
    expect(isSenderSideFailure('RECIPIENT_OPTED_OUT [21610]: unsubscribed')).toBe(false);
    expect(isSenderSideFailure('recipient unreachable')).toBe(false);
    expect(isSenderSideFailure(null)).toBe(false);
    expect(isSenderSideFailure(undefined)).toBe(false);
  });

  it('does not collide with WhatsAppErrorCode strings', () => {
    // A WhatsAppErrorCode-style reason yields a code via parseFailureReasonCode
    // and NO meta code, so the Admin log shows the friendly WhatsAppErrorCode.
    const reason = 'TEMPLATE_NOT_APPROVED [132001]: (#132001) Template language does not exist';
    expect(parseFailureReasonCode(reason)).toBe('TEMPLATE_NOT_APPROVED');
    expect(parseMetaErrorCode(reason)).toBeNull();
  });
});
