/**
 * Map an `auth.actions` error code to the translation key under `auth.*`.
 * Centralizing this lets each form just call `t(errorMessageKey(code))`.
 */
export function errorMessageKey(code: string): string {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 'invalidCredentials';
    case 'ACCOUNT_LOCKED':
      return 'accountLocked';
    case 'OTP_EXPIRED':
      return 'otpExpired';
    case 'OTP_INVALID':
      return 'otpInvalid';
    case 'OTP_LOCKED':
      return 'otpLocked';
    case 'OTP_COOLDOWN':
      return 'otpCooldown';
    case 'RATE_LIMITED':
      return 'rateLimited';
    case 'WEAK_PASSWORD':
      return 'weakPassword';
    case 'TOKEN_INVALID':
      return 'tokenInvalid';
    // P57 — a shared family number never renders as "invalid credentials":
    // the normal path is the profile picker; these are the explicit states.
    case 'PHONE_AMBIGUOUS':
      return 'phoneAmbiguous';
    case 'PICK_INVALID':
      return 'pickExpired';
    default:
      return 'invalidCredentials';
  }
}
