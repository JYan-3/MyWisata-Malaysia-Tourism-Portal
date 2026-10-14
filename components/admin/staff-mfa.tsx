"use client";

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { safeAdminNext, safeKycReviewNext } from '@/lib/auth/safe-next';

// Authenticator (TOTP) setup and verification for staff. `kyc` keeps the KYC
// review wording and return paths; `staff` is the general admin gate that the
// request proxy sends aal1 staff sessions to.
// Plan: Docs/plans/2026-10-14-1543-staff-two-factor-login.md
type MfaScope = 'kyc' | 'staff';
const FRIENDLY_NAME: Record<MfaScope, string> = { kyc: 'MyLawatan KYC', staff: 'MyLawatan' };

export function StaffMfa({ next, available = true, scope = 'staff' }: { next: string; available?: boolean; scope?: MfaScope }) {
  const safeNextPath = scope === 'kyc' ? safeKycReviewNext : safeAdminNext;
  const { t } = useTranslation('admin');
  const router = useRouter();
  const db = useMemo(() => createClient(), []);
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy || !available) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: listError } = await db.auth.mfa.listFactors();
      if (listError || !data) throw new Error();
      const verified = data.totp.find(factor => factor.status === 'verified');
      if (verified) {
        setFactorId(verified.id);
        setQr(null);
        setEnrolling(false);
      } else {
        // Retry only this flow's abandoned, unverified factors.
        for (const factor of data.all.filter(factor => factor.factor_type === 'totp' && factor.status === 'unverified' && factor.friendly_name === FRIENDLY_NAME[scope])) {
          const { error: cleanupError } = await db.auth.mfa.unenroll({ factorId: factor.id });
          if (cleanupError) throw new Error();
        }
        const { data: enrollment, error: enrollError } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: FRIENDLY_NAME[scope], issuer: 'MyLawatan' });
        if (enrollError || !enrollment || enrollment.type !== 'totp' || !enrollment.totp.qr_code.startsWith('data:image/svg+xml;')) throw new Error();
        setFactorId(enrollment.id);
        setQr(enrollment.totp.qr_code);
        setEnrolling(true);
      }
      setCode('');
    } catch { setError(t('kyc.mfa.setupError')); }
    finally { setBusy(false); }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy || !factorId || !/^[0-9]{6}$/.test(code)) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await db.auth.mfa.challengeAndVerify({ factorId, code });
      if (verifyError) throw new Error();
      const { data, error: claimsError } = await db.auth.getClaims();
      if (claimsError || data?.claims.aal !== 'aal2') throw new Error();
      setQr(null);
      setCode('');
      setFactorId('');
      setEnrolling(false);
      router.replace(safeNextPath(next));
      router.refresh();
    } catch {
      setCode('');
      setError(t('kyc.mfa.verifyError'));
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (busy) return;
    setBusy(true);
    try {
      if (enrolling && factorId) {
        const { error: cleanupError } = await db.auth.mfa.unenroll({ factorId });
        if (cleanupError) throw new Error();
      }
      setQr(null);
      setCode('');
      setFactorId('');
      setEnrolling(false);
      setError(null);
    } catch { setError(t('kyc.mfa.cancelError')); }
    finally { setBusy(false); }
  }

  return (
    <AdminPageShell>
      <AdminPageHeader eyebrow={<><ShieldCheck size={18} /> {t(scope === 'kyc' ? 'kyc.eyebrow' : 'security.eyebrow')}</>} title={t(scope === 'kyc' ? 'kyc.mfa.title' : 'security.title')} description={t(scope === 'kyc' ? 'kyc.mfa.description' : 'security.description')} />
      <section className="max-w-xl space-y-4 rounded-2xl border border-border bg-card p-6">
        {(!available || error) && <p role="alert" className="text-sm text-destructive">{error ?? t('kyc.mfa.setupError')}</p>}
        {!factorId ? <Button disabled={busy || !available} onClick={() => void start()}>{t(busy ? 'kyc.mfa.working' : 'kyc.mfa.start')}</Button> : (
          <form onSubmit={verify} className="space-y-4">
            {qr && <>
              <p className="text-sm text-muted-foreground">{t('kyc.mfa.scan')}</p>
              {/* The QR is held in memory only and never sent to an external image service. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={t('kyc.mfa.qrAlt')} className="h-56 w-56 rounded-xl bg-white p-3" referrerPolicy="no-referrer" />
            </>}
            <label htmlFor="kyc-mfa-code" className="block text-sm font-semibold">{t('kyc.mfa.code')}</label>
            <Input id="kyc-mfa-code" value={code} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} />
            <div className="flex gap-3">
              <Button type="submit" disabled={busy || code.length !== 6}>{t(busy ? 'kyc.mfa.working' : 'kyc.mfa.verify')}</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void cancel()}>{t('kyc.mfa.cancel')}</Button>
            </div>
          </form>
        )}
        <p className="text-sm text-muted-foreground">{t('kyc.mfa.recovery')}</p>
      </section>
    </AdminPageShell>
  );
}
