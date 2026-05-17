import bcrypt from 'bcryptjs';
import type { User } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

import {
  evaluateLockout,
  lookupPatientByPhone,
  lookupStaffByEmail,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from './lockout';
import { verifyOtp } from './otp';

/**
 * Provider definitions for Auth.js.
 *
 * Both providers swallow specific reasons and return `null` for any failure
 * so the client sees a single, generic INVALID_CREDENTIALS error — no
 * "user not found" / "wrong password" enumeration leak. The pre- and
 * post-checks in the corresponding server actions (`lib/auth/actions/*`)
 * surface lockout state to the UI once it has actually been reached
 * (which is no longer a secret).
 */

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const phoneOtpSchema = z.object({
  // Jordan E.164 mobile — country code 962 + 9-digit subscriber starting with 7.
  phone: z.string().regex(/^\+9627\d{8}$/),
  otp: z.string().regex(/^\d{6}$/),
});

const staffCredentials = Credentials({
  id: 'credentials',
  name: 'Staff credentials',
  credentials: {
    email: { label: 'Email', type: 'email' },
    password: { label: 'Password', type: 'password' },
  },
  async authorize(raw): Promise<User | null> {
    const parsed = credentialsSchema.safeParse(raw);
    if (!parsed.success) return null;

    const user = await lookupStaffByEmail(parsed.data.email);
    if (!user || !user.passwordHash) return null;

    if (evaluateLockout(user).status === 'LOCKED') return null;

    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!ok) {
      await recordFailedAttempt(user.id);
      return null;
    }

    await recordSuccessfulAttempt(user.id);
    return toAuthUser(user);
  },
});

const phoneOtp = Credentials({
  id: 'phone-otp',
  name: 'Phone OTP',
  credentials: {
    phone: { label: 'Phone', type: 'tel' },
    otp: { label: 'OTP', type: 'text' },
  },
  async authorize(raw): Promise<User | null> {
    const parsed = phoneOtpSchema.safeParse(raw);
    if (!parsed.success) return null;

    const user = await lookupPatientByPhone(parsed.data.phone);
    if (!user) return null;

    if (evaluateLockout(user).status === 'LOCKED') return null;

    const result = await verifyOtp(parsed.data.phone, parsed.data.otp);
    if (!result.ok) {
      await recordFailedAttempt(user.id);
      return null;
    }

    await recordSuccessfulAttempt(user.id);
    return toAuthUser(user);
  },
});

export const providers = [staffCredentials, phoneOtp];

function toAuthUser(row: {
  id: string;
  email: string | null;
  fullNameEn: string;
  fullNameAr: string;
  role: User['role'];
  languagePref: User['languagePref'];
  mustChangePassword: boolean;
}): User {
  return {
    id: row.id,
    email: row.email ?? undefined,
    name: row.fullNameEn,
    role: row.role,
    languagePref: row.languagePref,
    mustChangePassword: row.mustChangePassword,
    fullNameEn: row.fullNameEn,
    fullNameAr: row.fullNameAr,
  };
}
