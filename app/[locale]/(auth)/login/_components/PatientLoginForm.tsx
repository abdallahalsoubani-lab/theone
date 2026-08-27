'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInAsPickedPatient, verifyOtpAndSignIn } from '@/lib/auth/actions/login';
import { requestOtpAction } from '@/lib/auth/actions/otp';
import type { PickableProfile } from '@/lib/auth/profile-pick';
import { patientDisplayName } from '@/lib/format/patientName';

import { errorMessageKey } from './errorMessage';

type Step = 'phone' | 'otp' | 'pick';

export function PatientLoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const locale = useLocale();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // P57 — shared family number: the OTP verified, now choose the profile.
  const [pick, setPick] = useState<{ token: string; patients: PickableProfile[] } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const go = (redirectTo: string) => {
    router.replace(`/${locale}${redirectTo}`);
    router.refresh();
  };

  const sendOtp = () => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await requestOtpAction({ phone });
      if (!result.ok) {
        setError(errorMessageKey(result.error.code));
        return;
      }
      setStep('otp');
      setCooldown(result.data.cooldownSeconds);
      setInfo('otpSent');
    });
  };

  const verifyOtp = (otp: string) => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await verifyOtpAndSignIn({ phone, otp });
      if (!result.ok) {
        setError(errorMessageKey(result.error.code));
        return;
      }
      if (result.data.pick) {
        setPick(result.data.pick);
        setStep('pick');
        return;
      }
      if (result.data.redirectTo) go(result.data.redirectTo);
    });
  };

  const openProfile = (patientId: string) => {
    if (!pick) return;
    setError(null);
    startTransition(async () => {
      const result = await signInAsPickedPatient({ token: pick.token, patientId });
      if (!result.ok) {
        setError(errorMessageKey(result.error.code));
        return;
      }
      if (result.data.redirectTo) go(result.data.redirectTo);
    });
  };

  if (step === 'phone') {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          sendOtp();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="patient-phone">{t('phoneLabel')}</Label>
          <Input
            id="patient-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={t('phonePlaceholder')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending || !phone}>
          {pending ? t('signingIn') : t('sendOtp')}
        </Button>
      </form>
    );
  }

  if (step === 'pick' && pick) {
    // P57 — one OTP, then choose. Only ACTIVE patients on the number are
    // listed (archived records never reach the client). The birth year
    // separates siblings with similar names; it is omitted while the DOB is
    // still the quick-add placeholder.
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium text-brand-navy">{t('pickProfileTitle')}</h2>
          <p className="text-sm text-brand-textMuted">{t('pickProfileHint')}</p>
        </div>
        <ul className="space-y-2" aria-label={t('pickProfileTitle')}>
          {pick.patients.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => openProfile(p.id)}
                disabled={pending}
                className="flex w-full items-center justify-between rounded-md border border-brand-border bg-brand-surface px-4 py-3 text-start text-sm text-brand-navy transition-colors hover:border-brand-cyan hover:bg-brand-bg disabled:opacity-50"
              >
                <bdi className="font-medium">
                  {patientDisplayName(p.fullNameEn, p.fullNameAr, locale)}
                </bdi>
                {p.dobYear ? (
                  <span className="text-xs text-brand-textMuted">
                    {t('pickBornIn', { year: p.dobYear })}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        ) : null}
        <button
          type="button"
          className="text-sm text-brand-cyan underline-offset-4 hover:underline"
          onClick={() => {
            setPick(null);
            setStep('phone');
            setError(null);
            setInfo(null);
          }}
        >
          {t('back')}
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const otp = String(new FormData(e.currentTarget).get('otp') ?? '');
        verifyOtp(otp);
      }}
    >
      {info ? (
        <p className="rounded-md bg-brand-bg px-3 py-2 text-sm text-brand-navy">{t(info)}</p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="patient-otp">{t('otpLabel')}</Label>
        <Input
          id="patient-otp"
          name="otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder={t('otpPlaceholder')}
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t('signingIn') : t('signIn')}
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="text-brand-cyan underline-offset-4 hover:underline"
          onClick={() => {
            setStep('phone');
            setError(null);
            setInfo(null);
          }}
        >
          {t('back')}
        </button>
        <button
          type="button"
          className="text-brand-cyan underline-offset-4 hover:underline disabled:opacity-50"
          onClick={sendOtp}
          disabled={cooldown > 0 || pending}
        >
          {cooldown > 0 ? t('resendIn', { seconds: cooldown }) : t('resendOtp')}
        </button>
      </div>
    </form>
  );
}
